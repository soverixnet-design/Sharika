import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {rankingRewardDashboard,settleLastRankingPeriod,
  handleRankingRewardAdmin,rewardBoardKey,settleAutomaticRankingRewards} from '../src/ranking-rewards.mjs';

const NOW=Date.UTC(2026,10,16,0,20);
const START='2026-11-09T00:00:00.000Z';
const PERIOD='2026-11-10 14:00:00';
const BOARD={kind:'sending',period:'weekly'};
const PRIZES=[700,400,0,0,0,0,0];
const TARGETS=[100,200,0,0,0,0,0];

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  const folder=new URL('../migrations/',import.meta.url);
  for(const name of readdirSync(folder).filter(file=>file.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(new URL(name,folder),'utf8'));
  for(let i=0;i<4;i++)sqlite.prepare('INSERT INTO sharika_users '+
    '(public_no,auth_uid,name,birthdate,minor,coins) VALUES(?,?,?,?,?,?)')
    .run(10000001+i,'person-'+i,'Person '+i,'2000-01-01',0,5000);
  const db={
    prepare(sql){let args=[];
      const statement={bind(...values){args=values;return statement;},
        async first(){return sqlite.prepare(sql).get(...args)||null;},
        async all(){return {results:sqlite.prepare(sql).all(...args)};},
        async run(){const result=sqlite.prepare(sql).run(...args);
          return {meta:{changes:result.changes,last_row_id:Number(result.lastInsertRowid)}};}};
      return statement;
    },
    async batch(statements){sqlite.exec('BEGIN IMMEDIATE');
      try{const out=[];for(const s of statements)out.push(await s.run());
        sqlite.exec('COMMIT');return out;}
      catch(error){sqlite.exec('ROLLBACK');throw error;}}
  };
  const env={DB:db,SHARIKA_AUTOMATIC_RANKING_REWARDS_ENABLED:'false'};
  const add=(uid,amount,ref,time=PERIOD)=>sqlite.prepare(
    'INSERT INTO sharika_verified_activity_events '+
    '(source_ref,event_type,user_uid,amount_coins,occurred_at) VALUES(?,?,?,?,?)'
  ).run(ref,'gift_sent',uid,amount,time);
  const policy=({enabled=true,auto_award=true,prizes=PRIZES,targets=TARGETS,
    effective=START,kind='sending',period='weekly',metric='coins',game=null}={})=>{
    const policy_key=rewardBoardKey({kind,period,metric,game});
    return sqlite.prepare('INSERT INTO sharika_ranking_reward_policies '+
      '(policy_key,kind,period,metric,game_code,targets_json,prizes_json,enabled,auto_award,effective_from,created_by) '+
      'VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(policy_key,kind,period,metric,game,
      JSON.stringify(targets),JSON.stringify(prizes),Number(enabled),Number(auto_award),
      effective,'person-3');
  };
  const admin=async(role,operation,method='GET',body,query='')=>{
    const request=new Request('https://staging.example/api/v1/admin/'+operation+query,{
      method,...(body===undefined?{}:{body:JSON.stringify(body)})});
    const reply=(data,status=200)=>Response.json(data,{status});
    const fail=(code,status)=>reply({error:code},status);
    const response=await handleRankingRewardAdmin({request,env,uid:'person-3',
      actor:{role},operation,cors:{},reply,fail});
    return {status:response.status,data:await response.json()};
  };
  return {sqlite,db,env,add,policy,admin};
}

test('new ranking reward migration is off, produces no wallets or seeded rules',async()=>{
  const f=fixture();
  try{
    const dashboard=await rankingRewardDashboard(f.db,BOARD,NOW);
    assert.equal(dashboard.paused,true);
    assert.equal(dashboard.policy,null);
    assert.equal(dashboard.coverage,'post_migration_only');
    assert.equal((await settleLastRankingPeriod(f.db,f.env,BOARD,NOW)).skipped,'no_published_rule');
    assert.equal(f.sqlite.prepare('SELECT SUM(coins) AS n FROM sharika_users').get().n,20_000);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_wallet_ledger').get().n,0);
  }finally{f.sqlite.close();}
});

