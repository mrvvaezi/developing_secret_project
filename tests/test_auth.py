import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, AsyncMock

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.app import auth, main
from pg_support import isolate_database


@unittest.skipUnless(os.environ.get('MUSIC_DB_NAME', '').startswith('music_room_auth_test'),
                     'Requires an isolated music_room_auth_test PostgreSQL database')
class AuthTests(unittest.TestCase):
    def setUp(self):
        isolate_database(self)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        config = patch.multiple(auth, SESSION_SECRET='test-secret-' * 4)
        config.start()
        self.addCleanup(config.stop)
        state = patch.multiple(main, DATA=root, MUSIC=root / 'music', DB=root / 'music.db',
                               STATE_LOCK=asyncio.Lock(), clients=set(), ADMIN_TOKEN='admin-test')
        state.start()
        self.addCleanup(state.stop)
        auth.init_auth()
        with auth.connection() as con:
            con.execute('TRUNCATE users, sessions, login_attempts RESTART IDENTITY CASCADE')
        auth.create_user('سارا', 'test-password')
        self.client = TestClient(main.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def login(self, name='سارا', pin='test-password'):
        return self.client.post('/api/auth/login', json={'name': name, 'password': pin})

    def test_anonymous_cannot_access_pages_apis_audio_or_websocket(self):
        for path in ('/', '/static/index.html', '/static/player.js'):
            response = self.client.get(path, follow_redirects=False)
            self.assertEqual(response.status_code, 303)
            self.assertEqual(response.headers['location'], '/login')
        for path in ('/api/state', '/api/library', '/api/history', '/api/auth/me', '/api/tracks/id/audio'):
            self.assertEqual(self.client.get(path).status_code, 401)
        for path in ('/api/chat', '/api/upload', '/api/reactions', '/api/admin/control', '/api/listener'):
            self.assertEqual(self.client.post(path, json={}).status_code, 401)
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect('/ws'):
                self.fail('Anonymous websocket accepted')
        self.assertEqual(self.client.get('/login').status_code, 200)
        self.assertEqual(self.client.get('/static/login.css').status_code, 200)

    def test_repeat_login_uses_existing_postgres_user(self):
        auth.create_user('Sara', 'test-password')
        response = self.login('  Sara  ')
        self.assertEqual(response.status_code, 200)
        first = response.json()['user']
        cookie = response.headers['set-cookie'].lower()
        self.assertIn('httponly', cookie)
        self.assertIn('samesite=strict', cookie)
        token = self.client.cookies.get(auth.SESSION_COOKIE)
        self.assertEqual(self.login('sara').json()['user'], first)
        with auth.connection() as con:
            self.assertEqual(con.execute('SELECT count(*) AS n FROM users').fetchone()['n'], 2)
            stored = con.execute('SELECT token_hash FROM sessions').fetchall()
            self.assertTrue(all(row['token_hash'] != token for row in stored))
        self.assertEqual(self.client.get('/api/auth/me').json()['user'], first)
        self.assertIn('no-store', self.client.get('/').headers['cache-control'])
        self.assertEqual(self.client.post('/api/admin/control', json={'action': 'next'}).status_code, 403)

    def test_invalid_credentials_and_bruteforce_limit(self):
        for name in ('', 'Guest', 'gUsT', 'مهمان', 'میهمان', '\u200b', 'Ｇｕｅｓｔ', 'a' * 41):
            self.assertEqual(self.login(name).status_code, 400)
        for _ in range(10):
            self.assertEqual(self.login(pin='000000').status_code, 401)
        self.assertEqual(self.login().status_code, 429)
        with auth.connection() as con:
            self.assertEqual(con.execute('SELECT count(*) AS n FROM users').fetchone()['n'], 1)

    def test_unknown_user_cannot_register_and_passwords_are_hashed(self):
        self.assertEqual(self.login('unknown').status_code, 401)
        with auth.connection() as con:
            users = con.execute('SELECT name,password_hash FROM users').fetchall()
        self.assertEqual(len(users), 1)
        self.assertNotEqual(users[0]['password_hash'], 'test-password')
        self.assertTrue(auth.verify_password('test-password', users[0]['password_hash']))

    def test_admin_creation_and_private_reaction_report(self):
        self.login()
        self.assertEqual(self.client.post('/api/admin/users', json={'name': 'Ali', 'password': 'ali-password'}).status_code, 403)
        self.assertEqual(self.client.get('/api/admin/users').status_code, 403)
        self.assertEqual(self.client.get('/api/admin/reactions').status_code, 403)
        headers = {'X-Admin-Token': 'admin-test'}
        result = self.client.post('/api/admin/users', headers=headers, json={'name': 'Ali', 'password': 'ali-password'})
        self.assertEqual(result.status_code, 200)
        self.assertNotIn('password_hash', result.text)
        self.assertEqual(self.client.post('/api/admin/users', headers=headers, json={'name': 'Ali', 'password': 'new-password'}).status_code, 409)
        tone = (Path(__file__).parent / 'fixtures' / 'tone.mp3').read_bytes()
        self.client.post('/api/upload', files={'file': ('song.mp3', tone, 'audio/mpeg')})
        play_id = self.client.get('/api/state').json()['play_id']
        self.client.post('/api/reactions', json={'play_id': play_id, 'reaction': 'love', 'name': 'Fake'})
        report = self.client.get('/api/admin/reactions', headers=headers).json()['items']
        self.assertEqual(report[0]['name'], 'سارا')
        self.assertEqual(report[0]['reaction'], 'love')
        self.assertEqual(report[0]['title'], 'song.mp3')
        public = self.client.get('/api/reactions/' + str(play_id)).json()
        self.assertEqual(set(public), {'play_id', 'reactions', 'mine'})
        self.assertEqual(self.login('Ali', 'ali-password').status_code, 200)

    def test_admin_chat_deletion_permissions_persistence_and_broadcast(self):
        self.login()
        headers = {'X-Admin-Token': 'admin-test'}
        message = self.client.post('/api/chat', json={'text': 'delete me'}).json()
        for endpoint in ('/api/admin/chat',):
            self.assertEqual(self.client.get(endpoint, headers=headers).status_code, 403)
        self.assertEqual(self.client.delete('/api/admin/chat/' + str(message['id']), headers=headers).status_code, 403)
        self.assertEqual(self.client.post('/api/admin/chat/clear', headers=headers, json={'through_id': message['id']}).status_code, 403)
        with auth.connection() as con:
            con.execute('UPDATE users SET is_admin=TRUE')
        self.assertEqual(self.client.delete('/api/admin/chat/' + str(message['id'])).status_code, 403)
        self.assertEqual(len(self.client.get('/api/admin/chat', headers=headers).json()['items']), 1)
        with patch.object(main, 'broadcast', new_callable=AsyncMock) as broadcast:
            result = self.client.delete('/api/admin/chat/' + str(message['id']), headers=headers)
            self.assertEqual(result.json()['deleted'], 1)
            broadcast.assert_awaited_once_with({'type': 'chat_deleted', 'ids': [message['id']]})
        self.assertEqual(main.chat_history(), [])
        self.assertEqual(self.client.delete('/api/admin/chat/' + str(message['id']), headers=headers).json()['deleted'], 0)
        with main.db() as con:
            first = con.execute("INSERT INTO chat_messages(listener_id,name,text,created_at) VALUES ('x','x','old',1) RETURNING id").fetchone()['id']
            last = con.execute("INSERT INTO chat_messages(listener_id,name,text,created_at) VALUES ('x','x','new',2) RETURNING id").fetchone()['id']
        self.assertEqual(self.client.post('/api/admin/chat/clear', headers=headers, json={'through_id': True}).status_code, 400)
        result = self.client.post('/api/admin/chat/clear', headers=headers, json={'through_id': first})
        self.assertEqual(result.json()['deleted'], 1)
        main.init_db()
        self.assertEqual([m['id'] for m in main.chat_history()], [last])

    def test_bootstrap_admin_and_legacy_sessions(self):
        with patch.dict(os.environ, {'MUSIC_ADMIN_PASSWORD': 'admin-password'}):
            auth.init_auth()
        self.assertEqual(self.login('admin', 'admin-password').status_code, 200)
        self.assertTrue(self.client.get('/api/auth/me').json()['user']['is_admin'])
        with patch.object(main, 'ADMIN_PASSWORD', 'admin-password'):
            self.assertEqual(self.client.post('/api/admin/login', json={'password': 'admin-password'}).status_code, 200)
            self.login()
            self.assertEqual(self.client.post('/api/admin/login', json={'password': 'admin-password'}).status_code, 403)
        with auth.connection() as con:
            con.execute("UPDATE sessions SET pin_version='legacy-pin-version'")
        auth.init_auth()
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)

    def test_legacy_account_activation_preserves_identity(self):
        with auth.connection() as con:
            old = con.execute("INSERT INTO users(name,name_key) VALUES ('old','old') RETURNING id").fetchone()
        self.assertEqual(self.login('old').status_code, 401)
        user = auth.create_user('old', 'new-password')
        self.assertEqual(user['id'], old['id'])
        self.assertEqual(self.login('old', 'new-password').status_code, 200)

    def test_logout_revokes_cookie_and_open_websocket(self):
        self.login()
        old_token = self.client.cookies.get(auth.SESSION_COOKIE)
        with self.client.websocket_connect('/ws') as socket:
            self.assertEqual(socket.receive_json()['type'], 'state')
            self.assertEqual(socket.receive_json()['type'], 'chat_history')
            self.assertEqual(self.client.post('/api/auth/logout').status_code, 200)
            # A ticker state may already be queued before the close frame.
            while True:
                event = socket.receive()
                if event['type'] == 'websocket.close':
                    self.assertEqual(event['code'], 4401)
                    break
        self.client.cookies.set(auth.SESSION_COOKIE, old_token)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)

    def test_expired_and_forged_sessions_are_rejected(self):
        self.login()
        with auth.connection() as con:
            con.execute("UPDATE sessions SET expires_at=now() - interval '1 second'")
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)
        self.client.cookies.clear()
        self.client.cookies.set(auth.SESSION_COOKIE, 'x' * 43)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)

    def test_session_survives_auth_initialization(self):
        self.login()
        user = self.client.get('/api/auth/me').json()['user']
        auth.init_auth()
        self.assertEqual(self.client.get('/api/auth/me').json()['user'], user)

    def test_names_come_from_session_and_chat_broadcasts(self):
        self.login()
        with self.client.websocket_connect('/ws') as socket:
            socket.receive_json()
            socket.receive_json()
            response = self.client.post('/api/chat', json={'name': 'Guest', 'text': 'سلام'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['name'], 'سارا')
            event = socket.receive_json()
            while event['type'] == 'state':
                event = socket.receive_json()
            self.assertEqual(event['type'], 'chat_message')
            self.assertEqual(event['message']['name'], 'سارا')
        tone = (Path(__file__).parent / 'fixtures' / 'tone.mp3').read_bytes()
        response = self.client.post('/api/upload?uploader=Guest', files={'file': ('tone.mp3', tone, 'audio/mpeg')})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get('/api/state').json()['current']['uploader'], 'سارا')

    def test_cross_origin_login_and_mutation_are_rejected(self):
        response = self.client.post('/api/auth/login', json={'name': 'سارا', 'password': 'test-password'},
                                    headers={'Origin': 'https://unrelated.example'})
        self.assertEqual(response.status_code, 403)
        self.login()
        self.assertEqual(self.client.post('/api/chat', json={'text': 'سلام'},
                                         headers={'Origin': 'https://unrelated.example'}).status_code, 403)
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect('/ws', headers={'Origin': 'https://unrelated.example'}):
                self.fail('Cross-origin websocket accepted')


if __name__ == '__main__':
    unittest.main()
