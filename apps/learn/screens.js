import {LearnStreak, STREAK_LENGTH} from './streak.mjs';
import {celebrateCoin} from './celebration.mjs';
import {RecordingEndpoint, MAX_RECORDING_SECONDS} from './endpoint.mjs';
import {recordingGuideWord} from './guide.mjs';

// Learn UI. Lesson text/timings and comparison remain supplied by existing APIs.
const $ = id => document.getElementById(id);
const LESSON_ID = 'japji-sahib-full';
const SVG_NS = 'http://www.w3.org/2000/svg';
let lesson, index = 0, ctx, playing, analyser, microphone, frame;
let recorder, stream, timer, endpointInterval, student, studentWav, result, selected = null;
let generation = 0, playbackToken = 0, phase = 'loading';
const clips = new Map();
const STREAK_KEY = 'uchaaran-learn-streak';
const COIN_KEY = 'uchaaran-nanak-coins';
function storedNumber(key) {
  try {
    const value = Number(sessionStorage.getItem(key));
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch { return 0; }
}
const streak = new LearnStreak(storedNumber(STREAK_KEY));
let coins = storedNumber(COIN_KEY), displayedCoins = coins;
let rewardPending = false, cancelCelebration;

function stopCelebration() {
  cancelCelebration?.(); cancelCelebration = null;
}

function renderStreak() {
  const segments = $('lp-segments'), count = rewardPending ? STREAK_LENGTH : streak.count;
  if (segments.children.length !== STREAK_LENGTH) {
    segments.replaceChildren(...Array.from({length:STREAK_LENGTH}, () => element('span', undefined, 'lp-segment')));
  }
  [...segments.children].forEach((segment,i) => segment.classList.toggle('is-reached', i < count));
  segments.setAttribute('aria-valuenow', count);
  segments.setAttribute('aria-valuetext', `${count} of ${STREAK_LENGTH} consecutive qualifying turns`);
  $('lp-streak-message').textContent = rewardPending
    ? '+1 Nanak Coin! Five in a row.'
    : `${STREAK_LENGTH - streak.count} more to go for Nanak Coin`;
  $('lp-streak-message').classList.toggle('is-earned', rewardPending);
  $('lp-coins').value = displayedCoins;
}

function recordTurn(value) {
  stopCelebration();
  const earned = streak.record(value, screen().words);
  if (earned) coins = Math.max(coins, storedNumber(COIN_KEY)) + 1;
  try {
    sessionStorage.setItem(STREAK_KEY, String(streak.count));
    if (earned) sessionStorage.setItem(COIN_KEY, String(coins));
  } catch {}
  rewardPending = earned;
  renderStreak();
  if (earned) cancelCelebration = celebrateCoin($('lp-celebration'), document.querySelector('.lp-coins'), () => {
    rewardPending = false; displayedCoins = coins;
    renderStreak();
  });
}
const screen = () => lesson.screens[index];
const busy = () => ['permission', 'recording', 'checking'].includes(phase);
const wordResult = i => result?.words?.find(w => w.id === screen().words[i].id);
const say = text => { $('lp-message').textContent = text; };
const restMessage = () => !result ? 'Tap the microphone to record, or listen to Ustaad ji.'
  : result.status !== 'judged' ? 'Listen again, then give it another try.'
  : index === lesson.screens.length - 1 ? 'You reached the end of Japji Sahib. You can practise again.' : 'Try again, or go to the next pankti.';
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

function speakerIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path'); path.setAttribute('d', 'M4 9v6h4l5 4V5L8 9H4Zm12-2v3a3 3 0 0 1 0 4v3a7 7 0 0 0 0-10Z'); svg.append(path); return svg;
}
function setPhase(value, message) {
  phase = value; $('lp-screen').dataset.phase = value;
  if (message !== undefined) say(message);
  controls();
}
function controls() {
  const recording = phase === 'recording', listening = phase === 'listening' || phase === 'audio-loading';
  $('lp-listen').disabled = busy() || phase === 'loading' || !lesson;
  $('lp-listen').setAttribute('aria-label', listening ? 'Stop ustaad playback' : 'Listen to ustaad');
  $('lp-listen').title = listening ? 'Stop playback' : 'Listen to ustaad';
  $('lp-speaker-icon').toggleAttribute('hidden', listening); $('lp-speaker-stop').toggleAttribute('hidden', !listening);
  $('lp-record').disabled = !lesson || phase === 'loading' || phase === 'permission' || phase === 'checking';
  $('lp-record').classList.toggle('recording', recording);
  $('lp-record').setAttribute('aria-label', recording ? 'Stop recording' : result || student ? 'Try again' : 'Record yourself');
  $('lp-record').title = recording ? 'Stop recording' : 'Record yourself';
  $('lp-mic-icon').toggleAttribute('hidden', recording || phase === 'checking'); $('lp-stop-icon').toggleAttribute('hidden', !recording); $('lp-checking-icon').toggleAttribute('hidden', phase !== 'checking');
  $('lp-next').disabled = !lesson || busy() || phase === 'loading' || !result || result.status !== 'judged' || index === lesson.screens.length - 1;
  $('lp-back').disabled = !lesson || busy() || phase === 'loading' || index === 0;
  $('lp-back').hidden = index === 0;
  $('lp-attempt-actions').hidden = !studentWav || busy();
  $('lp-hear').disabled = !student || busy();
  document.querySelectorAll('.lp-word').forEach(button => { button.disabled = busy() || phase === 'loading'; });
  document.querySelectorAll('.lp-issue-replay,.lp-text-button').forEach(button => { button.disabled = busy() || phase === 'loading'; });
}

