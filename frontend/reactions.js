const reactionUI = {ready: false, playId: null, selectedFor: null, loadingFor: null, mine: null, pendingFor: null};
const reactionLabels = {fire: 'عالیه', love: 'دوستش دارم', skip: 'بعدی'};
const reactionNumber = value => Number(value || 0).toLocaleString('fa-IR');
function reactionText(id, text) {
  if ($(id).textContent !== text) $(id).textContent = text;
}

async function loadMyReaction(playId) {
  reactionUI.loadingFor = playId;
  try {
    const response = await fetch('/api/reactions/' + playId);
    if (!response.ok) throw Error('دریافت واکنش انجام نشد.');
    const data = await response.json();
    if (state?.play_id !== playId) return;
    reactionUI.mine = data.mine;
    reactionUI.selectedFor = playId;
    reactionUI.loadingFor = null;
    renderReactions(state);
  } catch (error) {
    if (state?.play_id === playId) {
      reactionUI.loadingFor = null;
      $('reaction-status').textContent = 'دریافت واکنش انجام نشد؛ دوباره تلاش می‌کنیم.';
    }
  }
}

function renderReactions(s) {
  const playId = s.play_id || null, counts = s.reactions || {};
  if (playId !== reactionUI.playId) {
    reactionUI.playId = playId;
    reactionUI.mine = null;
    reactionUI.selectedFor = null;
    $('reaction-status').textContent = playId ? 'یک واکنش انتخاب کن؛ با زدن دوباره، حذف می‌شود.' : 'با شروع آهنگ، واکنشت را ثبت کن.';
  }
  if (reactionUI.ready && playId && reactionUI.selectedFor !== playId && reactionUI.loadingFor !== playId) loadMyReaction(playId);
  let total = 0;
  for (const kind of ['fire', 'love', 'skip']) {
    const count = Number(counts[kind] || 0), button = $('reaction-' + kind);
    total += count;
    reactionText('reaction-' + kind + '-count', reactionNumber(count));
    button.disabled = !reactionUI.ready || !playId || reactionUI.selectedFor !== playId || reactionUI.pendingFor === playId;
    button.setAttribute('aria-pressed', String(reactionUI.mine === kind));
    button.setAttribute('aria-label', reactionLabels[kind] + '؛ ' + reactionNumber(count) + ' واکنش');
  }
  reactionText('reaction-total', reactionNumber(total) + ' واکنش');
  reactionText('admin-reaction-summary', total
    ? 'نظر جمع: 🔥 ' + reactionNumber(counts.fire) + ' · ❤️ ' + reactionNumber(counts.love) + ' · ⏭ ' + reactionNumber(counts.skip) + ' درخواستِ بعدی'
    : 'هنوز واکنشی برای این آهنگ ثبت نشده است.');
}

for (const kind of ['fire', 'love', 'skip']) {
  $('reaction-' + kind).onclick = async () => {
    if ($('reaction-' + kind).disabled || !state?.play_id) return;
    const playId = state.play_id;
    const selected = reactionUI.mine === kind ? null : kind;
    reactionUI.pendingFor = playId;
    renderReactions(state);
    try {
      const response = await fetch('/api/reactions', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({play_id: playId, reaction: selected})
      });
      if (!response.ok) {
        const data = await response.json();
        throw Error(typeof data.detail === 'string' ? data.detail : 'ثبت واکنش انجام نشد.');
      }
      const data = await response.json();
      if (state?.play_id !== playId) return;
      reactionUI.mine = data.mine;
      reactionUI.selectedFor = playId;
      state.reactions = data.reactions;
      $('reaction-status').textContent = selected ? 'واکنشت ثبت شد؛ هویتت فقط برای مدیر قابل مشاهده است.' : 'واکنشت حذف شد.';
    } catch (error) {
      if (state?.play_id === playId) $('reaction-status').textContent = error.message || 'ارتباط با سرور برقرار نشد.';
    } finally {
      if (reactionUI.pendingFor === playId) reactionUI.pendingFor = null;
      if (state) renderReactions(state);
    }
  };
}
listenerReady
  .then(ready => { if (!ready) throw Error(); reactionUI.ready = true; if (state) renderReactions(state); })
  .catch(() => { $('reaction-status').textContent = 'برای فعال شدن واکنش‌ها، صفحه را تازه کنید.'; });
if (state) renderReactions(state);
