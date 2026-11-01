import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleBondApp} from '../src/bonds.mjs';
import {cpWeekStart,readCpRewardBoard,settleLastCpWeek,handleCpRewardAdmin}
  from '../src/cp-rewards.mjs';

const MONDAY=Date.UTC(2026,10,2,12);
const FRIDAY=Date.UTC(2026,9,30,12);
const IDS=['10000001','10000002','10000003','10000004'];
const winnerRules=()=>Array.from({length:7},(_,index)=>({rank:index+1,
  coins_each:index===0?700:0,
  frame_item_id:index===0?'frame_style:royal-gold':null,
  medal_item_id:index===0?'medal_style:gold':null}));

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  const folder=new URL('../migrations/',import.meta.url);
  for(const name of readdirSync(folder).filter(file=>file.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(new URL(name,folder),'utf8'));
  for(let i=0;i<4;i++)sqlite.prepare('INSERT INTO sharika_users'+
    '(public_no,auth_uid,name,birthdate,minor,coins) VALUES(?,?,?,?,?,?)')
    .run(Number(IDS[i]),'person-'+i,'Person '+i,'2000-01-01',0,50_000);
  const db={
    prepare(sql){let params=[];
      const stmt={bind(...values){params=values;return stmt;},
        async first(){return sqlite.prepare(sql).get(...params)||null;},
        async all(){return {results:sqlite.prepare(sql).all(...params)};},
        async run(){const result=sqlite.prepare(sql).run(...params);
          return {meta:{changes:result.changes,last_row_id:Number(result.lastInsertRowid)}};}};
      return stmt;
    },
    async batch(statements){sqlite.exec('BEGIN IMMEDIATE');
      try{const list=[];for(const stmt of statements)list.push(await stmt.run());
        sqlite.exec('COMMIT');return list;}
      catch(error){sqlite.exec('ROLLBACK');throw error;}}
  };
  const reply=(value,status=200)=>Response.json(value,{status});
  const fail=(code,status)=>reply({error:code},status);
  const app=async(uid,path,method='GET',payload=null,nowMs=FRIDAY)=>{
    const request=new Request('https://staging.example/api/v1'+path,{
      method,...(payload===null?{}:{body:JSON.stringify(payload)})});
    const response=await handleBondApp({request,env:{DB:db},uid,
      path:'/api/v1'+path,cors:{},reply,fail,nowMs});
    return {status:response.status,data:await response.json()};
  };
  const admin=async(role,operation,method='GET',payload=null)=>{
    const request=new Request('https://staging.example/api/v1/admin/'+operation,{
      method,...(payload===null?{}:{body:JSON.stringify(payload)})});
    const response=await handleCpRewardAdmin({request,env:{DB:db},uid:'person-3',
      actor:{role},operation,cors:{},reply,fail});
    return {status:response.status,data:await response.json()};
  };
  return {sqlite,db,app,admin};
}

async function createVerifiedCp(app){
  const request={gift_id:1,recipient_public_id:IDS[1],request_id:'cp-reward-test-invite-1'};
  const invite=await app('person-0','/bonds/invite','POST',request);
  assert.equal(invite.status,201);
  const accept=await app('person-1','/bonds/invites/'+invite.data.invite_id+'/respond',
    'POST',{accept:true});
  assert.equal(accept.status,201);
  return accept.data.bond_id;
}

test('CP weekly rules are disabled and migration does not alter wallets',async()=>{
  const {sqlite,db}=fixture();
  try{
    const board=await readCpRewardBoard(db,MONDAY);
    assert.equal(board.policy.enabled,false);
    assert.equal(board.policy.auto_award,false);
    assert.equal(board.rules.length,7);
    assert.ok(board.rules.every(rule=>rule.coins_each===0));
    assert.equal(sqlite.prepare('SELECT SUM(coins) AS n FROM sharika_users').get().n,200_000);
    assert.deepEqual(await settleLastCpWeek(db,MONDAY,'system',true),{skipped:'disabled'});
  }finally{sqlite.close();}
});

