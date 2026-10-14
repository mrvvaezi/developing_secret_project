import asyncio
import os
import hashlib
import io
import sqlite3
import tempfile
import uuid
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, Request, UploadFile, WebSocketDisconnect

from backend.app import main, auth
from pg_support import isolate_database


TONE = (Path(__file__).parent / 'fixtures' / 'tone.mp3').read_bytes()


@unittest.skipUnless(os.environ.get('MUSIC_DB_NAME', '').startswith('music_room_auth_test'), 'Requires isolated PostgreSQL test database')
class MusicRoomTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isolate_database(self)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.patches = patch.multiple(main, DATA=root, MUSIC=root / 'music', DB=root / 'music.db',
                                      ADMIN_TOKEN='test-token', STATE_LOCK=asyncio.Lock(), clients=set())
        self.patches.start()
        self.addCleanup(self.patches.stop)
        main.init_db()

    async def upload(self, data=TONE, name='tone.mp3'):
        file = UploadFile(filename=name, file=io.BytesIO(data))
        try:
            return await main.upload(self.listener('Test'), file)
        finally:
            await file.close()

    async def control(self, action, **values):
        return await main.control({'action': action, **values}, 'test-token')

    def counts(self):
        with main.db() as con:
            return (con.execute('SELECT count(*) AS total FROM tracks').fetchone()['total'],
                    con.execute('SELECT count(*) AS total FROM queue').fetchone()['total'],
                    len(list(main.MUSIC.glob('*.mp3'))))

    async def test_renamed_current_duplicate_is_rejected_and_cleaned(self):
        original = await self.upload()
        with self.assertRaises(HTTPException) as error:
            await self.upload(name='renamed.mp3')
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(main.snapshot()['current']['id'], original['id'])
        self.assertEqual(self.counts(), (1, 0, 1))

    async def test_queued_duplicate_and_same_name_different_content(self):
        await self.upload()
        second = await self.upload(TONE + b'other-content')
        with self.assertRaises(HTTPException) as error:
            await self.upload(TONE + b'other-content', 'renamed.mp3')
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual([t['id'] for t in main.snapshot()['queue']], [second['id']])
        self.assertEqual(self.counts(), (2, 1, 2))

    async def test_finished_track_is_reused_without_copy(self):
        original = await self.upload()
        await self.control('next')
        again = await self.upload(name='renamed.mp3')
        self.assertEqual(again['id'], original['id'])
        self.assertEqual(self.counts(), (1, 0, 1))

    async def test_concurrent_duplicate_uploads_add_only_one_track(self):
        outcomes = await asyncio.gather(self.upload(), self.upload(), return_exceptions=True)
        self.assertEqual(sum(isinstance(r, dict) for r in outcomes), 1)
        self.assertEqual([r.status_code for r in outcomes if isinstance(r, HTTPException)], [409])
        self.assertEqual(self.counts(), (1, 0, 1))

    async def test_shuffle_is_admin_only_and_requires_boolean(self):
        with self.assertRaises(HTTPException) as error:
            await main.control({'action': 'shuffle', 'enabled': True}, None)
        self.assertEqual(error.exception.status_code, 403)
        for value in ('false', 1, None):
            with self.assertRaises(HTTPException) as error:
                await self.control('shuffle', enabled=value)
            self.assertEqual(error.exception.status_code, 400)
        self.assertFalse(main.snapshot()['shuffle'])

    async def test_shuffle_keeps_current_and_consumes_queue_without_repeats(self):
        current = await self.upload()
        queued = [(await self.upload(TONE + bytes([i])))['id'] for i in range(4)]
        await self.control('pause')
        await self.control('seek', position=0.05)
        await self.control('shuffle', enabled=True)
        state = main.snapshot()
        self.assertTrue(state['shuffle'])
        self.assertEqual(state['current']['id'], current['id'])
        self.assertFalse(state['playing'])
        self.assertEqual(state['position'], 0.05)
        await self.control('next')
        played = [main.snapshot()['current']['id']]
        self.assertIn(played[0], queued)
        for _ in range(3):
            await self.control('next')
            played.append(main.snapshot()['current']['id'])
        self.assertCountEqual(played, queued)
        await self.control('next')
        self.assertIsNone(main.snapshot()['current'])
        self.assertEqual(main.snapshot()['queue'], [])

    async def test_disabling_shuffle_restores_fifo_and_setting_survives_restart(self):
        await self.upload()
        second = await self.upload(TONE + b'second')
        await self.upload(TONE + b'third')
        await self.control('shuffle', enabled=True)
        main.init_db()
        self.assertTrue(main.snapshot()['shuffle'])
        await self.control('shuffle', enabled=False)
        await self.control('next')
        self.assertEqual(main.snapshot()['current']['id'], second['id'])

    async def test_automatic_completion_uses_shuffle(self):
        await self.upload()
        next_track = await self.upload(TONE + b'second')
        await self.control('shuffle', enabled=True)
        with main.db() as con:
            con.execute('UPDATE state SET started=%s WHERE id=1', (time.time() - 100,))
        self.assertTrue(main.advance_if_finished())
        self.assertEqual(main.snapshot()['current']['id'], next_track['id'])

    async def test_legacy_database_migration_and_duplicate_detection(self):
        legacy_db = main.DATA / 'legacy.db'
        with sqlite3.connect(legacy_db) as con:
            con.execute('CREATE TABLE tracks (id TEXT PRIMARY KEY, title TEXT NOT NULL, uploader TEXT NOT NULL, duration REAL NOT NULL, filename TEXT NOT NULL, created REAL NOT NULL)')
            con.execute('CREATE TABLE queue (position INTEGER PRIMARY KEY AUTOINCREMENT, track_id TEXT NOT NULL REFERENCES tracks(id))')
            con.execute('CREATE TABLE state (id INTEGER PRIMARY KEY CHECK (id=1), track_id TEXT, started REAL, offset REAL NOT NULL DEFAULT 0, playing INTEGER NOT NULL DEFAULT 0)')
            con.execute("INSERT INTO tracks VALUES ('legacy','old.mp3','Old',1,'old.mp3',0)")
            con.execute("INSERT INTO state VALUES (1,'legacy',NULL,0,0)")
        (main.MUSIC / 'old.mp3').write_bytes(TONE)
        with main.db() as con:
            con.execute('DROP TABLE reactions,play_history,queue,state,tracks,chat_messages,storage_migrations CASCADE')
        with patch.object(main, 'DB', legacy_db):
            main.init_db()
            main.init_db()
            with main.db() as con:
                self.assertEqual(con.execute('SELECT content_hash FROM tracks').fetchone()['content_hash'], hashlib.sha256(TONE).hexdigest())
            self.assertFalse(main.snapshot()['shuffle'])
            with self.assertRaises(HTTPException) as error:
                await self.upload(name='renamed-old.mp3')
            self.assertEqual(error.exception.status_code, 409)
            await self.upload(TONE + b'new')
            self.assertEqual(len(main.snapshot()['queue']), 1)

    async def test_library_keeps_finished_and_removed_tracks_and_files(self):
        first = await self.upload()
        second = await self.upload(TONE + b'second', 'other.mp3')
        await self.control('remove', track_id=second['id'])
        await self.control('next')
        archive = main.library(q='', limit=25, offset=0)
        self.assertEqual(archive['total'], 2)
        self.assertCountEqual([r['id'] for r in archive['items']], [first['id'], second['id']])
        self.assertEqual(self.counts(), (2, 0, 2))
        self.assertEqual(main.history(limit=25, offset=0)['total'], 1)

    async def test_library_search_pagination_and_literal_wildcards(self):
        await self.upload(name='100%.mp3')
        await self.upload(TONE + b'second', 'other.mp3')
        result = main.library(q='%', limit=25, offset=0)
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['items'][0]['title'], '100%.mp3')
        first = main.library(q='', limit=1, offset=0)
        second = main.library(q='', limit=1, offset=1)
        self.assertEqual(first['total'], 2)
        self.assertNotEqual(first['items'][0]['id'], second['items'][0]['id'])

    async def test_archive_enqueue_blocks_duplicates_and_reuses_file(self):
        track = await self.upload()
        with self.assertRaises(HTTPException) as error:
            await main.enqueue(track['id'])
        self.assertEqual(error.exception.status_code, 409)
        await self.control('next')
        await main.enqueue(track['id'])
        self.assertEqual(main.snapshot()['current']['id'], track['id'])
        self.assertEqual(self.counts(), (1, 0, 1))
        self.assertEqual(main.history(limit=25, offset=0)['total'], 2)

    async def test_history_completion_skip_and_pause_resume(self):
        first = await self.upload()
        second = await self.upload(TONE + b'second')
        await self.control('pause')
        await self.control('play')
        self.assertEqual(main.history(limit=25, offset=0)['total'], 1)
        with main.db() as con:
            con.execute('UPDATE state SET started=%s WHERE id=1', (time.time() - 100,))
        main.advance_if_finished()
        await self.control('next')
        events = main.history(limit=25, offset=0)['items']
        self.assertEqual([e['id'] for e in events], [second['id'], first['id']])
        self.assertEqual([e['outcome'] for e in events], ['skipped', 'completed'])
        self.assertTrue(all(e['ended_at'] >= e['started_at'] for e in events))

    async def test_library_history_survive_restart_without_duplicate_resume(self):
        await self.upload()
        before = main.history(limit=25, offset=0)
        main.init_db()
        await self.control('play')
        self.assertEqual(main.history(limit=25, offset=0), before)
        self.assertEqual(main.library(q='', limit=25, offset=0)['total'], 1)

    async def test_missing_archive_file_is_not_enqueued(self):
        track = await self.upload()
        await self.control('next')
        for path in main.MUSIC.glob('*.mp3'):
            path.unlink()
        for ident in (track['id'], 'unknown'):
            with self.assertRaises(HTTPException) as error:
                await main.enqueue(ident)
            self.assertEqual(error.exception.status_code, 404)
        self.assertIsNone(main.snapshot()['current'])

    async def test_upload_larger_than_previous_30_mib_limit(self):
        # Keep a real MP3 header/audio payload, followed by padding past the old limit.
        data = TONE + b'\0' * (31 * 1024 * 1024)
        result = await self.upload(data, 'large.mp3')
        with main.db() as con:
            track = con.execute('SELECT filename,content_hash FROM tracks WHERE id=%s', (result['id'],)).fetchone()
        self.assertEqual((main.MUSIC / track['filename']).stat().st_size, len(data))
        self.assertEqual(track['content_hash'], hashlib.sha256(data).hexdigest())

    def listener(self, name='علی'):
        with auth.connection() as con:
            user = con.execute('INSERT INTO users(name,name_key) VALUES (%s,%s) RETURNING id,name', (name, uuid.uuid4().hex)).fetchone()
        return Request({'type': 'http', 'scheme': 'http', 'path': '/', 'server': ('test', 80),
                        'headers': [], 'state': {'user': user}})

    async def test_chat_broadcast_history_and_restart(self):
        messages = [[], []]
        class Socket:
            def __init__(self, output): self.output = output
            async def send_json(self, payload): self.output.append(payload)
        main.clients.update(Socket(output) for output in messages)
        message = await main.send_chat({'name': ' سارا ', 'text': ' آهنگ عالیه! '}, self.listener('سارا'))
        self.assertEqual(message['name'], 'سارا')
        self.assertEqual(message['text'], 'آهنگ عالیه!')
        self.assertNotIn('listener_id', message)
        for output in messages:
            self.assertEqual(output, [{'type': 'chat_message', 'message': message}])
        main.init_db()
        self.assertEqual(main.chat_history(), [message])

    async def test_chat_requires_identity_name_and_valid_text(self):
        anonymous = Request({'type': 'http', 'headers': []})
        with self.assertRaises(HTTPException) as error:
            await main.send_chat({'name': 'علی', 'text': 'سلام'}, anonymous)
        self.assertEqual(error.exception.status_code, 401)
        listener = self.listener()
        for text in (None, '', ' \n ', 12, [], 'a' * 501):
            with self.subTest(text=text), self.assertRaises(HTTPException) as error:
                await main.send_chat({'name': 'علی', 'text': text}, listener)
            self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(main.chat_history(), [])

    async def test_chat_cooldown_survives_rename_and_allows_other_listeners(self):
        listener = self.listener()
        await main.send_chat({'name': 'علی', 'text': 'سلام'}, listener)
        with self.assertRaises(HTTPException) as error:
            await main.send_chat({'name': 'سارا', 'text': 'سلام'}, listener)
        self.assertEqual(error.exception.status_code, 429)
        await main.send_chat({'name': 'سارا', 'text': 'سلام'}, self.listener())
        with patch.object(main.time, 'time', return_value=time.time() + 3):
            await main.send_chat({'name': 'علی', 'text': 'دوباره سلام'}, listener)
        self.assertEqual(len(main.chat_history()), 3)

    async def test_socket_receives_history_then_live_messages_and_disconnects(self):
        first = await main.send_chat({'name': 'سارا', 'text': 'قبل از ورود'}, self.listener())
        listener = self.listener()
        received = []
        class Socket:
            async def accept(self): pass
            async def send_json(self, payload): received.append(payload)
            async def receive_text(self):
                await main.send_chat({'name': 'علی', 'text': 'پیام زنده'}, listener)
                raise WebSocketDisconnect()
        socket = Socket()
        await main.ws(socket)
        self.assertEqual(received[0]['type'], 'state')
        self.assertEqual(received[1], {'type': 'chat_history', 'messages': [first]})
        self.assertEqual(received[2]['type'], 'chat_message')
        self.assertEqual(received[2]['message']['text'], 'پیام زنده')
        self.assertNotIn(socket, main.clients)

    async def test_chat_retains_only_latest_100_in_order(self):
        for i in range(103):
            await main.send_chat({'name': 'علی', 'text': str(i)}, self.listener())
        history = main.chat_history()
        self.assertEqual([m['text'] for m in history], [str(i) for i in range(3, 103)])
        with main.db() as con:
            self.assertEqual(con.execute('SELECT count(*) AS total FROM chat_messages').fetchone()['total'], 100)

    async def test_upload_requires_authenticated_user_before_writing(self):
        file = UploadFile(filename='tone.mp3', file=io.BytesIO(TONE))
        try:
            with self.assertRaises(HTTPException) as error:
                await main.upload(Request({'type': 'http', 'headers': []}), file)
            self.assertEqual(error.exception.status_code, 401)
        finally:
            await file.close()
        self.assertEqual(self.counts(), (0, 0, 0))

    async def test_chat_uses_session_name_and_ignores_supplied_name(self):
        message = await main.send_chat({'name': 'جعل نام', 'text': 'سلام'}, self.listener('سارا'))
        self.assertEqual(message['name'], 'سارا')

    async def test_reactions_are_unique_changeable_and_removable(self):
        await self.upload()
        play = main.snapshot()['play_id']
        one, two = self.listener(), self.listener()
        for _ in range(3):
            await main.react({'play_id': play, 'reaction': 'fire'}, one)
        await main.react({'play_id': play, 'reaction': 'love'}, two)
        self.assertEqual(main.snapshot()['reactions'], {'fire': 1, 'love': 1, 'skip': 0})
        await main.react({'play_id': play, 'reaction': 'skip'}, one)
        self.assertEqual(main.read_reactions(play, one)['mine'], 'skip')
        self.assertEqual(main.read_reactions(play, two)['mine'], 'love')
        await main.react({'play_id': play, 'reaction': None}, one)
        self.assertEqual(main.snapshot()['reactions'], {'fire': 0, 'love': 1, 'skip': 0})

    async def test_reactions_broadcast_to_everyone_without_auto_skip(self):
        current = await self.upload()
        await self.upload(TONE + b'next')
        messages = [[], []]
        class Socket:
            def __init__(self, output): self.output = output
            async def send_json(self, payload): self.output.append(payload)
        main.clients.update(Socket(output) for output in messages)
        play = main.snapshot()['play_id']
        for _ in range(5):
            await main.react({'play_id': play, 'reaction': 'skip'}, self.listener())
        self.assertEqual(main.snapshot()['current']['id'], current['id'])
        for output in messages:
            self.assertEqual(output[-1]['reactions']['skip'], 5)
            self.assertNotIn('listener_id', output[-1])

    async def test_reactions_survive_restart_but_reset_for_next_play(self):
        track = await self.upload()
        listener = self.listener()
        old_play = main.snapshot()['play_id']
        await main.react({'play_id': old_play, 'reaction': 'love'}, listener)
        main.init_db()
        self.assertEqual(main.read_reactions(old_play, listener)['mine'], 'love')
        await self.control('next')
        self.assertEqual(main.snapshot()['reactions'], {'fire': 0, 'love': 0, 'skip': 0})
        await main.enqueue(track['id'])
        self.assertNotEqual(main.snapshot()['play_id'], old_play)
        with self.assertRaises(HTTPException) as error:
            await main.react({'play_id': old_play, 'reaction': 'skip'}, listener)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(main.snapshot()['reactions']['skip'], 0)

    async def test_reaction_validation_and_listener_identity(self):
        await self.upload()
        play = main.snapshot()['play_id']
        guest = Request({'type': 'http', 'scheme': 'http', 'path': '/', 'server': ('test', 80), 'headers': []})
        with self.assertRaises(HTTPException) as error:
            await main.react({'play_id': play, 'reaction': 'fire'}, guest)
        self.assertEqual(error.exception.status_code, 401)
        listener = self.listener()
        for payload in ({'play_id': play, 'reaction': 'invalid'}, {'play_id': True, 'reaction': 'fire'}, {'play_id': play}):
            with self.assertRaises(HTTPException) as error:
                await main.react(payload, listener)
            self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(main.register_listener(listener)['user'], listener.state.user)

    async def test_move_queue_up_down_preserves_current_and_persists(self):
        current = await self.upload()
        tracks = [(await self.upload(TONE + bytes([i])))['id'] for i in range(3)]
        await self.control('pause')
        before = main.snapshot()
        await self.control('shuffle', enabled=True)
        await self.control('move', track_id=tracks[2], direction='up')
        state = main.snapshot()
        self.assertEqual([t['id'] for t in state['queue']], [tracks[0], tracks[2], tracks[1]])
        self.assertFalse(state['shuffle'])
        self.assertEqual(state['current']['id'], current['id'])
        self.assertEqual(state['position'], before['position'])
        self.assertEqual(state['playing'], before['playing'])
        await self.control('move', track_id=tracks[0], direction='down')
        main.init_db()
        self.assertEqual([t['id'] for t in main.snapshot()['queue']], [tracks[2], tracks[0], tracks[1]])
        await self.control('next')
        self.assertEqual(main.snapshot()['current']['id'], tracks[2])
        last = await self.upload(TONE + b'last')
        self.assertEqual([t['id'] for t in main.snapshot()['queue']], [tracks[0], tracks[1], last['id']])

    async def test_move_permissions_boundaries_invalid_and_stale_requests(self):
        current = await self.upload()
        one = await self.upload(TONE + b'one')
        two = await self.upload(TONE + b'two')
        with self.assertRaises(HTTPException) as error:
            await main.control({'action': 'move', 'track_id': two['id'], 'direction': 'up'}, None)
        self.assertEqual(error.exception.status_code, 403)
        for values in ({'track_id': two['id'], 'direction': 'left'}, {'direction': 'up'}, {'track_id': [], 'direction': 'up'}):
            with self.assertRaises(HTTPException) as error:
                await self.control('move', **values)
            self.assertEqual(error.exception.status_code, 400)
        for ident in ('missing', current['id']):
            with self.assertRaises(HTTPException) as error:
                await self.control('move', track_id=ident, direction='up')
            self.assertEqual(error.exception.status_code, 404)
        await self.control('move', track_id=one['id'], direction='up')
        await self.control('move', track_id=two['id'], direction='down')
        self.assertEqual([t['id'] for t in main.snapshot()['queue']], [one['id'], two['id']])
        await self.control('remove', track_id=one['id'])
        with self.assertRaises(HTTPException) as error:
            await self.control('move', track_id=one['id'], direction='down')
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual([t['id'] for t in main.snapshot()['queue']], [two['id']])


if __name__ == '__main__':
    unittest.main()
