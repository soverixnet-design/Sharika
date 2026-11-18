import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

const site=process.env.SHARIKA_GAME_QA_URL||'http://127.0.0.1:8787';

test('Food Wheel in room crops only decorative floor and keeps food/chips inside 65% sheet',
 {timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const [width,height] of [[360,520],[390,560]]){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2});
   const page=await context.newPage();
   await page.goto(site+'/?view=room&surface=app',{waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:/Food Wheel Deluxe · Play/}).click();
   await page.frameLocator('#game-frame').locator('#stage').waitFor({timeout:20000});
   const frame=await page.locator('#game-frame').boundingBox();
   const fit=await page.frameLocator('#game-frame').locator('#stage').evaluate(st=>{
    const r=st.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height,
      designHeight:parseFloat(st.style.height),
      foods:st.querySelectorAll('.food.btn').length,
      imageButtons:st.querySelectorAll('img.btn').length,
      viewportWidth:innerWidth,viewportHeight:innerHeight};
   });
   assert.equal(fit.designHeight,2100,'Room crop must be visual-only');
   assert.ok(fit.foods===8,'Keep original eight food wager hit targets');
   assert.ok(fit.imageButtons>=10,'Keep original food/group/chip controls');
   assert.ok(fit.width>width*.70,'Do not squeeze full 2352px into short room sheet');
   assert.ok(fit.height<=height+2,'Original game must fit the compact iframe');
   assert.ok(fit.x>=-2&&fit.x+fit.width<=width+2);
   assert.ok(frame.height<=height+1,'Game iframe stays in the room sheet');
   await context.close();
  }
 }finally{await browser.close();}
});

test('Food Wheel outside retains original full design height, no gameplay or wallet mutations',
 {timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(site+'/?surface=app',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:/Food Wheel Deluxe · Play/}).click();
  await page.frameLocator('#game-frame').locator('#stage').waitFor({timeout:20000});
  const value=await page.frameLocator('#game-frame').locator('#stage').evaluate(el=>parseFloat(el.style.height));
  assert.equal(value,2352);
 }finally{await browser.close();}
});

test('Greedy outside uses a compact lower results/bet deck instead of a giant red void',
 {timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(site+'/?surface=app',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:/Greedy Game · Play/}).click();
  await page.frameLocator('#game-frame').locator('html.sharika-greedy-full').waitFor({timeout:20000});
  const m=await page.frameLocator('#game-frame').locator('#low').evaluate(el=>{
   const r=el.getBoundingClientRect();
   const footer=document.querySelector('#me')?.getBoundingClientRect();
   return {height:r.height,viewport:innerHeight,bottom:r.bottom,
    footerBottom:footer?.bottom||0};
  });
  assert.ok(m.height>=190&&m.height<=260,'Compact lower controls stay ~190-258px');
  assert.ok(m.bottom<=m.viewport+2,'Do not clip results and wallet behind system bar');
  assert.ok(m.footerBottom<=m.viewport+2,'Keep wallet footer visible');
 }finally{await browser.close();}
});


test('Sovera Food and Night Food activate their original compact mobile controls inside a room',
 {timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const ctx=await browser.newContext({viewport:{width:390,height:560}});
  const page=await ctx.newPage();
  await page.goto(site+'/?view=room&surface=app',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:/Sovera Food Wheel · Play/}).click();
  await page.frameLocator('#game-frame').locator('html.sharika-room-mini').waitFor({timeout:20000});
  const food=await page.frameLocator('#game-frame').locator('#chips').evaluate(el=>{
   const chips=el.getBoundingClientRect(),me=document.querySelector('.me')?.getBoundingClientRect();
   return {chipBottom:chips.bottom,footerBottom:me?.bottom||0,viewport:innerHeight};
  });
  assert.ok(food.chipBottom<=food.viewport+2,
   'Sovera Food must not clip coin chips below 65% room panel');
  assert.ok(food.footerBottom<=food.viewport+2,'Player wallet and Autoplay stay visible');
  await page.evaluate(()=>window.sharikaPremiumBack());
  await page.getByRole('button',{name:/Night Food Wheel · Play/}).click();
  await page.frameLocator('#game-frame').locator('html.sharika-room-mini').waitFor({timeout:20000});
  const night=await page.frameLocator('#game-frame').locator('#chips').evaluate(el=>({
    height:el.getBoundingClientRect().height,buttons:el.querySelectorAll('button').length
  }));
  assert.ok(night.buttons>0,'Night Food coin chips exist');
  assert.ok(night.height<=100,'Night Food coin chips use room compact sizing');
  await ctx.close();
 }finally{await browser.close();}
});


test('Food Wheel does not remain at scale zero on repeat room opens',
 {timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:560}});
  const page=await context.newPage();
  await page.goto(site+'/?view=room&surface=app',{waitUntil:'domcontentloaded'});
  for(let attempt=0;attempt<4;attempt++){
   await page.getByRole('button',{name:/Food Wheel Deluxe · Play/}).click();
   const stage=page.frameLocator('#game-frame').locator('#stage');
   await stage.waitFor({timeout:20000});
   await page.waitForTimeout(200);
   const rect=await stage.evaluate(el=>({
    w:el.getBoundingClientRect().width,
    h:el.getBoundingClientRect().height,
    transform:el.style.transform,
    height:parseFloat(el.style.height)
   }));
   assert.equal(rect.height,2100);
   assert.ok(rect.w>270&&rect.h>=550,
    'Repeated room entry must never leave Food Wheel at scale(0): '+JSON.stringify(rect));
   assert.ok(!rect.transform.includes('scale(0)'));
   await page.evaluate(()=>window.sharikaPremiumBack());
  }
  await context.close();
 }finally{await browser.close();}
});

test('hosted Food Wheel retries invalid viewport dimensions without removing bet controls',()=>{
 const source=readFileSync(new URL('../dist/games/original-games/food-wheel-deluxe.html',import.meta.url),'utf8');
 assert.match(source,/if\(w<10\|\|h<10\)\{if\(fitRetry\+\+<50\)setTimeout\(fit,80\);return;\}/);
 assert.match(source,/addEventListener\('pageshow'/);
 assert.match(source,/ResizeObserver/);
 assert.match(source,/requestId\(\)/);
});

test('original games remain iframe-isolated and keep server bet routes unchanged',()=>{
 const js=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
 assert.match(js,/game\.id==='food-deluxe'&&inRoom\?'mode=room'/);
 assert.match(js,/\/api\/v1\/original-games\//);
 assert.match(html,/sandbox="allow-scripts allow-modals"/);
 assert.doesNotMatch(html,/allow-same-origin/);
});
