import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';

const site=process.env.SHARIKA_GAME_QA_URL||'http://127.0.0.1:8787';
const shots=process.env.GAME_UX_SCREENSHOT_DIR||'/tmp/sharika-premium-games-final';
mkdirSync(shots,{recursive:true});

function verifiedBridge(){
 if(window!==window.top)return;
 window.SharikaGameBridge={
  onmessage:null,
  postMessage(raw){
   const message=JSON.parse(raw);
   let data={balance:400000,coins:400000};
   if(message.path==='/api/v1/me')
    data={name:'QA Player',public_id:'10000011',display_id:'10000011',coins:400000};
   else if(message.path==='/api/v1/game-catalog')
    data={games:['royal-slots','royal-ace','cleopatra','greedy-classic','food-deluxe',
      'sovera-gaddy','sovera-food','night-food','greedy-wheel',
      'fruit-royale','jackpot-fruit'].map(id=>({id,enabled:true}))};
   queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({id:message.id,ok:true,data})}));
  }
 };
}

test('native Premium Games has one title, Royal Spotlight, three Hot Games and working search',
 {timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
  await ctx.addInitScript(verifiedBridge);
  const page=await ctx.newPage();
  await page.goto(site+'/?surface=app',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#toolbar-count')?.textContent==='11 Games');
  assert.equal(await page.locator('html.native-verified').count(),1);
  assert.equal(await page.locator('.app-toolbar .app-brand b').innerText(),'Premium Games');
  assert.equal(await page.locator('.catalog-title-row').isVisible(),false);
  assert.equal(await page.locator('.eyebrow').isVisible(),false);
  assert.equal(await page.locator('.notice').isVisible(),false);
  assert.equal(await page.locator('#catalog-profile').isVisible(),false);
  assert.equal(await page.locator('#royal-hero').isVisible(),true);
  assert.equal(await page.locator('#hot-section').isVisible(),true);
  assert.equal(await page.locator('.featured-game').count(),3);
  assert.equal(await page.locator('.tile').count(),11);
  assert.equal(await page.getByRole('heading',{name:'All Games'}).count(),1);
  const hero=await page.locator('.hero-award').allTextContents();
  assert.equal(hero.length,3);
  assert.ok(hero.some(x=>x.includes('FEATURED')));
  assert.ok(!hero.some(x=>/TOP[123]/.test(x)),'decorative awards must not fabricate rankings');
  await page.screenshot({path:join(shots,'premium-games-app-390.png'),fullPage:true});
  await page.getByRole('searchbox',{name:'Search games'}).fill('Greedy Wheel');
  assert.equal(await page.locator('.tile:visible').count(),1);
  assert.equal(await page.locator('#royal-hero').isVisible(),false);
  await page.getByRole('searchbox',{name:'Search games'}).fill('');
  await page.getByRole('button',{name:/Greedy Game · Play/}).click();
  await page.waitForFunction(()=>document.body.classList.contains('is-playing'));
  assert.equal(await page.locator('header').isVisible(),false);
  assert.equal(await page.locator('#game-profile').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.sharikaPremiumBack()),true,
   'Android system Back first closes the active game');
  assert.equal(await page.locator('#landing').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.sharikaPremiumBack()),false,
   'Second Android system Back exits Activity');
  await ctx.close();
 }finally{await browser.close()}
});

test('public browser still has honest demo notice but uses Premium Games visual shell',
 {timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:360,height:800},deviceScaleFactor:2});
  const page=await context.newPage();
  await page.goto(site+'/',{waitUntil:'domcontentloaded'});
  await page.locator('.tile').first().waitFor();
  assert.equal(await page.locator('html.premium-browser').count(),1);
  assert.equal(await page.locator('h1').innerText(),'Premium Games');
  assert.equal(await page.locator('#royal-hero').isVisible(),true);
  assert.equal(await page.locator('#hot-section').isVisible(),true);
  assert.equal(await page.locator('.notice').isVisible(),true);
  assert.match(await page.locator('.notice').innerText(),/simulated virtual coins/i);
  assert.equal(await page.locator('.tile').count(),11);
  const columns=await page.locator('.games').evaluate(el=>
   getComputedStyle(el).gridTemplateColumns.split(' ').length);
  assert.equal(columns,4);
  await page.screenshot({path:join(shots,'premium-games-public-360.png'),fullPage:true});
  await page.goto(site+'/?surface=app',{waitUntil:'domcontentloaded'});
  await page.locator('.tile').first().waitFor();
  assert.equal(await page.locator('html.native-verified').count(),0);
  assert.equal(await page.locator('.notice').isVisible(),true,
   'An app query parameter alone must never suppress public practice disclosure');
  await context.close();
 }finally{await browser.close()}
});

test('native room catalog stays compact: no outside hero or web controls',
 {timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const ctx=await browser.newContext({viewport:{width:390,height:560},deviceScaleFactor:2});
  await ctx.addInitScript(verifiedBridge);
  const page=await ctx.newPage();
  await page.goto(site+'/?view=room&surface=app',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#game-count')?.textContent==='11 games');
  assert.equal(await page.locator('#royal-hero').isVisible(),false);
  assert.equal(await page.locator('#hot-section').isVisible(),false);
  assert.equal(await page.locator('.app-toolbar').isVisible(),false);
  assert.equal(await page.locator('#game-count').isVisible(),true);
  assert.equal(await page.locator('.room-title').innerText(),'Game');
  assert.equal(await page.locator('.tile').count(),11);
  const grid=await page.locator('#games').evaluate(el=>
   getComputedStyle(el).gridTemplateColumns.split(' ').length);
  assert.equal(grid,4);
  await page.screenshot({path:join(shots,'premium-games-room-390.png')});
  await ctx.close();
 }finally{await browser.close()}
});

test('native Back and app-mode link remain secure and the original game engine stays isolated',()=>{
 const java=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaGameCenterActivity.java',import.meta.url),'utf8');
 const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
 assert.ok(java.includes('web.evaluateJavascript('));
 assert.ok(java.includes('window.sharikaPremiumBack()'));
 assert.ok(java.includes('SITE_ORIGIN.equals(origin)'));
 assert.ok(java.includes('request.isForMainFrame()'));
 assert.ok(html.includes('sandbox="allow-scripts allow-modals"'));
 assert.ok(!html.includes('allow-same-origin'));
 assert.ok(js.includes("window.sharikaPremiumBack=()=>"));
 assert.ok(js.includes("bridge?refreshProfile():Promise.resolve()"));
 assert.ok(!js.includes("localStorage.setItem('coins'"));
});
