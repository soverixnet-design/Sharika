import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const site='https://sharika-games-web-staging.soverixnet.workers.dev';
const enabled=['royal-ace','cleopatra','greedy-classic','food-deluxe','sovera-gaddy','sovera-food','night-food','greedy-wheel'];
const catalog=enabled.map(id=>({id,enabled:true})).concat(
  ['fruit-royale','jackpot-fruit'].map(id=>({id,enabled:false})));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function mockWebViewBridge(account){
  // Called as Playwright's addInitScript before the application JS loads.
  // WebView in real Android injects only into the top-level trusted document.
  if(window!==window.top)return;
  const firstBalance=account==='test-a'?500000:750000;
  // Playwright init scripts run in the page without Node-side lexical closures.
  const catalog=['royal-ace','cleopatra','greedy-classic','food-deluxe','sovera-gaddy',
    'sovera-food','night-food','greedy-wheel'].map(id=>({id,enabled:true}))
    .concat(['fruit-royale','jackpot-fruit'].map(id=>({id,enabled:false})));
  window.__gameCalls=[];
  window.__gameAccount=account;
  window.SharikaGameBridge={
    onmessage:null,
    postMessage(encoded){
      const call=JSON.parse(encoded);
      window.__gameCalls.push(call);
      let payload={};
      if(call.path==='/api/v1/game-catalog')payload={games:catalog};
      else if(call.path==='/api/v1/royal-ace/state')payload={balance:firstBalance,bets:[1000,10000,100000,1000000],freeSpins:0,lockedBet:0,virtual_coins_only:true};
      else if(call.path==='/api/v1/cleopatra/state')payload={balance:firstBalance,bets:[1000,10000,100000],freeSpins:0,lockedBet:0};
      else if(call.path==='/api/v1/royal-ace/spin'){
        const b=call.body;
        payload={requestId:b.requestId,bet:b.bet,mode:b.buy?'bonus_buy':'paid',
          win:0,balance:firstBalance-b.bet,freeSpins:0,bonusSpins:0,
          steps:[{grid:Array.from({length:5},()=>Array.from({length:4},()=>({s:0,g:false}))),
            marks:[],win:0,multiplier:1}],settled:true,virtual_coins_only:true};
      }
      else if(call.path==='/api/v1/cleopatra/spin'){
        payload={requestId:call.body.requestId,bet:call.body.bet,win:0,balance:firstBalance-call.body.bet,
          freeSpins:0,grid:[['K','H','N'],['Q','H','J'],['T','H','K'],['L','N','E'],['J','A','T']],settled:true};
      }
      else if(call.path.startsWith('/api/v1/original-games/'))payload={
        balance:firstBalance,coins:firstBalance,enabled:true,round:{
          id:'mock-round-1',round_no:1,starts_ms:Date.now(),bets:[],total:0
        },server_time:Date.now(),previous_result:null,rankings:[],history:[]};
      else if(call.path.startsWith('/api/v1/greedy-wheel/'))payload={
        balance:firstBalance,coins:firstBalance,round:{round_no:1},
        records:[],history:[],state:'open'};
      else payload={error:'mock_not_configured'};
      queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({
        id:call.id,ok:!payload.error,...(payload.error?{error:payload.error}:{data:payload})
      })}));
    }
  };
}

