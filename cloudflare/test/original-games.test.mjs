import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ORIGINAL_ROUND_MS,originalOutcome,originalPayout,handleOriginalGameRequest} from '../src/original-games.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const seed='0123456789abcdef'.repeat(4);
const commit=createHash('sha256').update(seed).digest('hex');

test('original three games share deterministic, auditable 40-second rounds',async()=>{
  assert.equal(ORIGINAL_ROUND_MS,40000);
  for(const game of ['sovera-food','night-food','jackpot-fruit']){
    const row={game,seed_hex:seed,commit_sha256:commit};
    const a=await originalOutcome(row),b=await originalOutcome(row);
    assert.deepEqual(a,b);
    assert.equal(a.commit_sha256,commit);
    assert.ok(a.index>=0&&a.index<8);
    assert.ok(a.positions.every(i=>Number.isInteger(i)&&i>=0&&i<8));
    if(game!=='jackpot-fruit')assert.equal(a.bonus,'');
  }
});
test('original Food Wheel pays only the exact selected food',()=>{
  const answer={index:0,positions:[0],bonus:''};
  assert.equal(originalPayout({game:'sovera-food',pick_index:0,amount:50},answer,0,0),2250);
  assert.equal(originalPayout({game:'sovera-food',pick_index:7,amount:50},answer,0,0),0);
});
test('Night Food Wheel salad and pizza are distinct wager types',()=>{
  const salad={index:4,positions:[4],bonus:''};
  const pizza={index:0,positions:[0],bonus:''};
  const bet=(pick_index)=>({game:'night-food',pick_index,amount:100});
  assert.equal(originalPayout(bet(8),salad,0,0),120);
  assert.equal(originalPayout(bet(8),pizza,0,0),0);
  assert.equal(originalPayout(bet(9),pizza,0,0),400);
  assert.equal(originalPayout(bet(9),salad,0,0),0);
});
test('Jackpot bonuses are authoritative and pool bonuses cannot mint unlimited currency',()=>{
  const base={game:'jackpot-fruit',pick_index:7,amount:100};
  assert.equal(originalPayout(base,{index:7,positions:[7],bonus:''},0,0),4000);
  assert.equal(originalPayout(base,{index:7,positions:[7],bonus:'x2'},0,0),8000);
  assert.equal(originalPayout(base,{index:7,positions:[7],bonus:'x3'},0,0),12000);
  assert.equal(originalPayout(base,{index:7,positions:[7,7],bonus:'+1'},0,0),8000);
  const budget=199,total=700,answer={index:0,positions:[0],bonus:'JP'};
  const amounts=[100,200,400];
  const paid=amounts.reduce((sum,amount)=>sum+originalPayout({
    game:'jackpot-fruit',pick_index:7,amount},answer,budget,total),0);
  assert.ok(paid<=budget);
  assert.ok(paid>=budget-amounts.length);
});
test('real history and winners never arise from local Math.random',()=>{
  const source=originalOutcome.toString()+originalPayout.toString();
  assert.doesNotMatch(source,/Math\.random|localStorage|fake.*winner/i);
});
test('accepted original-game bets survive a retry after the round closes',async()=>{
  const round=Math.floor(Date.now()/ORIGINAL_ROUND_MS)-1;
  const existing={id:76,game:'sovera-food',round_no:round,pick_index:2,
    amount:500,request_id:'original-retry-test-12345'};
  const queries=[];
  let prior=existing;
  const db={prepare(sql){
    return {
      bind(...args){this.args=args;return this;},
      async first(){
        queries.push(sql);
        if(sql.startsWith('SELECT coins,minor,status FROM sharika_users'))
          return {coins:750,minor:0,status:'active'};
        if(sql.startsWith('SELECT * FROM sharika_original_game_bets WHERE user_uid=?'))
          return prior;
        throw Error('Unexpected read: '+sql);
      },
      async run(){throw Error('A retry must never insert another bet');}
    };
  }};
  const reply=(body,status)=>Response.json(body,{status});
  const fail=(error,status)=>Response.json({error},{status});
  const call=body=>handleOriginalGameRequest({
    request:new Request('https://sharika.test/api/v1/original-games/sovera-food/bet',{
      method:'POST',body:JSON.stringify(body),
      headers:{'content-type':'application/json'}
    }),db,uid:'verified-user',game:'sovera-food',action:'bet',reply,fail,cors:{}
  });
  const payload={round_no:round,pick:2,amount:500,request_id:existing.request_id};
  const replay=await call(payload);
  assert.equal(replay.status,200);
  assert.deepEqual(await replay.json(),{
    bet_id:76,duplicate:true,coins:750,round_no:round
  });
  const conflict=await call({...payload,amount:501});
  assert.equal(conflict.status,409);
  assert.equal((await conflict.json()).error,'idempotency_conflict');
  prior=null;
  const stale=await call({...payload,request_id:'original-stale-new-1234'});
  assert.equal(stale.status,409);
  assert.equal((await stale.json()).error,'betting_closed');
  assert.ok(queries.some(sql=>sql.includes('sharika_original_game_bets')));
});


