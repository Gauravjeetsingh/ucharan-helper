const $ = id => document.getElementById(id);
let audioBytes, audioName, sampleSelected = false, result, audioUrl, busy = false, selection = 0;
function status(message) { $('status').textContent = message; }
function invalidate() {
  result = null; $('download').disabled = $('copy').disabled = true;
  $('output').textContent = 'Your word timestamps will appear here.'; $('result-summary').textContent = '';
}
function controls() {
  $('generate').disabled = busy || !audioBytes || !$('transcript').value.trim();
  $('existing').disabled = busy || !sampleSelected;
  $('sample').disabled = $('upload').disabled = $('transcript').disabled = $('expansion').disabled = busy;
}
function chooseAudio(bytes, name, mime = 'audio/wav') {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioBytes = bytes; audioName = name;
  audioUrl = URL.createObjectURL(new Blob([bytes], {type: mime}));
  $('player').src = audioUrl; $('player').hidden = false; $('audio-name').textContent = name;
  invalidate(); controls(); status('Recording ready. Check the text, then generate timestamps.');
}
function show(value, message) {
  result = value; $('output').textContent = JSON.stringify(value, null, 2);
  const words = value.words || value.verses?.flatMap(v => v.words) || [];
  $('result-summary').textContent = `${words.length} word occurrences · ${value.audio.duration_seconds.toFixed(2)} seconds · unreviewed`;
  $('download').disabled = $('copy').disabled = false; status(message);
}
async function pcmWav(bytes) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes.slice(0));
    if (decoded.duration > 120 || decoded.duration < .25) throw Error('Choose between 0.25 and 120 seconds of audio.');
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
  if (file.size > 40*1024*1024) { status('Choose an audio file under 40 MB.'); return; }
  const bytes = await file.arrayBuffer(); if (selection !== token) return;
  sampleSelected = false; chooseAudio(bytes, file.name, file.type);
};
for (const id of ['transcript','expansion']) $(id).oninput = () => { invalidate(); controls(); };
$('existing').onclick = async () => {
  try { show(await (await fetch('/data/reference/word-timings.json')).json(), 'Loaded the existing sample artifact. These timings were not regenerated.'); }
  catch (error) { status(error.message); }
};
$('generate').onclick = async () => {
  busy = true; invalidate(); controls(); status('Generating locally… First model loading can take a moment.');
  try {
    const response = await fetch('/api/timestamps/generate', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      audio_base64: await pcmWav(audioBytes), filename: audioName, text: $('transcript').value,
      expansions: {'ੴ': $('expansion').value}
    })});
    const value = await response.json(); if (!response.ok) throw Error(value.error || 'Generation failed.');
    show(value, 'Timestamps generated. Download the JSON to keep or share the result.');
  } catch (error) { status(error.message); }
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
