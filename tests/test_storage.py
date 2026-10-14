import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from backend.app import auth, storage
from pg_support import isolate_database


@unittest.skipUnless(os.environ.get('MUSIC_DB_NAME', '').startswith('music_room_auth_test'), 'Requires isolated PostgreSQL')
class MigrationTests(unittest.TestCase):
    def setUp(self):
        isolate_database(self)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'old.db'
        with auth.connection() as con:
            self.user = con.execute("INSERT INTO users(name,name_key) VALUES ('Test','test') RETURNING id").fetchone()['id']
        with sqlite3.connect(self.path) as con:
            con.executescript('''
                CREATE TABLE tracks(id TEXT,title TEXT,uploader TEXT,duration REAL,filename TEXT,created REAL,content_hash TEXT);
                INSERT INTO tracks VALUES ('song','Song','Test',5,'song.mp3',1,'hash');
                CREATE TABLE queue(position INTEGER,track_id TEXT);
                INSERT INTO queue VALUES (12,'song');
                CREATE TABLE state(id INTEGER,track_id TEXT,started REAL,offset REAL,playing INTEGER,shuffle INTEGER);
                INSERT INTO state VALUES (1,'song',1,2.5,1,1);
                CREATE TABLE play_history(id INTEGER,track_id TEXT,started_at REAL,ended_at REAL,outcome TEXT);
                INSERT INTO play_history VALUES (30,'song',1,NULL,'current');
                CREATE TABLE reactions(play_id INTEGER,listener_id TEXT,reaction TEXT);
                INSERT INTO reactions VALUES (30,'user:999999','skip');
                CREATE TABLE chat_messages(id INTEGER,listener_id TEXT,name TEXT,text TEXT,created_at REAL);
                INSERT INTO chat_messages VALUES (40,'user:999999','Old','hello',1);
            ''')
            con.execute('INSERT INTO reactions VALUES (30,?,?)', ('user:' + str(self.user), 'love'))

    def test_all_tables_identity_sequences_and_idempotence(self):
        original = self.path.read_bytes()
        storage.init_storage(self.path)
        storage.init_storage(self.path)
        self.assertEqual(self.path.read_bytes(), original)
        with auth.connection() as con:
            for table, count in [('tracks',1),('queue',1),('state',1),('play_history',1),('reactions',2),('chat_messages',1)]:
                self.assertEqual(con.execute(f'SELECT count(*) AS n FROM {table}').fetchone()['n'],count)
            rows = con.execute('SELECT listener_id,user_id FROM reactions').fetchall()
            self.assertEqual({r['listener_id']:r['user_id'] for r in rows}, {'user:999999':None, 'user:'+str(self.user):self.user})
            state = con.execute('SELECT * FROM state').fetchone()
            self.assertEqual(state['playback_offset'],2.5)
            self.assertEqual(state['playing'],0)
            self.assertEqual(con.execute("INSERT INTO queue(track_id) VALUES ('song') RETURNING position").fetchone()['position'],13)
            self.assertEqual(con.execute("INSERT INTO play_history(track_id,started_at) VALUES ('song',2) RETURNING id").fetchone()['id'],31)
            self.assertEqual(con.execute("INSERT INTO chat_messages(listener_id,name,text,created_at) VALUES ('x','x','x',2) RETURNING id").fetchone()['id'],41)

    def test_invalid_import_rolls_back_and_can_retry(self):
        with sqlite3.connect(self.path) as con:
            con.execute("UPDATE queue SET track_id='missing'")
        with self.assertRaises(auth.psycopg.errors.ForeignKeyViolation):
            storage.init_storage(self.path)
        with auth.connection() as con:
            self.assertIsNone(con.execute("SELECT to_regclass('tracks') AS table_name").fetchone()['table_name'])
        with sqlite3.connect(self.path) as con:
            con.execute("UPDATE queue SET track_id='song'")
        storage.init_storage(self.path)
