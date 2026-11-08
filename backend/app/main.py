from typing import Annotated
import base64
import binascii
import re
import asyncio

import hashlib

import os

import secrets

import time

import uuid

from contextlib import asynccontextmanager

from pathlib import Path



from fastapi import FastAPI, File, Form, Header, HTTPException, Query, Request, Response, UploadFile, WebSocket, WebSocketDisconnect

from fastapi.responses import FileResponse

from fastapi.staticfiles import StaticFiles

from mutagen.mp3 import MP3
from psycopg.types.json import Jsonb

from starlette.concurrency import run_in_threadpool



from . import auth, storage, presence



BASE = Path(__file__).resolve().parents[2]

FRONTEND = BASE / 'frontend' / 'out'

DATA = BASE / 'data'

MUSIC = DATA / 'music'

DB = DATA / 'music.db'

ADMIN_PASSWORD = os.environ.get('MUSIC_ADMIN_PASSWORD', '')

ADMIN_TOKEN = os.environ.get('MUSIC_ADMIN_TOKEN', '')

STATE_LOCK = asyncio.Lock()

clients: set[WebSocket] = set()

REACTIONS = ('fire', 'love', 'skip')

CHAT_LIMIT = 100

CHAT_COOLDOWN = 2



def db():

    return auth.connection()





def clean_artist(value: str) -> str:
    # Mutagen joins multi-value ID3 text frames with NUL, which PostgreSQL rejects.
    return ' / '.join(part.strip() for part in value.split('\x00') if part.strip())[:120]


def init_db():

    MUSIC.mkdir(parents=True, exist_ok=True)

    storage.init_storage(DB)

    with db() as con:

        for track in con.execute('SELECT id,filename FROM tracks WHERE metadata_version=0').fetchall():
            try:
                tags = MP3(MUSIC / track['filename']).tags
                artist = clean_artist(str(tags.get('TPE1', '') if tags else ''))
            except Exception:
                artist = ''
            con.execute('UPDATE tracks SET artist=%s,metadata_version=1 WHERE id=%s', (artist, track['id']))

        for track in con.execute('SELECT id,filename FROM tracks WHERE content_hash IS NULL').fetchall():

            path = MUSIC / track['filename']

            if path.is_file():

                digest = hashlib.sha256()

                with path.open('rb') as src:

                    while chunk := src.read(1024 * 1024):

                        digest.update(chunk)

                con.execute('UPDATE tracks SET content_hash=%s WHERE id=%s', (digest.hexdigest(), track['id']))



@asynccontextmanager

async def lifespan(app: FastAPI):

    await run_in_threadpool(auth.init_auth)

    init_db()

    task = asyncio.create_task(ticker())

    yield

    task.cancel()

    try:

        await task

    except asyncio.CancelledError:

        pass



