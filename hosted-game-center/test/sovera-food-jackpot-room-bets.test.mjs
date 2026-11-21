import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,dirname,normalize,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=join(dirname(fileURLToPath(import.meta.url)),'../dist');
const publicHost='https://sharika-games-web-staging.soverixnet.workers.dev';
const privateHost='https://sharika-private-center-staging.soverixnet.workers.dev';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css',
 '.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'};
const readAsset=(path)=>readFileSync(normalize(join(root,path)));
const fakeHost=(game)=>`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;overflow:hidden"><iframe id="game" sandbox="allow-scripts allow-forms"
 style="width:100vw;height:100dvh;border:0;display:block"
 src="${publicHost}/games/original-games/${game}.html#sharika-room"></iframe>
<script>
window.addEventListener('message',e=>{
  const m=e.data;
  if(!m||m.type!=='sharika:original-request')return;
  const t=Date.now();
  let value={};
  if(m.action==='state')value={
    server_time:t,round:{round_no:44880549,bet_closes_ms:t+15000,
      starts_ms:t-1000,closes_ms:t+30000,phase:'bet'},
    coins:100000000,virtual_coins_only:true,
    my_bets:[],previous_result:null,today_won:0,jackpot_pool:50000000};
  else if(m.action==='bet'){
    const taps=m.body.taps||[];
    value={coins:100000000,round_no:m.body.round_no,
      receipts:taps.map((tap,i)=>({request_id:tap.request_id,bet_id:i+1}))};
  }else value={rankings:[],rounds:[]};
  e.source.postMessage({type:'sharika:original-response',ok:true,id:m.id,value},'*');
});
</script></body></html>`;

async function runGame(browser,game,viewport){
 const context=await browser.newContext({viewport});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin===privateHost&&u.pathname==='/'){
     await route.fulfill({status:200,contentType:'text/html',
       body:fakeHost(game)});return;
   }
   if(u.origin!==publicHost){await route.abort();return;}
   const path=normalize(join(root,u.pathname));
   if(!path.startsWith(root+sep)){await route.fulfill({status:404});return;}
   try{const ext=path.slice(path.lastIndexOf('.'));
     await route.fulfill({status:200,body:readFileSync(path),
       contentType:MIME[ext]||'application/octet-stream'});
   }catch{await route.fulfill({status:404,body:'missing asset'});}
 });
 try{
   await page.goto(privateHost+'/',{waitUntil:'domcontentloaded'});
   const child=page.frameLocator('#game');
   const buttons=game==='sovera-food-wheel'?'#chips button.chip':'#ch button';
   await child.locator(buttons).first().waitFor({state:'visible',timeout:18000});
   // Fruit Jackpot intentionally shows an opening loader for one second;
   // measuring hit targets before it disappears falsely reports blocked chips.
   await child.locator('#load, #ld').first().waitFor({state:'hidden',timeout:18000});
   if(game==='sovera-food-wheel')
     await child.locator('#chips button.chip').first().waitFor({state:'visible'});
   const layout=await child.locator('body').evaluate((body,selector)=>{
     const buttons=[...document.querySelectorAll(selector)];
     return buttons.map(b=>{
       const r=b.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
       const at=document.elementFromPoint(cx,cy);
       return {text:b.textContent.trim().slice(0,25),x:cx,y:cy,
        width:r.width,height:r.height,inViewport:r.top>=0&&r.bottom<=innerHeight&&
        r.left>=0&&r.right<=innerWidth,
        clickTarget:at===b||b.contains(at)};
     });
   },buttons);
   assert.equal(layout.length,game==='sovera-food-wheel'?4:5,
     game+' missing chips: '+JSON.stringify(layout));
   for(const p of layout){
     assert.equal(p.inViewport,true,game+' hidden chip: '+JSON.stringify(p));
     assert.equal(p.clickTarget,true,game+' overlay blocks chip: '+JSON.stringify(p));
   }
   const stake=child.locator('#sharika-stake-picker');
   await stake.waitFor({state:'visible'});
   const toolbar=await stake.evaluate(el=>({
     fixed:getComputedStyle(el).position==='fixed',
     parent:el.parentElement?.className||'',
     rect:(()=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom}})()
   }));
   assert.equal(toolbar.fixed,false,'Set stake must not float over native close');
   assert.ok(toolbar.rect.bottom<=viewport.height,game+' stake button off screen');
   assert.ok(['me',''].includes(toolbar.parent)||toolbar.parent==='',
     'Unexpected toolbar parent: '+toolbar.parent);
   assert.deepEqual(errors,[],game+': page errors');
   if(game==='jackpot-fruit'){
     const clock=await child.locator('#tm').evaluate(el=>{
       const data={round:{bet_closes_ms:GameBridge.now()-1000}};
       paintBetClock(data);
       return {text:el.textContent,closed:el.classList.contains('bet-closed')};
     });
     assert.deepEqual(clock,{text:'CLOSED',closed:true});
   }
 }finally{await context.close();}
}
test('Sovera Food in 65%-height room keeps four real bet chips visible and moves Set stake into bottom toolbar',
 {timeout:40000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{await runGame(browser,'sovera-food-wheel',{width:412,height:680})}
 finally{await browser.close()}
});
test('Fruit Jackpot keeps five bet chips clickable, Set stake away from close and labels closed round',
 {timeout:40000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{await runGame(browser,'jackpot-fruit',{width:412,height:690})}
 finally{await browser.close()}
});