test('Super Admin publishes future-only immutable audited rules, Finance read-only',async()=>{
  const f=fixture();
  try{
    const body={...BOARD,targets:TARGETS,prizes:PRIZES,enabled:true,auto_award:true};
    assert.equal((await f.admin('finance','ranking-rewards','PATCH',body)).status,403);
    assert.equal((await f.admin('super','ranking-rewards','PATCH',{
      ...body,prizes:[-1,...PRIZES.slice(1)]})).status,400);
    const result=await f.admin('super','ranking-rewards','PATCH',body);
    assert.equal(result.status,200);
    assert.ok(Date.parse(result.data.effective_from)>Date.now());
    const view=await f.admin('finance','ranking-rewards','GET',undefined,
      '?kind=sending&period=weekly');
    assert.equal(view.status,200);
    assert.equal(view.data.read_only,true);
    assert.deepEqual(view.data.policy.targets,TARGETS);
    assert.deepEqual(view.data.policy.prizes,PRIZES);
    assert.equal(view.data.paused,true);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_ranking_reward_batches').get().n,0);
    assert.throws(()=>f.sqlite.prepare('UPDATE sharika_ranking_reward_policies SET enabled=0').run(),
      /ranking_policy_immutable/);
    assert.throws(()=>f.sqlite.prepare('DELETE FROM sharika_ranking_reward_policies').run(),
      /ranking_policy_immutable/);
    assert.equal((await f.admin('super','ranking-rewards','GET',undefined,
      '?kind=game&period=weekly&metric=drop%20table')).status,400);
  }finally{f.sqlite.close();}
});

test('completed verified week pays matching rank targets once and writes immutable receipts',async()=>{
  const f=fixture();
  try{
    f.policy();f.add('person-0',300,'activity:a');f.add('person-1',250,'activity:b');
    f.add('person-2',40,'activity:c');
    f.sqlite.prepare('UPDATE sharika_ranking_reward_control SET paused=0 WHERE id=1').run();
    assert.equal((await settleLastRankingPeriod(f.db,f.env,BOARD,NOW)).skipped,'automatic_disabled');
    f.env.SHARIKA_AUTOMATIC_RANKING_REWARDS_ENABLED='true';
    const settled=await settleLastRankingPeriod(f.db,f.env,BOARD,NOW);
    assert.equal(settled.awarded,true);
    assert.equal(settled.winner_count,2);
    assert.equal(settled.awarded_coins,1100);
    assert.deepEqual(f.sqlite.prepare('SELECT coins FROM sharika_users ORDER BY public_no').all()
      .map(r=>r.coins),[5700,5400,5000,5000]);
    assert.deepEqual(f.sqlite.prepare("SELECT delta,reason FROM sharika_wallet_ledger "+
      "WHERE reason='verified_ranking_reward' ORDER BY id").all().map(row=>({...row})),[
      {delta:700,reason:'verified_ranking_reward'},
      {delta:400,reason:'verified_ranking_reward'}]);
    assert.equal((await settleLastRankingPeriod(f.db,f.env,BOARD,NOW)).duplicate,true);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_ranking_reward_batches').get().n,1);
    assert.throws(()=>f.sqlite.prepare('DELETE FROM sharika_ranking_reward_awards').run(),
      /ranking_award_immutable/);
    assert.throws(()=>f.sqlite.prepare('UPDATE sharika_ranking_reward_batches SET winner_count=0').run(),
      /ranking_batch_immutable/);
    const report=await rankingRewardDashboard(f.db,BOARD,NOW);
    assert.equal(report.last_completed.settled,true);
    assert.equal(report.last_completed.settlement.awarded_coins,1100);
  }finally{f.sqlite.close();}
});

test('a paused switch atomically rejects a settlement batch; manual confirmation and permissions apply',async()=>{
  const f=fixture();
  try{
    f.policy({auto_award:false});f.add('person-0',500,'activity:a');
    const paused=await settleLastRankingPeriod(f.db,f.env,BOARD,NOW,{automatic:false,issuer:'person-3'});
    assert.equal(paused.skipped,'paused');
    assert.throws(()=>f.sqlite.prepare('INSERT INTO sharika_ranking_reward_batches '+
      '(policy_key,policy_id,period_start,period_end,issued_by) VALUES(?,?,?,?,?)').run(
        rewardBoardKey({...BOARD,metric:'coins'}),1,START,'2026-11-16T00:00:00.000Z','person-3'),
    /ranking_rewards_paused/);
    assert.equal((await f.admin('finance','ranking-rewards/pause','POST',
      {paused:false,confirm:true})).status,403);
    assert.equal((await f.admin('super','ranking-rewards/pause','POST',
      {paused:false})).status,400);
    assert.equal((await f.admin('super','ranking-rewards/pause','POST',
      {paused:false,confirm:true})).status,200);
    const result=await settleLastRankingPeriod(f.db,f.env,BOARD,NOW,
      {automatic:false,issuer:'person-3'});
    assert.equal(result.awarded,true);
    assert.equal(result.winner_count,1);
  }finally{f.sqlite.close();}
});

