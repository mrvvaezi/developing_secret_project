// A session belongs to the signed-in user; names are never supplied by chat/upload.
const listenerReady = fetch('/api/auth/me', {cache: 'no-store'})
  .then(async response => {
    if (response.status === 401) { location.replace('/login'); return false; }
    if (!response.ok) throw Error();
    const {user} = await response.json();
    document.getElementById('session-name').textContent = user.name;
    document.getElementById('chat-author').textContent = user.name;
    document.getElementById('upload-author').textContent = user.name;
    return true;
  }).catch(() => {
    document.getElementById('session-status').textContent = 'دریافت اطلاعات ورود انجام نشد؛ صفحه را تازه کنید.';
    return false;
  });

document.getElementById('session-logout').onclick = async () => {
  const button = document.getElementById('session-logout');
  button.disabled = true;
  try {
    const response = await fetch('/api/auth/logout', {method: 'POST'});
    if (!response.ok && response.status !== 401) throw Error();
    location.replace('/login');
  } catch (_) {
    document.getElementById('session-status').textContent = 'خروج انجام نشد؛ دوباره تلاش کنید.';
    button.disabled = false;
  }
};