async function audioContext() { ctx ||= new AudioContext(); await ctx.resume(); return ctx; }
function stopWave() {
  cancelAnimationFrame(frame); analyser?.disconnect(); analyser = null;
  microphone?.disconnect(); microphone = null; $('lp-wave').hidden = true;
  document.querySelectorAll('.lp-word.is-playing,.lp-word.is-guided').forEach(node => {
    node.classList.remove('is-playing','is-guided'); node.removeAttribute('aria-current');
  });
}
function stopEndpoint() {
  clearInterval(endpointInterval); clearTimeout(timer);
}
function startEndpoint(detector) {
  const input = analyser, samples = new Float32Array(input.fftSize);
  endpointInterval = setInterval(() => {
    if (recorder?.state !== 'recording') return;
    input.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum,value) => sum + value * value, 0) / samples.length);
    if (detector.update(ctx.currentTime,rms)) recorder.stop();
  },50);
  timer = setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); }, MAX_RECORDING_SECONDS * 1000);
}
function stop() {
  stopEndpoint();
  playbackToken++; if (playing) { playing.onended = null; try { playing.stop(); } catch {} playing = null; }
  stopWave();
}
function startWave(input, playback) {
  analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = .65; input.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize), bars = [...$('lp-wave').children]; $('lp-wave').hidden = false;
  const guide = playback ? null : {words:screen().words, started:ctx.currentTime};
  function draw() {
    if (!analyser) return;
    analyser.getByteTimeDomainData(samples);
    bars.forEach((bar, i) => {
      const a = Math.floor(i * samples.length / bars.length), b = Math.floor((i + 1) * samples.length / bars.length);
      let amplitude = 0; for (let j = a; j < b; j++) amplitude = Math.max(amplitude, Math.abs(samples[j] - 128) / 128);
      bar.style.height = `${Math.min(48, 5 + amplitude * 130)}px`;
    });
    // Playback follows the media clock. Recording uses a reference-paced prompt,
    // never a claim about which word the student has actually spoken.
    if (playback) {
      const position = playback.offset + ctx.currentTime - playback.started;
      document.querySelectorAll('.lp-word').forEach((button, i) => {
        const word = screen().words[i]; button.classList.toggle('is-playing', word.start <= position && position < word.end);
      });
    } else if (guide) {
      const id = recordingGuideWord(guide.words, ctx.currentTime - guide.started);
      document.querySelectorAll('.lp-word').forEach(button => {
        const active = button.dataset.wordId === id;
        button.classList.toggle('is-guided', active);
        if (active) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current');
      });
    }
    frame = requestAnimationFrame(draw);
  }
  draw();
}
async function clip(url) {
  if (!clips.has(url)) {
    const response = await fetch(url);
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw Error(error.error || 'The reference recording could not be loaded.'); }
    const offset = Number(response.headers.get('X-Audio-Start'));
    clips.set(url, {buffer:await ctx.decodeAudioData(await response.arrayBuffer()), offset});
    // Keep only recent phrases in memory on phones.
    if (clips.size > 8) clips.delete(clips.keys().next().value);
  }
  return clips.get(url);
}
async function play(buffer, start, end, token, options = {}) {
  if (token !== playbackToken || busy()) return;
  start = Math.max(0, start); end = Math.min(buffer.duration, end);
  if (end <= start) throw Error('This audio segment is unavailable.');
  playing = ctx.createBufferSource(); playing.buffer = buffer; playing.connect(ctx.destination);
  const source = playing;
  source.onended = () => {
    if (token !== playbackToken) return;
    playing = null; stopWave();
    setPhase(result ? 'result' : 'ready', restMessage());
  };
  const started = ctx.currentTime;
  if (options.reference) startWave(source, {offset:start + options.referenceOffset, started});
  source.start(0, start, end - start);
}
async function playUstaad(start, end) {
  if (busy() || !lesson) return;
  stop(); const token = playbackToken, url = `/api/learn/screens/audio?lesson_id=${encodeURIComponent(lesson.id)}&screen_id=${encodeURIComponent(screen().id)}`;
  setPhase('audio-loading', 'Loading Ustaad ji’s recording…');
  try {
    await audioContext(); const reference = await clip(url);
    if (token !== playbackToken || busy()) return;
    setPhase('listening', 'Ustaad ji is reciting…');
    await play(reference.buffer, start - reference.offset, end - reference.offset, token, {reference:true, referenceOffset:reference.offset});
  } catch (error) { if (token === playbackToken) showError(error.message); }
}
async function hearStudent(start = 0, end = student?.duration) {
  if (!student || busy()) return;
  stop(); const token = playbackToken; await audioContext();
  if (token !== playbackToken) return;
  setPhase('student-playback', 'Listen to your attempt.'); await play(student, start, end, token);
}

