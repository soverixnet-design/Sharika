import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';

const site=process.env.SHARIKA_GAME_QA_URL||'http://127.0.0.1:8787';
const screenshots=process.env.GAME_UX_SCREENSHOT_DIR||'/tmp/sharika-royal-emerald-ui';
mkdirSync(screenshots,{recursive:true});

function secureAndroidFixture(){
 if(window!==window.top)return;
 const enabled=['royal-ace','cleopatra','greedy-classic','food-deluxe',
  'sovera-gaddy','sovera-food','night-food','greedy-wheel',
  'fruit-royale','jackpot-fruit'].map(id=>({id,enabled:true}));
 window.SharikaGameBridge={
  onmessage:null,
  postMessage(encoded){
   const msg=JSON.parse(encoded);
   let data={};
   if(msg.path==='/api/v1/me')
    data={name:'Soverix Net',public_id:'1010',display_id:'1010',coins:500000};
   else if(msg.path==='/api/v1/game-catalog')data={games:enabled};
   else if(msg.path==='/api/v1/original-games/greedy-classic/state'){
    const now=Date.now();
    data={balance:500000,coins:500000,serverTime:now,todayWin:0,
     todayPlayed:0,history:[],myBets:Array(8).fill(0),
     state:{round:1234,phase:'betting',endsAt:now+22000,totals:Array(8).fill(0)}};
   }else data={balance:500000,coins:500000};
   queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({
    id:msg.id,ok:true,data
   })}));
  }
 };
}

test('outside room has app-like Royal Emerald header, featured row and searchable original icons',
 {timeout:100000},async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
  await context.addInitScript(secureAndroidFixture);
  const page=await context.newPage();
  await page.goto(site+'/?surface=app',{waitUntil:'domcontentloaded'});
  await page.locator('.tile').first().waitFor();
  await page.getByText('Soverix Net').first().waitFor({state:'attached'});
  assert.equal(await page.locator('.tile').count(),10);
  assert.equal(await page.locator('#hot-section').isVisible(),true);
  assert.equal(await page.locator('#hot-games .featured-game').count(),3);
  assert.equal(await page.locator('header').isVisible(),false,
   'website header must not show inside Android');
  assert.equal(await page.locator('.app-toolbar').isVisible(),true);
  assert.equal(await page.locator('#catalog-profile').isVisible(),false);
  assert.equal(await page.locator('.eyebrow').isVisible(),false);
  assert.equal(await page.locator('.notice').isVisible(),false);
  assert.equal(await page.locator('.all-games-head').isVisible(),true);
  const icons=await page.locator('.tile .art').evaluateAll(els=>els.map(el=>{
   const r=el.getBoundingClientRect(),tile=getComputedStyle(el.closest('.tile'));
   return {width:r.width,height:r.height,border:tile.borderTopWidth,
    image:getComputedStyle(el).backgroundImage}
  }));
  assert.ok(icons.every(x=>Math.abs(x.width-x.height)<1.5&&x.border==='0px'));
  await page.screenshot({path:join(screenshots,'outside-game-center.png'),fullPage:true});
  await page.getByRole('searchbox',{name:'Search games'}).fill('Cleopatra');
  assert.equal(await page.locator('.tile:visible').count(),1);
  assert.equal(await page.locator('#hot-section').isVisible(),false);
  await page.getByRole('searchbox',{name:'Search games'}).fill('');
  assert.equal(await page.locator('.tile:visible').count(),10);
  await page.getByRole('button',{name:/Greedy Game/}).click();
  await page.frameLocator('#game-frame').locator('html.sharika-greedy-full').waitFor();
  const state=await page.evaluate(()=>({
   header:getComputedStyle(document.querySelector('header')).display,
   profile:getComputedStyle(document.getElementById('game-profile')).display,
   border:getComputedStyle(document.getElementById('game-frame')).borderTopWidth
  }));
  assert.deepEqual(state,{header:'none',profile:'none',border:'0px'});
  await page.screenshot({path:join(screenshots,'outside-greedy-game.png')});
  await context.close();
 }finally{await browser.close()}
});

test('room shows opaque 65% panel content, four icon columns and larger Greedy game',
 {timeout:100000},async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:560},deviceScaleFactor:2});
  await context.addInitScript(secureAndroidFixture);
  const page=await context.newPage();
  await page.goto(site+'/?view=room&surface=app',{waitUntil:'domcontentloaded'});
  await page.locator('.tile').first().waitFor();
  await page.locator('#game-count').getByText('10 games').waitFor();
  assert.equal(await page.locator('.tile').count(),10);
  assert.equal(await page.locator('.app-toolbar').isVisible(),false);
  assert.equal(await page.locator('#hot-section').isVisible(),false);
  assert.equal(await page.locator('#catalog-profile').isVisible(),false);
  assert.equal(await page.locator('header').isVisible(),false);
  const design=await page.evaluate(()=>{
   const grid=document.querySelector('.games'),
    icon=document.querySelector('.tile .art'),body=getComputedStyle(document.body);
   const r=icon.getBoundingClientRect();
   return {columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,
    iconW:r.width,iconH:r.height,bodyBackground:body.backgroundImage,
    title:document.querySelector('.room-title').textContent.trim()}
  });
  assert.equal(design.columns,4);
  assert.ok(Math.abs(design.iconW-design.iconH)<1.5);
  assert.match(design.bodyBackground,/gradient/);
  assert.equal(design.title,'Game');
  await page.screenshot({path:join(screenshots,'room-game-catalog.png')});
  await page.getByRole('button',{name:/Greedy Game/}).click();
  const frame=page.frameLocator('#game-frame');
  await frame.locator('html.sharika-greedy-mini').waitFor({timeout:15000});
  const fit=await frame.locator('#stage').evaluate(el=>{
   const r=el.getBoundingClientRect(),footer=document.getElementById('me').getBoundingClientRect();
   return {wheel:r.width,footerBottom:footer.bottom,viewport:innerHeight};
  });
  assert.ok(fit.wheel>=280,'Greedy 8-food wheel should no longer be tiny');
  assert.ok(fit.footerBottom<=fit.viewport+4,'bet controls must stay within room sheet');
  await page.screenshot({path:join(screenshots,'room-greedy-game.png')});
  await context.close();
 }finally{await browser.close()}
});
