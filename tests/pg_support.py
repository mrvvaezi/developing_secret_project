import uuid
from unittest.mock import patch
from psycopg import sql
from backend.app import auth


def isolate_database(test):
    original = auth.connection
    schema = 'test_' + uuid.uuid4().hex
    with original() as con:
        con.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
    def connection():
        con = original()
        con.execute(sql.SQL('SET search_path TO {}').format(sql.Identifier(schema)))
        return con
    def cleanup():
        with original() as con:
            con.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))
    test.addCleanup(cleanup)
    config = patch.object(auth, 'connection', connection)
    config.start()
    test.addCleanup(config.stop)
    secret = patch.object(auth, 'SESSION_SECRET', 'isolated-test-secret-' * 3)
    secret.start()
    test.addCleanup(secret.stop)
    auth.init_auth()