test('public browser shows original game cards and free demo without wallet API', {timeout:75000},async()=>{
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.goto(site+'/',{waitUntil:'domcontentloaded'});
    await page.locator('.tile').first().waitFor();
    assert.equal(await page.locator('.tile').count(),10);
    assert.equal(await page.locator('.tile:enabled').count(),10);
    assert.match(await page.locator('#status').innerText(),/free browser demo/i);
    const cardImages=await page.locator('.tile .art img').count();
    assert.equal(cardImages,10);
    assert.equal(await page.locator('.tile .art img').first().evaluate(img=>img.complete&&img.naturalWidth>0),true,
      'Original Royal Ace card image must load');
    await page.getByRole('button',{name:/SuperAce Deluxe/}).click();
    assert.equal(await page.locator('#demo-banner').isVisible(),true);
    const royal=page.frameLocator('#game-frame');
    await royal.locator('#sp').waitFor({state:'visible',timeout:15000});
    await royal.locator('#sp').click();
    await page.waitForFunction(()=>document.querySelector('#game-name').textContent.includes('SuperAce'));
    await page.getByRole('button',{name:'Close Game'}).click();
    await page.getByRole('button',{name:/Cleopatra/}).click();
    await page.frameLocator('#game-frame').locator('#spin').waitFor({state:'visible'});
    await page.frameLocator('#game-frame').locator('#spin').click();
    await page.getByRole('button',{name:'Close Game'}).click();
    const api=await page.request.post(site+'/api/spin',{data:{}});
    assert.equal(api.status(),405,'public Game Center must reject virtual wallet changes');
    await page.close();
  } finally {await browser.close();}
});

test('mobile WebView test bridge links both slots to authenticated API routes and isolates game frames',
  {timeout:100000},async()=>{
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try {
    for(const account of ['test-a','test-b']){
      const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
      await context.addInitScript(mockWebViewBridge,account);
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(site+'/',{waitUntil:'domcontentloaded'});
      await page.locator('.tile:enabled').first().waitFor();
      assert.equal(await page.locator('.tile:enabled').count(),enabled.length);
      const catalogCalls=await page.evaluate(()=>window.__gameCalls.filter(c=>c.path==='/api/v1/game-catalog').length);
      assert.equal(catalogCalls,1,'catalog should be checked with native session');

      await page.getByRole('button',{name:/SuperAce Deluxe/}).click();
      const royal=page.frameLocator('#game-frame');
      await royal.locator('#royal-loading').waitFor({state:'attached'});
      await page.waitForFunction(()=>
        window.__gameCalls.some(c=>c.path==='/api/v1/royal-ace/state'),null,{timeout:20000});
      // The sandbox must keep hosted game JS away from the high-privilege main frame.
      const bridgeAccess=await royal.locator('html').evaluate(()=>{
        try {return window.parent.SharikaGameBridge ? 'exposed':'missing'}
        catch(error){return error?.name||'denied'}
      });
      assert.notEqual(bridgeAccess,'exposed','game frame must NOT access the native bridge');
      await royal.locator('#sp').waitFor({state:'visible',timeout:15000});
      await royal.locator('#sp').waitFor({state:'attached'});
      // Bonus-buy confirms before sending a paid request, even in the sandbox.
      const confirmations=[];
      page.on('dialog',async dialog=>{
        confirmations.push(dialog.message());await dialog.dismiss();
      });
      await royal.locator('#bb').click({timeout:15000});
      assert.ok(confirmations.some(message=>message.includes('Buy 10 Free Spins')),
        'Bonus Buy confirmation must remain visible in isolated game iframe');
      await royal.locator('#sp').click({timeout:15000});
      await page.waitForFunction(()=>
        window.__gameCalls.some(c=>c.path==='/api/v1/royal-ace/spin'),null,{timeout:20000});
      const royalSpin=await page.evaluate(()=>window.__gameCalls.find(c=>c.path==='/api/v1/royal-ace/spin'));
      assert.equal(royalSpin.method,'POST');
      assert.equal(royalSpin.body.buy,false);
      assert.ok(royalSpin.body.bet>=1000);

      await page.getByRole('button',{name:'Close Game'}).click();
      await page.getByRole('button',{name:/Cleopatra/}).click();
      await page.waitForFunction(()=>
        window.__gameCalls.some(c=>c.path==='/api/v1/cleopatra/state'),null,{timeout:20000});
      const cleo=page.frameLocator('#game-frame');
      await cleo.locator('#spin').waitFor({state:'visible',timeout:15000});
      await cleo.locator('#spin').click({timeout:15000});
      await page.waitForFunction(()=>
        window.__gameCalls.some(c=>c.path==='/api/v1/cleopatra/spin'),null,{timeout:20000});
      const cleoSpin=await page.evaluate(()=>window.__gameCalls.find(c=>c.path==='/api/v1/cleopatra/spin'));
      assert.equal(cleoSpin.method,'POST');
      assert.equal(typeof cleoSpin.body.requestId,'string');
      assert.ok(cleoSpin.body.bet>0);
      assert.equal(await page.locator('#error').isVisible(),false);
      assert.deepEqual(errors.filter(x=>/SecurityError|Uncaught TypeError/.test(x)),[],
        'frame isolation must not crash the hosted UI');
      await context.close();
    }
  } finally {await browser.close();}
});

