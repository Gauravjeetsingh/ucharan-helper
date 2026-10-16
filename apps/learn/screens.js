// Learn practice screens: listen, repeat, and each word is judged only against that screen's ustaad clip.
const $ = id => document.getElementById(id);
const LESSONS = [['japji-short-phrases', 'Japji Sahib · short phrases'], ['mool-mantar', 'Mool Mantar']];
let lesson, index = 0, ctx, playing, recorder, stream, timer, student, studentWav, result, selected = null, generation = 0;
const clips = new Map();

const screen = () => lesson.screens[index];
const say = text => { $('lp-message').textContent = text; };

async function audioContext() { ctx ||= new AudioContext(); await ctx.resume(); return ctx; }
function stop() { if (playing) { try { playing.stop(); } catch {} playing = null; } }
async function play(buffer, start, end) {
  stop(); await audioContext();
  start = Math.max(0, start); end = Math.min(buffer.duration, end);
  if (end <= start) return;
  playing = ctx.createBufferSource(); playing.buffer = buffer; playing.connect(ctx.destination); playing.start(0, start, end - start);
}
async function clip(url) {
  await audioContext();
  if (!clips.has(url)) clips.set(url, ctx.decodeAudioData(await (await fetch(url)).arrayBuffer()));
  return clips.get(url);
}
async function playUstaad(start, end) { if (recorder) return; await play(await clip(screen().audio), start, end); }

function renderWords() {
  const box = $('lp-words'); box.replaceChildren();
  screen().words.forEach((word, i) => {
    const chip = document.createElement('button');
    // 'word': the shared route smoke test looks for it on /learn.
    chip.className = 'word-chip word'; chip.textContent = word.text; chip.dataset.wordId = word.id;
    const state = result?.words[i]?.state;
    if (state) chip.classList.add(state);
    if (selected === i) chip.classList.add('selected');
    chip.setAttribute('aria-label', `${word.text}${state ? ', ' + {correct: 'matched', wrong: 'differed', unclear: 'unclear'}[state] : ''}. Play ustaad.`);
    chip.onclick = () => { selected = i; renderWords(); renderDetail(); playUstaad(word.start - .08, word.end + .08).catch(e => say(e.message)); };
    box.append(chip);
  });
}

function renderDetail() {
  const box = $('lp-detail'), w = result?.words[selected];
  box.hidden = !w || result.status !== 'judged'; box.replaceChildren();
  if (box.hidden) return;
  const line = (label, value) => { const p = document.createElement('p'); const b = document.createElement('span'); b.className = 'heard-label'; b.textContent = label; const g = document.createElement('span'); g.className = 'gurmukhi'; g.textContent = value || '(nothing)'; p.append(b, g); return p; };
  box.append(line('Ustaad sounded like ', w.ustaad_heard), line('You sounded like ', w.student_heard));
  const reason = document.createElement('p'); reason.className = 'reason';
  reason.textContent = w.state === 'correct' ? 'This word matched the ustaad.' : (w.reason || 'This word sounded different. Listen again.');
  box.append(reason);
  if (w.student_start !== null && w.student_start !== undefined && student) {
    const mine = document.createElement('button'); mine.textContent = '▶ Hear yours';
    mine.onclick = () => play(student, w.student_start - .1, w.student_end + .15).catch(e => say(e.message));
    const ustaad = document.createElement('button'); ustaad.textContent = '▶ Hear ustaad';
    const word = screen().words[selected];
    ustaad.onclick = () => playUstaad(word.start - .08, word.end + .08).catch(e => say(e.message));
    const row = document.createElement('div'); row.className = 'actions center'; row.append(ustaad, mine); box.append(row);
  }
}

function renderScreen() {
  generation++; stop(); result = null; selected = null; student = null; studentWav = null;
  $('lp-lesson').value = lesson.id;
  $('lp-ustaad').textContent = screen().ustaad;
  $('lp-progress').textContent = `Screen ${index + 1} of ${lesson.screens.length}`;
  $('lp-bar-fill').style.width = `${100 * index / lesson.screens.length}%`;
  renderWords(); renderDetail(); say('');
  controls();
}