test('Night Food and Jackpot Fruit advertise 1k chips for small verified wallets',async()=>{
  // A staging account may have only 1,425 coins; the old 10k minimum
  // prevented any manual wager while Sovera Food Wheel appeared to work.
  const now=Date.now();
  const currentRound=Math.floor(now/ORIGINAL_ROUND_MS);
  const db={prepare(sql){
    const stmt={
      bind(...values){this.values=values;return this;},
      async all(){return {results:[]};},
      async first(){
        if(sql.startsWith('SELECT * FROM sharika_original_game_rounds WHERE game=? AND round_no=?'))
          return {id:'round',game:this.values[0],round_no:currentRound,
            commit_sha256:commit,seed_hex:seed};
        if(sql.startsWith('SELECT * FROM sharika_original_game_rounds WHERE game=? AND closes_ms<=?'))
          return null;
        if(sql.startsWith('SELECT coins,minor,status FROM sharika_users'))
          return {coins:1425,minor:0,status:'active'};
        if(sql.includes('FROM sharika_original_game_bets WHERE user_uid=? AND game=?'))
          return null;
        if(sql.includes('FROM sharika_original_game_pools'))
          return {coins:0};
        if(sql.includes('COUNT(*) AS bets'))
          return {bets:0,wagered:0,won:0};
        throw Error('Unexpected SQL query '+sql);
      },
      async run(){throw Error('Read-only game catalog may not write fake balance');}
    };
    return stmt;
  }};
  const reply=(body,status)=>Response.json(body,{status});
  const fail=(error,status)=>Response.json({error},{status});
  for(const game of ['night-food','jackpot-fruit']){
    const res=await handleOriginalGameRequest({
      request:new Request('https://sharika.test/api/v1/original-games/'+game+'/state'),
      db,uid:'verified-user',game,action:'state',reply,fail,cors:{}
    });
    assert.equal(res.status,200);
    const state=await res.json();
    assert.equal(state.coins,1425);
    assert.deepEqual(state.chips,[1000,10000,100000,1000000,10000000]);
    assert.equal(state.virtual_coins_only,true);
  }
});


