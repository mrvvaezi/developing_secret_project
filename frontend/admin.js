async function adminRequest(path, options = {}) {
  const token = adminToken;
  const response = await fetch(path, {...options, headers: {'Content-Type': 'application/json', 'X-Admin-Token': token}});
  const data = await response.json();
  if (!response.ok) throw Error(data.detail || 'درخواست انجام نشد.');
  if (!adminToken || adminToken !== token) throw Error('از مدیریت خارج شده‌اید.');
  return data;
}
$('create-user-form').onsubmit = async event => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  button.disabled = true;
  try {
    const data = await adminRequest('/api/admin/users', {method: 'POST', body: JSON.stringify({name: $('new-username').value, password: $('new-password').value})});
    $('user-create-status').textContent = 'کاربر «' + data.user.name + '» ساخته شد؛ نام کاربری و رمز انتخابی را به خودش بدهید.';
    $('new-password').value = '';
    $('refresh-users').click();
  } catch (error) { $('user-create-status').textContent = error.message; }
  finally { button.disabled = false; }
};
$('refresh-users').onclick = async () => {
  try {
    const data = await adminRequest('/api/admin/users');
    $('admin-users').replaceChildren(...data.items.map(user => {
      const li = document.createElement('li');
      li.textContent = user.name + (user.is_admin ? ' — مدیر' : '') + (!user.active ? ' — برای فعال‌سازی با همین نام رمز تعیین کنید' : '');
      return li;
    }));
  } catch (error) { $('user-create-status').textContent = error.message; }
};
function renderReactionReport(items) {
  const make = (tag, cls, text) => {
    const node = document.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const kinds = [['fire', '🔥', 'عالیه'], ['love', '❤️', 'دوستش دارم'], ['skip', '⏭', 'بعدی']];
  const number = value => value.toLocaleString('fa-IR');
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.play_id)) groups.set(item.play_id, {title: item.title, play: item.play_id, fire: [], love: [], skip: []});
    if (kinds.some(([kind]) => kind === item.reaction)) groups.get(item.play_id)[item.reaction].push(item);
  }
  const cards = [...groups.values()].map(group => {
    const card = make('article', 'reaction-report-card');
    const header = make('header', 'reaction-report-heading');
    const icon = make('span', 'reaction-report-icon', '♫');
    icon.setAttribute('aria-hidden', 'true');
    const info = make('div', 'reaction-report-info');
    const title = make('h4', '', group.title);
    title.dir = 'auto';
    info.append(title, make('span', 'reaction-report-meta', 'نوبت پخش ' + number(group.play)));
    const total = group.fire.length + group.love.length + group.skip.length;
    header.append(icon, info, make('span', 'reaction-report-total', number(total) + ' واکنش'));
    const bar = make('div', 'reaction-report-bar');
    bar.setAttribute('aria-hidden', 'true');
    const columns = make('div', 'reaction-report-columns');
    for (const [kind, emoji, label] of kinds) {
      const count = group[kind].length;
      const segment = make('span', 'report-' + kind);
      segment.style.width = (total ? count / total * 100 : 0) + '%';
      bar.append(segment);
      const column = make('section', 'reaction-report-kind report-' + kind);
      const heading = make('div', 'reaction-kind-heading');
      heading.append(make('span', '', emoji + ' ' + label), make('strong', '', number(count)));
      const people = make('div', 'reaction-report-people');
      group[kind].forEach(item => {
        const person = make('bdi', 'reaction-person', item.name);
        people.append(person);
      });
      if (!count) people.append(make('span', 'reaction-report-meta', 'هنوز کسی انتخاب نکرده'));
      column.append(heading, people);
      columns.append(column);
    }
    card.append(header, bar, columns);
    return card;
  });
  $('admin-reactions').replaceChildren(...cards);
  $('admin-report-status').textContent = items.length
    ? number(items.length) + ' واکنش در ' + number(groups.size) + ' نوبت پخش · نام افراد فقط برای مدیر قابل مشاهده است.'
    : 'هنوز واکنشی ثبت نشده است.';
}
$('refresh-reactions').onclick = async () => {
  const button = $('refresh-reactions');
  button.disabled = true;
  $('admin-report-status').textContent = 'در حال دریافت واکنش‌ها…';
  try {
    const data = await adminRequest('/api/admin/reactions');
    renderReactionReport(data.items);
  } catch (error) { $('admin-report-status').textContent = error.message; }
  finally { button.disabled = false; }
};
let adminChatThrough = 0;
async function loadAdminChat() {
  const data = await adminRequest('/api/admin/chat');
  adminChatThrough = Math.max(0, ...data.items.map(item => item.id));
  $('clear-admin-chat').disabled = !adminChatThrough;
  $('admin-chat-messages').replaceChildren(...data.items.map(item => {
    const row = document.createElement('article');
    row.className = 'chat-message';
    const body = document.createElement('p'), remove = document.createElement('button');
    body.textContent = item.name + ': ' + item.text;
    remove.textContent = 'حذف پیام';
    remove.className = 'text-button';
    remove.onclick = async () => {
      if (!confirm('این پیام برای همه حذف شود؟')) return;
      remove.disabled = true;
      try {
        await adminRequest('/api/admin/chat/' + item.id, {method: 'DELETE'});
        await loadAdminChat();
        $('admin-chat-status').textContent = 'پیام حذف شد.';
      } catch (error) { $('admin-chat-status').textContent = error.message; remove.disabled = false; }
    };
    row.append(body, remove);
    return row;
  }));
  if (!data.items.length) $('admin-chat-messages').textContent = 'پیامی وجود ندارد.';
}
$('refresh-admin-chat').onclick = async () => {
  try { await loadAdminChat(); $('admin-chat-status').textContent = ''; }
  catch (error) { $('admin-chat-status').textContent = error.message; }
};
$('clear-admin-chat').onclick = async () => {
  const throughId = adminChatThrough;
  if (!throughId || !confirm('همه پیام‌های نمایش‌داده‌شده برای همه کاربران حذف شوند؟ این کار قابل برگشت نیست.')) return;
  $('clear-admin-chat').disabled = true;
  try {
    const data = await adminRequest('/api/admin/chat/clear', {method: 'POST', body: JSON.stringify({through_id: throughId})});
    await loadAdminChat();
    $('admin-chat-status').textContent = data.deleted.toLocaleString('fa-IR') + ' پیام حذف شد.';
  } catch (error) { $('admin-chat-status').textContent = error.message; $('clear-admin-chat').disabled = !adminToken || !adminChatThrough; }
};

