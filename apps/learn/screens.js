// Learn UI. Lesson text/timings and comparison remain supplied by existing APIs.
const $ = id => document.getElementById(id);
const LESSONS = [['japji-short-phrases', 'Japji Sahib · short phrases'], ['mool-mantar', 'Mool Mantar'], ['japji-sahib', 'Japji Sahib · first lines (full recording)']];
const SVG_NS = 'http://www.w3.org/2000/svg';
let lesson, index = 0, ctx, playing, analyser, microphone, frame;
let recorder, stream, timer, student, studentWav, result, selected = null;
let generation = 0, playbackToken = 0, hasListened = false, phase = 'loading';
const clips = new Map();
const screen = () => lesson.screens[index];
const busy = () => ['permission', 'recording', 'checking'].includes(phase);
const wordResult = i => result?.words?.find(w => w.id === screen().words[i].id);
const say = text => { $('lp-message').textContent = text; };
const restMessage = () => !result ? hasListened ? 'Your turn. Tap the microphone.' : 'Tap the speaker to hear Ustaad ji.'
  : result.status !== 'judged' ? 'Listen again, then give it another try.'
  : index === lesson.screens.length - 1 ? 'Try again, or choose another lesson.' : 'Try again, or go to the next pankti.';
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
  $('lp-speaker-icon').hidden = listening; $('lp-speaker-stop').hidden = !listening;
  $('lp-record').disabled = !lesson || phase === 'loading' || phase === 'permission' || phase === 'checking' || listening || (!hasListened && !recording);
  $('lp-record').classList.toggle('recording', recording);
  $('lp-record').setAttribute('aria-label', recording ? 'Stop recording' : result || student ? 'Try again' : 'Record yourself');
  $('lp-record').title = recording ? 'Stop recording' : hasListened ? 'Record yourself' : 'Listen first, then record';
  $('lp-mic-icon').hidden = recording || phase === 'checking'; $('lp-stop-icon').hidden = !recording; $('lp-checking-icon').hidden = phase !== 'checking';
  $('lp-next').disabled = !lesson || busy() || phase === 'loading' || !result || result.status !== 'judged' || index === lesson.screens.length - 1;
  $('lp-back').disabled = !lesson || busy() || phase === 'loading' || index === 0;
  $('lp-shuffle').disabled = $('lp-lesson').disabled = busy() || phase === 'loading';
  $('lp-attempt-actions').hidden = !studentWav || busy();
  $('lp-hear').disabled = !student || busy();
  document.querySelectorAll('.lp-word').forEach(button => { button.disabled = busy() || phase === 'loading'; });
  document.querySelectorAll('.lp-issue-replay,.lp-text-button').forEach(button => { button.disabled = busy() || phase === 'loading'; });
}