function controls() {
  const recording = !!recorder;
  $('lp-record').textContent = recording ? '■ Stop' : (result ? '● Try again' : '● Record');
  $('lp-record').classList.toggle('recording', recording);
  $('lp-listen').disabled = recording;
  $('lp-back').disabled = recording || index === 0;
  $('lp-next').disabled = recording || index === lesson.screens.length - 1;
  $('lp-shuffle').disabled = $('lp-lesson').disabled = recording;
  $('lp-save').hidden = !studentWav || recording;
}

function encodeWav(samples) {
  const out = new ArrayBuffer(44 + samples.length * 2), v = new DataView(out);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * (s < 0 ? 32768 : 32767)), true));
  return out;
}

async function check(blob, token) {
  await audioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  if (decoded.duration < .3) throw Error('Recording was too short.');
  const offline = new OfflineAudioContext(1, Math.round(Math.min(decoded.duration, 15) * 16000), 16000);
  const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
  const converted = await offline.startRendering();
  const wav = new Uint8Array(encodeWav(converted.getChannelData(0)));
  let binary = ''; for (let i = 0; i < wav.length; i += 8192) binary += String.fromCharCode(...wav.subarray(i, i + 8192));
  say('Checking… (the first check loads the model and can take a minute)');
  const response = await fetch('/api/learn/screens/compare', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({lesson_id: lesson.id, screen_id: screen().id, audio_base64: btoa(binary)})});
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(value.error || 'The local server could not check this recording.');
  if (token !== generation) return;
  student = converted; studentWav = wav; result = value;
  const firstWrong = result.words.findIndex(w => w.state === 'wrong');
  selected = firstWrong >= 0 ? firstWrong : null;
  renderWords(); renderDetail();
  say(result.status === 'judged' && result.words.every(w => w.state === 'correct') ? `${result.message} Well done!` : result.message);
}

async function toggleRecord() {
  if (recorder) { recorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { say('This browser cannot record here. Open the app on http://127.0.0.1.'); return; }
  stop(); const token = ++generation; result = null; studentWav = null; selected = null; renderWords(); renderDetail();
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false}});
  } catch (e) { say(`Microphone unavailable: ${e.message}`); return; }
  const chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    clearTimeout(timer); stream.getTracks().forEach(t => t.stop()); stream = null; recorder = null; controls();
    $('lp-record').disabled = true;
    try { await check(new Blob(chunks, {type: chunks[0]?.type || 'audio/webm'}), token); }
    catch (e) { if (token === generation) say(e.message); }
    finally { $('lp-record').disabled = false; controls(); }
  };
  recorder.start(); controls();
  timer = setTimeout(() => recorder?.state === 'recording' && recorder.stop(), 14500);
  say('Recording… say the words, then press Stop.');
}

function saveAttempt() {
  // Downloads to this computer only; nothing is kept on the server.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const verdict = result.words.map(w => ({correct: 'G', wrong: 'R', unclear: 'X'})[w.state]).join('');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([studentWav], {type: 'audio/wav'}));
  a.download = `attempt-${lesson.id}-${screen().id}-${verdict}-${stamp}.wav`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  say(`Saved ${a.download} to your Downloads folder.`);
}

function shuffle() {
  const screens = lesson.screens;
  for (let i = screens.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [screens[i], screens[j]] = [screens[j], screens[i]]; }
  index = 0; renderScreen();
}

async function loadLesson(id) {
  if (recorder) return;
  const response = await fetch(`/data/lessons/${id}.json`);
  if (!response.ok) throw Error('Lesson file not found.');
  lesson = await response.json(); index = 0;
  if (lesson.shuffle) shuffle(); else renderScreen();
}

async function init() {
  for (const [id, title] of LESSONS) { const o = document.createElement('option'); o.value = id; o.textContent = title; $('lp-lesson').append(o); }
  $('lp-lesson').onchange = () => loadLesson($('lp-lesson').value).catch(e => say(e.message));
  $('lp-shuffle').onclick = () => { if (!recorder) shuffle(); };
  $('lp-listen').onclick = () => playUstaad(screen().start, screen().end).catch(e => say(e.message));
  $('lp-record').onclick = toggleRecord;
  $('lp-save').onclick = saveAttempt;
  $('lp-back').onclick = () => { index--; renderScreen(); };
  $('lp-next').onclick = () => { index++; renderScreen(); };
  window.addEventListener('pagehide', () => { stream?.getTracks().forEach(t => t.stop()); });
  await loadLesson(LESSONS[0][0]);
}
init().catch(e => say(`Could not start: ${e.message}`));