app = FastAPI(title='Music Room', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

app.add_middleware(auth.AuthMiddleware)

app.mount('/static', StaticFiles(directory=FRONTEND / 'static', check_dir=False), name='static')
app.mount('/_next', StaticFiles(directory=FRONTEND / '_next', check_dir=False), name='next-assets')



def is_admin(value: str | None):

    return bool(ADMIN_TOKEN and value and secrets.compare_digest(value, ADMIN_TOKEN))



def require_admin(value: str | None):

    if not is_admin(value):

        raise HTTPException(403, 'Admin access required')



def track_dict(r):

    return {'id': r['id'], 'title': r['title'], 'uploader': r['uploader'], 'artist': r.get('artist', ''), 'duration': r['duration'], 'url': '/api/tracks/' + r['id'] + '/audio'}



def current_play(con):

    return con.execute('''SELECT play_history.id FROM play_history JOIN state ON state.track_id=play_history.track_id

        WHERE state.id=1 AND play_history.ended_at IS NULL ORDER BY play_history.id DESC LIMIT 1''').fetchone()



def reaction_counts(con, play_id):

    counts = dict.fromkeys(REACTIONS, 0)

    if play_id is not None:

        for row in con.execute('SELECT reaction,count(*) AS total FROM reactions WHERE play_id=%s GROUP BY reaction', (play_id,)):

            counts[row['reaction']] = row['total']

    return counts



def listener_identity(request):

    user = request.scope.get('state', {}).get('user')

    return 'user:' + str(user['id']) if user else None



def snapshot():

    now = time.time()

    with db() as con:

        state = con.execute('SELECT * FROM state WHERE id=1').fetchone()

        current = con.execute('SELECT * FROM tracks WHERE id=%s', (state['track_id'],)).fetchone() if state['track_id'] else None

        rows = con.execute('SELECT tracks.* FROM queue JOIN tracks ON queue.track_id=tracks.id ORDER BY queue.position').fetchall()

        library_count = con.execute('SELECT last_value FROM catalog_revision').fetchone()['last_value']

        latest = con.execute('SELECT id,ended_at FROM play_history ORDER BY id DESC LIMIT 1').fetchone()

        play = current_play(con)

        play_id = play['id'] if play else None

        reactions = reaction_counts(con, play_id)

        site_copy = con.execute('SELECT copy FROM site_copy WHERE id=1').fetchone()['copy']

    position = float(state['playback_offset'])

    if state['playing'] and state['started'] is not None:

        position += max(0, now - state['started'])

    return {'type': 'state', 'server_time': now, 'current': track_dict(current) if current else None,

            'position': position, 'playing': bool(state['playing']), 'shuffle': bool(state['shuffle']),

            'play_id': play_id, 'reactions': reactions,
            'site_copy': {**storage.DEFAULT_SITE_COPY, **site_copy},

            'library_revision': library_count, 'history_revision': f"{latest['id']}:{latest['ended_at']}" if latest else '0',

            'queue': [track_dict(r) for r in rows], 'listeners': len(clients)}



async def broadcast(payload=None):

    if payload is None:

        payload = snapshot()

    for ws in list(clients):

        try:

            await ws.send_json(payload)

        except Exception:

            clients.discard(ws)



def record_play(con, track_id, now):

    if not con.execute('SELECT 1 FROM play_history WHERE track_id=%s AND ended_at IS NULL', (track_id,)).fetchone():

        con.execute('INSERT INTO play_history(track_id,started_at) VALUES (%s,%s)', (track_id, now))



def start_next(con, now, outcome='skipped'):

    con.execute('UPDATE play_history SET ended_at=%s,outcome=%s WHERE ended_at IS NULL', (now, outcome))

    shuffle = con.execute('SELECT shuffle FROM state WHERE id=1').fetchone()['shuffle']

    order = 'RANDOM()' if shuffle else 'position'

    row = con.execute(f'SELECT position,track_id FROM queue ORDER BY {order} LIMIT 1').fetchone()

    if row:

        con.execute('DELETE FROM queue WHERE position=%s', (row['position'],))

        con.execute('UPDATE state SET track_id=%s,started=%s,playback_offset=0,playing=1 WHERE id=1', (row['track_id'], now))

        record_play(con, row['track_id'], now)

    else:

        con.execute('UPDATE state SET track_id=NULL,started=NULL,playback_offset=0,playing=0 WHERE id=1')



def advance_if_finished():

    now = time.time()

    with db() as con:

        s = con.execute('SELECT * FROM state WHERE id=1 FOR UPDATE').fetchone()

        if not s['playing'] or not s['track_id']:

            return False

        t = con.execute('SELECT duration FROM tracks WHERE id=%s', (s['track_id'],)).fetchone()

        if not t or float(s['playback_offset']) + now - float(s['started']) >= float(t['duration']):

            start_next(con, now, 'completed')

            return True

    return False



async def ticker():

    while True:

        await asyncio.sleep(1)

        async with STATE_LOCK:

            advance_if_finished()

            await broadcast()



@app.get('/')

def home():

    return FileResponse(FRONTEND / 'index.html')



@app.get('/admin/music')
def admin_music_page(request: Request):
    user = auth.current_user(request)
    if not user or not user.get('is_admin'):
        raise HTTPException(403, 'دسترسی مدیر لازم است.')
    return FileResponse(FRONTEND / 'admin' / 'music.html', headers={'Cache-Control': 'no-store'})


@app.get('/api/state')

def state():

    return snapshot()



@app.get('/login')

def login_page():

    return FileResponse(FRONTEND / 'login.html', headers={'Cache-Control': 'no-store'})



@app.get('/manifest.webmanifest')
def web_manifest():
    return FileResponse(FRONTEND / 'manifest.webmanifest', media_type='application/manifest+json')


@app.get('/sw.js')
def service_worker():
    return FileResponse(FRONTEND / 'sw.js', media_type='application/javascript', headers={'Cache-Control': 'no-cache'})


@app.get('/offline.html')
def offline_page():
    return FileResponse(FRONTEND / 'offline.html', headers={'Cache-Control': 'no-cache'})


@app.post('/api/auth/login')

def user_login(payload: dict, request: Request, response: Response):

    try:

        token, user = auth.login(payload.get('name'), payload.get('password'),

                                 request.cookies.get(auth.SESSION_COOKIE, ''))

    except auth.psycopg.Error:

        raise HTTPException(503, 'ورود موقتاً در دسترس نیست؛ دوباره تلاش کنید.')

    response.set_cookie(auth.SESSION_COOKIE, token, max_age=auth.SESSION_SECONDS,

                        httponly=True, samesite='strict', secure=request.url.scheme == 'https')

    response.headers['Cache-Control'] = 'no-store'

    return {'user': user}



@app.get('/api/auth/me')

def user_me(request: Request):

    return {'user': auth.current_user(request)}



@app.post('/api/auth/logout')

async def user_logout(request: Request, response: Response):

    token = request.cookies.get(auth.SESSION_COOKIE, '')

    await run_in_threadpool(auth.logout, token)

    for socket in list(clients):

        if socket.cookies.get(auth.SESSION_COOKIE) == token:

            clients.discard(socket)

            try:

                await socket.close(code=4401)

            except Exception:

                pass

    response.delete_cookie(auth.SESSION_COOKIE, httponly=True, samesite='strict',

                           secure=request.url.scheme == 'https')

    return {'ok': True}



@app.post('/api/listener')

def register_listener(request: Request):

    return {'ok': True, 'user': auth.current_user(request)}



def chat_history():

    with db() as con:

        rows = con.execute('SELECT id,name,text,created_at FROM chat_messages ORDER BY id DESC LIMIT %s',

                           (CHAT_LIMIT,)).fetchall()

    return [dict(row) for row in reversed(rows)]



@app.post('/api/chat')

async def send_chat(payload: dict, request: Request):

    ident = listener_identity(request)

    if not ident:

        raise HTTPException(401, 'برای ارسال پیام، صفحه را تازه کنید.')

    name, text = auth.current_user(request)['name'], payload.get('text')

    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 500:

        raise HTTPException(400, 'پیام باید بین ۱ تا ۵۰۰ کاراکتر باشد.')

    text = text.strip()

    async with STATE_LOCK:

        now = time.time()

        with db() as con:

            con.execute('SELECT id FROM state WHERE id=1 FOR UPDATE')

            last = con.execute('SELECT created_at FROM chat_messages WHERE listener_id=%s ORDER BY id DESC LIMIT 1',

                               (ident,)).fetchone()

            if last and now - last['created_at'] < CHAT_COOLDOWN:

                raise HTTPException(429, 'بین پیام‌ها دو ثانیه صبر کنید.', headers={'Retry-After': '2'})

            cursor = con.execute('INSERT INTO chat_messages(listener_id,name,text,created_at) VALUES (%s,%s,%s,%s) RETURNING id',

                                 (ident, name, text, now))

            message = {'id': cursor.fetchone()['id'], 'name': name, 'text': text, 'created_at': now}

            con.execute('DELETE FROM chat_messages WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT %s)',

                        (CHAT_LIMIT,))

        await broadcast({'type': 'chat_message', 'message': message})

    return message



@app.get('/api/reactions/{play_id}')

def read_reactions(play_id: int, request: Request):

    ident = listener_identity(request)

    with db() as con:

        if not con.execute('SELECT 1 FROM play_history WHERE id=%s', (play_id,)).fetchone():

            raise HTTPException(404, 'این نوبت پخش پیدا نشد.')

        own = con.execute('SELECT reaction FROM reactions WHERE play_id=%s AND listener_id=%s', (play_id, ident)).fetchone() if ident else None

        return {'play_id': play_id, 'reactions': reaction_counts(con, play_id), 'mine': own['reaction'] if own else None}



@app.post('/api/reactions')

async def react(payload: dict, request: Request):

    ident = listener_identity(request)

    if not ident:

        raise HTTPException(401, 'برای ثبت واکنش، صفحه را تازه کنید.')

    play_id, reaction = payload.get('play_id'), payload.get('reaction')

    if type(play_id) is not int or play_id <= 0 or 'reaction' not in payload or reaction not in (*REACTIONS, None):

        raise HTTPException(400, 'واکنش معتبر انتخاب کنید.')

    async with STATE_LOCK:

        with db() as con:

            con.execute('SELECT id FROM state WHERE id=1 FOR UPDATE')

            play = current_play(con)

            if not play or play['id'] != play_id:

                raise HTTPException(409, 'آهنگ عوض شده؛ برای آهنگ جدید واکنش بزنید.')

            if reaction is None:

                con.execute('DELETE FROM reactions WHERE play_id=%s AND listener_id=%s', (play_id, ident))

            else:

                con.execute('''INSERT INTO reactions(play_id,listener_id,reaction,user_id) VALUES (%s,%s,%s,%s)

                    ON CONFLICT(play_id,listener_id) DO UPDATE SET reaction=excluded.reaction,user_id=excluded.user_id''', (play_id, ident, reaction, auth.current_user(request)['id']))

            counts = reaction_counts(con, play_id)

        await broadcast()

    return {'play_id': play_id, 'reactions': counts, 'mine': reaction}



@app.get('/api/library')

def library(q: str = '', limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0),
            uploader: str = '', artist: str | None = None):
    term = '%' + q.strip().replace('!', '!!').replace('%', '!%').replace('_', '!_') + '%'
    where = "WHERE (title ILIKE %s ESCAPE '!' OR uploader ILIKE %s ESCAPE '!' OR artist ILIKE %s ESCAPE '!')"
    params = [term, term, term]
    if uploader:
        where += ' AND uploader=%s'
        params.append(uploader)
    if artist is not None:
        where += ' AND artist=%s'
        params.append(artist)
    with db() as con:
        total = con.execute('SELECT count(*) AS total FROM tracks ' + where, params).fetchone()['total']
        rows = con.execute('SELECT * FROM tracks ' + where + ' ORDER BY created DESC,id DESC LIMIT %s OFFSET %s',
                           (*params, limit, offset)).fetchall()
    return {'items': [{**track_dict(r), 'uploaded_at': r['created']} for r in rows], 'total': total}