async function audioContext() { ctx ||= new AudioContext(); await ctx.resume(); return ctx; }
function stopWave() {
  cancelAnimationFrame(frame); analyser?.disconnect(); analyser = null;
  microphone?.disconnect(); microphone = null; $('lp-wave').hidden = true;
  document.querySelectorAll('.lp-word.is-playing').forEach(node => node.classList.remove('is-playing'));
}
function stop() {
  playbackToken++; if (playing) { playing.onended = null; try { playing.stop(); } catch {} playing = null; }
  stopWave();
}
function startWave(input, playback) {
  analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = .65; input.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize), bars = [...$('lp-wave').children]; $('lp-wave').hidden = false;
  function draw() {
    if (!analyser) return;
    analyser.getByteTimeDomainData(samples);
    bars.forEach((bar, i) => {
      const a = Math.floor(i * samples.length / bars.length), b = Math.floor((i + 1) * samples.length / bars.length);
      let amplitude = 0; for (let j = a; j < b; j++) amplitude = Math.max(amplitude, Math.abs(samples[j] - 128) / 128);
      bar.style.height = `${Math.min(48, 5 + amplitude * 130)}px`;
    });
    // Playback highlighting uses the actual audio clock. No live pronunciation
    // judgement or inferred student word timing is fabricated during recording.
    if (playback) {
      const position = playback.offset + ctx.currentTime - playback.started;
      document.querySelectorAll('.lp-word').forEach((button, i) => {
        const word = screen().words[i]; button.classList.toggle('is-playing', word.start <= position && position < word.end);
      });
    }
    frame = requestAnimationFrame(draw);
  }
  draw();
}
async function clip(url) {
  if (!clips.has(url)) {
    const response = await fetch(url); if (!response.ok) throw Error('The reference recording could not be loaded.');
    clips.set(url, ctx.decodeAudioData(await response.arrayBuffer()));
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
    if (options.fullReference) hasListened = true;
    setPhase(result ? 'result' : 'ready', restMessage());
  };
  const started = ctx.currentTime;
  if (options.reference) startWave(source, {offset:start, started});
  source.start(0, start, end - start);
}
async function playUstaad(start, end, fullReference = false) {
  if (busy() || !lesson) return;
  stop(); const token = playbackToken, url = screen().audio;
  setPhase('audio-loading', 'Loading Ustaad ji’s recording…');
  try {
    await audioContext(); const buffer = await clip(url);
    if (token !== playbackToken || busy()) return;
    setPhase('listening', 'Ustaad ji is reciting…');
    await play(buffer, start, end, token, {reference:true, fullReference});
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
  generation++; stop(); result = null; selected = null; student = studentWav = null; hasListened = false;
  $('lp-lesson').value = lesson.id; $('lp-ustaad').textContent = screen().ustaad;
  $('lp-progress').textContent = `Pankti ${index + 1} / ${lesson.screens.length}`;
  const segments = $('lp-segments'); segments.replaceChildren(); segments.style.gridTemplateColumns = `repeat(${lesson.screens.length}, minmax(0, 1fr))`;
  segments.setAttribute('aria-valuemax', lesson.screens.length); segments.setAttribute('aria-valuenow', index + 1);
  lesson.screens.forEach((_,i) => { const segment = element('span', undefined, 'lp-segment'); segment.classList.toggle('is-reached', i <= index); segments.append(segment); });
  renderWords(); renderFeedback(); $('lp-reader').scrollTop = 0;
  setPhase('idle', 'Tap the speaker to hear Ustaad ji.');
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
  result = value; selected = null; renderWords(); renderFeedback();
  setPhase('result', restMessage());
}
async function toggleRecord() {
  if (recorder) { if (recorder.state === 'recording') recorder.stop(); return; }
  if (busy() || !hasListened) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { showError('This browser cannot record here. Open the app on localhost in a browser with microphone support.'); return; }
  stop(); const token = ++generation, lessonId = lesson.id, screenId = screen().id;
  result = null; student = studentWav = null; selected = null; renderWords(); renderFeedback();
  setPhase('permission', 'Allow microphone access to record your voice.');
  try {
    await audioContext(); stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1, echoCancellation:false, noiseSuppression:false, autoGainControl:false}});
    if (token !== generation) { stream.getTracks().forEach(track => track.stop()); stream = null; return; }
    const chunks = []; recorder = new MediaRecorder(stream);
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { if (recorder?.state === 'recording') recorder.stop(); };
    recorder.onstop = async () => {
      clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); stream = null; recorder = null; stopWave();
      if (token !== generation) return;
      setPhase('checking', 'Comparing with Ustaad ji…');
      try { await check(new Blob(chunks, {type:chunks[0]?.type || 'audio/webm'}), token, lessonId, screenId); }
      catch (error) { if (token === generation) showError(error.message); }
    };
    recorder.start(); setPhase('recording', 'Listening to you…');
    microphone = ctx.createMediaStreamSource(stream); startWave(microphone);
    timer = setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); },14500);
  } catch (error) {
    clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); stream = null; recorder = null;
    if (token === generation) showError(`Microphone unavailable: ${error.message}`);
  }
}
function saveAttempt() {
  if (!studentWav || !lesson) return;
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const verdict = screen().words.map((_,i) => ({correct:'G',wrong:'R',unclear:'X'})[wordResult(i)?.state] || 'X').join('');
  const link = element('a'); link.href = URL.createObjectURL(new Blob([studentWav], {type:'audio/wav'})); link.download = `attempt-${lesson.id}-${screen().id}-${verdict}-${stamp}.wav`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href),1000);
}
function shuffle() {
  if (busy()) return;
  const screens = lesson.screens;
  for (let i=screens.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [screens[i],screens[j]]=[screens[j],screens[i]]; }
  index=0; renderScreen();
}
async function loadLesson(id) {
  if (busy()) return;
  generation++; stop(); setPhase('loading','Loading the lesson…'); const token=generation;
  try {
    const response=await fetch(`/data/lessons/${id}.json`); if(!response.ok) throw Error('Lesson file not found.');
    const value=await response.json(); if(token!==generation) return;
    lesson=value; index=0;
    if(lesson.shuffle) { phase='idle'; shuffle(); } else renderScreen();
  } catch(error) { if(token===generation) { phase='error'; say(`Could not load the lesson: ${error.message}`); controls(); } }
}
async function init() {
  for(const [id,title] of LESSONS) { const option=element('option',title); option.value=id; $('lp-lesson').append(option); }
  for(let i=0;i<27;i++) $('lp-wave').append(element('span'));
  $('lp-lesson').onchange=()=>loadLesson($('lp-lesson').value);
  $('lp-shuffle').onclick=shuffle;
  $('lp-listen').onclick=()=>{
    if(phase==='listening'||phase==='audio-loading') { stop(); setPhase(result?'result':hasListened?'ready':'idle',restMessage()); }
    else playUstaad(screen().start,screen().end,true);
  };
  $('lp-record').onclick=toggleRecord; $('lp-save').onclick=saveAttempt;
  $('lp-hear').onclick=()=>hearStudent().catch(error=>showError(error.message));
  $('lp-back').onclick=()=>{ if(!busy()&&index>0) { index--; renderScreen(); } };
  $('lp-next').onclick=()=>{ if(!busy()&&index<lesson.screens.length-1) { index++; renderScreen(); } };
  window.addEventListener('pagehide',()=>{ generation++; clearTimeout(timer); stop(); stream?.getTracks().forEach(track=>track.stop()); });
  await loadLesson(LESSONS[0][0]);
}
init().catch(error=>say(`Could not start: ${error.message}`));
