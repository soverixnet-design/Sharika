import assert from 'node:assert/strict';
import {mkdtempSync,copyFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const source=resolve(import.meta.dirname,'../../android-staging/app/src/main/assets/original-games');
const dir=mkdtempSync(join(tmpdir(),'superace-qa-'));
const images=process.env.SUPERACE_QA_OUTPUT||join(dir,'screens');
mkdirSync(images,{recursive:true});
for(const n of ['royal-ace-deluxe.html','royal-ace-loader.svg'])copyFileSync(join(source,n),join(dir,n));
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--allow-file-access-from-files','--no-sandbox']});
 for(const m of [{mode:'full',width:393,height:852},{mode:'room',width:360,height:710}]){
  const html=[
   '<html><style>html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style>',
   '<iframe id="game" src="./royal-ace-deluxe.html?mode='+m.mode+'&host=1"></iframe>',
   '<script>window.requests=[];window.connected=false;',
   "addEventListener('message',e=>{const d=e.data;if(d?.source!=='sharika-royal-ace')return;",
   "if(d.type==='ready')setTimeout(()=>{e.source.postMessage({source:'sharika-royal-ace-server',type:'init',",
   "balance:1000000,bets:[1000,10000,100000,1000000,10000000],lockedBet:0,freeSpins:0},'*');window.connected=true},1200);",
   "if(d.type==='spin'){window.requests.push(d);let grid=Array.from({length:5},()=>Array.from({length:4},()=>({s:8,g:false})));",
   "setTimeout(()=>e.source.postMessage({source:'sharika-royal-ace-server',type:'spinResult',id:d.id,",
   "win:500,balance:999500,mode:'paid',freeSpins:0,bonusSpins:0,steps:[{grid,marks:[],combo:0,multiplier:1}]},'*'),100)",
   "}});</script></html>"
  ].join('\n');
  const file=join(dir,m.mode+'.html');writeFileSync(file,html);
  const page=await browser.newPage({viewport:{width:m.width,height:m.height}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(file).href,{waitUntil:'load'});
  const f=page.frameLocator('#game');
  await f.locator('#royal-loading').waitFor({state:'visible',timeout:10000});
  assert.equal(await f.locator('#sp').isDisabled(),true);
  await page.screenshot({path:join(images,m.mode+'-loading.png')});
  await page.waitForFunction(()=>window.connected,{timeout:10000});
  await f.locator('#royal-loading').waitFor({state:'hidden',timeout:10000});
  assert.equal(await f.locator('#sp').isDisabled(),false);
  assert.equal(await f.locator('#grid .c').count(),20);
  const box=await f.locator('body').evaluate(b=>{
    const p=b.querySelector('#g').getBoundingClientRect(),g=b.querySelector('#grid').getBoundingClientRect(),c=b.querySelector('.pan').getBoundingClientRect();
    return {panelWidth:p.width,gridWidth:g.width,gridBottom:g.bottom,controlBottom:c.bottom,scrollWidth:b.ownerDocument.documentElement.scrollWidth,viewportWidth:b.ownerDocument.documentElement.clientWidth};
  });
  assert.ok(box.panelWidth<=m.width&&box.gridWidth>250,'Grid width');
  assert.ok(box.scrollWidth<=box.viewportWidth+3,'Horizontal clipping');
  assert.ok(box.gridBottom<=m.height+4,'Tiles clipped');
  assert.ok(box.controlBottom<=m.height+10,'Controls clipped');
  await page.screenshot({path:join(images,m.mode+'-game.png')});
  await f.locator('#sp').click({timeout:5000});
  await page.waitForFunction(()=>window.requests.length===1,{timeout:6000});
  await page.waitForTimeout(700);
  const state=await f.locator('body').evaluate(()=>({balance:bal,win:document.getElementById('wn').textContent,stored:localStorage.getItem('sa_bal')}));
  assert.equal(state.balance,999500,'server balance');
  assert.equal(state.win,'500');
  assert.equal(state.stored,null);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({mode:m.mode,status:'passed',box}));
  await page.close();
 }
}finally{await browser?.close();rmSync(dir,{recursive:true,force:true});}
