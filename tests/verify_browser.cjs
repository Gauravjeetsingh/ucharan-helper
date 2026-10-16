const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1320,height:1100}}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.segmentCalls=[];
      const original=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(when,offset,duration){
        const record={offset,duration,started:this.context.currentTime};window.segmentCalls.push(record);
        this.addEventListener('ended',()=>record.ended=this.context.currentTime);
        return original.call(this,when,offset,duration);
      };
    });
    await page.goto('http://127.0.0.1:8767/apps/learn/lab.html');
    await page.waitForSelector('.word');
    assert.equal(await page.locator('.word').count(),25);
    const source=JSON.parse(fs.readFileSync('data/reference/word-timings.json','utf8'));
    const rendered=await page.locator('.gurmukhi').allTextContents();
    assert.deepEqual(rendered,source.verses.map(v=>v.text));
    const last=source.verses[3].words[6];
    await page.locator('.word').last().click();
    await page.waitForFunction(()=>window.segmentCalls.length>0);
    await page.waitForFunction(()=>window.segmentCalls.at(-1).ended!==undefined);
    const call=await page.evaluate(()=>window.segmentCalls.at(-1));
    assert.equal(call.offset,last.start);assert.ok(Math.abs(call.duration-(last.end-last.start))<1e-8);
    assert.ok(Math.abs((call.ended-call.started)-call.duration)<.15,JSON.stringify(call));
    await page.locator('#start').fill(String(last.start+.02));await page.locator('#start').dispatchEvent('change');
    await page.locator('#reviewed').check();
    await page.reload();await page.waitForSelector('.word');await page.locator('.word').last().click();
    assert.equal(Number(await page.locator('#start').inputValue()),last.start+.02);
    assert.equal(await page.locator('#reviewed').isChecked(),true);
    const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;
    const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(exported.verses[3].words[6].reviewed,true);
    await page.locator('#coverage').selectOption('outside_audio');
    assert.equal(await page.locator('#replay').isDisabled(),true);
    const saved=JSON.parse(await page.evaluate(()=>localStorage.getItem('uchaaran-reference-review-v1')));
    assert.equal(saved.verses[3].words[6].start,null);assert.equal(saved.verses[3].words[6].end,null);
    await page.locator('#import').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
    await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Review imported'));
    const tampered=structuredClone(exported);tampered.verses[0].text+='x';
    await page.locator('#import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(tampered))});
    await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Import rejected'));
    await page.evaluate(()=>localStorage.clear());await page.reload();await page.waitForSelector('.word');
    await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(), 'uchaaran-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(), 'uchaaran-mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'PASS',sourceWordCount:25,exactUnicode:true,webAudioOffset:call.offset,webAudioDuration:call.duration,measuredEndSeconds:call.ended-call.started,editingPersistence:true,exportImport:true,tamperedSourceRejected:true,mobileOverflow:false}));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1);});
