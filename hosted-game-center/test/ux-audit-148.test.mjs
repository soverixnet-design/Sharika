import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';

const site=process.env.SHARIKA_GAME_QA_URL||'http://127.0.0.1:8787';
const screenshotDir=process.env.GAME_UX_SCREENSHOT_DIR||'/tmp/sharika-game-audit-148';
mkdirSync(screenshotDir,{recursive:true});
const ids=['royal-ace','cleopatra','greedy-classic','food-deluxe','sovera-gaddy',
 'sovera-food','night-food','greedy-wheel','fruit-royale','jackpot-fruit'];
const custom=['gaddy-royal.svg','sovera-food-royal.svg','night-food-royal.svg',
 'greedy-wheel-royal.svg'];

function readOnlyFixture(){
 if(window!==window.top)return;
 window.SharikaGameBridge={
  onmessage:null,
  postMessage(raw){
   const {id,path}=JSON.parse(raw);
   let data={};
   if(path==='/api/v1/me')
    data={name:'QA Player',public_id:'10000011',display_id:'10000011',coins:100000};
   else if(path==='/api/v1/game-catalog')
    data={games:['royal-ace','cleopatra','greedy-classic','food-deluxe',
     'sovera-gaddy','sovera-food','night-food','greedy-wheel',
     'fruit-royale','jackpot-fruit'].map(id=>({id,enabled:true}))};
   queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({id,ok:true,data})}));
  }
 };
}

async function checkCatalog(page,{room,width,height}){
 const url=site+(room?'/?view=room&surface=app':'/?surface=app');
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.locator('.tile').first().waitFor();
 await page.waitForFunction(()=>document.querySelector('#game-count')?.textContent==='10 games');
 await page.waitForFunction(()=>[...document.querySelectorAll('.tile img')]
  .every(img=>img.complete&&img.naturalWidth>0&&img.naturalHeight>0));
 const metrics=await page.evaluate(()=>{
  const grid=document.querySelector('#games');
  const cards=[...grid.querySelectorAll('.tile')];
  const icons=cards.map(el=>{
   const art=el.querySelector('.art').getBoundingClientRect();
   const img=el.querySelector('img');
   const ribbon=el.querySelector('.badge-ribbon')?.getBoundingClientRect();
   return {x:art.x,y:art.y,w:art.width,h:art.height,
    src:img.getAttribute('src'),naturalW:img.naturalWidth,naturalH:img.naturalHeight,
    ribbon:ribbon?{x:ribbon.x,right:ribbon.right,top:ribbon.top,bottom:ribbon.bottom}:null};
  });
  return {
   width:document.documentElement.clientWidth,
   scrollWidth:document.documentElement.scrollWidth,
   columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,
   icons,
   room:document.documentElement.classList.contains('room-mode'),
   beforeBottom:document.querySelector('#landing').getBoundingClientRect().bottom,
   viewportHeight:innerHeight
  };
 });
 assert.equal(metrics.room,room);
 assert.equal(metrics.columns,4,'All catalog rows must use four columns');
 assert.equal(metrics.icons.length,10);
 assert.ok(metrics.scrollWidth<=metrics.width+2,'No horizontal scrollbar');
 for(const [index,icon] of metrics.icons.entries()){
  assert.ok(icon.naturalW>0&&icon.naturalH>0,'Game '+index+' icon image loaded');
  assert.ok(Math.abs(icon.w-icon.h)<2,'Game '+index+' icon must remain square');
  if(icon.ribbon){
   assert.ok(icon.ribbon.x>=icon.x-2 && icon.ribbon.right<=icon.x+icon.w+2,
    'Game '+index+' HOT/NEW badge is clipped at '+width);
   assert.ok(icon.ribbon.top>=icon.y-2&&icon.ribbon.bottom<=icon.y+icon.h+2,
    'Game '+index+' HOT/NEW badge must fit inside the art');
  }
 }
 const listed=metrics.icons.map(x=>x.src);
 for(const image of custom){
  assert.equal(listed.filter(x=>x.includes(image)).length,1,
   'Dedicated art missing or reused: '+image);
 }
 assert.equal(new Set(listed).size,10,'Each game gets its own artwork URL');
 if(room){
  assert.ok(metrics.icons[8].x>metrics.icons[0].x+2,
   'The last two room icons should be centered instead of left-aligned');
  assert.ok(metrics.beforeBottom>=height-4,'Room view fills available native sheet');
 }
 await page.screenshot({path:join(screenshotDir,(room?'room':'outside')+'-'+width+'.png'),fullPage:!room});
}

test('Game Center and room catalog: ten crisp icons, no clipped badges, four mobile widths',
 {timeout:160000},async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const [width,height] of [[320,690],[360,800],[390,844],[430,932]]){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2});
   await context.addInitScript(readOnlyFixture);
   const page=await context.newPage();
   await checkCatalog(page,{room:false,width,height});
   await context.close();
  }
  for(const [width,height] of [[320,420],[360,520],[390,560],[430,620]]){
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2});
   await context.addInitScript(readOnlyFixture);
   const page=await context.newPage();
   await checkCatalog(page,{room:true,width,height});
   await context.close();
  }
 }finally{await browser.close()}
});
