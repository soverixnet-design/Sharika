import test from 'node:test';
import assert from 'node:assert/strict';
import {readVerifiedRankings,verifiedRankingWindow} from '../src/verified-rankings.mjs';

function fixture(rows=[]){
  const calls=[];
  return {calls,prepare(sql){
    return {bind(...params){calls.push({sql,params});return this;},
      async all(){return {results:rows};}};
  }};
}

test('verified activity windows use UTC, Monday weeks, and half-open month ends',()=>{
  const now=Date.parse('2026-11-06T17:20:10Z');
  const day=verifiedRankingWindow('daily',now);
  assert.equal(day.start.toISOString(),'2026-11-06T00:00:00.000Z');
  assert.equal(day.end.toISOString(),'2026-11-07T00:00:00.000Z');
  const week=verifiedRankingWindow('weekly',now);
  assert.equal(week.start.toISOString(),'2026-11-02T00:00:00.000Z');
  assert.equal(week.end.toISOString(),'2026-11-09T00:00:00.000Z');
  const month=verifiedRankingWindow('monthly',Date.parse('2026-12-31T23:59:00Z'));
  assert.equal(month.start.toISOString(),'2026-12-01T00:00:00.000Z');
  assert.equal(month.end.toISOString(),'2027-01-01T00:00:00.000Z');
  assert.equal(verifiedRankingWindow('yearly',now),null);
});

test('sending ranking uses only trusted gift events and hides a real ID behind Special ID',async()=>{
  const db=fixture([{
    public_no:10000001,special_id:'4567',name:'Royal Sender',pic:null,
    wealth_level:2,charm_level:3,total:'10000000000000000',
    equipped_frame_style:'royal-gold',equipped_medal_style:'gold',
    equipped_name_tag_style:'legend'
  }]);
  const result=await readVerifiedRankings(db,{kind:'sending',period:'weekly',
    now:Date.parse('2026-11-06T12:00:00Z')});
  assert.equal(result.source,'verified_activity_events');
  assert.equal(result.coverage,'post_migration_only');
  assert.equal(result.leaders[0].total,'10000000000000000');
  assert.equal(result.leaders[0].display_id,'4567');
  assert.equal(result.leaders[0].frame_style,'royal-gold');
  assert.equal(Object.hasOwn(result.leaders[0],'public_id'),false);
  assert.equal(db.calls.length,1);
  assert.deepEqual(db.calls[0].params,[
    'gift_sent','2026-11-02 00:00:00','2026-11-09 00:00:00'
  ]);
  assert.match(db.calls[0].sql,/FROM sharika_verified_activity_events e/);
  assert.match(db.calls[0].sql,/e.occurred_at>=\? AND e.occurred_at<\?/);
  assert.match(db.calls[0].sql,/SUM\(e.amount_coins\)/);
  assert.match(db.calls[0].sql,/u.status='active'/);
  assert.doesNotMatch(db.calls[0].sql,/UPDATE |INSERT |DELETE /);
});

test('recharge reads approved recharge events, not other wallet credits',async()=>{
  const db=fixture([{public_no:10000002,name:'Buyer',total:'500000'}]);
  const result=await readVerifiedRankings(db,{kind:'recharge',period:'daily',
    now:Date.parse('2026-11-06T12:00:00Z')});
  assert.equal(result.leaders[0].display_id,'10000002');
  assert.equal(result.units,'coins');
  assert.equal(db.calls[0].params[0],'recharge_approved');
});

test('game supports explicit wins, stake and payout metrics with bound game code',async()=>{
  const db=fixture([{public_no:10000003,name:'Player',total:'3'}]);
  const result=await readVerifiedRankings(db,{kind:'game',period:'monthly',
    metric:'wins',game:'fruit-royale',now:Date.parse('2026-11-06T12:00:00Z')});
  assert.equal(result.metric,'wins');
  assert.equal(result.units,'wins');
  assert.deepEqual(db.calls[0].params,[
    'game_settled','2026-11-01 00:00:00','2026-12-01 00:00:00','fruit-royale'
  ]);
  assert.match(db.calls[0].sql,/SUM\(CASE WHEN e.payout_coins>0 THEN 1 ELSE 0 END\)/);
  assert.match(db.calls[0].sql,/AND e.game_code=\?/);
  const stakes=await readVerifiedRankings(db,{kind:'game',metric:'stake'});
  assert.equal(stakes.units,'coins');
  assert.match(db.calls[1].sql,/SUM\(e.amount_coins\)/);
  await readVerifiedRankings(db,{kind:'game',metric:'payout'});
  assert.match(db.calls[2].sql,/SUM\(e.payout_coins\)/);
});

test('unrecognized filters never reach the database',async()=>{
  const db=fixture();
  for(const options of [
    {kind:'other'},{period:'yearly'},{kind:'game',metric:'profit'},
    {kind:'game',game:'fake-game'},{kind:'sending',metric:'wins'},
    {kind:'recharge',game:'food-wheel'}
  ])assert.equal(await readVerifiedRankings(db,options),null);
  assert.equal(db.calls.length,0);
});
