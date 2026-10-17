const $ = id => document.getElementById(id);
let audioBytes, audioName, sampleSelected = false, result, audioUrl, busy = false, selection = 0;
let playbackWords = [];
let selectedWord = null, waveformBuffer = null, waveformToken = 0, currentAudioKey = null;
const originalStarts = new Map(); // word -> originally detected start (seconds), so "Reset" can undo an adjustment
const originalEnds = new Map(); // word -> originally detected end (seconds), so "Reset" can undo an adjustment
const MIN_GAP = 0.02; // minimum seconds kept between a word's start and end
const NUDGE_RANGE = 1; // seconds of travel across each whole fine-adjust slider, centered on that boundary's original value
const WAVEFORM_PAD = 0.3; // extra seconds of context shown beyond whichever of original/adjusted boundary is furthest out
const WAVEFORM_HEIGHT = 90; // fixed logical (CSS pixel) canvas height, independent of devicePixelRatio
const LEGACY_BROWSER_KEY = 'uchaaran-timestamps-boundary-overrides-v1'; // earlier browser-only saves, migrated to disk once
function audioKeyFor(value) {
  // Keyed by this recording's decoded-audio checksum, so a saved correction only ever reapplies to the same audio.
  return value?.audio?.pcm_sha256 || value?.audio?.sha256 || null;
}
async function postCorrection(action, body) {
  // The local server writes data/corrections/<audio checksum>.json; reference JSON and audio stay unchanged.
  const response = await fetch(`/api/corrections/${action}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(value.error || 'The local server could not save the correction.');
  return value.words;
}
async function loadDiskCorrections(audioKey) {
  try {
    const response = await fetch(`/api/corrections/${audioKey}`);
    return response.ok ? (await response.json()).words || {} : {};
  } catch { return {}; }
}
async function migrateBrowserCorrections(audioKey, saved) {
  let store;
  try { store = JSON.parse(localStorage.getItem(LEGACY_BROWSER_KEY)) || {}; } catch { return saved; }
  const pending = store[audioKey]; if (!pending) return saved;
  for (const [wordId, entry] of Object.entries(pending)) {
    if (saved[wordId] || !(entry?.start < entry?.end)) continue; // a correction already on disk wins
    try { saved = await postCorrection('save', {audio_key: audioKey, word_id: wordId, start: entry.start, end: entry.end}); } catch { return saved; }
  }
  delete store[audioKey];
  try { Object.keys(store).length ? localStorage.setItem(LEGACY_BROWSER_KEY, JSON.stringify(store)) : localStorage.removeItem(LEGACY_BROWSER_KEY); } catch {}
  return saved;
}
async function applySavedCorrections(value, words) {
  const audioKey = audioKeyFor(value); currentAudioKey = audioKey;
  if (!audioKey) return 0;
  const saved = await migrateBrowserCorrections(audioKey, await loadDiskCorrections(audioKey));
  if (result !== value) return 0; // a different result loaded while we were waiting
  let applied = 0;
  for (const word of words) {
    const entry = word.id == null ? undefined : saved[word.id];
    if (!entry || !(entry.start < entry.end)) continue;
    originalStarts.set(word, word.start); originalEnds.set(word, word.end); // remember model-detected values so "Reset" can undo this restored correction
    word.start = entry.start; word.end = entry.end; applied++;
  }
  return applied;
}
function status(message) { $('status').textContent = message; }
function invalidate() {
  result = null; $('download').disabled = $('copy').disabled = true;
  $('output').textContent = 'Your word timestamps will appear here.'; $('result-summary').textContent = '';
  playbackWords = []; $('word-playback').replaceChildren();
  $('word-playback').append(Object.assign(document.createElement('span'), {className: 'placeholder', textContent: 'Generate or load timestamps to see word-by-word highlighting here.'}));
  selectedWord = null; $('word-detail').hidden = true;
  originalStarts.clear(); originalEnds.clear(); waveformBuffer = null; currentAudioKey = null;
}
function originalStart(word) { return originalStarts.has(word) ? originalStarts.get(word) : word.start; }
function originalEnd(word) { return originalEnds.has(word) ? originalEnds.get(word) : word.end; }
let segmentToken = 0;
function playSegment(start, end) {
  const player = $('player'); if (!player.src) return;
  const token = ++segmentToken;
  player.pause();
  try { player.currentTime = Math.max(0, start); } catch {}
  const duration = Math.max(0, end - start);
  player.play().then(() => {
    setTimeout(() => { if (token === segmentToken) player.pause(); }, duration * 1000);
  }).catch(() => {});
}
function sliderToTime(value, origin) {
  // Large slider travel maps to a small time window for very fine adjustment, centered on that boundary's original value.
  return origin + (Number(value) / 1000 - .5) * NUDGE_RANGE;
}
function timeToSlider(time, origin) {
  return Math.min(1000, Math.max(0, Math.round(((time - origin) / NUDGE_RANGE + .5) * 1000)));
}
function refreshDetailText() {
  $('word-detail-time').textContent = `${selectedWord.start.toFixed(3)}–${selectedWord.end.toFixed(3)} s · duration ${(selectedWord.end - selectedWord.start).toFixed(3)} s`;
  const entry = playbackWords.find(w => w.word === selectedWord);
  if (entry) entry.element.title = `${selectedWord.start.toFixed(2)}–${selectedWord.end.toFixed(2)} s`;
  $('word-start-input').value = selectedWord.start.toFixed(3);
  $('word-end-input').value = selectedWord.end.toFixed(3);
  $('word-save-status').textContent = ''; $('word-save-status').classList.remove('saved');
}
function refreshResultJson() {
  // Keep the downloadable/copyable JSON in sync with any boundary adjustment made here.
  if (result) $('output').textContent = JSON.stringify(result, null, 2);
}
function setAdjustedStart(time, play = true) {
  if (!originalStarts.has(selectedWord)) originalStarts.set(selectedWord, selectedWord.start);
  const clamped = Math.min(selectedWord.end - MIN_GAP, Math.max(0, time));
  selectedWord.start = clamped; // mutates the shared word object, so highlighting + JSON export stay in sync
  $('word-start-nudge').value = timeToSlider(clamped, originalStart(selectedWord));
  refreshDetailText(); drawWordWaveform(); refreshResultJson();
  if (play) playSegment(clamped, selectedWord.end);
}
function setAdjustedEnd(time, play = true) {
  if (!originalEnds.has(selectedWord)) originalEnds.set(selectedWord, selectedWord.end);
  const duration = $('player').duration || Infinity;
  const clamped = Math.max(selectedWord.start + MIN_GAP, Math.min(duration, time));
  selectedWord.end = clamped;
  $('word-end-nudge').value = timeToSlider(clamped, originalEnd(selectedWord));
  refreshDetailText(); drawWordWaveform(); refreshResultJson();
  if (play) playSegment(Math.max(selectedWord.start, clamped - .6), clamped); // preview the tail, so you can hear exactly where it now cuts off
}
function selectWord(word, button) {
  for (const w of playbackWords) w.element.classList.toggle('selected', w.element === button);
  selectedWord = word;
  $('word-detail').hidden = false;
  $('word-detail-text').textContent = word.text;
  $('word-start-nudge').value = timeToSlider(word.start, originalStart(word));
  $('word-end-nudge').value = timeToSlider(word.end, originalEnd(word));
  $('word-save').disabled = word.id == null || !currentAudioKey;
  refreshDetailText(); drawWordWaveform();
  playSegment(word.start, word.end);
}
$('word-start-nudge').oninput = () => { if (selectedWord) setAdjustedStart(sliderToTime($('word-start-nudge').value, originalStart(selectedWord))); };
$('word-end-nudge').oninput = () => { if (selectedWord) setAdjustedEnd(sliderToTime($('word-end-nudge').value, originalEnd(selectedWord))); };
$('word-start-input').onchange = () => {
  if (!selectedWord) return;
  const value = Number($('word-start-input').value);
  if (Number.isFinite(value)) setAdjustedStart(value); else $('word-start-input').value = selectedWord.start.toFixed(3);
};
$('word-end-input').onchange = () => {
  if (!selectedWord) return;
  const value = Number($('word-end-input').value);
  if (Number.isFinite(value)) setAdjustedEnd(value); else $('word-end-input').value = selectedWord.end.toFixed(3);
};
$('word-reset').onclick = async () => {
  if (!selectedWord) return;
  const word = selectedWord;
  if (originalStarts.has(word)) { word.start = originalStarts.get(word); originalStarts.delete(word); }
  if (originalEnds.has(word)) { word.end = originalEnds.get(word); originalEnds.delete(word); }
  $('word-start-nudge').value = 500; $('word-end-nudge').value = 500;
  refreshDetailText(); drawWordWaveform(); refreshResultJson();
  playSegment(word.start, word.end);
  if (!currentAudioKey || word.id == null) return;
  try {
    await postCorrection('delete', {audio_key: currentAudioKey, word_id: word.id});
    if (selectedWord === word) $('word-save-status').textContent = 'Restored the detected boundaries and removed any saved correction from disk.';
  } catch (error) {
    if (selectedWord === word) $('word-save-status').textContent = `Restored here, but the saved file was not updated: ${error.message}`;
  }
};
$('word-save').onclick = async () => {
  if (!selectedWord) return;
  if (!currentAudioKey) { $('word-save-status').textContent = 'This result has no audio checksum to save against.'; return; }
  if (selectedWord.id == null) { $('word-save-status').textContent = 'This word has no stable occurrence ID to save against.'; return; }
  const word = selectedWord, start = word.start, end = word.end;
  $('word-save').disabled = true; $('word-save-status').classList.remove('saved');
  $('word-save-status').textContent = 'Saving…';
  try {
    await postCorrection('save', {audio_key: currentAudioKey, word_id: word.id, start, end});
    if (selectedWord !== word) return;
    $('word-save-status').textContent = `Saved to data/corrections/${currentAudioKey.slice(0, 12)}….json: "${word.text}" now plays ${start.toFixed(3)}–${end.toFixed(3)} s whenever this recording loads.`;
    $('word-save-status').classList.add('saved');
  } catch (error) {
    if (selectedWord === word) $('word-save-status').textContent = `Not saved: ${error.message}`;
  } finally {
    $('word-save').disabled = false;
  }
};
function appendWordSpan(container, word) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'word'; button.textContent = word.text;
  const hasTiming = Number.isFinite(word.start) && Number.isFinite(word.end);
  if (hasTiming) {
    button.title = `${word.start.toFixed(2)}–${word.end.toFixed(2)} s`;
    button.onclick = () => selectWord(word, button);
    // Keep a direct reference to the word object (not a copy) so edits to word.start stay in sync everywhere.
    playbackWords.push({element: button, word, get start() { return word.start; }, get end() { return word.end; }});
  } else {
    button.disabled = true; button.title = word.status || 'No timing assigned for this word.';
  }
  container.append(button);
}
function appendTextSegment(container, text) {
  // Preserve exact source whitespace, including line breaks between pasted verses.
  text.split('\n').forEach((part, i) => { if (i) container.append(document.createElement('br')); if (part) container.append(document.createTextNode(part)); });
}
async function ensureWaveformBuffer() {
  if (waveformBuffer || !audioBytes) return waveformBuffer;
  const token = ++waveformToken;
  try {
    $('word-waveform-status').textContent = 'Decoding waveform…';
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(audioBytes.slice(0));
    await context.close();
    if (token !== waveformToken) return waveformBuffer;
    waveformBuffer = decoded; $('word-waveform-status').textContent = '';
  } catch (error) {
    $('word-waveform-status').textContent = `Waveform unavailable: ${error.message}. Use the slider to adjust instead.`;
  }
  return waveformBuffer;
}
function drawWaveformFrame() {
  const canvas = $('word-waveform'), word = selectedWord; if (!word) return;
  const height = WAVEFORM_HEIGHT, width = canvas.clientWidth || 600, ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const c = canvas.getContext('2d'); c.setTransform(ratio, 0, 0, ratio, 0, 0); c.clearRect(0, 0, width, height);
  // Anchor the view on the original detected boundaries so the waveform stays put while either slider/box moves within it.
  const origin = originalStart(word), originEnd = originalEnd(word);
  const windowStart = Math.max(0, Math.min(origin, word.start) - WAVEFORM_PAD);
  const windowEnd = Math.max(originEnd, word.end) + WAVEFORM_PAD;
  const span = windowEnd - windowStart;
  const toX = t => (t - windowStart) / span * width;
  c.fillStyle = '#e8d6b1'; c.fillRect(toX(origin), 0, toX(originEnd) - toX(origin), height);
  if (waveformBuffer) {
    const samples = waveformBuffer.getChannelData(0), rate = waveformBuffer.sampleRate;
    const first = Math.max(0, Math.floor(windowStart * rate)), last = Math.min(samples.length, Math.ceil(windowEnd * rate));
    const bins = Math.max(1, Math.floor(width)), size = Math.max(1, Math.ceil((last - first) / bins));
    c.strokeStyle = '#4f6a62'; c.beginPath();
    for (let i = 0; i < bins; i++) {
      let peak = 0; const s = first + i * size, e = Math.min(last, s + size);
      for (let j = s; j < e; j++) peak = Math.max(peak, Math.abs(samples[j] || 0));
      const x = i / bins * width; c.moveTo(x, height / 2 - peak * (height / 2 - 4)); c.lineTo(x, height / 2 + peak * (height / 2 - 4));
    }
    c.stroke();
  } else {
    c.fillStyle = '#9aa69e'; c.font = '12px -apple-system,sans-serif'; c.fillText('Waveform loads after choosing audio.', 8, height / 2 + 4);
  }
  // Thin lines mark the original detected boundaries; thick colored lines mark the current (possibly adjusted) start/end.
  c.strokeStyle = '#8a7a5a'; c.lineWidth = 1;
  for (const t of [origin, originEnd]) { c.beginPath(); c.moveTo(toX(t), 0); c.lineTo(toX(t), height); c.stroke(); }
  c.strokeStyle = '#a45b24'; c.lineWidth = 3;
  const startX = toX(word.start); c.beginPath(); c.moveTo(startX, 0); c.lineTo(startX, height); c.stroke();
  c.strokeStyle = '#4f6a62'; c.lineWidth = 3;
  const endX = toX(word.end); c.beginPath(); c.moveTo(endX, 0); c.lineTo(endX, height); c.stroke();
  const player = $('player');
  if (!player.paused && player.currentTime >= windowStart && player.currentTime <= windowEnd) {
    c.strokeStyle = '#203f3b'; c.lineWidth = 1.5; const x = toX(player.currentTime);
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, height); c.stroke();
  }
}
async function drawWordWaveform() { await ensureWaveformBuffer(); drawWaveformFrame(); }
$('word-waveform').onclick = (event) => {
  if (!selectedWord) return;
  const rect = $('word-waveform').getBoundingClientRect();
  const origin = originalStart(selectedWord), originEnd = originalEnd(selectedWord);
  const windowStart = Math.max(0, Math.min(origin, selectedWord.start) - WAVEFORM_PAD);
  const windowEnd = Math.max(originEnd, selectedWord.end) + WAVEFORM_PAD;
  const time = windowStart + (event.clientX - rect.left) / rect.width * (windowEnd - windowStart);
  // Move whichever boundary the click is nearer to, so one waveform works for adjusting either edge.
  if (Math.abs(time - selectedWord.start) <= Math.abs(time - selectedWord.end)) setAdjustedStart(time);
  else setAdjustedEnd(time);
};
$('player').addEventListener('timeupdate', () => { if (selectedWord) drawWaveformFrame(); });
window.addEventListener('resize', () => { if (selectedWord) drawWaveformFrame(); });
function renderWordPlayback(value) {
  const container = $('word-playback');
  container.replaceChildren(); playbackWords = [];
  selectedWord = null; $('word-detail').hidden = true;
  if (Array.isArray(value.verses)) {
    value.verses.forEach((verse, vi) => {
      if (vi) container.append(document.createElement('br'));
      const chars = [...verse.text]; let cursor = 0;
      for (const word of verse.words) { appendTextSegment(container, chars.slice(cursor, word.source_start).join('')); appendWordSpan(container, word); cursor = word.source_end; }
      appendTextSegment(container, chars.slice(cursor).join(''));
    });
  } else {
    const chars = [...(value.source?.text || '')]; let cursor = 0;
    for (const word of value.words || []) { appendTextSegment(container, chars.slice(cursor, word.source_start).join('')); appendWordSpan(container, word); cursor = word.source_end; }
    appendTextSegment(container, chars.slice(cursor).join(''));
  }
  if (!playbackWords.length) container.append(Object.assign(document.createElement('span'), {className: 'placeholder', textContent: 'No word has both a start and end time to highlight yet.'}));
  highlightAt($('player').currentTime || 0);
  refreshResultJson();
}
function highlightAt(time) {
  for (const word of playbackWords) {
    const active = time >= word.start && time < word.end;
    word.element.classList.toggle('spoken', active);
    word.element.classList.toggle('played', !active && time >= word.end);
  }
}
$('player').addEventListener('timeupdate', () => highlightAt($('player').currentTime));
$('player').addEventListener('seeked', () => highlightAt($('player').currentTime));
function controls() {
  $('generate').disabled = busy || !audioBytes || !$('transcript').value.trim();
  $('existing').disabled = busy || !sampleSelected;
  $('sample').disabled = $('upload').disabled = $('text-upload').disabled = $('transcript').disabled = $('expansion').disabled = busy;
}
function chooseAudio(bytes, name, mime = 'audio/wav') {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioBytes = bytes; audioName = name;
  audioUrl = URL.createObjectURL(new Blob([bytes], {type: mime}));
  $('player').src = audioUrl; $('player').hidden = false; $('audio-name').textContent = name;
  invalidate(); controls(); status('Recording ready. Check the text, then generate timestamps.');
}
async function show(value, message) {
  result = value; $('output').textContent = JSON.stringify(value, null, 2);
  const words = value.words || value.verses?.flatMap(v => v.words) || [];
  $('result-summary').textContent = `${words.length} word occurrences · ${value.audio.duration_seconds.toFixed(2)} seconds · unreviewed`;
  $('download').disabled = $('copy').disabled = false; status(message);
  // Apply corrections saved on disk for this exact recording before drawing the words.
  const applied = await applySavedCorrections(value, words);
  if (result !== value) return;
  renderWordPlayback(value);
  if (applied) status(`${message} Applied ${applied} saved correction${applied === 1 ? '' : 's'} from data/corrections/.`);
}
async function pcmWav(bytes) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes.slice(0));
    if (decoded.duration > 1800 || decoded.duration < .25) throw Error("Choose between 0.25 seconds and 30 minutes of audio.");
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const samples = (await offline.startRendering()).getChannelData(0);
    const output = new ArrayBuffer(44 + samples.length * 2), view = new DataView(output);
    const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset+i, c.charCodeAt(0)));
    text(0,'RIFF'); view.setUint32(4,36+samples.length*2,true); text(8,'WAVE'); text(12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,16000,true);
    view.setUint32(28,32000,true); view.setUint16(32,2,true); view.setUint16(34,16,true); text(36,'data'); view.setUint32(40,samples.length*2,true);
    samples.forEach((sample,i) => view.setInt16(44+i*2, Math.round(Math.max(-1,Math.min(1,sample))*(sample<0?32768:32767)), true));
    let binary = ''; const array = new Uint8Array(output);
    for (let i=0; i<array.length; i+=8192) binary += String.fromCharCode(...array.subarray(i,i+8192));
    return btoa(binary);
  } finally { await context.close(); }
}
$('sample').onclick = async () => {
  const token = ++selection;
  try {
    const [audio, timing] = await Promise.all([fetch('/data/reference/recording.wav').then(r=>r.arrayBuffer()), fetch('/data/reference/word-timings.json').then(r=>r.json())]);
    if (selection !== token) return;
    sampleSelected = true; $('transcript').value = timing.verses.map(v=>v.text).join('\n');
    chooseAudio(audio, 'Japji Sahib · supplied snippet.mov');
  } catch (error) { status(`Could not load sample: ${error.message}`); }
};
$('upload').onchange = async () => {
  const token = ++selection, file = $('upload').files[0]; if (!file) return;
  if (file.size > 300*1024*1024) { status("Choose an audio file under 300 MB."); return; }
  const bytes = await file.arrayBuffer(); if (selection !== token) return;
  sampleSelected = false; chooseAudio(bytes, file.name, file.type);
};
for (const id of ['transcript','expansion']) $(id).oninput = () => { invalidate(); controls(); };
$('text-upload').onchange = async () => {
  const file = $('text-upload').files[0]; if (!file) return;
  if (file.size > 64*1024) { status('Choose a text file under 64 KB.'); return; }
  // Only whitespace is tidied: blank lines, repeated spaces and line-edge spaces. Gurmukhi characters are kept exactly.
  const text = (await file.text()).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    .split('\n').map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim()).filter(Boolean).join('\n');
  $('transcript').value = text; $('text-upload').value = ''; $('transcript').dispatchEvent(new Event('input'));
  invalidate(); controls(); status(`Loaded ${file.name}. Check the text, then generate timestamps.`);
};
$('existing').onclick = async () => {
  try { show(await (await fetch('/data/reference/word-timings.json')).json(), 'Loaded the existing sample artifact. These timings were not regenerated.'); }
  catch (error) { status(error.message); }
};
function showLoader(message) {
  const loader = document.createElement('div'); loader.className = 'loader'; loader.setAttribute('role', 'status');
  loader.append(Object.assign(document.createElement('span'), {className: 'spinner'}), Object.assign(document.createElement('span'), {textContent: message}));
  $('word-playback').replaceChildren(loader);
}
$('generate').onclick = async () => {
  busy = true; invalidate(); controls(); status('Generating locally… First model loading can take a moment.');
  showLoader('Generating word timestamps… long recordings can take a few minutes.');
  try {
    const response = await fetch('/api/timestamps/generate', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      audio_base64: await pcmWav(audioBytes), filename: audioName, text: $('transcript').value,
      expansions: {'ੴ': $('expansion').value}
    })});
    const value = await response.json(); if (!response.ok) throw Error(value.error || 'Generation failed.');
    show(value, 'Timestamps generated. Download the JSON to keep or share the result.');
  } catch (error) {
    status(error.message);
    $('word-playback').replaceChildren(Object.assign(document.createElement('span'), {className: 'placeholder', textContent: `Could not generate: ${error.message}`}));
  }
  finally { busy = false; controls(); }
};
$('download').onclick = () => {
  if (!result) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(result,null,2)+'\n'],{type:'application/json'}));
  const link = document.createElement('a'); link.href=url; link.download='word-timings.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(result,null,2)); status('Timing JSON copied.'); }
  catch { status('Clipboard unavailable. Use Download JSON.'); }
};
fetch('/api/status').then(r=>r.json()).then(value => {
  $('model-status').textContent = value.timestamp_model_present ? 'Local timestamp model available.' : 'To enable generation: install requirements-timestamps.txt, then run python -m scripts.download_timestamp_model. Existing sample timings work immediately.';
}).catch(()=> { $('model-status').textContent = 'Start the app with python serve.py to enable local generation.'; });