function renderWords() {
  $('lp-words').replaceChildren();
  screen().words.forEach((word, i) => {
    const button = element('button', word.text, 'lp-word word'); button.dataset.wordId = word.id;
    const verdict = wordResult(i), state = verdict?.state;
    if (state === 'correct' || state === 'wrong') button.classList.add(state);
    if (selected === i) button.classList.add('selected');
    button.setAttribute('aria-label', `${word.text}${state ? ', ' + {correct:'matched', wrong:'possible difference', unclear:'not assessed'}[state] : ''}. Play ustaad.`);
    button.setAttribute('aria-pressed', String(selected === i));
    button.onclick = () => {
      selected = i; renderWords(); renderFeedback(); controls();
      playUstaad(word.start - .08, word.end + .08).catch(error => showError(error.message));
    };
    $('lp-words').append(button);
  });
}
function heardLine(word) {
  const line = element('div', undefined, 'lp-heard');
  for (const [label, heard] of [[word.ustaad_says ? 'Ustaad says: ' : 'Reference: ', word.ustaad_says || word.ustaad_heard], ['You: ', word.student_heard]]) {
    const part = element('span', label); const value = element('b', heard || '(not clear)'); value.lang = 'pa'; part.append(value); line.append(part);
  }
  return line;
}
function replayActions(i, verdict) {
  const row = element('div', undefined, 'lp-issue-actions'), reference = screen().words[i];
  const teacher = element('button', 'Hear ustaad', 'lp-text-button'); teacher.onclick = () => playUstaad(reference.start - .08, reference.end + .08);
  row.append(teacher);
  if (student && Number.isFinite(verdict.student_start) && Number.isFinite(verdict.student_end)) {
    const mine = element('button', 'Hear yours', 'lp-text-button'); mine.onclick = () => hearStudent(verdict.student_start - .1, verdict.student_end + .15).catch(error => showError(error.message)); row.append(mine);
  }
  return row;
}
function renderFeedback() {
  const feedback = $('lp-feedback'); feedback.hidden = !result;
  $('lp-issues').replaceChildren(); $('lp-detail').replaceChildren(); $('lp-detail').hidden = true;
  if (!result) return;
  const wrong = screen().words.map((_,i) => i).filter(i => wordResult(i)?.state === 'wrong');
  const unclear = screen().words.map((_,i) => i).filter(i => wordResult(i)?.state !== 'wrong' && wordResult(i)?.state !== 'correct');
  const judged = result.status === 'judged';
  feedback.classList.toggle('has-differences', judged && wrong.length > 0);
  feedback.classList.toggle('needs-recording', !judged || unclear.length > 0 && !wrong.length);
  $('lp-feedback-icon').textContent = !judged || unclear.length && !wrong.length ? '↻' : wrong.length ? '!' : '✓';
  $('lp-feedback-title').textContent = !judged ? 'Let’s listen once more' : wrong.length ? 'Let’s practise these words' : unclear.length ? 'Try these words again' : 'Lovely work!';
  $('lp-feedback-summary').textContent = !judged ? 'The app couldn’t check this attempt.' : wrong.length ? 'Listen to the words in red, then try again.' : unclear.length ? 'Some sounds weren’t clear enough to check.' : 'Your sounds matched this reference.';
  if (!judged) {
    $('lp-issues').append(element('p', result.message || 'Listen again and record the whole phrase.', 'lp-error')); return;
  }
  for (const i of wrong) {
    const verdict = wordResult(i), word = screen().words[i], card = element('article', undefined, 'lp-issue'); card.dataset.wordId = word.id;
    const top = element('div', undefined, 'lp-issue-top'), title = element('span', word.text, 'lp-issue-word'); title.lang = 'pa';
    const reason = element('p', verdict.reason || 'This word sounded different. Listen to the reference and try again.', 'lp-issue-reason');
    const replay = element('button', undefined, 'lp-issue-replay'); replay.append(speakerIcon()); replay.setAttribute('aria-label', `Hear ustaad say ${word.text}`); replay.onclick = () => playUstaad(word.start - .08, word.end + .08);
    top.append(title, reason, replay); card.append(top, heardLine(verdict), replayActions(i, verdict)); $('lp-issues').append(card);
  }
  if (unclear.length) $('lp-issues').append(element('p', `Couldn’t check: ${unclear.map(i => screen().words[i].text).join(' · ')}. Listen and try again.`, 'lp-uncertain'));
  if (selected !== null && wordResult(selected)?.state === 'correct') {
    const verdict = wordResult(selected), detail = $('lp-detail'); detail.hidden = false; detail.className = 'lp-match-detail';
    detail.append(element('p', `${screen().words[selected].text} matched this reference.`), replayActions(selected, verdict));
  }
}
function renderScreen() {
  stopCelebration();
  generation++; stop(); result = null; selected = null; student = studentWav = null;
  $('lp-progress').textContent = `Pankti ${index + 1} / ${lesson.screens.length}`;
  renderStreak();
  renderWords(); renderFeedback(); $('lp-reader').scrollTop = 0;
  setPhase('idle', restMessage());
}
function showError(message) {
  stop(); result = {status:'unclear', words:[], message}; selected = null;
  renderWords(); renderFeedback(); setPhase('error', 'Listen again, then give it another try.');
}

