const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.APP_URL || 'http://127.0.0.1:8767';
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:1000}}), errors=[];
    page.on('pageerror', error=>errors.push(error.message));
    await page.goto(base);
    assert.equal(new URL(page.url()).pathname, '/');
    await page.locator('.bani-card').click();
    assert.equal(await page.locator('.mode-card').count(),3);
    await page.goto(`${base}/timestamps`);
    assert.equal(await page.locator('.word, #sound-review, #record-student').count(), 0);
    await page.getByRole('button',{name:'Use the Japji Sahib sample'}).click();
    await page.waitForFunction(()=>!document.getElementById('existing').disabled);
    await page.getByRole('button',{name:'Load existing sample timings'}).click();
    await page.waitForFunction(()=>!document.getElementById('download').disabled);
    const artifact=JSON.parse(await page.locator('#output').textContent());
    assert.equal(artifact.verses.flatMap(v=>v.words).length,25);
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download JSON'}).click();
    assert.equal((await download).suggestedFilename(),'word-timings.json');
    await page.locator('#transcript').fill('ਸਤਿ ਨਾਮੁ');
    assert.equal(await page.locator('#download').isDisabled(),true);
    // Exercise browser decoding and request construction with a deterministic API stub.
    await page.route('**/api/timestamps/generate',async route=>{
      const input=route.request().postDataJSON();
      assert.ok(input.audio_base64.startsWith('UklGR'));
      assert.equal(input.text,'ਸਤਿ ਨਾਮੁ');
      await route.fulfill({json:{audio:{duration_seconds:30.76},words:[{text:'ਸਤਿ',start:1,end:2},{text:'ਨਾਮੁ',start:2,end:3}]}});
    });
    await page.getByRole('button',{name:'Generate timestamps',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Timestamps generated'));
    for (const route of ['follow','test','learn']) {
      await page.goto(`${base}/${route}`);
      await page.waitForSelector('.practice-home');
      if(route==='learn') await page.waitForSelector('.word');
      else if(route==='follow') await page.waitForSelector('.follow-word');
      else await page.waitForSelector('#test-text p');
    }
    await page.goto(`${base}/timestamps`);
    assert.equal(await page.locator('header').count(),1);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(), 'uchaaran-timestamps-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1280,height:1000});
    await page.reload();
    await page.waitForSelector('nav a[aria-current="page"]');
    await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(), 'uchaaran-timestamps-desktop.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: routes, isolated generator, sample JSON/export, browser WAV conversion, bani navigation, practice loading, mobile layout.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
