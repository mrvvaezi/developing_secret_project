const $=x=>document.getElementById(x),audio=$('audio');let state=null,enabled=false,adminToken='',lastTrack='',userSeeking=false,clockOffset=0;const fmt=x=>{x=Math.max(0,Math.floor(x||0));return Math.floor(x/60)+':'+String(x%60).padStart(2,'0')};function now(){return Date.now()/1000+clockOffset}function currentPos(){return !state?0:state.position+(state.playing?Math.max(0,now()-state.server_time):0)}
async function syncAudio(){if(!enabled||!state)return;let t=state.current;if(!t){audio.pause();audio.removeAttribute('src');lastTrack='';$('status').textContent='منتظر آهنگ بعدی هستیم.';return}if(lastTrack!==t.id){lastTrack=t.id;audio.src=t.url;audio.load()}let target=Math.max(0,Math.min(currentPos(),Math.max(0,t.duration-.03)));if(audio.readyState>=1&&Math.abs((audio.currentTime||0)-target)>.6){try{audio.currentTime=target}catch(e){}}if(state.playing){try{await audio.play();$('status').textContent='در حال شنیدن موسیقی';}catch(e){$('listen').disabled=false;$('status').textContent='برای پخش، دوباره شروع شنیدن را بزن.'}}else{audio.pause();$('status').textContent='پخش توسط مدیر متوقف شده است.'}}
let queueMoving = false, lastQueueKey = '';

