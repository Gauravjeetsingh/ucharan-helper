// Offline browser contract check. API results here are explicit synthetic stubs,
// never claimed to be real Claude or acoustic-model output.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const base=process.env.APP_URL||'http://127.0.0.1:8767';
function wave(seconds=1,silent=false){
  const count=16000*seconds,b=Buffer.alloc(44+count*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*2,40);for(let i=0;i<count;i++)b.writeInt16LE(silent?0:Math.round(4000*Math.sin(i*2*Math.PI*220/16000)),44+i*2);return b;
}
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  try{
    const context=await browser.newContext({permissions:['microphone'],viewport:{width:1280,height:1000}}),page=await context.newPage();
    const errors=[],remote=[];let extracts=0,defines=0,fail=false,silent=false,stale=false;
    page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{if(!request.url().startsWith(base)&&!request.url().startsWith('blob:'))remote.push(request.url());});
    await page.addInitScript(()=>{window.segmentCalls=[];const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(when,offset,duration){if(duration!==undefined)window.segmentCalls.push({offset,duration});return start.call(this,when,offset,duration);};});
    const events=[{id:'sound-001',label:'s',start:.1,end:.15},{id:'sound-002',label:'aː',start:.2,end:.3}];
    const evidence={schema_version:1,status:'ready',audio:{sha256:'a'.repeat(64),duration_seconds:1},quality:{rms_dbfs:-20,clipping_fraction:0,reasons:[]},events,limitations:['Synthetic browser fixture.'],integrity:'synthetic'};
    await page.route('**/api/test/status',route=>route.fulfill({json:{configured:true,model:'synthetic-claude-test',acoustic_model_present:true}}));
    await page.route('**/api/test/extract',async route=>{extracts++;const input=route.request().postDataJSON();assert.ok(input.audio_base64.startsWith('UklGR'));assert.deepEqual(Object.keys(input),['audio_base64']);await route.fulfill({json:{evidence:silent?{...evidence,status:'re_record',events:[],quality:{...evidence.quality,reasons:['Synthetic silence.']}}:evidence,claude_payload_preview:{events:events.map(e=>({event_id:e.id,observed_label:e.label})),limitations:evidence.limitations}}});});
    await page.route('**/api/test/define',async route=>{defines++;const input=route.request().postDataJSON();assert.equal(input.consent_to_external_processing,true);assert.equal(input.evidence.audio.sha256,evidence.audio.sha256);assert.equal(input.audio_base64,undefined);if(stale)return route.fulfill({status:400,json:{error:'Extract sounds locally again; your recording is still in this tab.',error_code:'stale_learner_evidence'}});if(fail)return route.fulfill({status:503,json:{error:'Synthetic provider failure.'}});await route.fulfill({json:{schema_version:1,artifact_type:'learner_pronunciation_definition',status:'draft',audio:evidence.audio,human_verified:false,privacy:{audio_uploaded:false},definition:{summary:'Synthetic descriptions for UI verification.',groups:[{heard_word:null,grouping_note:'Tentative sound group.',start:0,end:.42,sounds:events.map((e,i)=>({event_id:e.id,observed_label:e.label,description:'Synthetic sound description.',english_examples:i?[]:[{word:'sun',focus:'s',accent_note:'Approximate English example.'}],uncertainty_note:'This is a test fixture.'}))}]}}});});
    await page.goto(`${base}/test`);await page.waitForFunction(()=>document.getElementById('configuration').textContent.includes('configured'));
    assert.equal(await page.locator('#define').isDisabled(),true);assert.equal(extracts,0);assert.equal(defines,0);
    await page.locator('#file').setInputFiles({name:'synthetic-tone.wav',mimeType:'audio/wav',buffer:wave()});await page.waitForFunction(()=>!document.getElementById('extract').disabled);
    assert.equal(extracts,0);await page.locator('#extract').click();await page.waitForFunction(()=>document.querySelectorAll('.sound-chip').length===2);
    assert.equal(defines,0);assert.equal(await page.locator('#define').isDisabled(),true);
    await page.locator('#consent').check();await page.locator('#define').click();await page.waitForFunction(()=>document.querySelectorAll('.sound-definition').length===2);
    assert.equal(await page.locator('.sound-example').textContent(),'Sun');assert.equal(await page.locator('.sound-example strong').textContent(),'S');
    await page.getByRole('button',{name:'▶ Replay this group'}).click();const call=await page.evaluate(()=>window.segmentCalls.at(-1));assert.equal(call.offset,0);assert.equal(call.duration,.42);
    const promise=page.waitForEvent('download');await page.locator('#download-definition').click();const download=await promise,result=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(result.privacy.audio_uploaded,false);assert.equal(result.human_verified,false);assert.equal(result.artifact_type,'learner_pronunciation_definition');
    await page.screenshot({path:path.join(os.tmpdir(),'uchaaran-learner-definitions-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(os.tmpdir(),'uchaaran-learner-definitions-mobile.png'),fullPage:true});
    fail=true;await page.locator('#define').click();await page.waitForFunction(()=>document.getElementById('definition-status').textContent.includes('Synthetic provider failure'));
    assert.equal(await page.locator('#download-definition').isDisabled(),true);assert.equal(await page.locator('.sound-definition').count(),0);
    stale=true;fail=false;await page.locator('#define').click();await page.waitForFunction(()=>document.getElementById('extract-status').textContent.includes('Your recording is still available'));
    assert.equal(await page.locator('#playback').isVisible(),true);assert.equal(await page.locator('#extract').isDisabled(),false);assert.equal(await page.locator('#consent').isChecked(),false);assert.equal(await page.locator('#define').isDisabled(),true);stale=false;
    await page.locator('#file').setInputFiles({name:'replacement.wav',mimeType:'audio/wav',buffer:wave()});await page.waitForFunction(()=>!document.getElementById('extract').disabled);
    assert.equal(await page.locator('#consent').isChecked(),false);assert.equal(await page.locator('#download-evidence').isDisabled(),true);
    silent=true;await page.locator('#extract').click();await page.waitForFunction(()=>document.getElementById('extract-status').textContent.includes('More reliable audio'));
    assert.equal(await page.locator('#consent').isDisabled(),true);
    await page.locator('#discard').click();assert.equal(await page.locator('#extract').isDisabled(),true);assert.equal(await page.locator('#playback').isHidden(),true);
    await page.locator('#file').setInputFiles({name:'too-long.wav',mimeType:'audio/wav',buffer:wave(16)});await page.waitForFunction(()=>document.getElementById('capture-status').textContent.includes('between 0.1 and 15'));
    await page.locator('#record').click();await page.waitForFunction(()=>document.getElementById('capture-status').textContent.includes('Recording…'));await page.waitForTimeout(1200);await page.locator('#stop-record').click();await page.waitForFunction(()=>!document.getElementById('extract').disabled);
    assert.equal(await page.locator('#playback').isVisible(),true);
    assert.equal(await page.evaluate(()=>localStorage.length),0);assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
    console.log('PASS: learner capture, WAV conversion, local/Claude stages, opt-in, highlighted examples, replay, JSON export, stale-result invalidation, provider failure, quality gating, microphone, and mobile layout. Synthetic API stubs only.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