@app.get('/api/library/categories')
def library_categories():
    with db() as con:
        uploaders = con.execute('SELECT uploader AS name, count(*) AS count FROM tracks GROUP BY uploader ORDER BY uploader').fetchall()
        artists = con.execute('SELECT artist AS name, count(*) AS count FROM tracks GROUP BY artist ORDER BY artist').fetchall()
    return {'uploaders': uploaders, 'artists': artists}


def playlist_name(payload):
    name = payload.get('name')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
        raise HTTPException(400, 'نام پلی‌لیست باید بین ۱ تا ۱۰۰ کاراکتر باشد.')
    return name.strip()


def owned_playlist(con, ident, request):
    row = con.execute('SELECT * FROM playlists WHERE id=%s AND owner_id=%s FOR UPDATE',
                      (ident, auth.current_user(request)['id'])).fetchone()
    if not row:
        raise HTTPException(404, 'پلی‌لیست پیدا نشد.')
    return row


@app.get('/api/playlists')
def playlists(request: Request):
    with db() as con:
        rows = con.execute('''SELECT p.id,p.name,count(t.track_id) AS count FROM playlists p
            LEFT JOIN playlist_tracks t ON t.playlist_id=p.id WHERE p.owner_id=%s
            GROUP BY p.id ORDER BY p.id DESC''', (auth.current_user(request)['id'],)).fetchall()
    return {'items': rows}