test('both offline game layouts use the matching server-backed wager chips',()=>{
  for(const [page,token] of [
    ['night-food-wheel.html','const chips=[1000,10000,100000,1000000,10000000];'],
    ['jackpot-fruit.html','CH=[1000,10000,100000,1000000,10000000];']
  ]){
    const html=readFileSync(new URL('../../android-staging/app/src/main/assets/original-games/'+page,import.meta.url),'utf8');
    assert.ok(html.includes(token),page+' must offer the 1k wallet-compatible chip');
    assert.match(html,/sharika:original-request/);
    assert.match(html,/sharika:original-response/);
    assert.doesNotMatch(html,/https?:\/\/[^\s"'<>]+/);
  }
});


test('Night Food and Jackpot Fruit show verified round winners to all viewers',()=>{
  const base=new URL('../../android-staging/app/src/main/assets/original-games/',import.meta.url);
  const night=readFileSync(new URL('night-food-wheel.html',base),'utf8');
  const jackpot=readFileSync(new URL('jackpot-fruit.html',base),'utf8');
  assert.match(night,/Round Top 3:/);
  assert.match(night,/prev\.top_winners/);
  assert.match(jackpot,/verifiedWinners\.textContent/);
  assert.match(jackpot,/prev\.top_winners/);
  assert.match(jackpot,/if\(!spent&&!?\(prev\.top_winners\|\|\[\]\)\.length\)return/);
  // The original no-bet guard hid top-three results from spectators.
  assert.doesNotMatch(jackpot,/if\(!spent\)return;/);
});

test('all three original games announce at most three verified winners for ten seconds',()=>{
  const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const start=adapter.indexOf('  const announcedOriginalGameRounds=new Map();');
  const end=adapter.indexOf('  function showGameCard(',start);
  assert.ok(start>=0&&end>start,'verified ten-second winner gate must exist');
  const topThree=new Function(adapter.slice(start,end)+';return verifiedOriginalGameTopThree;')();
  const n=48123456;
  const winners=[1,2,3,4].map(i=>({
    public_id:String(10000000+i),name:'Winner '+i,total_win:i*1000
  }));
  const state=(round,seconds,items=winners)=>({
    server_time:(round+1)*40000+seconds*1000,
    previous_result:{round_no:round,top_winners:items}
  });
  assert.equal(topThree('sovera-food',state(n,11)),null,'stale finished round is not reannounced');
  const latest=topThree('sovera-food',state(n,2));
  assert.equal(latest.winners.length,3,'real first three only; never fabricate a fourth');
  assert.equal(latest.winners[0].public_id,'10000001');
  assert.equal(topThree('sovera-food',state(n,4)),null,'polling cannot replay same result');
  assert.equal(topThree('night-food',state(n,1)).winners.length,3);
  assert.equal(topThree('jackpot-fruit',state(n,8)).winners.length,3);
  assert.equal(topThree('jackpot-fruit',state(n+1,1,[])),null,'no demo winners');
  assert.match(adapter,/winnerBannerTimer=view\.setTimeout\(clearWinnerBanner/);
  assert.match(adapter,/winnerBannerStepTimer=view\.setInterval/);
  assert.match(adapter,/verifiedAvatarUrl\(winner\.pic\)/);
  assert.match(adapter,/sh-win-go/);
  assert.match(adapter,/shWinSlide/);
  assert.doesNotMatch(adapter,/parent\.postMessage\(\{type:'akira:game-win'/);
});

test('win banner uses verified player avatars from the original-game result API',()=>{
  const source=readFileSync(new URL('../src/original-games.mjs',import.meta.url),'utf8');
  assert.match(source,/SELECT u\.public_no,u\.name,u\.pic,SUM\(b\.payout\)/);
  assert.match(source,/name:u\.name,pic:u\.pic,total_win:u\.total_win/);
});

test('verified original game settlement refreshes the shared profile and room wallet',()=>{
  const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  assert.match(adapter,/if\(data\.action==='state'\)\{[\s\S]*?announceRoundWinners\(current\.item\.id,result\)/);
  assert.match(adapter,/result\.coins!==balance\.coins/);
  assert.match(adapter,/originalGameWalletRefreshTime>=2500/);
  assert.match(adapter,/reloadWallet\(\)\.catch\(\(\)=>\{\}\)/);
  assert.match(adapter,/view\.removeEventListener\('message',onOriginalGameMessage\)/);
  assert.match(adapter,/if\(!overlay\.classList\.contains\('on'\)\)/);
  assert.match(adapter,/currentGameFrame\?\.element\?\.remove\(\)/);
});

test('all three original games retry timed-out bets once with the same request ID',async()=>{
  const base=new URL('../../android-staging/app/src/main/assets/original-games/',import.meta.url);
  for(const [page,game] of [
    ['sovera-food-wheel.html','sovera-food'],
    ['night-food-wheel.html','night-food'],
    ['jackpot-fruit.html','jackpot-fruit']
  ]){
    const html=readFileSync(new URL(page,base),'utf8');
    const start=html.indexOf('const GameBridge=(()=>{');
    const tail=html.indexOf('  return {call,refresh,bet,onRefresh,onError,now,start,get};',start);
    const end=html.indexOf('})();',tail)+5;
    assert.ok(start>=0&&tail>start&&end>tail,'bridge exists in '+page);
    const listeners=[],attempts=[];
    const parent={postMessage(message){
      const response={type:'sharika:original-response',id:message.id,ok:true,value:{}};
      if(message.action==='state'){
        response.value={server_time:Date.now(),round:{
          round_no:9,bet_closes_ms:Date.now()+20000
        },my_bets:[],coins:3000,previous_result:null};
      }else if(message.action==='bet'){
        attempts.push(message.body);
        if(attempts.length===1){response.ok=false;response.error='server_timeout';}
        else response.value={bet_id:81,coins:2000,round_no:9,duplicate:true};
      }else throw Error('Unexpected bridge action '+message.action);
      queueMicrotask(()=>listeners.forEach(listener=>listener({source:parent,data:response})));
    }};
    const window={parent,addEventListener(_type,listener){listeners.push(listener);}};
    const document={documentElement:{getAttribute:()=>game}};
    const bridge=new Function('window','document','setTimeout','clearTimeout',
      html.slice(start,end)+';return GameBridge;')(window,document,setTimeout,clearTimeout);
    await bridge.refresh();
    const receipt=await bridge.bet(2,1000);
    assert.equal(receipt.bet_id,81,page);
    assert.equal(attempts.length,2,page+' should retry exactly once');
    assert.equal(attempts[0].request_id,attempts[1].request_id,
      page+' must never create a new charge on retry');
    assert.equal(bridge.get().coins,2000,page+' shows the confirmed real wallet receipt');
  }
});


test('original Food Wheel settles prior confirmed winnings before a new coin debit',async()=>{
  const oldNow=Date.now;
  const fixed=Math.floor(oldNow()/ORIGINAL_ROUND_MS)*ORIGINAL_ROUND_MS+1000;
  Date.now=()=>fixed;
  try{
    const round=Math.floor(fixed/ORIGINAL_ROUND_MS);
    let coins=0,paid=false,inserted=false;
    const db={prepare(sql){
      return {
        bind(){return this;},
        async first(){
          if(sql.startsWith('SELECT coins,minor,status FROM sharika_users'))
            return {coins,minor:0,status:'active'};
          if(sql.startsWith('SELECT * FROM sharika_original_game_bets WHERE user_uid=?'))
            return null;
          if(sql.startsWith('SELECT * FROM sharika_original_game_rounds WHERE game=? AND round_no=?'))
            return {id:'sovera-food:'+round,game:'sovera-food',round_no:round,
              seed_hex:seed,commit_sha256:commit};
          if(sql.startsWith('SELECT id FROM sharika_original_game_bets'))
            return {id:902};
          throw Error('Unexpected original-game read: '+sql);
        },
        async all(){
          if(sql.includes("WHERE b.status='accepted' AND r.closes_ms<=?"))
            return {results:[{id:901,game:'sovera-food',round_id:'sovera-food:'+(round-1),
              round_no:round-1,pick_index:0,amount:50,seed_hex:seed,
              commit_sha256:commit,closes_ms:fixed-1000}]};
          throw Error('Unexpected original-game list: '+sql);
        },
        async run(){
          if(sql.startsWith("UPDATE sharika_original_game_bets SET status='settled'")){
            paid=true;coins=2000;return {meta:{changes:1}};
          }
          if(sql.startsWith('INSERT INTO sharika_original_game_bets(')){
            assert.equal(paid,true,'prior wins must settle before the debit');
            if(coins<1000)throw Error('insufficient_balance');
            coins-=1000;inserted=true;
            return {meta:{changes:1}};
          }
          throw Error('Unexpected original-game write: '+sql);
        }
      };
    }};
    const response=await handleOriginalGameRequest({
      request:new Request('https://sharika.test/api/v1/original-games/sovera-food/bet',{
        method:'POST',body:JSON.stringify({round_no:round,pick:1,amount:1000,
          request_id:'original-funded-bet-12345'})
      }),
      db,uid:'verified-user',game:'sovera-food',action:'bet',
      reply:(data,status)=>Response.json(data,{status}),
      fail:(error,status)=>Response.json({error},{status}),cors:{}
    });
    assert.equal(response.status,201);
    assert.equal((await response.json()).coins,1000);
    assert.equal(paid,true);assert.equal(inserted,true);
  }finally{Date.now=oldNow;}
});
