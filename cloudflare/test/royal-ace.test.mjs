import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {simulateRoyalAce,handleRoyalAce} from '../src/royal-ace.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const sql=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(sql('0001_initial.sql'));
  sqlite.exec(sql('0046_admin_game_catalog.sql'));
  sqlite.exec(sql('0098_royal_ace_deluxe.sql'));
  sqlite.exec(sql('0099_royal_ace_bonus_buy_10x.sql'));
  const ins=sqlite.prepare('INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) VALUES(?,?,?,?,?,?)');
  ins.run(10000011,'adult-a','Adult','1991-01-01',0,1000000);
  ins.run(10000012,'minor-b','Minor','2015-01-01',1,1000000);
  ins.run(10000013,'adult-c','Adult C','1994-01-01',0,1000000);
  const db={prepare(query){const stmt=sqlite.prepare(query);let args=[];
    return {bind(...v){args=v;return this;},
      async first(){return stmt.get(...args)||null;},
      async all(){return {results:stmt.all(...args)};},
      async run(){return {meta:stmt.run(...args)};}};
  }};
  const reply=(data,status=200)=>Response.json(data,{status});
  const fail=(error,status)=>Response.json({error},{status});
  const route=(action,body={},uid='adult-a')=>handleRoyalAce({
    request:new Request('https://example.test/api/v1/royal-ace/'+action,{
      method:action==='state'?'GET':'POST',
      ...(action==='state'?{}:{body:JSON.stringify(body),headers:{'content-type':'application/json'}})}),
    db,uid,action,reply,fail,cors:{}
  });
  const enable=()=>{
    sqlite.prepare('UPDATE sharika_royal_ace_settings SET enabled=1 WHERE id=1').run();
    sqlite.prepare("UPDATE sharika_game_catalog SET enabled=1 WHERE id='royal-ace'").run();
  };
  return {sqlite,route,enable};
}
test('server uses bounded 5x4 grids and caps win',()=>{
  assert.throws(()=>simulateRoyalAce(0),/invalid_royal_round/);
  for(let i=0;i<150;i++){
    const g=simulateRoyalAce(1000,false,100000);
    assert.ok(g.steps.length>=1&&g.steps.length<=9);
    assert.ok(g.win>=0&&g.win<=10000,'A 1000-coin spin must never pay more than 10x');
    assert.ok([0,10].includes(g.bonusSpins));
    for(const step of g.steps){
      assert.equal(step.grid.length,5);
      for(const col of step.grid){assert.equal(col.length,4);
        for(const cell of col)assert.ok(Number.isInteger(cell.s)&&cell.s>=0&&cell.s<=10);
      }
    }
  }
});
test('staging migration starts game disabled and does not alter player balance',async()=>{
  const {sqlite,route}=fixture();
  assert.equal(sqlite.prepare("SELECT enabled FROM sharika_game_catalog WHERE id='royal-ace'").get().enabled,0);
  assert.equal((await route('state')).status,403);
  assert.equal(sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='adult-a'").get().coins,1000000);
  sqlite.close();
});
test('server validates bets, adults, idempotency and wallet ledger',async()=>{
  const {sqlite,route,enable}=fixture();enable();
  assert.equal((await route('spin',{bet:-1,requestId:'ra_badbet_100',buy:false})).status,400);
  assert.equal((await route('spin',{bet:1000,requestId:'ra_minor_10001',buy:false},'minor-b')).status,403);
  const req={bet:1000,requestId:'ra_idempotency_00001',buy:false};
  const first=await route('spin',req);
  assert.equal(first.status,200);
  const a=await first.json();
  assert.equal(a.settled,true);
  assert.ok(a.steps.length>=1);
  assert.equal(a.balance,1000000-1000+a.win);
  const again=await (await route('spin',req)).json();
  assert.deepEqual(again,a);
  assert.equal((await route('spin',{...req,buy:true})).status,409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_royal_ace_rounds').get().n,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sharika_wallet_ledger WHERE reason='royal_ace_bet'").get().n,1);
  assert.equal((await route('spin',{bet:1000,requestId:'ra_second_0000001',buy:false})).status,429);
  sqlite.close();
});
test('two eligible users have independent rounds, balances and ledger entries',async()=>{
  const {sqlite,route,enable}=fixture();enable();
  const a={bet:1000,requestId:'ra_parallel_a_00001',buy:false};
  const c={bet:1000,requestId:'ra_parallel_c_00001',buy:false};
  const [first,second]=await Promise.all([route('spin',a,'adult-a'),route('spin',c,'adult-c')]);
  assert.equal(first.status,200);assert.equal(second.status,200);
  const [ar,cr]=await Promise.all([first.json(),second.json()]);
  assert.equal(ar.balance,999000+ar.win);assert.equal(cr.balance,999000+cr.win);
  assert.equal(sqlite.prepare('SELECT COUNT(DISTINCT user_uid) AS n FROM sharika_royal_ace_rounds').get().n,2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sharika_wallet_ledger WHERE reason='royal_ace_bet'").get().n,2);
  assert.equal((await route('state',{},'adult-c')).status,200);
  const repeat=await (await route('spin',c,'adult-c')).json();
  assert.deepEqual(repeat,cr);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_royal_ace_rounds').get().n,2);
  sqlite.close();
});
test('two eligible adults can spin independently with the same client request ID',async()=>{
  const {sqlite,route,enable}=fixture();enable();
  const shared={bet:1000,requestId:'ra_two_adults_00001',buy:false};
  const first=await route('spin',shared,'adult-a');
  const second=await route('spin',shared,'adult-c');
  assert.equal(first.status,200);
  assert.equal(second.status,200);
  const a=await first.json(),b=await second.json();
  const balanceA=sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='adult-a'").get().coins;
  const balanceB=sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='adult-c'").get().coins;
  assert.equal(balanceA,1000000-1000+a.win);
  assert.equal(balanceB,1000000-1000+b.win);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_royal_ace_rounds').get().n,2);
  assert.deepEqual(await (await route('spin',shared,'adult-c')).json(),b,'retry must not debit again');
  sqlite.close();
});
test('bonus purchase debits exactly 10x and server owns 10 free spins',async()=>{
  const {sqlite,route,enable}=fixture();enable();
  const buy=await route('spin',{bet:1000,requestId:'ra_buy_0000000001',buy:true});
  assert.equal(buy.status,200);
  const b=await buy.json();
  assert.equal(b.balance,990000);assert.equal(b.freeSpins,10);
  assert.equal(b.win,0);assert.equal(b.steps.length,0);
  assert.equal((await route('spin',{bet:10000,requestId:'ra_mismatch_00001',buy:false})).status,409);
  // Bypass wall-clock delay for this follow-up; it exercises the persisted free counter.
  sqlite.prepare('UPDATE sharika_royal_ace_rounds SET created_ms=1 WHERE id=1').run();
  const free=await route('spin',{bet:1000,requestId:'ra_free_000000001',buy:false});
  assert.equal(free.status,200);
  const x=await free.json();
  assert.equal(x.mode,'free');
  assert.equal(x.balance,990000+x.win);
  assert.equal(x.freeSpins,9+x.bonusSpins);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sharika_wallet_ledger WHERE reason='royal_ace_bonus'").get().n,1);
  sqlite.close();
});
test('source artwork, server-only financial bridge, room and Play Store gates remain explicit',()=>{
  const html=readFileSync(new URL('../../android-staging/app/src/main/assets/original-games/royal-ace-deluxe.html',import.meta.url),'utf8');
  const bridge=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  assert.ok(html.length>400000);
  assert.match(html,/sharika-royal-ace-server/);
  assert.doesNotMatch(html,/localStorage\.setItem\('sa_bal'/);
  assert.match(html,/royal-ace-loader\.svg/);
  assert.match(html,/7\.5% of gross/);
  assert.doesNotMatch(html,/10,000x the bet|10,000× bet/,'Published game rules cannot claim a false maximum');
  assert.match(html,/Retry connection/);
  assert.match(html,/maximum 10× stake per spin/);
  assert.match(html,/Reconnecting safely/);
  assert.match(bridge,/file:\/\/\/android_asset\/royal-ace-card\.svg/);
  assert.match(bridge,/event\.source!==current\.element\.contentWindow/);
  assert.match(bridge,/preview\(greedyGame\)/);
  const loader=readFileSync(new URL('../../android-staging/app/src/main/assets/original-games/royal-ace-loader.svg',import.meta.url),'utf8');
  assert.match(loader,/<svg/);
  assert.match(loader,/data:image\/webp;base64,UklG/);
  const match=loader.match(/href="data:image\/webp;base64,([^"]+)"/);
  assert.ok(match,'original screenshot must be embedded in the packaged offline SVG');
  const bytes=Buffer.from(match[1],'base64');
  assert.ok(bytes.length>25000,'full-quality loading screenshot unexpectedly truncated');
  assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.toString('ascii',8,12),'WEBP');
});

test('Buy Bonus cost and user-visible rules match the staging D1 validation and no old 50x price survives',()=>{
  const engine=readFileSync(new URL('../src/royal-ace.mjs',import.meta.url),'utf8');
  const html=readFileSync(new URL('../../android-staging/app/src/main/assets/original-games/royal-ace-deluxe.html',import.meta.url),'utf8');
  const validator=sql('0099_royal_ace_bonus_buy_10x.sql');
  assert.match(engine,/cost=b\.buy\?b\.bet\*10/);
  assert.match(validator,/ELSE NEW\.bet\*10 END/);
  assert.match(validator,/royal_ace_validate_transition/);
  assert.match(html,/Buy 10 Free Spins for/);
  assert.match(html,/10× your bet/);
  assert.doesNotMatch(html,/bet\*50|amount\*50|50x bet|50× your bet/);
});

test('Android bridge permits only verified Royal Ace staging endpoints and denies Play',()=>{
  const java=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.match(java,/path\.equals\("\/api\/v1\/royal-ace\/state"\).*"GET"/);
  assert.match(java,/path\.equals\("\/api\/v1\/royal-ace\/spin"\).*"POST"/);
  assert.match(java,/game-catalog\|cleopatra\|royal-ace\|lucky-box/);
  assert.match(worker,/gameAcceptsBets\(env\.DB,'royal-ace'\)/);
  assert.match(worker,/handleRoyalAce\(/);
});


test('SuperAce capped RTP applies to paid and bonus rounds',()=>{
  for(const stake of [1000,10000,100000])for(const free of [false,true]){
    for(let i=0;i<30;i++){
      const result=simulateRoyalAce(stake,free,100000000);
      assert.ok(result.win>=0&&result.win<=stake*10,'Payout must remain below 10x');
      assert.ok(result.steps.length<=9);
    }
  }
});


test('cascade receipt payouts add up to the settled total, including rounding and caps',()=>{
  const original=crypto.getRandomValues.bind(crypto);
  let seed=123456789;
  crypto.getRandomValues=a=>{
    for(let i=0;i<a.length;i++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;a[i]=seed;
    }
    return a;
  };
  try{
    for(const cap of [100000000,37])for(const free of [false,true]){
      for(let i=0;i<200;i++){
        const round=simulateRoyalAce(1000,free,cap);
        const payouts=round.steps.map(s=>s.payout||0);
        assert.ok(payouts.every(n=>Number.isSafeInteger(n)&&n>=0));
        assert.equal(payouts.reduce((a,b)=>a+b,0),round.win);
        assert.ok(round.win<=Math.min(10000,cap));
      }
    }
  }finally{crypto.getRandomValues=original;}
});

test('legacy rejected stake returns a readable error without changing wallet or rounds',async()=>{
  const {sqlite,route,enable}=fixture();enable();
  try{
    const res=await route('spin',{bet:1234,requestId:'ra_legacy_stake_001',buy:false});
    assert.equal(res.status,400);
    assert.equal((await res.json()).error,'invalid_bet');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_royal_ace_rounds').get().n,0);
    assert.equal(sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='adult-a'").get().coins,1000000);
    sqlite.prepare('UPDATE sharika_royal_ace_settings SET max_win=34567 WHERE id=1').run();
    assert.equal((await (await route('state')).json()).maxWin,34567);
  }finally{sqlite.close();}
});
