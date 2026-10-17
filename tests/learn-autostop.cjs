// Synthetic microphone energy tests endpointing and UI flow, not speech accuracy.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const lesson = require('../data/lessons/japji-sahib-full.json');
const base = process.env.APP_URL || 'http://127.0.0.1:8767';
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844}}), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      navigator.mediaDevices.getUserMedia=async()=>{
        const ctx=new AudioContext();await ctx.resume();
        const source=ctx.createOscillator(),gain=ctx.createGain(),destination=ctx.createMediaStreamDestination();
        gain.gain.value=0;source.connect(gain);gain.connect(destination);source.start();
        window.testMic={gain,ctx,stream:destination.stream};
        for(const track of destination.stream.getTracks()) {
          const stop=track.stop.bind(track);
          track.stop=()=>{stop();source.stop();ctx.close();};
        }
        return destination.stream;
      };
    });
    let comparisons=0;
    await page.route('**/api/learn/screens/compare',async route=>{
      comparisons++;
      const input=route.request().postDataJSON();
      assert.equal(input.screen_id,lesson.screens[0].id);
      await route.fulfill({json:{status:'judged',words:lesson.screens[0].words.map(word=>({...word,state:'correct'}))}});
    });
    await page.goto(base+'/learn');await page.waitForSelector('.lp-word');
    assert.equal(await page.locator('#lp-record').isEnabled(),true);
    const record=async()=>{
      await page.locator('#lp-record').click();
      await page.waitForFunction(()=>document.getElementById('lp-screen').dataset.phase==='recording');
    };
    const volume=async value=>page.evaluate(value=>window.testMic.gain.gain.setValueAtTime(value,window.testMic.ctx.currentTime),value);
    await record(); // No ustaad playback before this first recording.
    await page.waitForTimeout(1700);
    assert.equal(await page.locator('#lp-screen').getAttribute('data-phase'),'recording','Initial silence does not stop');
    await volume(.2);await page.waitForTimeout(100);await volume(0);await page.waitForTimeout(1700);
    assert.equal(await page.locator('#lp-screen').getAttribute('data-phase'),'recording','A brief click does not arm automatic stopping');
    await volume(.2);await page.waitForTimeout(650);
    await volume(0);await page.waitForTimeout(700);
    assert.equal(await page.locator('#lp-screen').getAttribute('data-phase'),'recording','Short pauses within a phrase do not stop');
    await volume(.2);await page.waitForTimeout(400);await volume(0);
    await page.waitForFunction(()=>document.getElementById('lp-screen').dataset.phase==='result',null,{timeout:5000});
    assert.equal(comparisons,1,'One automatic stop creates one comparison');
    assert.equal(await page.evaluate(()=>window.testMic.stream.getTracks().every(track=>track.readyState==='ended')),true);
    assert.equal(await page.locator('#lp-mic-icon').isVisible(),true);
    assert.equal(await page.locator('#lp-stop-icon').isVisible(),false);
    // Recording can interrupt the reference; manual stop is still supported.
    await page.locator('#lp-listen').click();
    await page.waitForFunction(()=>document.getElementById('lp-screen').dataset.phase==='listening');
    assert.equal(await page.locator('#lp-record').isEnabled(),true);
    await record();assert.equal(await page.locator('.lp-word.is-playing').count(),0);
    await volume(.2);await page.waitForTimeout(650);await page.locator('#lp-record').click();
    await page.waitForFunction(()=>document.getElementById('lp-screen').dataset.phase==='result');
    assert.equal(comparisons,2);
    // An empty attempt asks for a retry and never sends silence for grading.
    await record();await page.waitForTimeout(500);await page.locator('#lp-record').click();
    await page.waitForFunction(()=>document.getElementById('lp-screen').dataset.phase==='error');
    assert.match(await page.locator('#lp-feedback').innerText(),/hear your voice/);
    assert.equal(comparisons,2);
    // Leaving while recording tears down the detector and never submits a late attempt.
    await record();await volume(.2);await page.waitForTimeout(400);
    await page.locator('.practice-home').click();await page.waitForTimeout(1800);
    assert.equal(comparisons,2);assert.deepEqual(errors,[]);
    console.log('PASS: record immediately, interrupt ustaad, initial silence/noise protection, pause-based auto-stop, manual stop, empty retry, microphone cleanup, no late submission.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
