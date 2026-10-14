const collectionViews = {
  library: {offset: 0, items: [], revision: null, request: 0},
  history: {offset: 0, items: [], revision: null, request: 0}
};
const pageSize = 25;
let activeTracksKey = '';
const dateLabel = seconds => new Date(seconds * 1000).toLocaleString('fa-IR');

function renderCollection(kind) {
  const view = collectionViews[kind], list = $(kind + '-list');
  list.replaceChildren();
  if (!view.items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = kind === 'library' ? 'هنوز آهنگی اینجا نیست؛ آهنگت را اضافه کن یا جست‌وجو را تغییر بده.' : 'اولین آهنگ که پخش شود، خاطره‌ها از اینجا شروع می‌شوند.';
    list.append(empty);
  }
  const active = new Set((state?.queue || []).map(t => t.id));
  if (state?.current) active.add(state.current.id);
  for (const track of view.items) {
    const row = document.createElement('div'), info = document.createElement('div');
    const title = document.createElement('div'), meta = document.createElement('div');
    row.className = kind === 'library' ? 'library-card' : 'history-item';
    info.className = 'track-info';
    if (active.has(track.id)) row.classList.add('is-active');
    title.className = 'queue-title';
    title.textContent = track.title;
    title.title = track.title;
    meta.className = 'track-meta';
    if (kind === 'history') {
      const outcome = {current: 'آهنگ جاری', completed: 'پخش کامل', skipped: 'رد شده'}[track.outcome] || track.outcome;
      meta.textContent = dateLabel(track.started_at) + ' · ' + outcome;
      if (track.ended_at) meta.textContent += ' · پایان: ' + dateLabel(track.ended_at);
    } else {
      meta.textContent = track.uploader + ' · ' + fmt(track.duration) + ' · ' + dateLabel(track.uploaded_at);
    }
    info.append(title, meta);
    const actions = document.createElement('div'), add = document.createElement('button');
    actions.className = 'track-actions';
    add.className = 'secondary';
    add.disabled = active.has(track.id);
    add.textContent = add.disabled ? 'در صف / پخش' : 'افزودن به صف';
    add.onclick = async () => {
      add.disabled = true;
      const status = $(kind + '-status');
      try {
        const response = await fetch('/api/tracks/' + encodeURIComponent(track.id) + '/enqueue', {method: 'POST'});
        if (!response.ok) throw Error((await response.json()).detail || 'افزودن انجام نشد.');
        status.textContent = 'آهنگ به صف اضافه شد.';
        const updated = await fetch('/api/state');
        if (updated.ok) render(await updated.json());
      } catch (error) {
        status.textContent = error.message;
      } finally {
        add.disabled = state?.current?.id === track.id || !!state?.queue.some(t => t.id === track.id);
      }
    };
    const download = document.createElement('a');
    download.href = track.url;
    download.download = track.title;
    download.textContent = 'دانلود';
    actions.append(add, download);
    row.append(createArtwork(track), info, actions);
    list.append(row);
  }
}

async function loadCollection(kind, revision) {
  const view = collectionViews[kind], request = ++view.request;
  view.revision = revision;
  const params = new URLSearchParams({limit: pageSize, offset: view.offset});
  if (kind === 'library') params.set('q', $('library-search').value);
  try {
    const response = await fetch('/api/' + kind + '?' + params);
    if (!response.ok) throw Error('دریافت اطلاعات انجام نشد.');
    const data = await response.json();
    if (request !== view.request) return;
    view.items = data.items;
    $(kind + '-count').textContent = data.total.toLocaleString('fa-IR');
    $(kind + '-prev').disabled = view.offset === 0;
    $(kind + '-next').disabled = view.offset + pageSize >= data.total;
    $(kind + '-status').textContent = '';
    renderCollection(kind);
  } catch (error) {
    if (request !== view.request) return;
    view.revision = null;
    $(kind + '-status').textContent = error.message;
  }
}

function refreshCollections(s) {
  for (const kind of ['library', 'history']) {
    const revision = s[kind + '_revision'];
    if (collectionViews[kind].revision !== revision) loadCollection(kind, revision);
  }
  const active = JSON.stringify([s.current?.id, s.queue.map(t => t.id)]);
  if (active !== activeTracksKey) {
    activeTracksKey = active;
    renderCollection('library');
    renderCollection('history');
  }
}

for (const kind of ['library', 'history']) {
  for (const [direction, step] of [['prev', -1], ['next', 1]]) {
    $(kind + '-' + direction).disabled = true;
    $(kind + '-' + direction).onclick = () => {
      collectionViews[kind].offset = Math.max(0, collectionViews[kind].offset + step * pageSize);
      loadCollection(kind, state?.[kind + '_revision']);
    };
  }
}
let searchTimer;
$('library-search').oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    collectionViews.library.offset = 0;
    loadCollection('library', state?.library_revision);
  }, 250);
};
if (state) refreshCollections(state);
