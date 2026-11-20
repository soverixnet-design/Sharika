import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,dirname,normalize,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import site from '../src/index.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'../dist');
const publicHost='https://sharika-games-web-staging.soverixnet.workers.dev';
const privateHost='https://sharika-private-center-staging.soverixnet.workers.dev';
const env={ASSETS:{fetch:async()=>new Response('')}};
const catalog=(await (await site.fetch(new Request(publicHost+'/api/catalog'),env)).json()).games;
const contentType=p=>p.endsWith('.html')?'text/html; charset=utf-8':
 p.endsWith('.js')?'text/javascript; charset=utf-8':
 p.endsWith('.css')?'text/css; charset=utf-8':
 p.endsWith('.svg')?'image/svg+xml':
 p.endsWith('.png')?'image/png':
 p.endsWith('.webp')?'image/webp':
 p.endsWith('.jpg')?'image/jpeg':
 p.endsWith('.mp3')?'audio/mpeg':'application/octet-stream';
const privateCsp="default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "+
 "frame-src 'self' "+publicHost+"; connect-src 'self'; object-src 'none'; "+
 "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const publicGameCsp="default-src 'none'; img-src "+publicHost+" data: blob:; "+
 "script-src "+publicHost+" 'unsafe-inline'; style-src "+publicHost+" 'unsafe-inline'; "+
 "font-src "+publicHost+" data:; connect-src 'none'; media-src "+publicHost+" data: blob:; "+
 "frame-ancestors "+privateHost+" "+publicHost;

function fakeNativeBridge(){
 if(window!==window.top)return;
 window.SharikaGameBridge={
   onmessage:null,
   postMessage(json){
     const request=JSON.parse(json);
     let data={};
     if(request.path==='/api/v1/me')
       data={name:'Game QA',public_id:'10000011',display_id:'10000011',coins:1000000};
     else if(request.path==='/api/v1/center/manifest')
       data={games:[
         {id:'royal-slots'},{id:'royal-ace'},{id:'cleopatra'},
         {id:'greedy-classic'},{id:'food-deluxe'},{id:'sovera-gaddy'},
         {id:'sovera-food'},{id:'night-food'},{id:'greedy-wheel'},
         {id:'fruit-royale'},{id:'jackpot-fruit'}
       ]};
     else data={error:'read_only_browser_QA'};
     queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({
       id:request.id,ok:!data.error,...(data.error?{error:data.error}:{data})
     })}));
   }
 };
}

function installAssetRouting(context){
 return context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(![new URL(publicHost).hostname,new URL(privateHost).hostname].includes(url.hostname)){
     await route.abort();return;
   }
   const origin=url.origin;
   const isPrivate=origin===privateHost;
   if(url.pathname==='/api/catalog'){
     await route.fulfill({status:200,contentType:'application/json',
       body:JSON.stringify({games:catalog,requires_sharika_app:true})});return;
   }
   if(url.pathname==='/api/center/manifest'){
     await route.fulfill({status:isPrivate?200:404,contentType:'application/json',
       body:JSON.stringify(isPrivate?{rankings:[],events:[],modules:[]}:{error:'not_found'})});
     return;
   }
   const path=normalize(join(root,url.pathname==='/'?'index.html':url.pathname));
   if(!path.startsWith(root+sep)){await route.fulfill({status:404,body:''});return;}
   try{
     const headers={'content-type':contentType(path),'cache-control':'no-store'};
     if(isPrivate&&url.pathname==='/')headers['content-security-policy']=privateCsp;
     if(!isPrivate&&url.pathname.startsWith('/games/'))
       headers['content-security-policy']=publicGameCsp;
     await route.fulfill({status:200,body:readFileSync(path),headers});
   }catch{await route.fulfill({status:404,body:'missing_file'});}
 });
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function loadedFrame(page,asset){
 const expected=publicHost+new URL(asset,publicHost).pathname;
 for(let i=0;i<120;i++){
   const child=page.frames().find(f=>f.parentFrame()&&f.url().startsWith(expected));
   if(child&&await child.locator('body').count())return child;
   await delay(75);
 }
 throw Error('game iframe not loaded: '+asset);
}

test('public demo shows all available static games without private /api/center/manifest', {timeout:40000},async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
   const ctx=await browser.newContext({viewport:{width:390,height:820}});
   await installAssetRouting(ctx);
   const page=await ctx.newPage();
   await page.goto(publicHost+'/',{waitUntil:'domcontentloaded'});
   await page.locator('#games .tile').first().waitFor();
   assert.equal(await page.locator('#games .tile').count(),catalog.length);
   assert.equal(await page.locator('#games .tile:enabled').count(),catalog.length);
   assert.match(await page.locator('#status').textContent(),/free browser demo/i);
 }finally{await browser.close();}
});

test('private native Game Center loads every sandboxed game asset without account cookie', {timeout:160000},async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
   const ctx=await browser.newContext({viewport:{width:390,height:820}});
   await ctx.addInitScript(fakeNativeBridge);
   await installAssetRouting(ctx);
   const page=await ctx.newPage();
   await page.goto(privateHost+'/?surface=app',{waitUntil:'domcontentloaded'});
   await page.locator('#games .tile').first().waitFor();
   assert.equal(await page.locator('#games .tile:enabled').count(),catalog.length);
   for(const [i,game] of catalog.entries()){
     const tile=page.locator('#games .tile').nth(i);
     await tile.click();
     const child=await loadedFrame(page,game.asset);
     assert.ok(child.url().startsWith(publicHost+'/games/'));
     const body=await child.locator('body').textContent();
     assert.ok((body||'').trim().length>10,game.id+': empty hosted game document');
     // Bet chips, fruit pictures, card art and game sprites must decode in
     // the real sandboxed Chromium frame, not merely exist as HTML source.
     const brokenVisibleImages=await child.evaluate(async()=>{
       const images=[...document.images].filter(img=>{
         if(!img.getAttribute('src'))return false;
         const style=getComputedStyle(img),bounds=img.getBoundingClientRect();
         return style.display!=='none'&&style.visibility!=='hidden'&&
           bounds.width>1&&bounds.height>1;
       });
       return (await Promise.all(images.map(async img=>{
         try{
           await Promise.race([img.decode(),
             new Promise(resolve=>setTimeout(resolve,2500))]);
         }catch(_){}
         return img.complete&&img.naturalWidth===0?
           (img.currentSrc||img.src).slice(0,140):null;
       }))).filter(Boolean);
     });
     assert.deepEqual(brokenVisibleImages,[],
       game.id+': visible game chip/card image failed to decode');
     const bridge=await child.evaluate(()=>{
       try {return window.parent.SharikaGameBridge?'leaked':'isolated';}
       catch {return 'isolated';}
     });
     assert.equal(bridge,'isolated',game.id+': game iframe accessed privileged parent');
     await page.locator('#exit').click();
   }
 }finally{await browser.close();}
});