@app.post('/api/playlists')
def create_playlist(payload: dict, request: Request):
    name = playlist_name(payload)
    with db() as con:
        row = con.execute('INSERT INTO playlists(owner_id,name) VALUES (%s,%s) RETURNING id,name',
                          (auth.current_user(request)['id'], name)).fetchone()
    return {**row, 'count': 0}


@app.patch('/api/playlists/{ident}')
def rename_playlist(ident: int, payload: dict, request: Request):
    name = playlist_name(payload)
    with db() as con:
        owned_playlist(con, ident, request)
        con.execute('UPDATE playlists SET name=%s WHERE id=%s', (name, ident))
    return {'ok': True}


@app.delete('/api/playlists/{ident}')
def delete_playlist(ident: int, request: Request):
    with db() as con:
        owned_playlist(con, ident, request)
        con.execute('DELETE FROM playlists WHERE id=%s', (ident,))
    return {'ok': True}


@app.get('/api/playlists/{ident}/tracks')
def playlist_contents(ident: int, request: Request, limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0)):
    with db() as con:
        owned_playlist(con, ident, request)
        total = con.execute('SELECT count(*) AS total FROM playlist_tracks WHERE playlist_id=%s', (ident,)).fetchone()['total']
        rows = con.execute('''SELECT t.* FROM playlist_tracks p JOIN tracks t ON t.id=p.track_id
            WHERE p.playlist_id=%s ORDER BY p.position LIMIT %s OFFSET %s''', (ident, limit, offset)).fetchall()
    return {'items': [track_dict(r) for r in rows], 'total': total}


@app.post('/api/playlists/{ident}/tracks/{track_id}')
def add_playlist_track(ident: int, track_id: str, request: Request):
    with db() as con:
        owned_playlist(con, ident, request)
        if not con.execute('SELECT id FROM tracks WHERE id=%s FOR KEY SHARE', (track_id,)).fetchone():
            raise HTTPException(404, 'آهنگ پیدا نشد.')
        con.execute('INSERT INTO playlist_tracks(playlist_id,track_id) VALUES (%s,%s) ON CONFLICT DO NOTHING', (ident, track_id))
    return {'ok': True}


@app.delete('/api/playlists/{ident}/tracks/{track_id}')
def remove_playlist_track(ident: int, track_id: str, request: Request):
    with db() as con:
        owned_playlist(con, ident, request)
        con.execute('DELETE FROM playlist_tracks WHERE playlist_id=%s AND track_id=%s', (ident, track_id))
    return {'ok': True}


