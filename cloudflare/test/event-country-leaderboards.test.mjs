// Isolated SQLite: event audience gates must constrain real leaderboard points.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleEventApp,handleEventAdmin} from '../src/events.mjs';
import {eventAudienceSqlExpression} from '../src/event-audience.mjs';
const reply=(data,code=200)=>Response.json(data,{status:code});
const fail=(error,code=400)=>Response.json({error},{status:code});
const start='2026-11-20T00:00:00.000Z',end='2026-11-21T00:00:00.000Z';
function fixture(scoring='game_wins',audience='BD'){
 const sql=new DatabaseSync(':memory:');
 sql.exec([
 "CREATE TABLE sharika_users(auth_uid TEXT PRIMARY KEY,public_no INTEGER,name TEXT,pic TEXT,country TEXT,status TEXT,coins INTEGER)",
 "CREATE TABLE sharika_events(id INTEGER PRIMARY KEY,title TEXT,starts_at TEXT,ends_at TEXT,status TEXT,prize_1 INTEGER,prize_2 INTEGER,prize_3 INTEGER,gift_rules_json TEXT,scoring_mode TEXT,country_code TEXT)",
 "CREATE TABLE sharika_center_publishing(kind TEXT,id TEXT,published INTEGER)",
 "CREATE TABLE sharika_wallet_ledger(id INTEGER PRIMARY KEY,auth_uid TEXT,currency TEXT,delta INTEGER,reason TEXT,created_at TEXT)",
 "CREATE TABLE sharika_gift_events(id INTEGER PRIMARY KEY,sender_uid TEXT,gift_id INTEGER,quantity INTEGER,created_at TEXT)",
 "CREATE TABLE sharika_special_ids(auth_uid TEXT,special_id TEXT,expires_at TEXT)",
 "CREATE TABLE sharika_bonds(id INTEGER PRIMARY KEY,type TEXT,uid_a TEXT,uid_b TEXT)",
 "CREATE TABLE sharika_bond_gift_events(id INTEGER PRIMARY KEY,bond_id INTEGER,type TEXT,value_coins INTEGER,created_at_ms INTEGER)",
 "CREATE TABLE sharika_event_awards(id INTEGER PRIMARY KEY,event_id INTEGER,rank INTEGER,auth_uid TEXT,coins INTEGER)"
 ].join(';\n')+';');
 for(const [uid,country,no] of [
  ['bd','Bangladesh',10000001],['bd2','BD',10000002],
  ['in','India',10000003],['unknown','',10000004]]){
  sql.prepare("INSERT INTO sharika_users(auth_uid,public_no,name,pic,country,status,coins) VALUES(?,?,?,?,?,'active',0)")
  .run(uid,no,uid,null,country);
 }
 sql.prepare("INSERT INTO sharika_events VALUES(1,'Event QA',?,?,?,100,50,25,?,?,?)")
 .run(start,end,'published',JSON.stringify([{gift_id:9,points:10}]),scoring,audience);
 sql.exec("INSERT INTO sharika_center_publishing VALUES('event','event:1',1)");
 const db={
  prepare(q){
   const stmt=sql.prepare(q);
   const mapped=(args)=>({
    async first(){return stmt.get(...args)||null;},
    async all(){return {results:stmt.all(...args)};},
    async run(){return stmt.run(...args);}
   });
   return {bind(...args){return mapped(args)},first:mapped([]).first,all:mapped([]).all};
  }
 };
 const run=(uid='bd',id=1)=>handleEventApp({
   request:new Request('https://test.invalid/api/v1/events/'+id+'/ranking'),
   path:'/api/v1/events/'+id+'/ranking',env:{DB:db},uid,cors:{},reply,fail
 });
 return {sql,db,run};
}
test('Game Event excludes other countries even when they have more settled wins',async()=>{
 const x=fixture('game_wins');
 try{
  for(const [uid,delta] of [['bd',125],['in',2000000],['unknown',4000],['bd2',75]])
   x.sql.prepare("INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,reason,created_at) VALUES(?,'coins',?,'royal_slots_win','2026-11-20 06:00:00')").run(uid,delta);
  const response=await x.run('bd');
  assert.equal(response.status,200);
  const board=(await response.json()).ranking;
  assert.deepEqual(board.map(x=>x.public_id),['10000001','10000002']);
  assert.deepEqual(board.map(x=>x.points),[125,75]);
  assert.equal((await x.run('in')).status,403);
 }finally{x.sql.close()}
});
test('Gift Event only counts settled gifts from selected-country senders',async()=>{
 const x=fixture('gift_points');
 try{
  for(const [uid,quantity] of [['bd',4],['bd2',2],['in',1000]])
   x.sql.prepare("INSERT INTO sharika_gift_events(sender_uid,gift_id,quantity,created_at) VALUES(?,9,?,'2026-11-20 06:00:00')").run(uid,quantity);
  const response=await x.run();
  assert.equal(response.status,200);
  const board=(await response.json()).ranking;
  assert.deepEqual(board.map(x=>x.public_id),['10000001','10000002']);
  assert.deepEqual(board.map(x=>x.points),[40,20]);
 }finally{x.sql.close()}
});
test('CP Event includes only pairs whose BOTH verified members are eligible',async()=>{
 const x=fixture('cp_gifts');
 try{
  for(const [id,uidA,uidB,coins] of [[1,'bd','bd2',900],[2,'bd','in',200000]]){
   x.sql.prepare("INSERT INTO sharika_bonds VALUES(?,'cp',?,?)").run(id,uidA,uidB);
   x.sql.prepare("INSERT INTO sharika_bond_gift_events(bond_id,type,value_coins,created_at_ms) VALUES(?,'cp',?,?)")
    .run(id,coins,Date.parse('2026-11-20T06:00:00Z'));
  }
  const response=await x.run();
  assert.equal(response.status,200);
  const board=(await response.json()).ranking;
  assert.equal(board.length,1);
  assert.equal(board[0].public_id,'10000001 / 10000002');
  assert.equal(board[0].points,900);
 }finally{x.sql.close()}
});
test('event reward cannot credit a user outside target country',async()=>{
 const x=fixture('gift_points');
 try{
  x.sql.exec("UPDATE sharika_events SET starts_at='2020-11-20T00:00:00.000Z',ends_at='2020-11-21T00:00:00.000Z'");
  const response=await handleEventAdmin({
   request:new Request('https://test.invalid/api/v1/admin/events/1/award',{
    method:'POST',body:JSON.stringify({rank:1,public_id:'10000003',
      request_id:'test-country-award-ineligible-1'})}),
   env:{DB:x.db},uid:'admin',actor:{role:'super'},
   operation:'events/1/award',cors:{},reply,fail,ctx:{}
  });
  assert.equal(response.status,409);
  assert.equal((await response.json()).error,'event_recipient_country_ineligible');
  assert.equal(x.sql.prepare('SELECT COUNT(*) AS n FROM sharika_event_awards').get().n,0);
 }finally{x.sql.close()}
});
test('country SQL accepts only statically reviewed aliases',()=>{
 assert.match(eventAudienceSqlExpression('u'),/CASE UPPER\(TRIM\(u\.country\)\)/);
 assert.match(eventAudienceSqlExpression('z'),/WHEN 'BANGLADESH' THEN 'BD'/);
 assert.throws(()=>eventAudienceSqlExpression("u) OR 1=1 --"));
});