test('Super Admin configures top seven, Finance only reads; invalid item is rejected',async()=>{
  const {sqlite,admin}=fixture();
  try{
    const payload={enabled:true,auto_award:false,rules:winnerRules()};
    assert.equal((await admin('finance','bonds/rewards','PATCH',payload)).status,403);
    assert.equal((await admin('super','bonds/rewards','PATCH',{
      ...payload,rules:payload.rules.map((r,i)=>i===0?{...r,frame_item_id:'medal_style:gold'}:r)
    })).status,400);
    const saved=await admin('super','bonds/rewards','PATCH',payload);
    assert.equal(saved.status,200);
    assert.equal(saved.data.policy.enabled,true);
    const view=await admin('finance','bonds/rewards');
    assert.equal(view.status,200);
    assert.equal(view.data.read_only,true);
    assert.equal(view.data.rules[0].coins_each,700);
    assert.equal(view.data.rules[0].frame_name,'Royal Gold');
    assert.equal(view.data.assets.some(item=>item.id==='medal_style:gold'),true);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_cp_reward_batches').get().n,0);
  }finally{sqlite.close();}
});

test('Completed CP week awards BOTH partners exactly once with ledger and cosmetics',async()=>{
  const {sqlite,db,app,admin}=fixture();
  try{
    const bondId=await createVerifiedCp(app);
    // Breaking a relationship after the UTC boundary cannot erase a pair
    // that was still together when the winning week finished.
    assert.equal((await app('person-1','/bonds/'+bondId+'/unbind','POST',{},
      MONDAY+1000)).status,200);
    await admin('super','bonds/rewards','PATCH',{
      enabled:true,auto_award:false,rules:winnerRules()});
    const before=sqlite.prepare('SELECT coins FROM sharika_users WHERE auth_uid=?');
    const a=before.get('person-0').coins,b=before.get('person-1').coins;
    assert.equal((await settleLastCpWeek(db,MONDAY,'system',true)).skipped,'auto_not_active');
    assert.equal(before.get('person-0').coins,a);
    const settled=await settleLastCpWeek(db,MONDAY,'person-3',false);
    assert.equal(settled.awarded,true);
    assert.equal(settled.winner_count,1);
    assert.equal(settled.recipients,2);
    assert.equal(before.get('person-0').coins,a+700);
    assert.equal(before.get('person-1').coins,b+700);
    const ledger=sqlite.prepare("SELECT auth_uid,delta FROM sharika_wallet_ledger "+
      "WHERE reason='cp_weekly_reward'").all();
    assert.equal(ledger.length,2);
    assert.deepEqual(ledger.map(entry=>entry.delta),[700,700]);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sharika_cosmetic_inventory "+
      "WHERE request_id LIKE 'cpweek:%'").get().n,4);
    const duplicate=await settleLastCpWeek(db,MONDAY+5000,'person-3',false);
    assert.equal(duplicate.duplicate,true);
    assert.equal(before.get('person-0').coins,a+700);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sharika_wallet_ledger "+
      "WHERE reason='cp_weekly_reward'").get().n,2);
    assert.throws(()=>sqlite.prepare('UPDATE sharika_cp_reward_member_awards SET coins=0').run(),
      /cp_reward_receipt_immutable/);
    assert.throws(()=>sqlite.prepare('DELETE FROM sharika_cp_reward_winners').run(),
      /cp_reward_winner_immutable/);
    const board=await readCpRewardBoard(db,MONDAY);
    assert.equal(board.last_week.awarded,true);
    assert.equal(board.last_week.leaders[0].reward.coins_each,700);
    assert.equal(board.last_week.leaders[0].reward.medal_name,'Gold');
    assert.equal(board.last_week.leaders[0].a.id,IDS[0]);
    assert.equal(cpWeekStart(MONDAY),Date.UTC(2026,10,2));
  }finally{sqlite.close();}
});

test('A completed empty CP week closes once without fabricating payouts',async()=>{
  const {sqlite,db,admin}=fixture();
  try{
    await admin('super','bonds/rewards','PATCH',{
      enabled:true,auto_award:false,rules:winnerRules()});
    const result=await settleLastCpWeek(db,MONDAY,'person-3',false);
    assert.equal(result.winner_count,0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_cp_reward_member_awards').get().n,0);
    assert.equal((await settleLastCpWeek(db,MONDAY,'person-3',false)).duplicate,true);
  }finally{sqlite.close();}
});

test('Android bridge exposes only authenticated GET for the new CP reward board',()=>{
  const android=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
  const bridge=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const admin=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');
  assert.match(android,/path\.equals\("\/api\/v1\/bonds\/rewards"\)/);
  assert.match(bridge,/api\('GET','\/bonds\/rewards'\)/);
  assert.match(bridge,/This Week/);
  assert.match(bridge,/Last Week/);
  assert.match(bridge,/sh-cp-toplist/);
  assert.match(admin,/bonds\/rewards\/settle/);
  assert.match(admin,/Coins each/);
});