@app.post('/api/playlists/{ident}/enqueue')
async def enqueue_playlist(ident: int, request: Request):
    added = skipped = 0
    async with STATE_LOCK:
        with db() as con:
            con.execute('SELECT id FROM state WHERE id=1 FOR UPDATE')
            owned_playlist(con, ident, request)
            rows = con.execute('SELECT track_id FROM playlist_tracks WHERE playlist_id=%s ORDER BY position', (ident,)).fetchall()
            for row in rows:
                try:
                    enqueue_track(con, row['track_id'])
                    added += 1
                except HTTPException as error:
                    if error.status_code not in (404, 409):
                        raise
                    skipped += 1
        await broadcast()
    return {'added': added, 'skipped': skipped}


@app.patch('/api/admin/tracks/{track_id}')
async def update_track_artist(track_id: str, payload: dict, request: Request, x_admin_token: str | None = Header(default=None)):
    require_chat_admin(request, x_admin_token)
    artist = payload.get('artist')
    if not isinstance(artist, str) or len(artist.strip()) > 120:
        raise HTTPException(400, 'نام خواننده حداکثر ۱۲۰ کاراکتر است.')
    async with STATE_LOCK:
        with db() as con:
            row = con.execute('UPDATE tracks SET artist=%s,metadata_version=1 WHERE id=%s RETURNING id', (clean_artist(artist), track_id)).fetchone()
            if not row:
                raise HTTPException(404, 'آهنگ پیدا نشد.')
        await broadcast()
    return {'ok': True}


@app.get('/api/history')

def history(limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0)):

    with db() as con:

        total = con.execute('SELECT count(*) AS total FROM play_history').fetchone()['total']

        rows = con.execute('''SELECT tracks.*,play_history.id AS event_id,started_at,ended_at,outcome

            FROM play_history JOIN tracks ON tracks.id=play_history.track_id

            ORDER BY play_history.id DESC LIMIT %s OFFSET %s''', (limit, offset)).fetchall()

    return {'items': [{**track_dict(r), 'event_id': r['event_id'], 'started_at': r['started_at'],

                       'ended_at': r['ended_at'], 'outcome': r['outcome']} for r in rows], 'total': total}



def enqueue_track(con, track_id):

    track = con.execute('SELECT * FROM tracks WHERE id=%s', (track_id,)).fetchone()

    if not track or not (MUSIC / track['filename']).is_file():

        raise HTTPException(404, 'فایل آهنگ پیدا نشد.')

    active = con.execute('''SELECT id FROM tracks WHERE (id=%s OR content_hash=%s) AND

        (id IN (SELECT track_id FROM queue) OR id=(SELECT track_id FROM state WHERE id=1)) LIMIT 1''',

        (track_id, track['content_hash'])).fetchone()

    if active:

        raise HTTPException(409, 'این آهنگ قبلاً اضافه شده و در صف یا در حال پخش است.')

    con.execute('INSERT INTO queue(track_id) VALUES (%s)', (track_id,))

    if con.execute('SELECT track_id FROM state WHERE id=1').fetchone()['track_id'] is None:

        start_next(con, time.time())



@app.post('/api/tracks/{ident}/enqueue')

async def enqueue(ident: str):

    async with STATE_LOCK:

        with db() as con:

            con.execute('SELECT id FROM state WHERE id=1 FOR UPDATE')

            enqueue_track(con, ident)

        await broadcast()

    return {'ok': True, 'id': ident}



@app.post('/api/upload')

async def upload(request: Request, file: UploadFile = File(...), artist: Annotated[str, Form(max_length=120)] = ''):

    uploader = auth.current_user(request)['name']

    title = Path(file.filename or 'music.mp3').name[:120]

    if not title.lower().endswith('.mp3'):

        raise HTTPException(400, 'Only MP3 files are accepted')

    ident = uuid.uuid4().hex

    filename = ident + '.mp3'

    path = MUSIC / filename

    total = 0

    digest = hashlib.sha256()

    try:

        with path.open('wb') as dst:

            while chunk := await file.read(1024 * 1024):

                total += len(chunk)

                dst.write(chunk)

                digest.update(chunk)

        if total == 0:

            raise HTTPException(400, 'Empty file')

        metadata = MP3(path)
        duration = float(metadata.info.length)
        artist = clean_artist(artist) or clean_artist(str(metadata.tags.get('TPE1', '') if metadata.tags else ''))

        if not 0 < duration < 24 * 3600:

            raise ValueError('Invalid duration')

    except HTTPException:

        path.unlink(missing_ok=True)

        raise

    except Exception:

        path.unlink(missing_ok=True)

        raise HTTPException(400, 'Invalid MP3')

    keep_file = False

    try:

        async with STATE_LOCK:

            with db() as con:

                con.execute('SELECT id FROM state WHERE id=1 FOR UPDATE')

                content_hash = digest.hexdigest()

                active = con.execute('''SELECT id FROM tracks WHERE content_hash=%s AND

                    (id IN (SELECT track_id FROM queue) OR id=(SELECT track_id FROM state WHERE id=1))

                    LIMIT 1''', (content_hash,)).fetchone()

                if active:

                    raise HTTPException(409, 'این آهنگ قبلاً اضافه شده و در صف یا در حال پخش است.')

                existing = con.execute('SELECT id FROM tracks WHERE content_hash=%s ORDER BY created,id LIMIT 1', (content_hash,)).fetchone()

                if existing:

                    ident = existing['id']

                else:

                    con.execute('INSERT INTO tracks(id,title,uploader,duration,filename,created,content_hash,artist,metadata_version) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,1)',

                                (ident, title, uploader, duration, filename, time.time(), content_hash, artist))

                enqueue_track(con, ident)

            keep_file = existing is None

            await broadcast()

    finally:

        if not keep_file:

            path.unlink(missing_ok=True)

    return {'ok': True, 'id': ident}



