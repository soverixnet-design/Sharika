import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {agencyRoomActivityStatements,recordAgencyRoomActivity} from '../src/agency-room-time.mjs';

function mockDb(eligible){
  let batches=[];
  return {batches,prepare(sql){return {sql,bind(...values){return {...this,values,first:async()=>eligible?{eligible:1}:null};}};},
    async batch(statements){batches.push(statements);}};
}

test('only approved roles cause activity writes; ordinary users keep free presence',async()=>{
  const noRole=mockDb(false);
  assert.equal(await recordAgencyRoomActivity(noRole,'ordinary','12345678',123000),false);
  assert.equal(noRole.batches.length,0);
  const host=mockDb(true);
  assert.equal(await recordAgencyRoomActivity(host,'host','12345678',123000),true);
  assert.equal(host.batches[0].length,2);
  assert.equal(await recordAgencyRoomActivity(host,'host',null,123100),true);
  assert.equal(host.batches[1].length,1);
});

test('credit is bounded to continuous verified visits in same room and UTC day',()=>{
  const db=mockDb(true);
  const t=Date.parse('2026-11-04T23:59:50.000Z');
  const statements=agencyRoomActivityStatements(db,'host','12345678',t);
  assert.deepEqual(statements[0].values,
    ['host','2026-11-04','12345678',t,'host','12345678','2026-11-04',t-60000,t-1000]);
  assert.match(statements[0].sql,/c.room_id=\? AND c.utc_day=\?/);
  assert.match(statements[0].sql,/c.last_seen_ms BETWEEN \? AND \?/);
  assert.match(statements[1].sql,/last_seen_ms=MAX/);
  const next=agencyRoomActivityStatements(db,'host','12345678',t+20000);
  assert.equal(next[0].values[1],'2026-11-05');
  assert.throws(()=>agencyRoomActivityStatements(db,'host','not-a-room',t),/invalid_agency_presence/);
});

test('Agency Host manager uses real public IDs and retains verified activity breakdown',()=>{
  const root=new URL('../../android-staging/',import.meta.url);
  const ui=readFileSync(new URL('agency-center.js',root),'utf8');
  const api=readFileSync(new URL('../src/agency.mjs',import.meta.url),'utf8');
  const server=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  for(const part of ['Real ID ','Daily Room Activity','Time by Room','active_seconds',
    'activity_by_day','activity_by_room'])assert.ok(ui.includes(part),part);
  for(const part of ['bd_profile','owner_id','owner_today_seconds','activity_by_room',
    'today_seconds','activity_source'])assert.ok(api.includes(part),part);
  assert.match(server,/roomAndMember\(env.DB,roomId,uid\)/);
  assert.match(server,/recordAgencyRoomActivity\(env.DB,uid,roomId\)/);
  assert.doesNotMatch(ui,/Special ID/);
});
