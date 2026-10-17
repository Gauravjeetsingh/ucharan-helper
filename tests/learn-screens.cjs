// Synthetic comparison responses test the UI, not acoustic accuracy.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path'), os = require('node:os');
const lesson = require('../data/lessons/mool-mantar.json');
const base = process.env.APP_URL || 'http://127.0.0.1:8767';
(async () => {
  const browser = await chromium.launch({headless:true, args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'], ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
  try {
    const context = await browser.newContext({permissions:['microphone'],viewport:{width:1280,height:1000}});
    const page = await context.newPage(), errors=[], external=[];
    page.on('pageerror', e=>errors.push(e.message));
    page.on('request', r=>{if(new URL(r.url()).origin!==new URL(base).origin) external.push(r.url());});
    await page.addInitScript(()=>{
      window.audioStarts=[];
      const start=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(...args){window.audioStarts.push(args);return start.apply(this,args);};
    });
    let mode='differences',release;
    const gate=new Promise(resolve=>{release=resolve;});
    await page.route('**/api/learn/screens/compare',async route=>{
      const input=route.request().postDataJSON(), wav=Buffer.from(input.audio_base64,'base64');
      assert.equal(input.lesson_id,lesson.id);assert.equal(input.screen_id,'screen-1');
      assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.readUInt16LE(22),1);
      await gate;
      const words=lesson.screens[0].words.map((w,i)=>({...w,state:i===1?'wrong':'correct',reason:i===1?'The final sound was missing in your recording.':'',ustaad_heard:w.text,ustaad_says:w.text,student_heard:i===1?'ਸ':w.text,student_start:0,student_end:.5})).reverse();
      await route.fulfill({json:mode==='unclear'?{status:'unclear',words:[],message:'The recording was too quiet to compare.'}:{status:'judged',words,experimental:true,calibrated:false,message:'4 of 5 words matched the ustaad.',score:80}});
    });
    await page.goto(`${base}/learn`);await page.waitForSelector('.lp-word');
    await page.locator('.lp-options summary').click();await page.locator('#lp-lesson').selectOption('mool-mantar');
    await page.waitForFunction(()=>document.querySelectorAll('.lp-word').length===5);await page.locator('.lp-options summary').click();
    assert.equal(await page.locator('#lp-record').isDisabled(),true);assert.equal(await page.locator('#lp-next').isDisabled(),true);
    assert.equal(await page.locator('.lp-word.correct,.lp-word.wrong').count(),0);
    await page.screenshot({path:path.join(os.tmpdir(),'uchaaran-learn-desktop.png'),fullPage:true});
    // A word replay doesn't unlock the microphone; complete reference playback does.
    await page.locator('.lp-word').first().click();await page.waitForFunction(()=>document.getElementById('lp-screen').dataset.phase==='listening');
    assert.equal(await page.locator('#lp-record').isDisabled(),true);
    await page.locator('#lp-listen').click();await page.locator('#lp-listen').click();
    await page.waitForFunction(()=>document.querySelector('.lp-word.is-playing'));
    assert.equal(await page.locator('#lp-wave').isVisible(),true);assert.equal(await page.locator('#lp-record').isDisabled(),true);
    await page.waitForFunction(()=>!document.getElementById('lp-record').disabled,null,{timeout:15000});
    assert.ok((await page.evaluate(()=>window.audioStarts)).some(a=>a[1]===lesson.screens[0].start&&Math.abs(a[2]-(lesson.screens[0].end-lesson.screens[0].start))<.001));
    await page.locator('#lp-record').click();await page.waitForFunction(()=>document.getElementById('lp-screen').dataset.phase==='recording');
    assert.equal(await page.locator('#lp-wave').isVisible(),true);assert.equal(await page.locator('.lp-word.correct,.lp-word.wrong').count(),0);
    await page.waitForTimeout(1000);
    const comparison=page.waitForRequest('**/api/learn/screens/compare');await page.locator('#lp-record').click();await comparison;
    assert.equal(await page.locator('#lp-record').isDisabled(),true);release();
    await page.waitForSelector('.lp-issue');
    assert.equal(await page.locator('.lp-word.correct').count(),4);
    assert.equal(await page.locator('.lp-word.wrong').getAttribute('data-word-id'),'v1-w02');assert.equal(await page.locator('.lp-issue').getAttribute('data-word-id'),'v1-w02');
    assert.match(await page.locator('.lp-issue').innerText(),/final sound was missing/);assert.equal(await page.locator('#lp-next').isDisabled(),false);
    assert.match(await page.locator('.lp-heard').innerText(),/Ustaad says:/);
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
    await page.locator('.lp-options summary').click();await page.locator('#lp-shuffle').click();
    assert.equal(await page.locator('#lp-feedback').isVisible(),false);assert.equal(await page.locator('#lp-attempt-actions').isVisible(),false);assert.equal(await page.locator('#lp-record').isDisabled(),true);
    // Main's new lesson and review pages remain available without changing practice styling.
    await page.locator('#lp-lesson').selectOption('japji-sahib');
    await page.waitForSelector('.lp-word[data-word-id="jp001-w01"]');
    assert.equal(await page.locator('.lp-phone').count(),1);
    for(const file of ['', '?file=pronunciation-cards-japji.json']) {
      await page.goto(`${base}/apps/learn/cards.html${file}`);await page.waitForSelector('.word-card');
      assert.equal(await page.locator('link[href="/apps/learn/cards.css"]').count(),1);
      assert.equal(await page.locator('link[href="/apps/learn/screens.css"]').count(),0);
      assert.ok(await page.locator('.word-card').count()>0);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log(`PASS: Learn playback, capture/WAV, ID-based red/green feedback, unclear retry, replay/download, reset, mobile layout, new lesson and isolated card reviews. Screenshots: ${os.tmpdir()}/uchaaran-learn-{desktop,feedback-mobile}.png`);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
