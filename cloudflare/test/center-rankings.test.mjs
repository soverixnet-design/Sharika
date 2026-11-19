import test from 'node:test';
import assert from 'node:assert/strict';
import {centerRankPeriod,readCenterRankings} from '../src/center-rankings.mjs';
const now=new Date('2026-11-20T10:00:00.000Z');
function fakeDb(rows){
 const calls=[];
 return {calls,prepare(sql){
  return {bind(...args){this.args=args;return this;},async all(){
   calls.push({sql,args:this.args});
   return {results:rows};
  }};
 }};
}
test('UTC day/week/month boundaries have no local timezone ambiguity',()=>{
 const day=centerRankPeriod('daily',now);
 assert.equal(day.start.toISOString(),'2026-11-20T00:00:00.000Z');
 assert.equal(day.end.toISOString(),'2026-11-21T00:00:00.000Z');
 const week=centerRankPeriod('weekly',now);
 assert.equal(week.start.toISOString(),'2026-11-16T00:00:00.000Z');
 assert.equal(week.end.toISOString(),'2026-11-23T00:00:00.000Z');
 const month=centerRankPeriod('monthly',now);
 assert.equal(month.start.toISOString(),'2026-11-01T00:00:00.000Z');
 assert.equal(month.end.toISOString(),'2026-12-01T00:00:00.000Z');
 assert.equal(centerRankPeriod('annual',now),null);
});
test('CP leaderboard uses only verified, settled CP gift events and shows both member names',async()=>{
 const db=fakeDb([{bond_id:31,a_id:10000001,a_name:'A',a_pic:null,
  b_id:10000002,b_name:'B',b_pic:null,total:56000}]);
 const got=await readCenterRankings(db,'weekly','cp',now);
 assert.equal(got.source,'settled_cp_gifts');
 assert.equal(got.leaders[0].total,56000);
 assert.equal(got.leaders[0].name,'A ♡ B');
 assert.equal(got.leaders[0].display_id,'10000001 · 10000002');
 assert.match(db.calls[0].sql,/JOIN sharika_bonds b ON b.id=e.bond_id/);
 assert.match(db.calls[0].sql,/WHERE e.type='cp'/);
 assert.deepEqual(db.calls[0].args,[Date.parse('2026-11-16T00:00:00Z'),
  Date.parse('2026-11-23T00:00:00Z'),Date.parse('2026-11-23T00:00:00Z'),
  Date.parse('2026-11-16T00:00:00Z')]);
});
test('BD and Agency earnings rankings read only actual settled agency ledger, not target projections',async()=>{
 for(const kind of ['bd','agency','host']){
  const db=fakeDb([{public_no:10000003,name:'Verified Member',pic:null,
   gift_count:4,total:12.25}]);
  const got=await readCenterRankings(db,'monthly',kind,now);
  assert.equal(got.source,'settled_agency_salary_ledger');
  assert.equal(got.unit,'salary coins');
  assert.equal(got.leaders[0].total,12.25);
  const query=db.calls[0];
  assert.match(query.sql,/FROM sharika_agency_earnings a/);
  assert.match(query.sql,/ON u.auth_uid=a.beneficiary_uid/);
  assert.match(query.sql,/a.created_at>=\? AND a.created_at<\?/);
  assert.deepEqual(query.args,[kind==='host'?'host_salary':kind,
   '2026-11-01 00:00:00','2026-12-01 00:00:00']);
 }
});
test('no fake winners when verified ledger has no entries',async()=>{
 const db=fakeDb([]);
 const got=await readCenterRankings(db,'weekly','bd',now);
 assert.deepEqual(got.leaders,[]);
 assert.equal(await readCenterRankings(db,'yearly','bd',now),null);
 assert.equal(await readCenterRankings(db,'weekly','unverified',now),null);
});