@app.get('/api/tracks/{ident}/audio')

def audio(ident: str):

    with db() as con:

        row = con.execute('SELECT filename FROM tracks WHERE id=%s', (ident,)).fetchone()

    if not row:

        raise HTTPException(404)

    return FileResponse(MUSIC / row['filename'], media_type='audio/mpeg', headers={'Cache-Control': 'private, max-age=3600'})



def require_chat_admin(request, token):

    require_admin(token)

    if not auth.current_user(request).get('is_admin'):

        raise HTTPException(403, 'دسترسی مدیر لازم است.')





@app.get('/api/admin/tracks')
def admin_tracks(
    request: Request,
    uploader: str = '',
    artist: str | None = None,
    q: str = '',
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    x_admin_token: str | None = Header(default=None),
):
    require_chat_admin(request, x_admin_token)
    return library(q=q, limit=limit, offset=offset, uploader=uploader, artist=artist)


@app.delete('/api/admin/tracks/{track_id}')
async def delete_admin_track(
    track_id: str,
    request: Request,
    x_admin_token: str | None = Header(default=None),
):
    require_chat_admin(request, x_admin_token)

    async with STATE_LOCK:
        with db() as con:
            state = con.execute('SELECT * FROM state WHERE id=1 FOR UPDATE').fetchone()
            track = con.execute(
                'SELECT id, filename FROM tracks WHERE id=%s FOR UPDATE',
                (track_id,),
            ).fetchone()
            if not track:
                raise HTTPException(404, 'آهنگ پیدا نشد.')

            was_current = state['track_id'] == track_id
            filename = track['filename']
            con.execute('DELETE FROM queue WHERE track_id=%s', (track_id,))
            if was_current:
                start_next(con, time.time(), 'skipped')

            # Remove dependent rows before deleting the track itself.
            con.execute("""DELETE FROM reactions WHERE play_id IN (
                SELECT id FROM play_history WHERE track_id=%s
            )""", (track_id,))
            con.execute('DELETE FROM play_history WHERE track_id=%s', (track_id,))
            con.execute('DELETE FROM tracks WHERE id=%s', (track_id,))

        # Database changes are committed when the context manager exits.
        # A filesystem failure does not undo that commit; log it for cleanup.
        file_removed = True
        try:
            (MUSIC / filename).unlink(missing_ok=True)
        except OSError:
            file_removed = False
            import logging
            logging.exception('Failed to delete music file %s', filename)

        await broadcast({'type': 'track_deleted', 'id': track_id})
        await broadcast()

    return {
        'ok': True,
        'deleted_id': track_id,
        'was_current': was_current,
        'file_removed': file_removed,
    }


@app.get('/api/admin/chat')

def admin_chat(request: Request, x_admin_token: str | None = Header(default=None)):

    require_chat_admin(request, x_admin_token)

    return {'items': chat_history()}





@app.delete('/api/admin/chat/{message_id}')

async def delete_chat(message_id: int, request: Request, x_admin_token: str | None = Header(default=None)):

    require_chat_admin(request, x_admin_token)

    async with STATE_LOCK:

        with db() as con:

            con.execute('SELECT id FROM state WHERE id=1 FOR UPDATE')

            rows = con.execute('DELETE FROM chat_messages WHERE id=%s RETURNING id', (message_id,)).fetchall()

        ids = [row['id'] for row in rows]

        await broadcast({'type': 'chat_deleted', 'ids': ids})

    return {'deleted': len(ids)}





@app.post('/api/admin/chat/clear')

