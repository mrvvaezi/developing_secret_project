"""Catalog and playlist regressions against an isolated PostgreSQL schema."""
import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, AsyncMock

from fastapi import HTTPException
from backend.app import auth, main, storage
from pg_support import isolate_database


@unittest.skipUnless(os.environ.get('MUSIC_DB_NAME', '').startswith('music_room_auth_test'),
                     'Requires an isolated test PostgreSQL database')
class CatalogTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isolate_database(self)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        settings = patch.multiple(main, MUSIC=root, DB=root / 'legacy.db',
                                  STATE_LOCK=asyncio.Lock())
        settings.start()
        self.addCleanup(settings.stop)
        storage.init_storage(main.DB)
        with auth.connection() as con:
            self.owner = con.execute("INSERT INTO users(name,name_key,password_hash,is_admin) VALUES ('owner','owner','unused',FALSE) RETURNING id").fetchone()['id']
            self.other = con.execute("INSERT INTO users(name,name_key,password_hash,is_admin) VALUES ('other','other','unused',FALSE) RETURNING id").fetchone()['id']
            for ident, uploader, artist in [('a', 'سارا', 'خواننده اول'), ('b', 'علی', 'خواننده دوم'), ('c', 'سارا', '')]:
                con.execute('''INSERT INTO tracks(id,title,uploader,artist,duration,filename,created,content_hash)
                    VALUES (%s,%s,%s,%s,100,%s,1,%s)''', (ident, 'song ' + ident, uploader, artist, ident + '.mp3', ident))
                (root / (ident + '.mp3')).write_bytes(b'test')
        self.user = patch.object(auth, 'current_user', return_value={'id': self.owner, 'name': 'owner', 'is_admin': False})
        self.user.start()
        self.addCleanup(self.user.stop)
        broadcast = patch.object(main, 'broadcast', new_callable=AsyncMock)
        self.broadcast = broadcast.start()
        self.addCleanup(broadcast.stop)

    def test_filtering_search_and_pagination(self):
        result = main.library(limit=1, offset=0, uploader='سارا')
        self.assertEqual(result['total'], 2)
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(main.library(limit=12, offset=0, artist='')['items'][0]['id'], 'c')
        self.assertEqual(main.library(q='خواننده اول', limit=12, offset=0)['items'][0]['id'], 'a')
        self.assertEqual(main.library(limit=12, offset=0, uploader='علی', artist='خواننده اول')['total'], 0)
        self.assertEqual(len(main.library_categories()['artists']), 3)

    async def test_playlist_persistence_order_duplicates_and_queue(self):
        playlist = main.create_playlist({'name': 'شب'}, None)
        ident = playlist['id']
        for track in ['b', 'a', 'b']:
            main.add_playlist_track(ident, track, None)
        self.assertEqual([t['id'] for t in main.playlist_contents(ident, None, 12, 0)['items']], ['b', 'a'])
        self.assertEqual(main.playlists(None)['items'][0]['count'], 2)
        main.rename_playlist(ident, {'name': 'شب جدید'}, None)
        storage.init_storage(main.DB)
        self.assertEqual(main.playlists(None)['items'][0]['name'], 'شب جدید')
        first = await main.enqueue_playlist(ident, None)
        second = await main.enqueue_playlist(ident, None)
        self.assertEqual(first, {'added': 2, 'skipped': 0})
        self.assertEqual(second, {'added': 0, 'skipped': 2})
        with auth.connection() as con:
            self.assertEqual(con.execute('SELECT track_id FROM state WHERE id=1').fetchone()['track_id'], 'b')
            self.assertEqual(con.execute('SELECT track_id FROM queue ORDER BY position').fetchone()['track_id'], 'a')
        main.remove_playlist_track(ident, 'a', None)
        main.delete_playlist(ident, None)
        self.assertEqual(main.library(limit=12, offset=0)['total'], 3)

    async def test_owner_boundary_and_validation(self):
        ident = main.create_playlist({'name': 'private'}, None)['id']
        for name in ['', '  ', 'a' * 101, 123]:
            with self.assertRaises(HTTPException) as error:
                main.create_playlist({'name': name}, None)
            self.assertEqual(error.exception.status_code, 400)
        with patch.object(auth, 'current_user', return_value={'id': self.other}):
            self.assertEqual(main.playlists(None)['items'], [])
            actions = [lambda: main.playlist_contents(ident, None, 12, 0),
                       lambda: main.rename_playlist(ident, {'name': 'changed'}, None),
                       lambda: main.delete_playlist(ident, None),
                       lambda: main.add_playlist_track(ident, 'a', None),
                       lambda: main.remove_playlist_track(ident, 'a', None)]
            for action in actions:
                with self.assertRaises(HTTPException) as error:
                    action()
                self.assertEqual(error.exception.status_code, 404)
            with self.assertRaises(HTTPException):
                await main.enqueue_playlist(ident, None)
        with self.assertRaises(HTTPException):
            main.add_playlist_track(ident, 'missing', None)

    async def test_deleted_track_cascades_and_artist_changes_revision(self):
        ident = main.create_playlist({'name': 'test'}, None)['id']
        main.add_playlist_track(ident, 'c', None)
        with auth.connection() as con:
            before = con.execute('SELECT last_value FROM catalog_revision').fetchone()['last_value']
        with patch.object(main, 'require_chat_admin'):
            await main.update_track_artist('a', {'artist': 'جدید'}, None)
        with auth.connection() as con:
            after = con.execute('SELECT last_value FROM catalog_revision').fetchone()['last_value']
            con.execute("DELETE FROM tracks WHERE id='c'")
        self.assertGreater(after, before)
        self.assertEqual(main.library(limit=12, offset=0, artist='جدید')['total'], 1)
        self.assertEqual(main.playlist_contents(ident, None, 12, 0)['total'], 0)

    async def test_nul_in_artist_is_safe_during_startup_upload_and_edit(self):
        import io
        from fastapi import UploadFile
        from mutagen.mp3 import MP3
        from mutagen.id3 import TPE1
        source = Path(__file__).parent / 'fixtures' / 'tone.mp3'
        legacy = main.MUSIC / 'a.mp3'
        legacy.write_bytes(source.read_bytes())
        audio = MP3(legacy)
        if audio.tags is None:
            audio.add_tags()
        audio.tags.add(TPE1(encoding=3, text=['خواننده اول', 'خواننده دوم']))
        audio.save()
        self.assertIn('\x00', str(MP3(legacy).tags['TPE1']))
        main.init_db()
        expected = 'خواننده اول / خواننده دوم'
        with auth.connection() as con:
            self.assertEqual(con.execute("SELECT artist FROM tracks WHERE id='a'").fetchone()['artist'], expected)
        upload = UploadFile(filename='multi-artist.mp3', file=io.BytesIO(legacy.read_bytes()))
        try:
            result = await main.upload(None, upload)
        finally:
            await upload.close()
        with auth.connection() as con:
            self.assertEqual(con.execute('SELECT artist FROM tracks WHERE id=%s', (result['id'],)).fetchone()['artist'], expected)
        with patch.object(main, 'require_chat_admin'):
            await main.update_track_artist('b', {'artist': 'اول\x00دوم'}, None)
        with auth.connection() as con:
            self.assertEqual(con.execute("SELECT artist FROM tracks WHERE id='b'").fetchone()['artist'], 'اول / دوم')
