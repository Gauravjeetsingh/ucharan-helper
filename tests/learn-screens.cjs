// Synthetic comparison responses test the UI, not acoustic accuracy.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path'), os = require('node:os');
const lesson = require('../data/lessons/japji-sahib-full.json');
const base = process.env.APP_URL || 'http://127.0.0.1:8767';
(async () => {
  const browser = await chromium.launch({headless:true, args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'], ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
  try {
    const context = await browser.newContext({permissions:['microphone'],viewport:{width:1280,height:1000}});
    const page = await context.newPage(), errors=[], external=[];
    page.on('pageerror', e=>errors.push(e.message));
    page.on('request', r=>{if(new URL(r.url()).origin!==new URL(base).origin) external.push(r.url());});
    await page.addInitScript(()=>{
      // Supply stable microphone energy for recording/UI tests; Chrome's default
      // fake microphone can be silent and is unsuitable for speech endpointing.
      navigator.mediaDevices.getUserMedia=async()=>{
        const ctx=new AudioContext();await ctx.resume();
        const source=ctx.createOscillator(),gain=ctx.createGain(),destination=ctx.createMediaStreamDestination();
        gain.gain.value=.2;source.connect(gain);gain.connect(destination);source.start();
        for(const track of destination.stream.getTracks()){
          const stop=track.stop.bind(track);
          track.stop=()=>{stop();source.stop();ctx.close();};
        }
        return destination.stream;
      };
      window.audioStarts=[];
      const start=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(...args){window.audioStarts.push(args);return start.apply(this,args);};
    });
    let mode='differences',release;
    const gate=new Promise(resolve=>{release=resolve;});
    await page.route('**/api/learn/screens/compare',async route=>{
      const input=route.request().postDataJSON(), wav=Buffer.from(input.audio_base64,'base64');
      assert.equal(input.lesson_id,lesson.id);assert.equal(input.screen_id,lesson.screens[0].id);
      assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.readUInt16LE(22),1);
      await gate;
      const words=lesson.screens[0].words.map((w,i)=>({...w,state:mode==='below' || i===1&&mode==='differences'?'wrong':'correct',reason:i===1?'The final sound was missing in your recording.':'',ustaad_heard:w.text,ustaad_says:w.text,student_heard:i===1?'ਸ':w.text,student_start:0,student_end:.5})).reverse();
      await route.fulfill({json:mode==='unclear'?{status:'unclear',words:[],message:'The recording was too quiet to compare.'}:{status:'judged',words,experimental:true,calibrated:false,message:'4 of 5 words matched the ustaad.',score:80}});
    });
    await page.goto(`${base}/learn`);await page.waitForSelector('.lp-word');
    assert.equal(await page.locator('select').count(),0);
    assert.equal(await page.locator('.lp-word').count(),lesson.screens[0].words.length);
    assert.equal(await page.locator('#lp-progress').innerText(),`Pankti 1 / ${lesson.screens.length}`);
    assert.equal(await page.locator('#lp-record').isDisabled(),false);assert.equal(await page.locator('#lp-next').isDisabled(),true);
    assert.equal(await page.locator('.lp-segment').count(),5);
    assert.equal(await page.locator('.lp-segment.is-reached').count(),0);
    assert.equal(await page.locator('#lp-segments').getAttribute('aria-valuemax'),'5');
    assert.equal(await page.locator('#lp-coins').innerText(),'0');
    assert.equal(await page.locator('#lp-streak-message').innerText(),'5 more to go for Nanak Coin');
    assert.equal(await page.locator('.lp-word.correct,.lp-word.wrong').count(),0);
    await page.screenshot({path:path.join(os.tmpdir(),'uchaaran-learn-desktop.png'),fullPage:true});
    // Listening is optional; recording can interrupt word or full-reference playback.
    await page.locator('.lp-word').first().click();await page.waitForFunction(()=>document.getElementById('lp-screen').dataset.phase==='listening');
    assert.equal(await page.locator('#lp-record').isDisabled(),false);
    await page.locator('#lp-listen').click();await page.locator('#lp-listen').click();
    await page.waitForFunction(()=>document.querySelector('.lp-word.is-playing'));
    assert.equal(await page.locator('#lp-wave').isVisible(),true);assert.equal(await page.locator('#lp-record').isDisabled(),false);
    await page.waitForFunction(()=>document.getElementById('lp-screen').dataset.phase==='ready',null,{timeout:15000});
    assert.ok((await page.evaluate(()=>window.audioStarts)).some(a=>a[1]===lesson.screens[0].start&&Math.abs(a[2]-(lesson.screens[0].end-lesson.screens[0].start))<.001));
    await page.locator('#lp-record').click();await page.waitForFunction(()=>document.getElementById('lp-screen').dataset.phase==='recording');
    assert.equal(await page.locator('#lp-wave').isVisible(),true);assert.equal(await page.locator('#lp-stop-icon').isVisible(),true);assert.equal(await page.locator('#lp-mic-icon').isVisible(),false);assert.equal(await page.locator('.lp-word.correct,.lp-word.wrong').count(),0);
    await page.waitForTimeout(1000);
    const comparison=page.waitForRequest('**/api/learn/screens/compare');await page.locator('#lp-record').click();await comparison;
    assert.equal(await page.locator('#lp-record').isDisabled(),true);release();
    await page.waitForSelector('.lp-issue');
    assert.equal(await page.locator('.lp-word.correct').count(),lesson.screens[0].words.length-1);
    assert.equal(await page.locator('.lp-word.wrong').getAttribute('data-word-id'),lesson.screens[0].words[1].id);assert.equal(await page.locator('.lp-issue').getAttribute('data-word-id'),lesson.screens[0].words[1].id);
    assert.match(await page.locator('.lp-issue').innerText(),/final sound was missing/);assert.equal(await page.locator('#lp-next').isDisabled(),false);
    assert.match(await page.locator('.lp-heard').innerText(),/Ustaad says:/);
    assert.equal(await page.locator('.lp-segment.is-reached').count(),1);
    assert.equal(await page.locator('#lp-streak-message').innerText(),'4 more to go for Nanak Coin');
    assert.doesNotMatch(await page.locator('body').innerText(),/%|4 of 5|80|ustaad.s tip/i);
    await page.locator('.lp-issue .lp-text-button').last().click();await page.waitForFunction(()=>document.getElementById('lp-screen').dataset.phase==='student-playback');
    const download=page.waitForEvent('download');await page.locator('#lp-save').click();assert.match((await download).suggestedFilename(),/\.wav$/);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(os.tmpdir(),'uchaaran-learn-feedback-mobile.png'),fullPage:true});
    for(const size of [{width:390,height:844},{width:320,height:650}]) {
      await page.setViewportSize(size);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const box=await page.locator('.lp-controls').boundingBox();assert.ok(box.y+box.height<=size.height);
    }
    mode='unclear';await page.locator('#lp-record').click();await page.waitForFunction(()=>document.getElementById('lp-screen').dataset.phase==='recording');
    await page.waitForTimeout(800);await page.locator('#lp-record').click();await page.waitForSelector('.lp-error');
    assert.equal(await page.locator('.lp-word.correct,.lp-word.wrong,.lp-issue').count(),0);assert.match(await page.locator('#lp-feedback').innerText(),/too quiet/);assert.equal(await page.locator('#lp-next').isDisabled(),true);
    assert.equal(await page.locator('.lp-segment.is-reached').count(),1,'Unclear assessment preserves streak');
    mode='success';await page.locator('#lp-record').click();await page.waitForFunction(()=>document.getElementById('lp-screen').dataset.phase==='recording');
    await page.waitForTimeout(800);await page.locator('#lp-record').click();await page.waitForFunction(()=>document.getElementById('lp-feedback-title').textContent==='Lovely work!');
    assert.equal(await page.locator('.lp-word.correct').count(),lesson.screens[0].words.length);
    assert.equal(await page.locator('.lp-segment.is-reached').count(),2);
    assert.equal(await page.locator('#lp-streak-message').innerText(),'3 more to go for Nanak Coin');
    await page.locator('#lp-next').click();
    assert.equal(await page.locator('#lp-feedback').isVisible(),false);assert.equal(await page.locator('#lp-attempt-actions').isVisible(),false);assert.equal(await page.locator('#lp-record').isDisabled(),false);
    assert.equal(await page.locator('#lp-progress').innerText(),`Pankti 2 / ${lesson.screens.length}`);
    await page.locator('#lp-listen').click();await page.waitForFunction(()=>document.querySelector('.lp-word.is-playing'));
    const lastStart=(await page.evaluate(()=>window.audioStarts)).at(-1);
    assert.ok(lastStart[1]>=0&&lastStart[1]<.2,'A later phrase uses the bounded clip offset');
    await page.locator('#lp-listen').click();
    await page.locator('#lp-back').click();
    assert.equal(await page.locator('#lp-progress').innerText(),`Pankti 1 / ${lesson.screens.length}`);
    const closing=await context.request.get(`${base}/api/learn/screens/audio?lesson_id=${lesson.id}&screen_id=${lesson.screens.at(-1).id}`);
    assert.equal(closing.ok(),true);assert.ok(Number(closing.headers()['x-audio-start'])>1600);assert.ok((await closing.body()).length<500000);
    assert.equal(await page.locator('.lp-segment.is-reached').count(),2,'Navigation does not count as a turn');
    await page.locator('#lp-listen').click();
    await page.waitForFunction(()=>!document.getElementById('lp-record').disabled,null,{timeout:15000});
    async function recordTurn(nextMode) {
      mode=nextMode;
      await page.locator('#lp-record').click();
      await page.waitForFunction(()=>document.getElementById('lp-screen').dataset.phase==='recording');
      await page.waitForTimeout(800); await page.locator('#lp-record').click();
      await page.waitForFunction(()=>document.getElementById('lp-screen').dataset.phase==='result');
    }
    await recordTurn('below');
    assert.equal(await page.locator('.lp-segment.is-reached').count(),0);
    assert.equal(await page.locator('#lp-streak-message').innerText(),'5 more to go for Nanak Coin');
    for(let turn=1;turn<=5;turn++) {
      await recordTurn('success');
      assert.equal(await page.locator('.lp-segment.is-reached').count(),turn);
      assert.equal(await page.locator('#lp-segments').getAttribute('aria-valuenow'),String(turn));
      assert.equal(await page.locator('#lp-coins').innerText(),'0','Counter waits for the coin to arrive');
      if(turn===2) await page.screenshot({path:path.join(os.tmpdir(),'uchaaran-learn-streak-mobile.png'),fullPage:true});
    }
    assert.match(await page.locator('#lp-streak-message').innerText(),/\+1 Nanak Coin/);
    assert.equal(await page.locator('.celebration-petal').count(),72);
    assert.equal(await page.locator('.celebration-coin').isVisible(),true);
    const origin=await page.locator('.celebration-coin').evaluate(el=>{
      const style=getComputedStyle(el), layer=el.parentElement.getBoundingClientRect();
      return {x:parseFloat(style.left),y:parseFloat(style.top),width:layer.width,height:layer.height};
    });
    assert.ok(Math.abs(origin.x-origin.width/2)<1&&Math.abs(origin.y-(origin.height-75))<1,'Coin starts at the bottom of the phone screen');
    await page.waitForTimeout(650);
    await page.screenshot({path:path.join(os.tmpdir(),'uchaaran-learn-petals.png'),fullPage:true});
    await page.waitForFunction(()=>document.getElementById('lp-coins').value==='1');
    assert.equal(await page.locator('.lp-segment.is-reached').count(),0);
    assert.equal(await page.locator('#lp-segments').getAttribute('aria-valuenow'),'0');
    assert.equal(await page.locator('#lp-streak-message').innerText(),'5 more to go for Nanak Coin');
    await page.screenshot({path:path.join(os.tmpdir(),'uchaaran-learn-coin-earned.png'),fullPage:true});
    await page.locator('.lp-word').first().click();
    assert.equal(await page.locator('#lp-coins').innerText(),'1','Re-rendering feedback never awards again');
    assert.equal(await page.locator('.lp-segment.is-reached').count(),0);
    await page.locator('#lp-listen').click();
    await recordTurn('success');
    assert.equal(await page.locator('.lp-segment.is-reached').count(),1);
    assert.equal(await page.locator('#lp-coins').innerText(),'1');
    await page.reload();await page.waitForSelector('.lp-word');
    assert.equal(await page.locator('.lp-segment.is-reached').count(),1);
    assert.equal(await page.locator('#lp-coins').innerText(),'1');
    // A second award survives leaving the phrase before the flight ends.
    await page.locator('#lp-listen').click();
    await page.waitForFunction(()=>!document.getElementById('lp-record').disabled,null,{timeout:15000});
    for(let turn=0;turn<4;turn++) await recordTurn('success');
    assert.equal(await page.locator('.celebration-coin').count(),1);
    await page.locator('#lp-next').click();
    assert.equal(await page.locator('#lp-coins').innerText(),'2');
    assert.equal(await page.locator('.lp-segment.is-reached').count(),0);
    assert.equal(await page.locator('.celebration-petal,.celebration-coin').count(),0);
    // Reduced motion collects and resets immediately, with no animated layer.
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>sessionStorage.setItem('uchaaran-learn-streak','4'));
    await page.reload();await page.waitForSelector('.lp-word');
    await page.locator('#lp-listen').click();
    await page.waitForFunction(()=>!document.getElementById('lp-record').disabled,null,{timeout:15000});
    await recordTurn('success');
    assert.equal(await page.locator('#lp-coins').innerText(),'3');
    assert.equal(await page.locator('.lp-segment.is-reached').count(),0);
    assert.equal(await page.locator('.celebration-petal,.celebration-coin').count(),0);
    await page.reload();await page.waitForSelector('.lp-word');
    assert.equal(await page.locator('#lp-coins').innerText(),'3');
    assert.equal(await page.locator('.lp-segment.is-reached').count(),0);
    await page.goto(base+'/follow');await page.waitForFunction(()=>!document.getElementById('play').disabled);
    assert.equal(await page.locator('#points').innerText(),'3','Learn and Follow share the coin total');
    for(const file of ['', '?file=pronunciation-cards-japji.json']) {
      await page.goto(`${base}/apps/learn/cards.html${file}`);await page.waitForSelector('.word-card');
      assert.equal(await page.locator('link[href="/apps/learn/cards.css"]').count(),1);
      assert.equal(await page.locator('link[href="/apps/learn/screens.css"]').count(),0);
      assert.ok(await page.locator('.word-card').count()>0);
    }
    await page.route('**/api/status',route=>route.fulfill({json:{local_only:false}}));
    await page.goto(base+'/learn');await page.locator('#lp-hosted-privacy').waitFor({state:'visible'});
    assert.match(await page.locator('#lp-hosted-privacy').innerText(),/checked on this server/);
    const controls=await page.locator('.lp-controls').boundingBox();assert.ok(controls.y+controls.height<=650);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log(`PASS: Learn playback, capture/WAV, ID-based red/green feedback, unclear retry, replay/download, reset, mobile layout, five-turn streak/reset/reward, falling petals and rising coin, interrupted/reduced-motion collection, shared coins, new lesson and isolated card reviews. Screenshots: ${os.tmpdir()}/uchaaran-learn-{desktop,feedback-mobile}.png`);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