function encodeWav(samples) {
  const out = new ArrayBuffer(44 + samples.length * 2), v = new DataView(out), str = (o,s) => [...s].forEach((c,i) => v.setUint8(o+i,c.charCodeAt(0)));
  str(0,'RIFF'); v.setUint32(4,36+samples.length*2,true); str(8,'WAVE'); str(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,16000,true); v.setUint32(28,32000,true); v.setUint16(32,2,true); v.setUint16(34,16,true); str(36,'data'); v.setUint32(40,samples.length*2,true);
  samples.forEach((s,i) => v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,s))*(s<0?32768:32767)),true)); return out;
}
async function check(blob, token, lessonId, screenId) {
  await audioContext(); const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  if (decoded.duration < .3) throw Error('The recording was too short. Record the whole phrase.');
  if (decoded.duration > 15) throw Error('Record one phrase, up to 15 seconds.');
  const offline = new OfflineAudioContext(1, Math.round(decoded.duration * 16000), 16000), source = offline.createBufferSource();
  source.buffer = decoded; source.connect(offline.destination); source.start(); const converted = await offline.startRendering();
  if (token !== generation) return;
  student = converted; studentWav = new Uint8Array(encodeWav(converted.getChannelData(0)));
  let binary = ''; for (let i=0;i<studentWav.length;i+=8192) binary += String.fromCharCode(...studentWav.subarray(i,i+8192));
  const response = await fetch('/api/learn/screens/compare', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({lesson_id:lessonId, screen_id:screenId, audio_base64:btoa(binary)})});
  const value = await response.json().catch(() => ({})); if (!response.ok) throw Error(value.error || 'The local server could not check this recording.');
  if (token !== generation) return;
  if (!Array.isArray(value.words)) throw Error('The comparison did not return word feedback. Please try again.');
  result = value; selected = null; recordTurn(value); renderWords(); renderFeedback();
  setPhase('result', restMessage());
}
async function toggleRecord() {
  if (recorder) { if (recorder.state === 'recording') recorder.stop(); return; }
  if (busy() || !lesson || phase === 'loading') return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { showError('This browser cannot record here. Open the app on localhost in a browser with microphone support.'); return; }
  stopCelebration(); stop(); const token = ++generation, lessonId = lesson.id, screenId = screen().id;
  result = null; student = studentWav = null; selected = null; renderWords(); renderFeedback();
  setPhase('permission', 'Allow microphone access to record your voice.');
  try {
    await audioContext(); stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1, echoCancellation:false, noiseSuppression:false, autoGainControl:false}});
    if (token !== generation) { stream.getTracks().forEach(track => track.stop()); stream = null; return; }
    const chunks = [], detector = new RecordingEndpoint(ctx.currentTime); recorder = new MediaRecorder(stream);
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { if (recorder?.state === 'recording') recorder.stop(); };
    recorder.onstop = async () => {
      stopEndpoint(); stream?.getTracks().forEach(track => track.stop()); stream = null; recorder = null; stopWave();
      if (token !== generation) return;
      if (!detector.speechDetected) { showError('I didn’t hear your voice. Try recording the whole phrase.'); return; }
      setPhase('checking', 'Comparing with Ustaad ji…');
      try { await check(new Blob(chunks, {type:chunks[0]?.type || 'audio/webm'}), token, lessonId, screenId); }
      catch (error) { if (token === generation) showError(error.message); }
    };
    recorder.start(); setPhase('recording', 'Follow the highlighted words. I’ll stop after a pause.');
    microphone = ctx.createMediaStreamSource(stream); startWave(microphone);
    startEndpoint(detector);
  } catch (error) {
    stopEndpoint(); stream?.getTracks().forEach(track => track.stop()); stream = null; recorder = null;
    if (token === generation) showError(`Microphone unavailable: ${error.message}`);
  }
}
function saveAttempt() {
  if (!studentWav || !lesson) return;
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const verdict = screen().words.map((_,i) => ({correct:'G',wrong:'R',unclear:'X'})[wordResult(i)?.state] || 'X').join('');
  const link = element('a'); link.href = URL.createObjectURL(new Blob([studentWav], {type:'audio/wav'})); link.download = `attempt-${lesson.id}-${screen().id}-${verdict}-${stamp}.wav`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href),1000);
}
async function loadLesson(id) {
  if (busy()) return;
  generation++; stop(); setPhase('loading','Loading the lesson…'); const token=generation;
  try {
    const response=await fetch(`/data/lessons/${id}.json`); if(!response.ok) throw Error('Lesson file not found.');
    const value=await response.json(); if(token!==generation) return;
    lesson=value; index=0;
    renderScreen();
  } catch(error) { if(token===generation) { phase='error'; say(`Could not load the lesson: ${error.message}`); controls(); } }
}
async function init() {
  fetch('/api/status').then(response=>response.ok ? response.json() : null).then(status=>{
    if (status && status.local_only === false) $('lp-hosted-privacy').hidden = false;
  }).catch(()=>{});
  for(let i=0;i<27;i++) $('lp-wave').append(element('span'));
  $('lp-listen').onclick=()=>{
    if(phase==='listening'||phase==='audio-loading') { stop(); setPhase(result?'result':'idle',restMessage()); }
    else playUstaad(screen().start,screen().end);
  };
  $('lp-record').onclick=toggleRecord; $('lp-save').onclick=saveAttempt;
  $('lp-hear').onclick=()=>hearStudent().catch(error=>showError(error.message));
  $('lp-back').onclick=()=>{ if(!busy()&&index>0) { index--; renderScreen(); } };
  $('lp-next').onclick=()=>{ if(!busy()&&index<lesson.screens.length-1) { index++; renderScreen(); } };
  window.addEventListener('pagehide',()=>{ stopCelebration(); generation++; stop(); if(recorder?.state==='recording') recorder.stop(); stream?.getTracks().forEach(track=>track.stop()); });
  await loadLesson(LESSON_ID);
}
init().catch(error=>say(`Could not start: ${error.message}`));
