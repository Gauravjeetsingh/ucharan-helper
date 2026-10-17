// Independent recitation is recorded locally; no invented assessment is shown.
const $ = id => document.getElementById(id);
let lesson, pauri=1, recorder, stream, timer, ticker, url, generation=0;
function phase(value,message) {
  $('test-screen').dataset.phase=value; $('test-status').textContent=message;
  const recording=value==='recording', busy=recording||value==='permission';
  $('test-record').disabled=value==='loading'||value==='permission';
  $('test-record').setAttribute('aria-label',recording?'Stop recording':url?'Record again':'Start reading');
  $('test-mic').toggleAttribute('hidden',recording); $('test-stop').toggleAttribute('hidden',!recording);
  $('test-next').disabled=busy||!lesson||pauri===38;
}
function clearAttempt() {
  $('test-playback').pause(); $('test-playback').removeAttribute('src'); $('test-attempt').hidden=true;
  if(url) URL.revokeObjectURL(url); url=null;
}
function render() {
  generation++; clearAttempt();
  const section=lesson.sections.find(s=>s.id===`pauri-${pauri}`);
  $('test-pauri').textContent=`JAPJI SAHIB · PAURI ${pauri}`;
  $('test-text').replaceChildren(...lesson.verses.filter(v=>section.verse_ids.includes(v.verse_id)).map(v=>{
    const p=document.createElement('p'); p.textContent=v.text; return p;
  }));
  $('test-text').scrollTop=0; phase('ready','Start reading');
}
async function record() {
  if(recorder) { if(recorder.state==='recording') recorder.stop(); return; }
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder) {phase('error','This browser cannot record here. Use localhost with microphone access.');return;}
  const token=++generation; clearAttempt(); phase('permission','Allow microphone access to start reading.');
  try {
    stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(token!==generation){stream.getTracks().forEach(t=>t.stop());return;}
    const chunks=[]; recorder=new MediaRecorder(stream);
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{
      clearTimeout(timer);clearInterval(ticker);stream?.getTracks().forEach(t=>t.stop());stream=null;recorder=null;
      if(token!==generation)return;
      if(!chunks.length){phase('error','The recording was empty. Please try again.');return;}
      const mime=chunks[0].type||'audio/webm';url=URL.createObjectURL(new Blob(chunks,{type:mime}));
      $('test-playback').src=url;$('test-save').href=url;
      $('test-save').download=`japji-pauri-${pauri}.${mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':'webm'}`;
      $('test-attempt').hidden=false;phase('ready','Your recording is ready. Listen back to your pauri.');
    };
    recorder.onerror=()=>{if(recorder?.state==='recording')recorder.stop();};
    recorder.start();const started=Date.now();phase('recording','Listening to you…');
    ticker=setInterval(()=>{const seconds=Math.floor((Date.now()-started)/1000);$('test-status').textContent=`Listening to you… ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;},1000);
    timer=setTimeout(()=>{if(recorder?.state==='recording')recorder.stop();},180000);
  }catch(error){stream?.getTracks().forEach(t=>t.stop());stream=null;recorder=null;phase('error',`Microphone unavailable: ${error.message}`);}
}
$('test-record').onclick=record;
$('test-next').onclick=()=>{if(!recorder&&pauri<38){pauri++;render();}};
window.addEventListener('pagehide',()=>{generation++;clearTimeout(timer);clearInterval(ticker);stream?.getTracks().forEach(t=>t.stop());clearAttempt();});
try {
  const response=await fetch('/data/lessons/japji-sahib-full.json');if(!response.ok)throw Error('The pauri could not load.');
  lesson=await response.json();render();
}catch(error){$('test-status').textContent=error.message;}
