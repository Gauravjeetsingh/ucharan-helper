const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const os=require('node:os'),path=require('node:path');
const lesson=require('../data/lessons/japji-sahib-full.json');
const base=process.env.APP_URL||'http://127.0.0.1:8767';
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  try{
    const context=await browser.newContext({permissions:['microphone'],viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],uploads=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')uploads.push(r.url());});
    await page.goto(base+'/');await page.locator('.bani-card').click();
    assert.equal(new URL(page.url()).pathname,'/bani/japji-sahib');assert.equal(await page.locator('.mode-card').count(),3);
    for(const size of [{width:390,height:844},{width:320,height:650}]){
      await page.setViewportSize(size);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const card=await page.locator('.mode-card').last().boundingBox(),phone=await page.locator('.practice-phone').boundingBox();
      assert.ok(card.y+card.height<phone.y+phone.height,'All three modes fit inside the phone');
    }
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(os.tmpdir(),'uchaaran-unified-menu.png'),fullPage:true});
    await page.getByRole('link',{name:/2 Learn/}).click();await page.waitForSelector('.lp-word');
    assert.equal(await page.locator('select').count(),0);assert.equal(await page.locator('#lp-progress').innerText(),`Pankti 1 / ${lesson.screens.length}`);
    await page.getByRole('link',{name:'Back to Japji Sahib',exact:true}).click();
    await page.getByRole('link',{name:/1 Follow along/}).click();await page.waitForFunction(()=>!document.getElementById('play').disabled);
    await page.waitForTimeout(250); // Allow the active-verse opacity transition to finish for the preview.
    await page.screenshot({path:path.join(os.tmpdir(),'uchaaran-unified-follow.png'),fullPage:true});
    await page.getByRole('link',{name:'Back to Japji Sahib',exact:true}).click();
    await page.getByRole('link',{name:/3 Test/}).click();await page.waitForSelector('#test-text p');
    const section=lesson.sections.find(s=>s.id==='pauri-1');
    assert.deepEqual(await page.locator('#test-text p').allTextContents(),lesson.verses.filter(v=>section.verse_ids.includes(v.verse_id)).map(v=>v.text));
    await page.screenshot({path:path.join(os.tmpdir(),'uchaaran-unified-test.png'),fullPage:true});
    await page.getByRole('button',{name:'Start reading',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('test-screen').dataset.phase==='recording');
    assert.equal(await page.locator('#test-stop').isVisible(),true);assert.equal(await page.locator('#test-mic').isVisible(),false);
    await page.waitForTimeout(800);await page.getByRole('button',{name:'Stop recording',exact:true}).click();
    await page.waitForSelector('#test-attempt:not([hidden])');assert.ok((await page.locator('#test-playback').getAttribute('src')).startsWith('blob:'));
    const download=page.waitForEvent('download');await page.locator('#test-save').click();assert.match((await download).suggestedFilename(),/^japji-pauri-1\./);
    await page.locator('#test-next').click();assert.match(await page.locator('#test-pauri').innerText(),/PAURI 2/);assert.equal(await page.locator('#test-attempt').isHidden(),true);
    await page.getByRole('link',{name:'All banis',exact:true}).click();assert.equal(await page.locator('#banis').isVisible(),true);
    assert.deepEqual(errors,[]);assert.deepEqual(uploads,[]);
    console.log('PASS: bani → three modes, shared navigation, phone fit, full Learn default, Test capture/download/reset without uploads.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
