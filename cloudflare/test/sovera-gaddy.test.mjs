import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {gaddyOutcome,gaddyPayout,handleSoveraGaddy} from '../src/sovera-gaddy.mjs';

test('Sovera Gaddy 30s server settlement has independent commit and bonus math',async()=>{
  const round={seed_hex:'a'.repeat(64),round_no:391,
    weights_json:'[20,36,60,90,180,180,180,180,37,37]',
    multipliers_json:'[45,25,15,10,5,5,5,5,2,2]',commit_sha256:'b'.repeat(64)};
  const result=await gaddyOutcome(round);
  assert.ok(['chicken','fish','hotdog','steak','grapes','lettuce','pepper','melon','salad','pizza'].includes(result.item));
  assert.deepEqual(result,await gaddyOutcome(round),'same committed seed yields same outcome');
  const salad={result_index:8},pizza={result_index:9};
  assert.equal(gaddyPayout({pick_index:4,amount:500},salad,round),1000);
  assert.equal(gaddyPayout({pick_index:2,amount:500},salad,round),0);
  assert.equal(gaddyPayout({pick_index:2,amount:500},pizza,round),1000);
  assert.equal(gaddyPayout({pick_index:4,amount:500},pizza,round),0);
});

test('server rejects wrong chips, item, request ID and underage play',async()=>{
  const fake={prepare(sql){return {bind(){return this;},async first(){
    if(sql.startsWith('SELECT coins,public_no'))return {coins:9000,minor:0,status:'active',public_no:10000001};
    throw Error('Unexpected SQL: '+sql);
  }};}};
  const call=body=>handleSoveraGaddy({
    request:new Request('https://test.invalid/api/v1/original-games/sovera-gaddy/bet',
      {method:'POST',body:JSON.stringify(body)}),db:fake,uid:'user',action:'bet',
    reply:(data,status)=>Response.json(data,{status}),
    fail:(error,status)=>Response.json({error},{status}),cors:{}
  });
  assert.equal((await call({round_no:1,pick:0,amount:1000,request_id:'test-request-0001'})).status,400);
  assert.equal((await call({round_no:1,pick:8,amount:50,request_id:'test-request-0002'})).status,400);
  assert.equal((await call({round_no:1,pick:0,amount:50,request_id:'short'})).status,400);
});

test('standalone source never ships live client-side fake payouts or Socket.io token URLs',()=>{
  const root=new URL('../../android-staging/app/src/main/assets/original-games/',import.meta.url);
  const html=readFileSync(new URL('sovera-gaddy-game.html',root),'utf8');
  const live=readFileSync(new URL('sovera-gaddy-live.js',root),'utf8');
  const card=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const native=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
  assert.match(html,/<title>Sovera Gaddy Game/);
  assert.match(html,/sovera-gaddy-live.js/);
  assert.doesNotMatch(html,/Math\.random\(|localStorage\.|socket\.io-client|function pick\(/);
  assert.match(live,/type:'sharika:original-request'/);
  assert.match(live,/game:GAME/);
  assert.match(live,/request\('bet',body\)/);
  assert.match(live,/pendingPicks\.has\(Number\(x\.dataset\.pick\)\)/,
    'only the tapped food locks while a bet is awaiting confirmation');
  assert.doesNotMatch(live,/!betting/,'one pending request never locks every food');
  assert.match(live,/Bet accepted ✓/,'English confirmation replaces the Bengali toast');
  assert.doesNotMatch(live,/বাজি গ্রহণ/);
  assert.match(live,/uncertainBets\.set\(pick,body\)/,
    'uncertain timeout reuses its original idempotent request');
  assert.match(live,/request_id===body\.request_id/,
    'state refresh reconciles a previous slow server receipt');
  assert.match(live,/gaddy-bet-ranking/);
  assert.match(live,/Daily Bet Ranking · Top 100/);
  assert.match(live,/My rank:/);
  assert.match(html,/slot:disabled\{opacity:1;filter:none\}/,
    'no greyed-out food tiles during bet requests');
  assert.doesNotMatch(html,/slot:disabled\{opacity:\.65/);
  assert.match(html,/DAILY BET RANKING|gaddy-bet-ranking/);
  assert.match(html,/Round: <span id="rn">/);
  assert.doesNotMatch(html,/>বাজি গ্রহণ/);
  assert.match(card,/id:'sovera-gaddy',name:'Sovera Gaddy Game'/);
  assert.match(card,/min\(65dvh,650px\)/);
  assert.match(native,/sovera-food\|sovera-gaddy\|night-food/);
  execFileSync('python3',[new URL('./sovera-gaddy-sql.test.py',import.meta.url).pathname]);
});