test('future-only policy, period grace, thresholds and hidden Special ID respected',async()=>{
  const f=fixture();
  try{
    f.policy({effective:'2026-11-16T00:00:00.000Z'});
    f.add('person-0',400,'activity:a');
    f.sqlite.prepare('INSERT INTO sharika_special_ids (auth_uid,special_id,assigned_by) '+
      'VALUES(?,?,?)').run('person-0','7654','person-3');
    const preview=await rankingRewardDashboard(f.db,BOARD,NOW);
    assert.equal(preview.last_completed.candidates[0].display_id,'7654');
    assert.equal(JSON.stringify(preview).includes('10000001'),false);
    f.sqlite.prepare('UPDATE sharika_ranking_reward_control SET paused=0 WHERE id=1').run();
    assert.equal((await settleLastRankingPeriod(f.db,f.env,BOARD,NOW,
      {automatic:false})).skipped,'no_published_rule');
    f.policy({targets:[1000,2000,0,0,0,0,0]});
    assert.equal((await settleLastRankingPeriod(f.db,f.env,BOARD,NOW,
      {automatic:false})).winner_count,0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_wallet_ledger').get().n,0);
    assert.equal((await settleLastRankingPeriod(f.db,f.env,BOARD,
      Date.UTC(2026,10,16,0,1),{automatic:false})).skipped,'grace_period');
  }finally{f.sqlite.close();}
});

test('automatic cron is disabled without env flag and cannot invent recipients',async()=>{
  const f=fixture();
  try{
    f.policy();f.add('person-0',120,'activity:a');
    f.sqlite.prepare('UPDATE sharika_ranking_reward_control SET paused=0 WHERE id=1').run();
    assert.deepEqual(await settleAutomaticRankingRewards(f.db,f.env,NOW),{skipped:'flag_disabled'});
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_wallet_ledger').get().n,0);
  }finally{f.sqlite.close();}
});

test('approved recharge and game results use separate immutable source metrics',async()=>{
  const f=fixture();
  try{
    f.sqlite.prepare('INSERT INTO sharika_verified_activity_events '+
      '(source_ref,event_type,user_uid,amount_coins,occurred_at) VALUES(?,?,?,?,?)')
      .run('recharge:one','recharge_approved','person-0',2000,PERIOD);
    f.sqlite.prepare('INSERT INTO sharika_verified_activity_events '+
      '(source_ref,event_type,user_uid,amount_coins,payout_coins,game_code,occurred_at) '+
      'VALUES(?,?,?,?,?,?,?)').run('game:one','game_settled','person-1',100,200,
      'fruit-royale',PERIOD);
    f.sqlite.prepare('INSERT INTO sharika_verified_activity_events '+
      '(source_ref,event_type,user_uid,amount_coins,payout_coins,game_code,occurred_at) '+
      'VALUES(?,?,?,?,?,?,?)').run('game:two','game_settled','person-1',150,0,
      'fruit-royale',PERIOD);
    f.sqlite.prepare('INSERT INTO sharika_verified_activity_events '+
      '(source_ref,event_type,user_uid,amount_coins,payout_coins,game_code,occurred_at) '+
      'VALUES(?,?,?,?,?,?,?)').run('game:three','game_settled','person-2',800,0,
      'greedy-wheel',PERIOD);
    const recharge=await rankingRewardDashboard(f.db,{kind:'recharge',period:'weekly'},NOW);
    assert.equal(recharge.last_completed.candidates[0].score,'2000');
    const wins=await rankingRewardDashboard(f.db,{kind:'game',period:'weekly',
      metric:'wins',game:'fruit-royale'},NOW);
    assert.equal(wins.last_completed.candidates.length,1);
    assert.equal(wins.last_completed.candidates[0].score,'1');
    const stakes=await rankingRewardDashboard(f.db,{kind:'game',period:'weekly',
      metric:'stake',game:'fruit-royale'},NOW);
    assert.equal(stakes.last_completed.candidates[0].score,'250');
    const payouts=await rankingRewardDashboard(f.db,{kind:'game',period:'weekly',
      metric:'payout',game:'fruit-royale'},NOW);
    assert.equal(payouts.last_completed.candidates[0].score,'200');
    assert.equal(await rankingRewardDashboard(f.db,{kind:'game',period:'weekly',
      metric:'payout',game:"fruit-royale' OR 1=1 --"},NOW),null);
  }finally{f.sqlite.close();}
});

test('automatic 5-minute cron closes only eligible ended periods and retries safely',async()=>{
  const f=fixture();
  try{
    f.policy();f.add('person-0',130,'activity:a');
    f.sqlite.prepare('UPDATE sharika_ranking_reward_control SET paused=0 WHERE id=1').run();
    f.env.SHARIKA_AUTOMATIC_RANKING_REWARDS_ENABLED='true';
    const done=await settleAutomaticRankingRewards(f.db,f.env,NOW);
    assert.equal(done.boards.length,1);
    assert.equal(done.boards[0].awarded,true);
    assert.equal(done.boards[0].awarded_coins,700);
    const retried=await settleAutomaticRankingRewards(f.db,f.env,NOW);
    assert.equal(retried.boards[0].duplicate,true);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_wallet_ledger '+
      "WHERE reason='verified_ranking_reward'").get().n,1);
  }finally{f.sqlite.close();}
});