async def clear_chat(payload: dict, request: Request, x_admin_token: str | None = Header(default=None)):

    require_chat_admin(request, x_admin_token)

    through_id = payload.get('through_id')

    if type(through_id) is not int or through_id <= 0:

        raise HTTPException(400, 'ابتدا فهرست پیام‌ها را دریافت کنید.')

    async with STATE_LOCK:

        with db() as con:

            con.execute('SELECT id FROM state WHERE id=1 FOR UPDATE')

            rows = con.execute('DELETE FROM chat_messages WHERE id<=%s RETURNING id', (through_id,)).fetchall()

        ids = [row['id'] for row in rows]

        await broadcast({'type': 'chat_deleted', 'ids': ids})

    return {'deleted': len(ids)}





@app.get('/api/admin/online')
async def admin_online(request: Request, x_admin_token: str | None = Header(default=None)):
    require_chat_admin(request, x_admin_token)
    return {'items': presence.online_users(clients)}


@app.get('/api/admin/users')

def list_users(x_admin_token: str | None = Header(default=None)):

    require_admin(x_admin_token)

    with auth.connection() as con:

        return {'items': con.execute('SELECT id,name,is_admin,password_hash IS NOT NULL AS active FROM users ORDER BY id').fetchall()}





@app.post('/api/admin/users')

def add_user(payload: dict, x_admin_token: str | None = Header(default=None)):

    require_admin(x_admin_token)

    return {'user': auth.create_user(payload.get('name'), payload.get('password'))}


@app.patch('/api/admin/users/{user_id}')
def edit_user(user_id: int, payload: dict, x_admin_token: str | None = Header(default=None)):
    require_admin(x_admin_token)
    if not isinstance(payload, dict) or 'name' not in payload:
        raise HTTPException(400, 'نام کاربری را وارد کنید.')
    password = payload.get('password')
    if password == '':
        password = None
    return {'user': auth.update_user(user_id, payload.get('name'), password)}





@app.get('/api/admin/reactions')

def admin_reactions(x_admin_token: str | None = Header(default=None)):

    require_admin(x_admin_token)

    with db() as con:

        rows = con.execute("""SELECT tracks.title, tracks.id AS track_id, reactions.play_id,

            reactions.listener_id, reactions.reaction, reactions.user_id,

            COALESCE(users.name, 'کاربر قدیمی') AS name FROM reactions

            JOIN play_history ON play_history.id=reactions.play_id

            JOIN tracks ON tracks.id=play_history.track_id

            LEFT JOIN users ON users.id=reactions.user_id

            ORDER BY reactions.play_id DESC, reactions.listener_id LIMIT 1000""").fetchall()

    return {'items': rows}







@app.post('/api/admin/login')

async def login(payload: dict, request: Request):

    if not auth.current_user(request).get('is_admin'):

        raise HTTPException(403, 'دسترسی مدیر لازم است.')

    if not ADMIN_PASSWORD or not secrets.compare_digest(str(payload.get('password', '')), ADMIN_PASSWORD):

        raise HTTPException(403, 'Wrong password')

    return {'token': ADMIN_TOKEN}


@app.put('/api/admin/site-copy')
async def update_site_copy(payload: dict, request: Request, x_admin_token: str | None = Header(default=None)):
    if not auth.current_user(request).get('is_admin'):
        raise HTTPException(403, 'دسترسی مدیر لازم است.')
    require_admin(x_admin_token)
    limits = {'hero_title': 100, 'hero_cover': 700000, 'hero_text_color': 7, 'hero_accent_color': 7}
    if not payload or any(key not in limits for key in payload):
        raise HTTPException(400, 'فیلد متن نامعتبر است.')
    updates = {}
    for key, value in payload.items():
        if not isinstance(value, str):
            raise HTTPException(400, 'متن باید رشته باشد.')
        value = value.strip()
        if key == 'hero_cover':
            if value:
                match = re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)', value)
                if not match or len(value) > limits[key]:
                    raise HTTPException(400, 'کاور باید عکس PNG، JPEG یا WebP با حجم حداکثر ۵۰۰ کیلوبایت باشد.')
                try:
                    image = base64.b64decode(match[2], validate=True)
                except (ValueError, binascii.Error):
                    raise HTTPException(400, 'عکس معتبر نیست.')
                signatures = {'png': image.startswith(b'\x89PNG\r\n\x1a\n'),
                              'jpeg': image.startswith(b'\xff\xd8\xff'),
                              'webp': image.startswith(b'RIFF') and image[8:12] == b'WEBP'}
                if len(image) > 500 * 1024 or not signatures[match[1]]:
                    raise HTTPException(400, 'عکس معتبر نیست یا حجم آن بیش از حد مجاز است.')
            updates[key] = value
            continue
        if key in ('hero_text_color', 'hero_accent_color'):
            if not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
                raise HTTPException(400, 'رنگ معتبر نیست.')
            updates[key] = value
            continue
        if (not value or len(value) > limits[key] or
                any(ord(char) < 32 and char != '\n' for char in value) or
                value.count('\n') > 2):
            raise HTTPException(400, 'متن واردشده معتبر نیست یا بیش از حد طولانی است.')
        updates[key] = value
    async with STATE_LOCK:
        with db() as con:
            current = con.execute('SELECT copy FROM site_copy WHERE id=1 FOR UPDATE').fetchone()['copy']
            result = {**storage.DEFAULT_SITE_COPY, **current, **updates}
            con.execute('UPDATE site_copy SET copy=%s WHERE id=1', (Jsonb(result),))
        await broadcast()
    return {'site_copy': result}