let onlineLoading = false;
async function loadOnlineUsers() {
  if (!adminToken || onlineLoading) return;
  onlineLoading = true;
  $('refresh-online').disabled = true;
  try {
    const data = await adminRequest('/api/admin/online');
    $('admin-online-users').replaceChildren(...data.items.map(user => {
      const li = document.createElement('li');
      const name = document.createElement('bdi');
      name.textContent = user.name;
      li.append(name);
      const connections = document.createElement('ul');
      for (const connection of user.connections) {
        const device = document.createElement('li');
        device.textContent = [connection.device, connection.os, connection.browser].join(' — ');
        connections.append(device);
      }
      li.append(connections);
      return li;
    }));
    $('admin-online-status').textContent = data.items.length
      ? data.items.length.toLocaleString('fa-IR') + ' کاربر آنلاین · به‌روزرسانی خودکار هر ۵ ثانیه'
      : 'هیچ کاربری آنلاین نیست.';
  } catch (error) {
    if (adminToken) {
      $('admin-online-users').replaceChildren();
      $('admin-online-status').textContent = 'دریافت وضعیت آنلاین انجام نشد؛ دوباره تلاش کنید.';
    }
  } finally {
    onlineLoading = false;
    $('refresh-online').disabled = false;
  }
}
$('refresh-online').onclick = loadOnlineUsers;
setInterval(() => {
  if (!document.hidden) loadOnlineUsers();
}, 5000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadOnlineUsers();
});
