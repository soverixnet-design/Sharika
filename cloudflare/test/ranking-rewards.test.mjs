import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {readRankingRewardPreview,handleRankingRewardAdmin}
  from '../src/ranking-rewards.mjs';

function fixture(){
  const raw=new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
  // The full shop migration depends on historical user-appearance columns;
  // this isolated fixture needs only its existing catalog reference contract.
  raw.exec("CREATE TABLE sharika_cosmetics_catalog (id TEXT PRIMARY KEY,kind TEXT,"+
    "name TEXT,active INTEGER);"+
    "INSERT INTO sharika_cosmetics_catalog VALUES("+
    "'frame_style:phoenix-fire','frame_style','Phoenix Fire',1);"+
    "INSERT INTO sharika_cosmetics_catalog VALUES("+
    "'entry_style:phoenix','entry_style','Phoenix Entry',1);");
  raw.exec(readFileSync(new URL(
    '../migrations/0074_royal_ranking_reward_display.sql',import.meta.url),'utf8'));
  const db={
    prepare(sql){
      const make=args=>({sql,args,
        async first(){return raw.prepare(sql).get(...args)||null;},
        async all(){return {results:raw.prepare(sql).all(...args)};},
        async run(){return raw.prepare(sql).run(...args);}
      });
      return {...make([]),bind(...args){return make(args);}};
    },
    async batch(statements){
      raw.exec('BEGIN');
      try{const result=statements.map(s=>raw.prepare(s.sql).run(...s.args));
        raw.exec('COMMIT');return result;
      }catch(error){raw.exec('ROLLBACK');throw error;}
    }
  };
  const invoke=({role='super',method='GET',body}={})=>handleRankingRewardAdmin({
    request:new Request('https://test.invalid/admin/ranking-rewards',{
      method,body:body?JSON.stringify(body):undefined
    }),db,uid:'admin-verified',role,
    reply:(data,status)=>({status,data}),
    fail:(error,status)=>({status,error}),cors:{}});
  return {raw,db,invoke};
}

function rules(){
  return Array.from({length:7},(_,i)=>({rank:i+1,coins:i===0?2000:0,
    display_days:7,frame_item_id:i===0?'frame_style:phoenix-fire':null,
    medal_item_id:null,entry_item_id:null}));
}

test('weekly preview defaults off and never changes coins or wallet ledger',async()=>{
  const {raw,db}=fixture();
  try{
    const result=await readRankingRewardPreview(db,'rich');
    assert.equal(result.rules.length,7);
    assert.equal(result.policy.enabled,false);
    assert.equal(result.automatic_awards,false);
    assert.equal(result.preview_only,true);
    assert.equal(await readRankingRewardPreview(db,'unsupported'),null);
    assert.equal(raw.prepare('SELECT count(*) AS n FROM sharika_wallet_ledger').get().n,0);
  }finally{raw.close();}
});

test('only verified Super Admin can configure Top 1-7 display, with audit and no payout',async()=>{
  const {raw,db,invoke}=fixture();
  try{
    const payload={kind:'rich',enabled:true,revision:0,rules:rules()};
    assert.equal((await invoke({role:'finance',method:'PATCH',body:payload})).status,403);
    assert.equal((await invoke({role:'support'})).status,403);
    const saved=await invoke({method:'PATCH',body:payload});
    assert.equal(saved.status,200);
    assert.equal(saved.data.policy.revision,1);
    assert.equal(saved.data.policy.enabled,true);
    assert.equal(saved.data.rules[0].coins,2000);
    assert.equal(saved.data.rules[0].frame_name,'Phoenix Fire');
    assert.equal(saved.data.preview_only,true);
    assert.equal(raw.prepare('SELECT count(*) AS n FROM sharika_rank_reward_audit').get().n,1);
    assert.equal(raw.prepare('SELECT count(*) AS n FROM sharika_wallet_ledger').get().n,0);
    assert.equal((await invoke({method:'PATCH',body:payload})).status,409);
    assert.equal((await invoke({role:'finance'})).status,200);
  }finally{raw.close();}
});

test('reward rules reject invalid assets, unknown ranks and forged coin amounts',async()=>{
  const {raw,invoke}=fixture();
  try{
    const bad=rules();bad[0].frame_item_id='entry_style:phoenix';
    assert.equal((await invoke({method:'PATCH',body:{kind:'room',enabled:true,
      revision:0,rules:bad}})).status,400);
    const dup=rules();dup[1].rank=1;
    assert.equal((await invoke({method:'PATCH',body:{kind:'room',enabled:true,
      revision:0,rules:dup}})).status,400);
    const forged=rules();forged[0].coins=1_000_001;
    assert.equal((await invoke({method:'PATCH',body:{kind:'room',enabled:true,
      revision:0,rules:forged}})).status,400);
    assert.equal(raw.prepare('SELECT count(*) AS n FROM sharika_rank_reward_audit').get().n,0);
  }finally{raw.close();}
});

test('reward box uses last completed UTC week and never client-credits prizes',()=>{
  const root=new URL('../../',import.meta.url);
  const ui=readFileSync(new URL('android-staging/staging-connection.js',root),'utf8');
  const worker=readFileSync(new URL('cloudflare/src/index.mjs',root),'utf8');
  const native=readFileSync(new URL('android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',root),'utf8');
  const back=readFileSync(new URL('android-staging/back-navigation.js',root),'utf8');
  assert.match(ui,/id='sh-rank-reward-box'/);
  assert.match(ui,/id='sh-rank-reward-center'/);
  assert.match(ui,/week_offset=1/);
  assert.match(ui,/end>start/);
  assert.match(ui,/leader\.display_id\|\|leader\.public_id/);
  assert.match(ui,/automatic/);
  assert.match(worker,/readRankingRewardPreview\(env\.DB,url\.searchParams\.get\('kind'\)\)/);
  assert.match(native,/api\/v1\/rankings\/rewards/);
  assert.match(back,/get\('sh-rank-reward-center'\)/);
});
