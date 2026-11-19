const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=process.cwd()+'/android-staging/app/src/main/assets';
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end('<body><iframe></iframe></body>');}
 const file=path.join(root,url.pathname);
 if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');
 fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const b=await chromium.launch({args:['--no-sandbox']});
 try{for(const [name,file,selector] of [
 ['sovera-gaddy','sovera-gaddy-game','.slot'],['night-food','night-food-wheel','.it'],['jackpot-fruit','jackpot-fruit','button.t'],['sovera-food','sovera-food-wheel','#s_chk']]){
 const page=await b.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(({name,file})=>{
  window.ids=[];window.stateRequests=0;const now=Date.now(),round=Math.floor(now/30000);
  const starts=round*30000;
  addEventListener('message',e=>{
   const m=e.data;let value;
   if(!m.action)return;
   if(m.action==='state')window.stateRequests++;
   if(m.action==='state')value={virtual_coins_only:true,game:name,round:{round_no:round,starts_ms:starts,bet_closes_ms:starts+20000,phase:'bet'},server_time:starts+1000,coins:20000000,my_bets:[],previous_result:null,user:{name:'QA'},today_won:0};
   else if(m.action==='bet'){const taps=m.body.taps;window.ids.push(...taps.map(t=>t.request_id));value={round_no:round,coins:10000000,receipts:taps.map((t,i)=>({request_id:t.request_id,bet_id:window.ids.length-taps.length+i+1}))};}
   else value={list:[],rankings:[]};
   e.source.postMessage({type:'sharika:original-response',ok:true,id:m.id,value},'*');
  });
  document.querySelector('iframe').src='/original-games/'+file+'.html';
 },{name,file});
 const frame=page.frames().find(f=>f.parentFrame());await frame.waitForURL('**/'+file+'.html');await frame.waitForLoadState('load');await frame.waitForTimeout(500);
 const result=await frame.evaluate(({selector,name})=>{
  let b=document.querySelector(selector);
  
  if(!b)return {missing:selector,ids:[...document.querySelectorAll('[onclick],button')].slice(0,8).map(e=>e.id)};
  for(let i=0;i<1000;i++)b.click();return {clicked:b.id||b.className,disabled:b.disabled};
 },{selector,name});
 try{await page.waitForFunction(()=>new Set(ids).size===1000,{},{timeout:15000});}catch(error){console.log(name,result,'IDs',await page.evaluate(()=>ids.length),errors);throw error;}require('node:assert/strict').deepEqual(errors,[]);console.log(name,result.clicked,'1000 distinct tap IDs');await page.close();
 }}finally{await b.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