function renderQueue(s) {
  const key = JSON.stringify([!!adminToken, queueMoving, s.shuffle, s.queue]);
  if (key === lastQueueKey) return;
  lastQueueKey = key;
  const queue = $('queue');
  queue.replaceChildren();
  if (!s.queue.length) { const empty=document.createElement('p');empty.className='empty-state';empty.textContent='صف منتظر آهنگ‌های شماست.';queue.append(empty); }
  s.queue.forEach((track, index) => {
    const row = document.createElement('div'), info = document.createElement('div');
    row.className = 'queue-item' + (index === 0 && !s.shuffle ? ' is-next' : '');
    const number = document.createElement('span'), title = document.createElement('div'), subtitle = document.createElement('div');
    number.className = 'queue-number';
    number.textContent = (index + 1).toLocaleString('fa-IR', {minimumIntegerDigits:2});
    info.className = 'queue-info';
    title.className = 'queue-title';
    title.textContent = track.title;
    title.title = track.title;
    subtitle.className = 'queue-subtitle';
    subtitle.textContent = track.uploader + ' · ' + fmt(track.duration);
    info.append(title, subtitle);
    row.append(number, createArtwork(track), info);
    if (adminToken) {
      const actions = document.createElement('div');
      actions.className = 'track-actions';
      for (const [direction, label, atEdge] of [['up', '↑', index === 0], ['down', '↓', index === s.queue.length - 1]]) {
        const move = document.createElement('button');
        move.className = 'secondary';
        move.textContent = label;
        move.setAttribute('aria-label', track.title + '؛ جابه‌جایی به ' + (direction === 'up' ? 'بالا' : 'پایین'));
        move.disabled = queueMoving || atEdge;
        move.onclick = async () => {
          if (queueMoving) return;
          queueMoving = true;
          renderQueue(state);
          try {
            await control('move', {track_id: track.id, direction});
            const response = await fetch('/api/state');
            if (response.ok) render(await response.json());
          } catch (error) {
            $('admin-status').textContent = 'دریافت وضعیت صف انجام نشد.';
          } finally {
            queueMoving = false;
            renderQueue(state);
          }
        };
        actions.append(move);
      }
      const remove = document.createElement('button');
      remove.className = 'danger';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'حذف ' + track.title + ' از صف');
      remove.title = 'حذف از صف';
      remove.onclick = () => control('remove', {track_id: track.id});
      actions.append(remove);
      row.append(actions);
    }
    queue.append(row);
  });
}
function render(s){state=s;updatePlayerVisuals(s);$('shuffle').textContent=s.shuffle?'🔀 شافل: روشن':'🔀 شافل: خاموش';$('shuffle').setAttribute('aria-pressed',String(!!s.shuffle));$('shuffle').className=s.shuffle?'':'secondary';$('queue-mode').textContent=s.shuffle?'شافل روشن است؛ جابه‌جایی دستی صف، شافل را خاموش می‌کند.':'پخش به ترتیب صف';clockOffset=s.server_time-Date.now()/1000;$('listeners').textContent=s.listeners.toLocaleString('fa-IR')+' نفر در اتاق';$('song').textContent=s.current?.title||'هنوز آهنگی نیست';$('uploader').textContent=s.current?'آپلود توسط '+s.current.uploader:'یک MP3 آپلود کنید';$('duration').textContent=fmt(s.current?.duration);$('count').textContent=s.queue.length.toLocaleString('fa-IR');renderQueue(s);syncAudio();if(typeof refreshCollections==='function')refreshCollections(s);if(typeof renderReactions==='function')renderReactions(s);tick()}
function tick(){if(!state)return;let p=currentPos(),dur=state.current?.duration||0;$('elapsed').textContent=fmt(Math.min(p,dur));$('progress').style.width=(dur?Math.min(100,p/dur*100):0)+'%';if(!userSeeking)$('seek').value=dur?Math.min(100,p/dur*100):0;if(enabled&&state.current&&state.playing&&audio.readyState>=1){if(Math.abs(audio.currentTime-p)>1.3)audio.currentTime=Math.min(p,Math.max(0,dur-.03))}}setInterval(tick,300);
$('listen').onclick=async()=>{enabled=true;audio.muted=false;$('listen').disabled=true;$('mute').disabled=false;await syncAudio()};$('mute').onclick=()=>{enabled=false;audio.pause();$('listen').disabled=false;$('mute').disabled=true;$('status').textContent='صدا قطع است.'};$('volume').oninput=e=>audio.volume=Number(e.target.value);
$('login').onclick=async()=>{try{let r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('password').value})});if(!r.ok)throw Error('رمز اشتباه است');adminToken=(await r.json()).token;$('password').value='';$('admin-login').style.display='none';$('admin-panel').style.display='block';$('admin-status').textContent='ورود موفق';loadOnlineUsers();if(state)render(state)}catch(e){$('admin-status').textContent=e.message}};
$('logout').onclick=()=>{adminToken='';$('admin-online-users').replaceChildren();$('admin-online-status').textContent='';$('admin-chat-messages').replaceChildren();$('clear-admin-chat').disabled=true;$('admin-users').replaceChildren();$('admin-reactions').replaceChildren();$('new-password').value='';$('admin-login').style.display='block';$('admin-panel').style.display='none';if(state)render(state)};
async function control(action,extra={}){try{let r=await fetch('/api/admin/control',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Token':adminToken},body:JSON.stringify({action,...extra})});if(!r.ok){let data=await r.json();throw Error(typeof data.detail==='string'?data.detail:'کنترل انجام نشد')}$('admin-status').textContent=''}catch(e){$('admin-status').textContent=e.message}}$('play').onclick=()=>control('play');$('pause').onclick=()=>control('pause');$('next').onclick=()=>control('next');$('shuffle').onclick=async()=>{if(!state)return;$('shuffle').disabled=true;try{await control('shuffle',{enabled:!state.shuffle})}finally{$('shuffle').disabled=false}};$('seek').onpointerdown=()=>userSeeking=true;$('seek').onchange=e=>{userSeeking=false;if(state?.current)control('seek',{position:state.current.duration*Number(e.target.value)/100})};
let ws;function connect(){ws=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/ws');ws.onmessage=e=>{let s=JSON.parse(e.data);if(s.type==='state')render(s);else chatUI.receive(s)};ws.onopen=()=>{chatUI.connection(true);$('connection-status').textContent='متصل به اتاق';$('connection-status').parentElement.classList.remove('offline')};ws.onclose=async e=>{chatUI.connection(false);if(e.code===4401){location.replace('/login');return}try{const check=await fetch('/api/auth/me',{cache:'no-store'});if(check.status===401){location.replace('/login');return}}catch(_){};$('connection-status').textContent='در حال اتصال مجدد…';$('connection-status').parentElement.classList.add('offline');setTimeout(connect,2000)}}listenerReady.then(ready=>{if(ready){connect();fetch('/api/state').then(r=>r.ok?r.json():null).then(s=>{if(s)render(s)}).catch(()=>{})}});
