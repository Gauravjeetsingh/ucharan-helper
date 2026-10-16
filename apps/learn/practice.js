const $ = id => document.getElementById(id);
let reference, phrase, review, ctx, teacher, studentBuffer, studentWav, studentUrl, result;
let playing, recorder, stream, timer, recordingPhrase, busy = false, generation = 0, attemptId;
let hasSeenEvidence = false;
let playbackGeneration = 0;
const reviewKey = 'uchaaran-sound-review-v1';
const studentPlayer = $('student-audio');

function node(tag, text, className) { const n=document.createElement(tag); if(text!==undefined)n.textContent=text;if(className)n.className=className;return n; }
function status(text) { $('practice-status').textContent=text; }
function download(value, name, type='application/json') {
  const blob=value instanceof Blob?value:new Blob([JSON.stringify(value,null,2)+'\n'],{type});
  const url=URL.createObjectURL(blob), a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function stopPlayback() { playbackGeneration++;if(playing){try{playing.stop();}catch{}playing=null;}studentPlayer.pause(); }
function stopAll() { document.dispatchEvent(new Event('uchaaran-stop')); }
document.addEventListener('uchaaran-stop',stopPlayback);
document.addEventListener('uchaaran-reference-playing',stopPlayback);
async function audioContext() { ctx ||= new AudioContext();await ctx.resume();return ctx; }
async function playSegment(buffer,start,end) {
  stopAll();const token=playbackGeneration;await audioContext();if(token!==playbackGeneration||recorder?.state==='recording')return;playing=ctx.createBufferSource();playing.buffer=buffer;playing.connect(ctx.destination);
  start=Math.max(0,start);end=Math.min(buffer.duration,end);if(end>start)playing.start(0,start,end-start);
}
async function playTeacher(start,end) {
  if(recorder?.state==='recording'){status('Stop recording before replaying the reference.');return;}
  stopAll();const token=playbackGeneration;
  await audioContext();teacher ||= await ctx.decodeAudioData(await(await fetch('/data/reference/recording.wav')).arrayBuffer());
  if(token!==playbackGeneration)return;
  await playSegment(teacher,start,end);
}
function validReview(candidate) {
  if(candidate?.schema_version!==1 || candidate.reference_sha256!==reference.reference_sha256 || !candidate.words || typeof candidate.words!=='object' || Array.isArray(candidate.words))throw Error('Review does not match this audio-derived extraction.');
  for(const [id,item] of Object.entries(candidate.words)){
    if(!reference.words[id] || !item || typeof item.reviewed!=='boolean' || typeof item.notes!=='string' || item.notes.length>4000)throw Error('Invalid occurrence or review fields.');
    const labels=item.corrected_labels;
    if(labels!==null && (!Array.isArray(labels)||!labels.length||labels.length>80||labels.some(l=>typeof l!=='string'||!reference.inventory.includes(l)||l.startsWith('<'))))throw Error('Unsupported model label. Keep that correction in ordinary-language notes.');
  }
  return candidate;
}
function saveReview() {try{localStorage.setItem(reviewKey,JSON.stringify(review));$('sound-status').textContent='Corrections saved separately in this browser.';}catch{$('sound-status').textContent='Browser storage unavailable. Download sound review to keep corrections.';}invalidateResult();}
function invalidateResult(){result=null;$('practice-results').replaceChildren();$('download-result').disabled=true;}
function soundReview() {
  const container=$('sound-review-words');container.replaceChildren();
  for(const id of phrase.word_ids){
    const word=reference.words[id], card=node('div',undefined,'sound-card');card.dataset.wordId=id;
    card.append(node('h3',`${word.text} · ${id}`));
    const extracted=node('p',`Extracted draft: / ${word.extracted_labels.join(' ')} /`,'sound-label');card.append(extracted);
    const warning=node('p',`Not human-verified. ${word.uncertainty.context_disagreement?'Full-clip and short-context labels disagree. ':''}${word.uncertainty.near_word_boundary?'Some emissions are near estimated word boundaries.':''}`,'hint');card.append(warning);
    const replay=node('button','▶ Replay reference word'), context=node('button','Hear phrase context');
    replay.onclick=()=>playTeacher(Math.max(0,word.start-.1),word.end+.1).catch(e=>status(e.message));context.onclick=()=>playTeacher(phrase.context_start,phrase.context_end).catch(e=>status(e.message));card.append(replay,document.createTextNode(' '),context);
    const correction=node('label','Optional corrected model labels (space separated)'), input=node('input');input.type='text';input.dataset.field='labels';input.value=review.words[id]?.corrected_labels?.join(' ')||'';correction.append(input);
    const notesLabel=node('label','Ordinary-language correction / examples / replay notes'),notes=node('textarea');notes.maxLength=4000;notes.dataset.field='notes';notes.value=review.words[id]?.notes||'';notesLabel.append(notes);
    const checkedLabel=node('label'),check=node('input');check.type='checkbox';check.dataset.field='reviewed';check.checked=review.words[id]?.reviewed||false;checkedLabel.append(check,document.createTextNode(' I listened and reviewed this draft / correction'));
    const save=node('button','Save this sound review');
    save.onclick=()=>{try{const labels=input.value.trim()?input.value.trim().split(/\s+/u):null;const candidate=structuredClone(review);candidate.words[id]={corrected_labels:labels,notes:notes.value,reviewed:check.checked};validReview(candidate);review=candidate;saveReview();}catch(e){$('sound-status').textContent=e.message;}};
    card.append(correction,notesLabel,checkedLabel,save);container.append(card);
  }
}
function ratings() {
  $('rating-words').replaceChildren();
  for(const id of phrase.word_ids){
    const card=node('div',undefined,'rating-card');card.dataset.wordId=id;card.append(node('strong',`${reference.words[id].text} · ${id}`));
    const fields=[['heard','Word judgement',['','acceptable','needs_practice','unable_to_judge']],['severity','Severity',['','none','minor','major','unable_to_judge']],['rating','Uchaaran rating (1–5)',['','1','2','3','4','5']],['sound_type','Heard sound event',['','none','substitution','deletion','insertion','vowel_length','localized_difference','unable_to_judge']]];
    for(const [name,label,options] of fields){const l=node('label',label),s=node('select');s.dataset.field=name;for(const o of options){const option=node('option',o||'Unrated');option.value=o;s.append(option);}l.append(s);card.append(l);}
    for(const [name,label] of [['sound','Sound heard / expected (ordinary language is fine)'],['notes','Listening notes; intended mistake, if any, recorded separately here']]){const l=node('label',label),t=node('textarea');t.dataset.field=name;t.maxLength=4000;l.append(t);card.append(l);}
    $('rating-words').append(card);
  }
}
function setPhrase() {
  generation++;discard();phrase=reference.phrases.find(p=>p.id===$('phrase').value);$('phrase-text').textContent=phrase.text;
  soundReview();ratings();status('Listen, then record one phrase. Reference labels and timings await human review.');
}
function controls(){
  $('record-student').disabled=!!recorder||busy;$('stop-record').disabled=!recorder||recorder.state!=='recording';
  $('compare').disabled=!studentWav||busy||!!recorder;$('retry').disabled=!studentWav||busy||!!recorder;
  $('phrase').disabled=busy||!!recorder;$('student-file').disabled=busy||!!recorder;
  $('download-student').disabled=!studentWav||busy||!!recorder;
}
function discard() {
  stopAll();if(studentUrl){URL.revokeObjectURL(studentUrl);studentUrl=null;}studentBuffer=studentWav=null;studentPlayer.removeAttribute('src');studentPlayer.hidden=true;
  invalidateResult();attemptId=null;hasSeenEvidence=false;controls();
}
function encodeWav(samples){
  const out=new ArrayBuffer(44+samples.length*2),v=new DataView(out);const str=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
  str(0,'RIFF');v.setUint32(4,36+samples.length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);
  samples.forEach((s,i)=>v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,s))* (s<0?32768:32767)),true));return out;
}
async function acceptAudio(blob,token){
  if(blob.size>20_000_000)throw Error('Choose a short phrase file smaller than 20 MB.');
  await audioContext();const decoded=await ctx.decodeAudioData(await blob.arrayBuffer());
  if(decoded.duration>15||decoded.duration<.1)throw Error('Record a phrase between 0.1 and 15 seconds.');
  const offline=new OfflineAudioContext(1,Math.round(decoded.duration*16000),16000),s=offline.createBufferSource();s.buffer=decoded;s.connect(offline.destination);s.start();const converted=await offline.startRendering();
  if(token!==generation)return;
  discard();studentBuffer=converted;studentWav=encodeWav(converted.getChannelData(0));attemptId=crypto.randomUUID();
  studentUrl=URL.createObjectURL(new Blob([studentWav],{type:'audio/wav'}));studentPlayer.src=studentUrl;studentPlayer.hidden=false;
  ratings();status(`Recorded ${converted.duration.toFixed(2)} s. Replay, then compare locally. Nothing saved to the server.`);controls();
}
async function record(){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){status('Microphone recording requires a supported browser on localhost. You can choose a short audio file.');return;}
  const token=++generation;discard();status('Requesting microphone access…');busy=true;controls();
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    if(token!==generation){stream.getTracks().forEach(t=>t.stop());return;}
    stopAll();recordingPhrase=phrase.id;const chunks=[];recorder=new MediaRecorder(stream);
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=async()=>{clearTimeout(timer);document.dispatchEvent(new CustomEvent('uchaaran-recording',{detail:false}));stream?.getTracks().forEach(t=>t.stop());stream=null;recorder=null;busy=true;controls();try{if(recordingPhrase===phrase.id)await acceptAudio(new Blob(chunks,{type:chunks[0]?.type||'audio/webm'}),token);}catch(e){status(`Recording could not be used: ${e.message}`);}finally{busy=false;controls();}};
    recorder.onerror=()=>{status('Microphone recording failed. Retry or choose an audio file.');if(recorder?.state==='recording')recorder.stop();};
    recorder.start();document.dispatchEvent(new CustomEvent('uchaaran-recording',{detail:true}));timer=setTimeout(()=>{if(recorder?.state==='recording')recorder.stop();},14500);status('Recording… speak the selected phrase, then press Stop. Maximum 14.5 seconds.');
  }catch(e){stream?.getTracks().forEach(t=>t.stop());stream=null;status(`Microphone unavailable: ${e.message}. You can choose a short audio file.`);}
  finally{busy=false;controls();}
}
function fmt(value){return value===null||value===undefined?'—':value.toFixed(3);}
function showResult(){
  hasSeenEvidence=true;
  const container=$('practice-results');container.replaceChildren();
  container.append(node('p',result.message));
  if(result.phone_sequence_agreement_index!==undefined&&result.phone_sequence_agreement_index!==null)container.append(node('p',`Experimental phone-label agreement: ${result.phone_sequence_agreement_index} / 100. This is not a pronunciation grade.`));
  container.append(node('p',`Capture: ${result.quality.rms_dbfs} dBFS · ${(100*result.quality.clipping_fraction).toFixed(2)}% clipped. Uncertainty is separate from model agreement.`,'hint'));
  for(const word of result.words){
    const card=node('article',undefined,'result-card');card.append(node('h3',`${word.text} · ${word.word_id}`));
    const counts=word.counts,changes=counts.substitution+counts.deletion+counts.insertion;
    card.append(node('p',changes?`Possible localized difference: ${counts.substitution} substituted, ${counts.deletion} missing, ${counts.insertion} extra model labels. Listen before deciding.`:'The model labels agree here. This does not certify pronunciation.'));
    const wr=reference.words[word.word_id],refButton=node('button','▶ Ustaad word'),learner=node('button','▶ Your word (approximate)');
    refButton.onclick=()=>playTeacher(Math.max(0,wr.start-.1),wr.end+.1).catch(e=>status(e.message));learner.disabled=word.student_start===null;learner.onclick=()=>playSegment(studentBuffer,word.student_start,word.student_end).catch(e=>status(e.message));card.append(refButton,document.createTextNode(' '),learner);
    card.append(node('p',`Word label agreement ${word.phone_label_agreement_index} / 100 · mean expected-label emission evidence ${fmt(word.mean_expected_emission_posterior)} · weakest ${fmt(word.weakest_expected_emission_posterior)}. These are experimental features, not correctness probabilities.`,'hint'));
    const details=node('details'),summary=node('summary','Inspect sound hypotheses');details.append(summary);
    details.append(node('p','“Expected” is the recording-derived draft or your reviewed correction. Missing sounds have no invented acoustic span. A substitution label is a model hypothesis, not an established sound diagnosis.','hint'));
    const table=node('table',undefined,'evidence-table'),head=node('tr');for(const t of ['Event','Expected','Observed','Expected vs alternative log odds'])head.append(node('th',t));table.append(head);
    for(const op of word.operations){const row=node('tr');for(const value of [op.kind,op.expected||'—',op.observed||'—',fmt(op.log_odds_expected_vs_best_alternative)])row.append(node('td',value));table.append(row);}details.append(table);card.append(details);
    card.append(node('p',word.uncertainty.join(' '),'hint'));container.append(card);
  }
  container.append(node('p','Replay the phrase or word and retry. No speed score, pass threshold, or forced “weakest word” error. Long-vowel labels remain distinct; this model does not reliably measure vowel duration.','hint'));
}
async function compare(){
  if(!studentWav||busy)return;busy=true;controls();stopAll();const token=generation;status('Extracting phones on this computer… first run loads the model and may take a minute.');
  try{
    const bytes=new Uint8Array(studentWav);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const response=await fetch('/api/learn/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phrase_id:phrase.id,audio_base64:btoa(binary),review})});
    if(!response.ok){let message='';try{message=(await response.json()).error;}catch{}throw Error(message||'Start the local analysis server: see README.md. The static timing server cannot analyze recordings.');}
    const value=await response.json();if(token!==generation)return;result=value;showResult();$('download-result').disabled=false;status(`Analysis complete · ${result.status}. Human validation pending.`);
  }catch(e){status(`Comparison unavailable: ${e.message}`);}finally{busy=false;controls();}
}
async function init(){
  const response=await fetch('/data/reference/reference-phones.json');if(!response.ok)throw Error('Run extract_phones.py to create the audio-derived draft.');reference=await response.json();
  review={schema_version:1,reference_sha256:reference.reference_sha256,words:{}};
  try{const saved=localStorage.getItem(reviewKey);if(saved)review=validReview(JSON.parse(saved));}catch{$('sound-status').textContent='Saved review was stale or invalid; using unchanged extracted labels.';}
  for(const p of reference.phrases){const option=node('option',p.text);option.value=p.id;$('phrase').append(option);}$('phrase').value=reference.default_phrase_id;setPhrase();
  $('inventory-audit').textContent=JSON.stringify({model:reference.model,coverage:reference.inventory_audit,limitations:reference.limitations},null,2);
  $('phrase').onchange=setPhrase;$('listen-phrase').onclick=()=>playTeacher(phrase.start,phrase.end).catch(e=>status(e.message));$('listen-phrase-context').onclick=()=>playTeacher(phrase.context_start,phrase.context_end).catch(e=>status(e.message));$('stop-practice').onclick=stopAll;
  $('record-student').onclick=record;$('stop-record').onclick=()=>{if(recorder?.state==='recording')recorder.stop();};$('compare').onclick=compare;$('retry').onclick=()=>{generation++;discard();ratings();status('Attempt discarded from this tab. Listen and record again.');};
  $('student-file').onchange=async()=>{const file=$('student-file').files[0];if(!file)return;const token=++generation;discard();busy=true;controls();try{await acceptAudio(file,token);}catch(e){status(e.message);}finally{busy=false;controls();$('student-file').value='';}};
  studentPlayer.onplay=()=>{document.dispatchEvent(new Event('uchaaran-teacher-stop'));if(playing){try{playing.stop();}catch{}playing=null;}};
  $('download-student').onclick=()=>download(new Blob([studentWav],{type:'audio/wav'}),`attempt-${attemptId}.wav`);
  $('download-result').onclick=()=>download({...result,attempt_id:attemptId},`evidence-${attemptId}.json`);
  $('export-sounds').onclick=()=>download(review,'reference-sound-review.json');
  $('import-sounds').onchange=async()=>{try{const file=$('import-sounds').files[0];if(!file)return;const candidate=validReview(JSON.parse(await file.text()));review=candidate;saveReview();soundReview();$('sound-status').textContent='Sound review imported; original extraction preserved.';}catch(e){$('sound-status').textContent=`Import rejected: ${e.message}`;}finally{$('import-sounds').value='';}};
  $('export-ratings').onclick=async()=>{
    if(!studentWav){$('rating-status').textContent='Record or choose an attempt first. Blank worksheets are not collected ratings.';return;}
    const speaker=$('eval-speaker').value.trim();if(!speaker){$('rating-status').textContent='Enter a pseudonymous speaker code to keep calibration and evaluation speakers separate.';return;}
    const digest=await crypto.subtle.digest('SHA-256',studentWav),audioHash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
    const rows=[...document.querySelectorAll('.rating-card')].map(card=>({word_id:card.dataset.wordId,...Object.fromEntries([...card.querySelectorAll('[data-field]')].map(n=>[n.dataset.field,n.value||null]))}));
    download({schema_version:1,attempt_id:attemptId,audio_file:`attempt-${attemptId}.wav`,audio_sha256:audioHash,speaker_id:speaker,split:$('eval-split').value,attempt_type:$('eval-type').value,phrase_id:phrase.id,reference_sha256:reference.reference_sha256,ratings:rows,model_evidence_file:result?`evidence-${attemptId}.json`:null,blind_rating:!hasSeenEvidence,created_at:new Date().toISOString()},`ratings-${attemptId}.json`);
    $('rating-status').textContent='Worksheet downloaded. Download the matching audio only if you choose to retain it.';
  };
  window.addEventListener('pagehide',()=>{clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());if(studentUrl)URL.revokeObjectURL(studentUrl);});
}
init().catch(e=>{status(`Practice setup: ${e.message} Timing review below remains available.`);$('record-student').disabled=true;});
