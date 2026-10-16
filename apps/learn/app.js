const $ = id => document.getElementById(id);
const storageKey = 'uchaaran-reference-review-v1';
let data, original, words, selected = 0, context, buffer, source, playbackToken = 0;
const audio = $('audio');
let peaks = [];
let practiceRecording = false;
document.addEventListener('uchaaran-recording', e => { practiceRecording = e.detail; if (practiceRecording) stop(); });

function validate(candidate) {
  if (!candidate || candidate.schema_version !== original.schema_version || JSON.stringify(candidate.audio) !== JSON.stringify(original.audio) || candidate.verses.length !== original.verses.length) throw Error('This review belongs to a different source or recording.');
  for (let vi = 0; vi < original.verses.length; vi++) {
    const a = original.verses[vi], b = candidate.verses[vi];
    if (a.verse_id !== b.verse_id || a.text !== b.text || a.words.length !== b.words.length) throw Error('Source text or verse IDs changed.');
    a.words.forEach((w, i) => {
      const v = b.words[i];
      if (w.id !== v.id || w.text !== v.text || w.source_start !== v.source_start || w.source_end !== v.source_end || w.verse_id !== v.verse_id || w.word_index !== v.word_index) throw Error('Source word identity changed.');
      if (!['aligned', 'uncertain', 'outside_audio'].includes(v.status) || typeof v.reviewed !== 'boolean') throw Error('Invalid coverage or review status.');
      const empty = v.start === null && v.end === null;
      const valid = Number.isFinite(v.start) && Number.isFinite(v.end) && v.start >= 0 && v.end > v.start && v.end <= original.audio.duration_seconds;
      if (!(empty || valid) || (v.status === 'aligned' && empty) || (v.status === 'outside_audio' && !empty)) throw Error(`Invalid interval for ${v.id}.`);
    });
  }
  return candidate;
}
function save() {
  try { localStorage.setItem(storageKey, JSON.stringify(data)); }
  catch { $('notice').textContent = 'Browser storage unavailable. Download your review JSON to keep your changes.'; }
}
function renderVerses() {
  words = data.verses.flatMap(v => v.words);
  $('verses').replaceChildren();
  let index = 0;
  data.verses.forEach((verse, vi) => {
    const block = document.createElement('article'); block.className = 'verse';
    const meta = document.createElement('div'); meta.className = 'verse-meta'; meta.textContent = `VERSE ${vi + 1} / SOURCE ID ${verse.verse_id}`;
    const line = document.createElement('div'); line.className = 'gurmukhi'; line.lang = 'pa';
    let cursor = 0;
    // Code-point offsets in JSON preserve the unmodified Unicode source.
    const chars = [...verse.text];
    for (const word of verse.words) {
      line.append(document.createTextNode(chars.slice(cursor, word.source_start).join('')));
      const button = document.createElement('button'); button.className = 'word'; button.textContent = word.text;
      button.dataset.index = index; button.title = `${word.id} · ${word.start === null ? word.status : `${word.start.toFixed(2)}–${word.end.toFixed(2)} s`}`;
      const wi = index++; button.addEventListener('click', () => { choose(wi); play(); }); line.append(button);
      cursor = word.source_end;
    }
    line.append(document.createTextNode(chars.slice(cursor).join(''))); block.append(meta, line); $('verses').append(block);
  });
  refresh();
}
function intervalError(w) {
  if (w.start === null || w.end === null) return 'No segment assigned. Review coverage before adding a timing.';
  if (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.end > data.audio.duration_seconds || w.start >= w.end) return `Use 0 ≤ start < end ≤ ${data.audio.duration_seconds.toFixed(3)} s.`;
  return '';
}
function refresh() {
  const w = words[selected];
  document.querySelectorAll('.word').forEach((el, i) => {
    el.setAttribute('aria-pressed', String(i === selected));
    el.classList.toggle('unreviewed', !words[i].reviewed);
    el.classList.toggle('absent', words[i].status !== 'aligned');
  });
  $('selected').textContent = w.text; $('identity').textContent = `${w.id} · verse ${w.verse_id}, word ${w.word_index}`;
  $('word-note').textContent = w.note || (w.status === 'aligned' ? 'Acoustic estimate. Listen for clipped consonants and neighbouring words.' : 'No confirmed audio segment.');
  $('start').value = w.start ?? ''; $('end').value = w.end ?? '';
  $('reviewed').checked = w.reviewed; $('coverage').value = w.status;
  const error = intervalError(w); $('range-error').textContent = error;
  $('replay').disabled = $('context').disabled = !!error || w.status === 'outside_audio';
  $('previous').disabled = selected === 0; $('next').disabled = selected === words.length - 1;
  $('summary').textContent = `${words.filter(w => w.reviewed).length} / ${words.length} reviewed · ${words.filter(w => w.status === 'aligned').length} aligned · ${words.filter(w => w.status !== 'aligned').length} outside / uncertain`;
  draw();
}
function stop() { playbackToken++; if (source) { try { source.stop(); } catch {} source = null; } audio.pause(); }
document.addEventListener('uchaaran-stop', stop);
document.addEventListener('uchaaran-teacher-stop', stop);
function choose(i) { stop(); selected = Math.max(0, Math.min(words.length - 1, i)); refresh(); }
async function ensureAudio() {
  context ||= new AudioContext();
  await context.resume();
  if (!buffer) { const bytes = await (await fetch('/data/reference/' + data.audio.playback_file)).arrayBuffer(); buffer = await context.decodeAudioData(bytes); buildPeaks(); }
}
async function play(padding = 0) {
  if (practiceRecording) return;
  document.dispatchEvent(new Event('uchaaran-stop'));
  const w = words[selected]; if (intervalError(w) || w.status === 'outside_audio') return;
  stop(); const token = playbackToken;
  try {
    await ensureAudio(); if (token !== playbackToken) return;
    const start = Math.max(0, w.start - padding), end = Math.min(buffer.duration, w.end + padding);
    source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
    // Duration is scheduled by Web Audio's audio clock, independent of UI timers.
    source.start(0, start, end - start);
    $('notice').textContent = `${padding ? 'Context' : 'Word'} playback · ${w.text} · ${start.toFixed(2)}–${end.toFixed(2)} s`;
  } catch (e) { $('notice').textContent = `Audio could not play: ${e.message}. Serve this folder over localhost.`; }
}
function updateBoundary(which, value) {
  stop(); const w = words[selected], candidate = {...w, [which]: value};
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > data.audio.duration_seconds)) { $('range-error').textContent = 'Boundary is outside the recording.'; return; }
  if (candidate.start !== null && candidate.end !== null && candidate.start >= candidate.end) { $('range-error').textContent = 'Start must be before end.'; return; }
  w[which] = value; w.reviewed = false;
  if (w.start !== null && w.end !== null) w.status = 'aligned';
  else { w.start = w.end = null; w.status = 'uncertain'; }
  save(); refresh();
}
function buildPeaks() {
  const samples = buffer.getChannelData(0), count = 900, size = Math.ceil(samples.length / count);
  peaks = Array.from({length: count}, (_, i) => { let peak=0; for (let j=i*size; j<Math.min(samples.length,(i+1)*size); j++) peak=Math.max(peak,Math.abs(samples[j])); return peak; }); draw();
}
function draw() {
  const canvas=$('waveform'), width=canvas.clientWidth || 900; canvas.width=width*devicePixelRatio; canvas.height=100*devicePixelRatio;
  const c=canvas.getContext('2d'); c.scale(devicePixelRatio,devicePixelRatio);
  const w=words?.[selected], duration=data?.audio.duration_seconds || 1;
  if (w?.start !== null && w?.end !== null) { c.fillStyle='#e8d6b1'; c.fillRect(w.start/duration*width,0,(w.end-w.start)/duration*width,100); }
  c.strokeStyle='#72867b'; c.beginPath(); peaks.forEach((p,i)=>{const x=i/peaks.length*width;c.moveTo(x,50-p*43);c.lineTo(x,50+p*43);});c.stroke();
  c.strokeStyle='#a45b24'; const x=audio.currentTime/duration*width;c.beginPath();c.moveTo(x,0);c.lineTo(x,100);c.stroke();
}
async function init() {
  original = await (await fetch('/data/reference/word-timings.json')).json(); data=structuredClone(original);
  try { const saved=localStorage.getItem(storageKey); if(saved) data=validate(JSON.parse(saved)); } catch { $('notice').textContent='A previous browser review could not be loaded. Using the source JSON.'; }
  $('notice').textContent ||= data.coverage.summary; renderVerses();
  $('replay').onclick=()=>play(); $('context').onclick=()=>play(.3); $('stop').onclick=stop;
  $('previous').onclick=()=>choose(selected-1); $('next').onclick=()=>choose(selected+1);
  for(const side of ['start','end']) $(side).onchange=()=>{
    const start=$('start').value===''?null:Number($('start').value), end=$('end').value===''?null:Number($('end').value);
    if(start===null||end===null){$('range-error').textContent='Enter both start and end, or mark the word outside the clip.';return;}
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>data.audio.duration_seconds||start>=end){$('range-error').textContent='Use a start before end, within the recording.';return;}
    stop();Object.assign(words[selected],{start,end,status:'aligned',reviewed:false});save();refresh();
  };
  document.querySelectorAll('[data-nudge]').forEach(b=>b.onclick=()=>{const [side,delta]=b.dataset.nudge.split(':');if(words[selected][side]!==null)updateBoundary(side,Math.round((words[selected][side]+Number(delta))*1000)/1000);});
  $('reviewed').onchange=()=>{words[selected].reviewed=$('reviewed').checked;save();refresh();};
  $('coverage').onchange=()=>{stop(); const w=words[selected];w.status=$('coverage').value;w.reviewed=false;if(w.status==='outside_audio')w.start=w.end=null;if(w.status==='aligned'&&(w.start===null||w.end===null))w.status='uncertain';save();refresh();};
  for(const side of ['start','end']) $(`set-${side}`).onclick=()=>{const w=words[selected];if(w.start===null&&w.end===null){const time=Math.round(audio.currentTime*1000)/1000;w.start=side==='start'?Math.min(time,data.audio.duration_seconds-.01):Math.max(0,time-.3);w.end=side==='end'?Math.max(time,.01):Math.min(data.audio.duration_seconds,time+.3);w.status='aligned';w.reviewed=false;save();refresh();}else updateBoundary(side,Math.round(audio.currentTime*1000)/1000);};
  $('export').onclick=()=>{try{validate(data);const blob=new Blob([JSON.stringify({...data,review_exported_at:new Date().toISOString()},null,2)+'\n'],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='word-timings.reviewed.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){$('notice').textContent=e.message;}};
  $('import').onchange=async()=>{try{const file=$('import').files[0];if(!file)return;const candidate=validate(JSON.parse(await file.text()));stop();data=candidate;save();renderVerses();$('notice').textContent='Review imported. Exact source text and occurrence IDs verified.';}catch(e){$('notice').textContent=`Import rejected: ${e.message}`;}finally{$('import').value='';}};
  audio.addEventListener('play',()=>{if(practiceRecording){audio.pause();return;}playbackToken++;if(source){try{source.stop();}catch{}source=null;}});
  audio.addEventListener('play',()=>document.dispatchEvent(new Event('uchaaran-reference-playing')));
  audio.addEventListener('timeupdate',()=>{$('cursor').textContent=`${audio.currentTime.toFixed(2)} s`;draw();});
  $('waveform').onclick=e=>{stop();audio.currentTime=(e.offsetX/$('waveform').clientWidth)*data.audio.duration_seconds;draw();};
  window.addEventListener('resize',draw);
  // Decode once for waveform; this does not start playback or request microphone access.
  try { const bytes=await(await fetch('/data/reference/' + data.audio.playback_file)).arrayBuffer();context ||= new AudioContext();buffer=await context.decodeAudioData(bytes);buildPeaks(); }catch(e){$('notice').textContent=`Waveform unavailable: ${e.message}. Click a word to retry audio.`;}
}
init().catch(e=>{$('notice').textContent=`Could not load reference: ${e.message}. Run the local server described in README.md.`;});
