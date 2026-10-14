const chatUI = (() => {
  const get = id => document.getElementById(id);
  const list = get('chat-messages'), form = get('chat-form');
  const text = get('chat-text'), send = get('chat-send'), status = get('chat-status');
  const latest = get('chat-latest');
  let connected = false, ready = false, pending = false;
  const messages = new Map();
  const deletedIds = new Set();

  function update() {
    send.disabled = !connected || !ready || pending;
    send.textContent = pending ? 'در حال ارسال…' : 'ارسال پیام';
  }
  function scrollToLatest() {
    list.scrollTop = list.scrollHeight;
    latest.hidden = true;
  }
  latest.onclick = scrollToLatest;
  list.addEventListener('scroll', () => {
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 40) latest.hidden = true;
  });
  function append(message) {
    if (deletedIds.has(message.id) || messages.has(message.id)) return false;
    if (!messages.size) list.replaceChildren();
    messages.set(message.id, message);
    const row = document.createElement('article'), header = document.createElement('div');
    const author = document.createElement('bdi'), time = document.createElement('time');
    const body = document.createElement('p');
    row.className = 'chat-message';
    row.dataset.messageId = message.id;
    header.className = 'chat-message-header';
    author.textContent = message.name;
    const date = new Date(message.created_at * 1000);
    time.dateTime = date.toISOString();
    time.textContent = date.toLocaleTimeString('fa-IR', {hour: '2-digit', minute: '2-digit'});
    time.title = date.toLocaleString('fa-IR');
    body.dir = 'auto';
    body.textContent = message.text;
    header.append(author, time);
    row.append(header, body);
    list.append(row);
    if (messages.size > 100) {
      messages.delete(messages.keys().next().value);
      const removedHeight = list.firstElementChild.getBoundingClientRect().height + 8;
      list.firstElementChild.remove();
      list.scrollTop = Math.max(0, list.scrollTop - removedHeight);
    }
    return true;
  }
  function receive(event) {
    if (event.type === 'chat_deleted') {
      event.ids.forEach(id => { deletedIds.add(id); messages.delete(id); });
      for (const row of list.querySelectorAll('[data-message-id]')) {
        if (deletedIds.has(Number(row.dataset.messageId))) row.remove();
      }
      if (!messages.size) { list.textContent = 'پیامی وجود ندارد.'; latest.hidden = true; }
    } else if (event.type === 'chat_history') {
      messages.clear();
      list.replaceChildren();
      event.messages.forEach(append);
      if (!messages.size) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'اولین نفر باش؛ نظرت دربارهٔ آهنگ چیه؟';
        list.append(empty);
      }
      scrollToLatest();
    } else if (event.type === 'chat_message') {
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      if (!append(event.message)) return;
      if (atBottom) scrollToLatest();
      else latest.hidden = false;
    }
  }
  function connection(value) {
    connected = value;
    get('chat-connection').textContent = value ? 'آنلاین' : 'در حال اتصال…';
    get('chat-connection').classList.toggle('offline', !value);
    update();
  }
  listenerReady.then(value => {
    ready = value;
    if (!value) status.textContent = 'برای فعال شدن چت، صفحه را تازه کنید.';
    update();
  });
  text.addEventListener('input', () => {
    get('chat-length').textContent = text.value.length.toLocaleString('fa-IR') + ' / ۵۰۰';
  });
  text.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (send.disabled) return;
    const message = text.value.trim();
    if (!message || [...message].length > 500) {
      status.textContent = 'پیام باید بین ۱ تا ۵۰۰ کاراکتر باشد.';
      text.focus();
      return;
    }
    pending = true;
    text.disabled = true;
    status.textContent = '';
    update();
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({text: message})
      });
      if (response.status === 401) { location.replace('/login'); return; }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw Error(typeof data.detail === 'string' ? data.detail : 'ارسال پیام انجام نشد.');
      }
      receive({type: 'chat_message', message: await response.json()});
      text.value = '';
      get('chat-length').textContent = '۰ / ۵۰۰';
      status.textContent = 'پیامت ارسال شد.';
      scrollToLatest();
    } catch (error) {
      status.textContent = error.message || 'ارتباط با سرور برقرار نشد؛ دوباره تلاش کنید.';
    } finally {
      pending = false;
      text.disabled = false;
      update();
      text.focus();
    }
  });
  return {receive, connection};
})();