test('all eight enabled hosted games load safely and connect their original state APIs',
  {timeout:180000},async()=>{
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    const context=await browser.newContext({viewport:{width:393,height:852}});
    await context.addInitScript(mockWebViewBridge,'test-a');
    const page=await context.newPage();
    await page.goto(site+'/',{waitUntil:'domcontentloaded'});
    await page.locator('.tile:enabled').first().waitFor();
    const scenarios=[
      ['Food Wheel Deluxe','/api/v1/original-games/food-deluxe/state'],
      ['Greedy Game','/api/v1/original-games/greedy-classic/state'],
      ['Sovera Gaddy','/api/v1/original-games/sovera-gaddy/state'],
      ['Sovera Food Wheel','/api/v1/original-games/sovera-food/state'],
      ['Night Food Wheel','/api/v1/original-games/night-food/state'],
      ['Greedy Wheel','/api/v1/greedy-wheel/state']
    ];
    for(const [label,endpoint] of scenarios){
      await page.getByRole('button',{name:new RegExp(label)}).click();
      await page.waitForFunction(path=>
        window.__gameCalls.some(call=>call.path===path),endpoint,{timeout:25000});
      const child=page.frameLocator('#game-frame');
      const origin=await child.locator('html').evaluate(()=>{
        try {return window.parent.SharikaGameBridge?'exposed':'sandboxed'}
        catch{return 'sandboxed'}
      });
      assert.equal(origin,'sandboxed',label+' must not receive native bridge');
      if(label==='Sovera Gaddy'){
        const url=await page.locator('#game-frame').getAttribute('src');
        assert.ok(!url.includes('#sharika-room'),'Full-page Game Center must avoid room mini layout');
      }
      await page.getByRole('button',{name:'Close Game'}).click();
    }
    await context.close();
  } finally {await browser.close();}
});

test('all ten original cards can be opened in browser practice without a Firebase token',
  {timeout:120000},async()=>{
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.goto(site+'/',{waitUntil:'domcontentloaded'});
    await page.locator('.tile').first().waitFor();
    const titles=['SuperAce Deluxe',"Cleopatra's Gold Deluxe",'Greedy Game',
      'Food Wheel Deluxe','Sovera Gaddy','Sovera Food Wheel','Night Food Wheel',
      'Greedy Wheel','Fruit Royale','Fruit Jackpot'];
    for(const name of titles){
      await page.locator('.tile').filter({has:page.locator('b').filter({hasText:name})}).first().click();
      await page.locator('#game-frame').waitFor({state:'visible'});
      const url=await page.locator('#game-frame').getAttribute('src');
      assert.ok(url.startsWith('/games/'),name+': hosted static game required');
      assert.equal(await page.locator('#demo-banner').isVisible(),true);
      await page.getByRole('button',{name:'Close Game'}).click();
    }
    const blocked=await page.request.post(site+'/api/spin',{data:{bet:1000}});
    assert.equal(blocked.status(),405,'The free public website cannot debit any Sharika wallet');
  } finally{await browser.close();}
});