@app.post('/api/admin/control')

async def control(payload: dict, x_admin_token: str | None = Header(default=None)):

    require_admin(x_admin_token)

    action = payload.get('action')

    if action not in ('play', 'pause', 'next', 'seek', 'remove', 'shuffle', 'move'):

        raise HTTPException(400, 'Unknown action')

    if action == 'shuffle' and not isinstance(payload.get('enabled'), bool):

        raise HTTPException(400, 'Shuffle enabled must be a boolean')

    if action == 'move' and (payload.get('direction') not in ('up', 'down')

                             or not isinstance(payload.get('track_id'), str) or not payload['track_id']):

        raise HTTPException(400, 'آهنگ و جهت جابه‌جایی را مشخص کنید.')

    async with STATE_LOCK:

        now = time.time()

        with db() as con:

            con.execute('SELECT id FROM state WHERE id=1 FOR UPDATE')

            s = con.execute('SELECT * FROM state WHERE id=1 FOR UPDATE').fetchone()

            if action == 'move':

                row = con.execute('SELECT position,track_id FROM queue WHERE track_id=%s ORDER BY position LIMIT 1',

                                  (payload['track_id'],)).fetchone()

                if not row:

                    raise HTTPException(404, 'این آهنگ دیگر در صف نیست.')

                comparison, order = ('<', 'DESC') if payload['direction'] == 'up' else ('>', 'ASC')

                neighbor = con.execute(f'SELECT position,track_id FROM queue WHERE position {comparison} %s ORDER BY position {order} LIMIT 1',

                                       (row['position'],)).fetchone()

                if neighbor:

                    con.execute('UPDATE queue SET track_id=%s WHERE position=%s', (neighbor['track_id'], row['position']))

                    con.execute('UPDATE queue SET track_id=%s WHERE position=%s', (row['track_id'], neighbor['position']))

                    con.execute('UPDATE state SET shuffle=0 WHERE id=1')

            elif action == 'shuffle':

                con.execute('UPDATE state SET shuffle=%s WHERE id=1', (int(payload['enabled']),))

            elif action == 'next':

                start_next(con, now)

            elif action == 'remove':

                track_id = str(payload.get('track_id', ''))

                con.execute('DELETE FROM queue WHERE track_id=%s', (track_id,))

            elif action == 'pause' and s['playing']:

                con.execute('UPDATE state SET playback_offset=%s,started=NULL,playing=0 WHERE id=1', (s['playback_offset'] + now - s['started'],))

            elif action == 'play' and s['track_id'] and not s['playing']:

                con.execute('UPDATE state SET started=%s,playing=1 WHERE id=1', (now,))

                record_play(con, s['track_id'], now)

            elif action == 'seek' and s['track_id']:

                t = con.execute('SELECT duration FROM tracks WHERE id=%s', (s['track_id'],)).fetchone()

                value = max(0.0, min(float(payload.get('position', 0)), t['duration']))

                con.execute('UPDATE state SET playback_offset=%s,started=%s WHERE id=1', (value, now if s['playing'] else None))

        await broadcast()

    return {'ok': True}



@app.websocket('/ws')

async def ws(websocket: WebSocket):

    await websocket.accept()

    try:

        async with STATE_LOCK:

            clients.add(websocket)

            await websocket.send_json(snapshot())

            await websocket.send_json({'type': 'chat_history', 'messages': chat_history()})

        next_check = time.monotonic() + 30

        while True:

            try:

                await asyncio.wait_for(websocket.receive_text(), timeout=max(0, next_check - time.monotonic()))

            except asyncio.TimeoutError:

                pass

            if time.monotonic() >= next_check:

                try:

                    user = await run_in_threadpool(auth.session_user, websocket.cookies.get(auth.SESSION_COOKIE, ''))

                except auth.psycopg.Error:

                    await websocket.close(code=1013)

                    break

                if not user:

                    await websocket.close(code=4401)

                    break

                next_check = time.monotonic() + 30

    except WebSocketDisconnect:

        pass

    finally:

        clients.discard(websocket)
