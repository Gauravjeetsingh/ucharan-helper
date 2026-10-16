const $=id=>document.getElementById(id);
let context, pcm, wav, mediaUrl, evidence, definition, config, preview;
let recorder, stream, timer, busy=false, generation=0, playbackGeneration=0, segment;
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const player=$('playback');

function controls(){
  const recording=!!recorder;
  $('record').disabled=busy||recording;$('stop-record').disabled=!recording||recorder.state!=='recording';
  $('file').disabled=busy||recording;$('discard').disabled=!wav||busy||recording;
  $('extract').disabled=!wav||busy||recording;
  $('download-audio').disabled=!wav||busy||recording;
  $('download-evidence').disabled=!evidence||busy||recording;
  $('consent').disabled=!evidence||evidence.status!=='ready'||busy||recording;
  $('define').disabled=!evidence||evidence.status!=='ready'||!config?.configured||!$('consent').checked||busy||recording;
  $('download-definition').disabled=!definition||busy||recording;
}
function stopPlayback(){playbackGeneration++;player.pause();if(segment){try{segment.stop();}catch{}segment=null;}}
async function audioContext(){context ||= new AudioContext();await context.resume();return context;}
async function replay(start,end){stopPlayback();const token=playbackGeneration;await audioContext();if(token!==playbackGeneration||!pcm||recorder)return;segment=context.createBufferSource();segment.buffer=pcm;segment.connect(context.destination);start=Math.max(0,start);end=Math.min(pcm.duration,end);if(end>start)segment.start(0,start,end-start);}
player.addEventListener('play',()=>{if(recorder){player.pause();return;}playbackGeneration++;if(segment){try{segment.stop();}catch{}segment=null;}});
function resetResults(){evidence=definition=preview=null;$('consent').checked=false;$('local-evidence').replaceChildren();$('definitions').replaceChildren();$('payload-preview').textContent='Extract sounds first. No audio, API key, or expected verse is included in this preview.';$('extract-status').textContent='Choose or record audio first. No cloud request is made by this step.';$('definition-status').textContent='Definitions will appear here after your request.';}
function discard(){stopPlayback();if(mediaUrl)URL.revokeObjectURL(mediaUrl);mediaUrl=null;pcm=wav=null;player.removeAttribute('src');player.hidden=true;resetResults();controls();}
function encodeWav(samples){
  const bytes=new ArrayBuffer(44+samples.length*2),v=new DataView(bytes),str=(o,t)=>[...t].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
  str(0,'RIFF');v.setUint32(4,36+samples.length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);
  samples.forEach((s,i)=>v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,s))*(s<0?32768:32767)),true));return bytes;
}
async function accept(blob,token){
  if(blob.size>20_000_000)throw Error('Choose an audio file smaller than 20 MB.');
  await audioContext();const decoded=await context.decodeAudioData(await blob.arrayBuffer());
  if(decoded.duration<.1||decoded.duration>15)throw Error('Choose one phrase between 0.1 and 15 seconds.');
  const offline=new OfflineAudioContext(1,Math.round(decoded.duration*16000),16000),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();const converted=await offline.startRendering();
  if(token!==generation)return;discard();pcm=converted;wav=encodeWav(converted.getChannelData(0));mediaUrl=URL.createObjectURL(new Blob([wav],{type:'audio/wav'}));player.src=mediaUrl;player.hidden=false;
  $('capture-status').textContent=`Ready: ${pcm.duration.toFixed(2)} seconds. Replay it, then extract its sounds locally.`;$('extract-status').textContent='Ready for local extraction. Nothing has been sent to Claude.';
}
async function record(){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){$('capture-status').textContent='Microphone recording needs a supported browser on localhost. You can choose an audio file instead.';return;}
  const token=++generation;discard();busy=true;controls();$('capture-status').textContent='Requesting microphone access…';
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    if(token!==generation){stream.getTracks().forEach(t=>t.stop());return;}
    const chunks=[];recorder=new MediaRecorder(stream);
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=async()=>{clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());stream=null;recorder=null;busy=true;controls();try{await accept(new Blob(chunks,{type:chunks[0]?.type||'audio/webm'}),token);}catch(e){$('capture-status').textContent=e.message;}finally{busy=false;controls();}};
    recorder.onerror=()=>{if(recorder?.state==='recording')recorder.stop();$('capture-status').textContent='Recording failed. Retry or choose an audio file.';};
    recorder.start();timer=setTimeout(()=>{if(recorder?.state==='recording')recorder.stop();},14500);$('capture-status').textContent='Recording… press Stop when the phrase ends. Maximum 14.5 seconds.';
  }catch(e){stream?.getTracks().forEach(t=>t.stop());stream=null;recorder=null;$('capture-status').textContent=`Microphone unavailable: ${e.message}`;}
  finally{busy=false;controls();}
}
async function api(path,input){
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  let body;try{body=await response.json();}catch{throw Error('Use the project server: python serve.py. A static file server cannot run this flow.');}
  if(!response.ok){const error=Error(body.error||`Request failed (${response.status}).`);error.code=body.error_code;throw error;}return body;
}
function download(value,name){const blob=value instanceof Blob?value:new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function renderEvidence(){
  const container=$('local-evidence');container.replaceChildren();const q=evidence.quality;
  container.append(node('p',`Capture: ${q.rms_dbfs} dBFS · ${(q.clipping_fraction*100).toFixed(2)}% clipped.`,'hint'));
  if(evidence.status!=='ready'){container.append(node('p',[...q.reasons,...evidence.limitations].join(' '),'warning'));return;}
  const sequence=node('div',undefined,'sound-sequence');
  for(const event of evidence.events){const b=node('button',event.label,'sound-chip');b.title=`${event.id} · approximate ${event.start.toFixed(2)}–${event.end.toFixed(2)} s`;b.onclick=()=>replay(event.start-.12,event.end+.12).catch(e=>$('extract-status').textContent=e.message);sequence.append(b);}container.append(sequence);
  container.append(node('p','These are recognizer guesses. Click a sound to replay nearby audio; the highlighted time is approximate, not an exact physical sound boundary.','hint'));
}
function renderDefinitions(){
  const container=$('definitions');container.replaceChildren();container.append(node('p',definition.definition.summary));
  definition.definition.groups.forEach((group,i)=>{
    const article=node('article',undefined,'definition-group');article.append(node('h3',group.heard_word?`${group.heard_word} · tentative word guess`:`Sound group ${i+1}`));article.append(node('p',group.grouping_note,'hint'));
    const play=node('button','▶ Replay this group');play.onclick=()=>replay(group.start,group.end).catch(e=>$('definition-status').textContent=e.message);article.append(play);
    for(const sound of group.sounds){
      const row=node('div',undefined,'sound-definition'),event=evidence.events.find(e=>e.id===sound.event_id),button=node('button',sound.observed_label);
      button.title='Replay approximate sound segment';button.onclick=()=>replay(event.start-.12,event.end+.12).catch(e=>$('definition-status').textContent=e.message);const body=node('div');body.append(node('p',sound.description));
      for(const example of sound.english_examples){const chip=node('span',undefined,'sound-example'),pos=example.word.toLowerCase().indexOf(example.focus.toLowerCase());chip.append(document.createTextNode(example.word.slice(0,pos)),node('strong',example.word.slice(pos,pos+example.focus.length).toUpperCase()),document.createTextNode(example.word.slice(pos+example.focus.length)));body.append(chip,node('p',example.accent_note,'hint'));}
      if(!sound.english_examples.length)body.append(node('p','No English example was suggested.','hint'));
      body.append(node('p',sound.uncertainty_note,'hint'));row.append(button,body);article.append(row);
    }container.append(article);
  });
  container.append(node('p','Draft only. Claude explained local sound observations and did not hear the audio. These definitions do not establish correct pronunciation.','hint'));
}
async function extract(){
  busy=true;stopPlayback();resetResults();controls();const token=generation;$('extract-status').textContent='Extracting locally… the first run loads the sound model and may take a minute.';
  try{let encoded='';const bytes=new Uint8Array(wav);for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));const result=await api('/api/test/extract',{audio_base64:btoa(encoded)});if(token!==generation)return;evidence=result.evidence;preview=result.claude_payload_preview;renderEvidence();$('payload-preview').textContent=JSON.stringify(preview,null,2);$('extract-status').textContent=evidence.status==='ready'?`${evidence.events.length} draft sound observations. No Claude request has been made.`:'More reliable audio is needed. No Claude request was made.';
  }catch(e){$('extract-status').textContent=e.message;}finally{busy=false;controls();}
}
async function define(){
  busy=true;definition=null;$('definitions').replaceChildren();stopPlayback();controls();const token=generation;$('definition-status').textContent='Claude is describing the extracted sound observations… audio stays local.';
  try{const result=await api('/api/test/define',{evidence,consent_to_external_processing:$('consent').checked});if(token!==generation)return;definition=result;renderDefinitions();$('definition-status').textContent='Draft definitions ready. Listen back to check them; no pronunciation score was assigned.';
  }catch(e){if(e.code==='stale_learner_evidence'){$('consent').checked=false;evidence=null;$('extract-status').textContent='Your recording is still available. Extract sounds locally again, then review the new observations before generating definitions.';}$('definition-status').textContent=e.message;}finally{busy=false;controls();}
}
$('record').onclick=record;$('stop-record').onclick=()=>{if(recorder?.state==='recording')recorder.stop();};$('discard').onclick=()=>{generation++;discard();$('capture-status').textContent='Recording and results discarded from this tab.';};
$('file').onchange=async()=>{const file=$('file').files[0];if(!file)return;const token=++generation;discard();busy=true;controls();try{await accept(file,token);}catch(e){$('capture-status').textContent=e.message;}finally{busy=false;controls();$('file').value='';}};
$('extract').onclick=extract;$('define').onclick=define;$('consent').onchange=controls;
$('download-audio').onclick=()=>download(new Blob([wav],{type:'audio/wav'}),'learner-recording.wav');
$('download-evidence').onclick=()=>download(evidence,`learner-observations-${evidence.audio.sha256.slice(0,12)}.json`);
$('download-definition').onclick=()=>download(definition,`learner-definitions-${definition.audio.sha256.slice(0,12)}.json`);
window.addEventListener('pagehide',()=>{generation++;clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());if(mediaUrl)URL.revokeObjectURL(mediaUrl);});
fetch('/api/test/status').then(async response=>{if(!response.ok)throw Error('Restart python serve.py from this feature branch to enable the learner endpoints.');config=await response.json();$('configuration').textContent=config.configured?`Claude is configured (${config.model}). Only sound observations are sent after you choose to send them.`:'Claude key is not configured. Local extraction does not need a Claude key. Copy .env.example to .env, set ANTHROPIC_API_KEY locally, then restart python serve.py.';if(!config.acoustic_model_present)$('extract-status').textContent='Local sound weights are missing. Follow the optional phonetic setup in README.md before extraction.';controls();}).catch(e=>{$('configuration').textContent=e.message;});
controls();
