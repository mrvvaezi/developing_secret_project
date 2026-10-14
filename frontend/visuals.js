function artworkHue(track) {
  let seed = 0;
  for (const char of (track.id || track.title || 'musicroom')) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  return [255, 184, 324, 224, 24, 284, 154][seed % 7];
}
function createArtwork(track) {
  const art = document.createElement('div');
  art.className = 'track-art';
  art.style.setProperty('--hue', artworkHue(track));
  art.setAttribute('aria-hidden', 'true');
  const note = document.createElement('span');
  note.textContent = '♪';
  art.append(note);
  return art;
}
function updatePlayerVisuals(s) {
  document.body.dataset.playing = String(Boolean(s.current && s.playing));
  document.getElementById('playback-label').textContent = s.current ? (s.playing ? 'همین حالا در حال پخش' : 'پخش متوقف شده') : 'آمادهٔ شنیدن';
}
