import hashlib
import hmac
import os
import secrets
import unicodedata
from urllib.parse import urlsplit

import psycopg
from psycopg.rows import dict_row
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool
from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse, RedirectResponse

ADMIN_USERNAME = os.environ.get('MUSIC_ADMIN_USERNAME', 'admin')
SESSION_SECRET = os.environ.get('MUSIC_SESSION_SECRET', '')
SESSION_COOKIE = 'music_session'
SESSION_SECONDS = 30 * 24 * 3600
PUBLIC_PATHS = {'/login', '/api/auth/login', '/static/login.css', '/static/login.js',
                '/static/favicon.svg', '/static/fonts/Vazirmatn.woff2'}


def connection():
    return psycopg.connect(host=os.environ.get('MUSIC_DB_HOST', 'users-db'),
                          port=int(os.environ.get('MUSIC_DB_PORT', '5432')),
                          dbname=os.environ.get('MUSIC_DB_NAME', 'music_room'),
                          user=os.environ.get('MUSIC_DB_USER', 'music_room'),
                          password=os.environ.get('MUSIC_DB_PASSWORD', ''),
                          connect_timeout=5, row_factory=dict_row)


def display_name(value):
    if not isinstance(value, str):
        raise HTTPException(400, 'نام خودتان را وارد کنید.')
    value = ' '.join(unicodedata.normalize('NFKC', value).split())
    key = ''.join(c for c in value if not c.isspace() and unicodedata.category(c) != 'Cf').casefold()
    if (not key or key in ('guest', 'gust', 'مهمان', 'میهمان') or len(value) > 40
            or any(unicodedata.category(c) == 'Cc' for c in value)):
        raise HTTPException(400, 'نام خودتان را با حداکثر ۴۰ کاراکتر وارد کنید؛ نام مهمان پذیرفته نیست.')
    return value


def fingerprint():
    return hmac.new(SESSION_SECRET.encode(), b'password-auth-v1', hashlib.sha256).hexdigest()


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def init_auth():
    if len(SESSION_SECRET) < 32:
        raise RuntimeError('Set MUSIC_SESSION_SECRET to at least 32 random characters in .env')
    with connection() as con:
        con.execute('''CREATE TABLE IF NOT EXISTS users (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            name TEXT NOT NULL, name_key TEXT UNIQUE NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_login_at TIMESTAMPTZ NOT NULL DEFAULT now())''')
        con.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT')
        con.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE')
        admin_password = os.environ.get('MUSIC_ADMIN_PASSWORD', '')
        if admin_password:
            name = display_name(ADMIN_USERNAME)
            con.execute("""INSERT INTO users(name,name_key,password_hash,is_admin) VALUES (%s,%s,%s,TRUE)
                ON CONFLICT(name_key) DO UPDATE SET password_hash=excluded.password_hash,is_admin=TRUE
                WHERE users.password_hash IS NULL""", (name, name.casefold(), hash_password(admin_password)))
        con.execute('''CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            pin_version TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL)''')
        con.execute('CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)')
        con.execute('''CREATE TABLE IF NOT EXISTS login_attempts (
            client_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL,
            window_started TIMESTAMPTZ NOT NULL DEFAULT now())''')
        con.execute('DELETE FROM sessions WHERE expires_at <= now() OR pin_version <> %s', (fingerprint(),))
        con.execute("DELETE FROM login_attempts WHERE window_started < now() - interval '10 minutes'")


def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return salt + ':' + digest


def verify_password(password, stored):
    if not stored:
        stored = '00' * 16 + ':' + '00' * 64
    salt, digest = stored.split(':')
    actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return secrets.compare_digest(actual, digest)


def create_user(name, password):
    name = display_name(name)
    if not isinstance(password, str) or not 8 <= len(password) <= 128:
        raise HTTPException(400, 'رمز عبور باید بین ۸ تا ۱۲۸ کاراکتر باشد.')
    with connection() as con:
        user = con.execute("""INSERT INTO users(name,name_key,password_hash) VALUES (%s,%s,%s)
            ON CONFLICT(name_key) DO UPDATE SET password_hash=excluded.password_hash
            WHERE users.password_hash IS NULL AND NOT users.is_admin
            RETURNING id,name,is_admin""", (name, name.casefold(), hash_password(password))).fetchone()
        if not user:
            raise HTTPException(409, 'این نام کاربری قبلاً ثبت شده است.')
    return user


