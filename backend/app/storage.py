"""PostgreSQL room storage and one-time, transactional SQLite import."""
import sqlite3
from contextlib import closing
from psycopg import sql
from psycopg.types.json import Jsonb
from . import auth

TABLES = ('tracks', 'queue', 'state', 'play_history', 'reactions', 'chat_messages')

DEFAULT_SITE_COPY = {'hero_title': 'یک اتاق.\nهزار حالِ خوب.'}


def init_storage(legacy_path):
    with auth.connection() as con:
        con.execute('SELECT pg_advisory_xact_lock(7362041)')
        con.execute('''CREATE TABLE IF NOT EXISTS tracks (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, uploader TEXT NOT NULL,
            duration DOUBLE PRECISION NOT NULL, filename TEXT NOT NULL,
            created DOUBLE PRECISION NOT NULL, content_hash TEXT)''')
        con.execute("ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artist TEXT NOT NULL DEFAULT ''")
        con.execute("ALTER TABLE tracks ADD COLUMN IF NOT EXISTS metadata_version INTEGER NOT NULL DEFAULT 0")
        con.execute('CREATE INDEX IF NOT EXISTS tracks_artist ON tracks(artist)')
        con.execute('CREATE INDEX IF NOT EXISTS tracks_uploader ON tracks(uploader)')
        con.execute('CREATE SEQUENCE IF NOT EXISTS catalog_revision')
        con.execute("CREATE OR REPLACE FUNCTION bump_catalog_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('catalog_revision'); RETURN NULL; END $$")
        con.execute('DROP TRIGGER IF EXISTS catalog_changed ON tracks')
        con.execute('CREATE TRIGGER catalog_changed AFTER INSERT OR UPDATE OR DELETE ON tracks FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_revision()')
        con.execute("""CREATE TABLE IF NOT EXISTS playlists (
            id BIGSERIAL PRIMARY KEY, owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
        con.execute("""CREATE TABLE IF NOT EXISTS playlist_tracks (
            position BIGSERIAL PRIMARY KEY,
            playlist_id BIGINT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            UNIQUE(playlist_id, track_id))""")
        con.execute('''CREATE TABLE IF NOT EXISTS queue (
            position BIGSERIAL PRIMARY KEY, track_id TEXT NOT NULL REFERENCES tracks(id))''')
        con.execute('''CREATE TABLE IF NOT EXISTS state (
            id INTEGER PRIMARY KEY CHECK(id=1), track_id TEXT REFERENCES tracks(id),
            started DOUBLE PRECISION, playback_offset DOUBLE PRECISION NOT NULL DEFAULT 0,
            playing INTEGER NOT NULL DEFAULT 0, shuffle INTEGER NOT NULL DEFAULT 0)''')
        con.execute('''CREATE TABLE IF NOT EXISTS play_history (
            id BIGSERIAL PRIMARY KEY, track_id TEXT NOT NULL REFERENCES tracks(id),
            started_at DOUBLE PRECISION NOT NULL, ended_at DOUBLE PRECISION,
            outcome TEXT NOT NULL DEFAULT 'current')''')
        con.execute('''CREATE TABLE IF NOT EXISTS reactions (
            play_id BIGINT NOT NULL REFERENCES play_history(id), listener_id TEXT NOT NULL,
            user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
            reaction TEXT NOT NULL CHECK(reaction IN ('fire','love','skip')),
            PRIMARY KEY(play_id,listener_id))''')
        con.execute('''CREATE TABLE IF NOT EXISTS chat_messages (
            id BIGSERIAL PRIMARY KEY, listener_id TEXT NOT NULL, name TEXT NOT NULL,
            text TEXT NOT NULL, created_at DOUBLE PRECISION NOT NULL)''')
        con.execute('''CREATE TABLE IF NOT EXISTS site_copy (
            id INTEGER PRIMARY KEY CHECK(id=1), copy JSONB NOT NULL)''')
        con.execute('INSERT INTO site_copy(id,copy) VALUES (1,%s) ON CONFLICT(id) DO NOTHING',
                    (Jsonb(DEFAULT_SITE_COPY),))
        con.execute('CREATE INDEX IF NOT EXISTS tracks_content_hash ON tracks(content_hash)')
        con.execute('CREATE INDEX IF NOT EXISTS history_open ON play_history(track_id) WHERE ended_at IS NULL')
        con.execute('CREATE TABLE IF NOT EXISTS storage_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())')
        if not con.execute("SELECT 1 FROM storage_migrations WHERE name='sqlite_room_v1'").fetchone():
            if legacy_path.is_file():
                # Never overwrite a PostgreSQL room that has already been populated.
                for table in TABLES:
                    if con.execute(sql.SQL('SELECT 1 FROM {} LIMIT 1').format(sql.Identifier(table))).fetchone():
                        raise RuntimeError('SQLite import refused: PostgreSQL room tables are not empty')
                with closing(sqlite3.connect(f'{legacy_path.resolve().as_uri()}?mode=ro', uri=True)) as old:
                    old.row_factory = sqlite3.Row
                    old.execute('BEGIN')
                    existing = {r[0] for r in old.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                    for table in TABLES:
                        if table not in existing:
                            continue
                        rows = old.execute(f'SELECT * FROM {table}').fetchall()
                        for row in rows:
                            columns = ['playback_offset' if c == 'offset' else c for c in row.keys()]
                            query = sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(
                                sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, columns)),
                                sql.SQL(',').join(sql.Placeholder() for _ in columns))
                            con.execute(query, tuple(row))
                        count = con.execute(sql.SQL('SELECT count(*) AS n FROM {}').format(sql.Identifier(table))).fetchone()['n']
                        if count != len(rows):
                            raise RuntimeError(f'Import count mismatch for {table}')
                con.execute("""UPDATE reactions SET user_id=users.id FROM users
                    WHERE reactions.listener_id='user:' || users.id::text""")
                for table, column in (('queue', 'position'), ('play_history', 'id'), ('chat_messages', 'id')):
                    con.execute(sql.SQL("SELECT setval(pg_get_serial_sequence(%s,%s), COALESCE(max({}),1), max({}) IS NOT NULL) FROM {}").format(
                        sql.Identifier(column), sql.Identifier(column), sql.Identifier(table)), (table, column))
            con.execute("INSERT INTO storage_migrations(name) VALUES ('sqlite_room_v1')")
        con.execute('INSERT INTO state(id) VALUES (1) ON CONFLICT(id) DO NOTHING')
        con.execute('UPDATE state SET playing=0,started=NULL WHERE id=1')