def login(name, password, client, previous_token=''):
    name = display_name(name)
    if not isinstance(password, str) or len(password) > 128:
        raise HTTPException(400, 'رمز عبور را وارد کنید.')
    client_key = hmac.new(SESSION_SECRET.encode(), client.encode(), hashlib.sha256).hexdigest()
    # Commit the attempt even when authentication fails.
    with connection() as con:
        con.execute("DELETE FROM login_attempts WHERE window_started < now() - interval '10 minutes'")
        row = con.execute('''INSERT INTO login_attempts(client_key,attempts) VALUES (%s,1)
            ON CONFLICT(client_key) DO UPDATE SET attempts=login_attempts.attempts+1
            RETURNING attempts''', (client_key,)).fetchone()
    if row['attempts'] > 10:
        raise HTTPException(429, 'تلاش‌های زیادی انجام شده؛ ده دقیقه دیگر امتحان کنید.', headers={'Retry-After': '600'})
    token = secrets.token_urlsafe(32)
    with connection() as con:
        user = con.execute('SELECT id,name,is_admin,password_hash FROM users WHERE name_key=%s',
                           (name.casefold(),)).fetchone()
        if not verify_password(password, user['password_hash'] if user else None) or not user:
            raise HTTPException(401, 'نام کاربری یا رمز عبور درست نیست.')
        user.pop('password_hash')
        con.execute('UPDATE users SET last_login_at=now() WHERE id=%s', (user['id'],))
        con.execute('DELETE FROM login_attempts WHERE client_key=%s', (client_key,))
        con.execute('DELETE FROM sessions WHERE expires_at <= now() OR token_hash=%s', (token_hash(previous_token),))
        con.execute('''INSERT INTO sessions(token_hash,user_id,pin_version,expires_at)
            VALUES (%s,%s,%s,now() + %s * interval '1 second')''',
                    (token_hash(token), user['id'], fingerprint(), SESSION_SECONDS))
    return token, user


def session_user(token):
    if not token or len(token) != 43:
        return None
    with connection() as con:
        return con.execute('''SELECT users.id,users.name,users.is_admin FROM sessions JOIN users ON users.id=sessions.user_id
            WHERE token_hash=%s AND expires_at > now() AND pin_version=%s''',
                           (token_hash(token), fingerprint())).fetchone()


def logout(token):
    with connection() as con:
        con.execute('DELETE FROM sessions WHERE token_hash=%s', (token_hash(token),))


def current_user(request):
    user = request.scope.get('state', {}).get('user')
    if not user:
        raise HTTPException(401, 'برای ادامه وارد اتاق شوید.')
    return user


class AuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] not in ('http', 'websocket'):
            return await self.app(scope, receive, send)
        request = HTTPConnection(scope)
        websocket = scope['type'] == 'websocket'
        origin = request.headers.get('origin')
        if (websocket or scope.get('method') not in ('GET', 'HEAD', 'OPTIONS')) and origin:
            parsed = urlsplit(origin)
            if parsed.scheme not in ('http', 'https') or parsed.netloc != request.headers.get('host'):
                if websocket:
                    return await send({'type': 'websocket.close', 'code': 4403})
                return await JSONResponse({'detail': 'درخواست نامعتبر است.'}, status_code=403)(scope, receive, send)
        if not websocket and scope['path'] in PUBLIC_PATHS:
            return await self.app(scope, receive, send)
        try:
            user = await run_in_threadpool(session_user, request.cookies.get(SESSION_COOKIE, ''))
        except psycopg.Error:
            if websocket:
                return await send({'type': 'websocket.close', 'code': 1013})
            return await JSONResponse({'detail': 'ورود موقتاً در دسترس نیست؛ دوباره تلاش کنید.'}, status_code=503)(scope, receive, send)
        if not user:
            if websocket:
                return await send({'type': 'websocket.close', 'code': 4401})
            response = (JSONResponse({'detail': 'برای ادامه وارد اتاق شوید.'}, status_code=401)
                        if scope['path'].startswith('/api/') else RedirectResponse('/login', status_code=303))
            return await response(scope, receive, send)
        scope.setdefault('state', {})['user'] = user

        async def send_private(message):
            if message['type'] == 'http.response.start':
                headers = [(k, v) for k, v in message.get('headers', []) if k.lower() != b'cache-control']
                message = {**message, 'headers': headers + [(b'cache-control', b'no-store')]}
            await send(message)
        await self.app(scope, receive, send_private)
