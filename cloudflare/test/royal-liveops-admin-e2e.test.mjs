// Isolated SQLite end-to-end staging QA. Never calls production, staging D1,
// sends messages, credits actual coins, or publishes a real event.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleEventAdmin,handleEventApp} from '../src/events.mjs';
import {handlePrivateCenter} from '../src/private-center.mjs';
import {readCenterRankings} from '../src/center-rankings.mjs';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec([
 "CREATE TABLE sharika_users(auth_uid TEXT PRIMARY KEY,public_no INTEGER,name TEXT,pic TEXT,status TEXT)",
 "CREATE TABLE sharika_admin_roles(auth_uid TEXT PRIMARY KEY,role TEXT)",
 "CREATE TABLE sharika_events(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,kind TEXT,description TEXT,starts_at TEXT,ends_at TEXT,status TEXT,prize_1 INTEGER,prize_2 INTEGER,prize_3 INTEGER,banner_id INTEGER,gift_rules_json TEXT,reward_labels_json TEXT,created_by TEXT,updated_by TEXT,template_id TEXT,scoring_mode TEXT,updated_at TEXT)",
 "CREATE TABLE sharika_event_awards(id INTEGER PRIMARY KEY,event_id INTEGER,rank INTEGER,auth_uid TEXT,coins INTEGER,created_at TEXT)",
 "CREATE TABLE sharika_admin_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id TEXT,action TEXT,details_json TEXT)",
 "CREATE TABLE sharika_center_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_uid TEXT,action TEXT,target TEXT,details_json TEXT)",
 "CREATE TABLE sharika_center_publishing(id TEXT PRIMARY KEY,kind TEXT,title TEXT,published INTEGER DEFAULT 0,sort_order INTEGER DEFAULT 0,updated_by TEXT,updated_at TEXT)",
 "CREATE TABLE sharika_game_catalog(id TEXT PRIMARY KEY,enabled INTEGER)",
 "CREATE TABLE sharika_banner_images(banner_id INTEGER PRIMARY KEY,image_bytes INTEGER,version INTEGER)",
 "CREATE TABLE sharika_special_ids(auth_uid TEXT,special_id TEXT,expires_at TEXT)",
 "CREATE TABLE sharika_bonds(id INTEGER PRIMARY KEY,type TEXT,uid_a TEXT,uid_b TEXT,created_at_ms INTEGER,ended_at_ms INTEGER)",
 "CREATE TABLE sharika_bond_gift_events(id INTEGER PRIMARY KEY,bond_id INTEGER,type TEXT,value_coins INTEGER,created_at_ms INTEGER)",
 "CREATE TABLE sharika_agency_earnings(id INTEGER PRIMARY KEY,beneficiary_uid TEXT,kind TEXT,amount_units INTEGER,created_at TEXT)",
 "CREATE TABLE sharika_wallet_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,auth_uid TEXT,currency TEXT,delta INTEGER,reason TEXT,created_at TEXT)"
 ].join(';\n')+';');
 sql.exec("ALTER TABLE sharika_users ADD COLUMN country TEXT NOT NULL DEFAULT ''; "+
   "ALTER TABLE sharika_events ADD COLUMN country_code TEXT NOT NULL DEFAULT 'GLOBAL';");
 sql.exec("INSERT INTO sharika_users(auth_uid,public_no,name,pic,status,country) "+
   "VALUES('qa:super',10000001,'QA Super',NULL,'active','BD'),"+
   "('qa:member',10000002,'QA Member',NULL,'active','Bangladesh'); "+
   "INSERT INTO sharika_admin_roles VALUES('qa:super','super');");
 for(const [id,kind] of [['events','module'],['cp','ranking'],['bd','ranking'],['agency','ranking'],['host','ranking'],['gift','ranking']])
  sql.prepare('INSERT INTO sharika_center_publishing(id,kind,title,published) VALUES(?,?,?,0)').run(id,kind,id);
 const db={
  prepare(query){
   const statement=sql.prepare(query);
   const bound=(...args)=>({
    async first(){return statement.get(...args)||null;},
    async all(){return {results:statement.all(...args)};},
    async run(){const v=statement.run(...args);return {meta:{last_row_id:Number(v.lastInsertRowid)}};}
   });
   return {bind:bound,all:async()=>({results:statement.all()}),run:async()=>bound().run()};
  },
  async batch(statements){
   sql.exec('BEGIN');
   try{const r=[];for(const s of statements)r.push(await s.run());sql.exec('COMMIT');return r;}
   catch(e){sql.exec('ROLLBACK');throw e;}
  }
 };
 return {sql,db};
}
const reply=(value,status=200)=>Response.json(value,{status});
const fail=(error,status=400)=>Response.json({error},{status});
function center(db,path,method='GET',body,uid='qa:super'){
 return handlePrivateCenter({db,uid,path,reply,fail,cors:{},
  request:new Request('https://qa.invalid'+path,{method,
   ...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})})});
}
function admin(db,operation,method='GET',body,role='super'){
 return handleEventAdmin({env:{DB:db},uid:'qa:super',actor:{role},operation,reply,fail,cors:{},ctx:{},
  request:new Request('https://qa.invalid/api/v1/admin/'+operation,{method,
   ...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})})});
}
const event={title:'Royal QA Festival',kind:'festival',description:'Isolated test only',
 starts_at:'2035-11-20T10:00:00.000Z',ends_at:'2035-11-21T10:00:00.000Z',status:'draft',
 prizes:[300,200,100],template_id:'royal_gold',scoring_mode:'gift_points',
 gift_rules:[],reward_labels:['Gold','Silver','Bronze','','','','']};
test('Super Admin can Save Draft, Edit, Publish, Hide; hidden module never leaks event',async()=>{
 const {sql,db}=fixture();
 try{
  const denied=await center(db,'/api/v1/center/admin/visibility','PATCH',
    {kind:'module',id:'events',published:true},'qa:member');
  assert.equal(denied.status,403);
  assert.equal((await admin(db,'events','POST',event,'finance')).status,403);
  const created=await admin(db,'events','POST',event);
  assert.equal(created.status,201);
  const id=(await created.json()).id;
  assert.equal(Number(id),1);
  assert.equal(sql.prepare('SELECT status FROM sharika_events WHERE id=1').get().status,'draft');
  let response=await center(db,'/api/v1/center/manifest','GET',undefined,'qa:member');
  assert.deepEqual((await response.json()).events,[]);
  const edited={...event,title:'Royal QA Festival - Saved',status:'published',template_id:'diamond_luxury'};
  assert.equal((await admin(db,'events/1','PATCH',edited)).status,200);
  response=await center(db,'/api/v1/center/manifest','GET',undefined,'qa:member');
  assert.deepEqual((await response.json()).events,[],'Status alone may not publish');
  assert.equal((await center(db,'/api/v1/center/admin/visibility','PATCH',
    {kind:'event',id:'event:1',published:true})).status,200);
  response=await center(db,'/api/v1/center/manifest','GET',undefined,'qa:member');
  assert.deepEqual((await response.json()).events,[],'Master OFF must still hide event');
  assert.equal((await center(db,'/api/v1/center/admin/visibility','PATCH',
    {kind:'module',id:'events',published:true})).status,200);
  response=await center(db,'/api/v1/center/manifest','GET',undefined,'qa:member');
  const published=(await response.json()).events;
  assert.equal(published.length,1);
  assert.equal(published[0].title,'Royal QA Festival - Saved');
  assert.equal(published[0].template_id,'diamond_luxury');
  assert.equal(published[0].status,'scheduled');
  assert.deepEqual(published[0].prizes,[300,200,100]);
  assert.equal(published[0].banner_url,null);
  const ranking=await handleEventApp({env:{DB:db},uid:'qa:member',
    request:new Request('https://qa.invalid/api/v1/events/1/ranking'),
    path:'/api/v1/events/1/ranking',cors:{},reply,fail});
  assert.equal(ranking.status,200);
  assert.deepEqual((await ranking.json()).ranking,[],'No fake event winners');
  assert.equal((await center(db,'/api/v1/center/admin/visibility','PATCH',
    {kind:'event',id:'event:1',published:false})).status,200);
  response=await center(db,'/api/v1/center/manifest','GET',undefined,'qa:member');
  assert.deepEqual((await response.json()).events,[]);
  assert.equal((await center(db,'/api/v1/center/admin/visibility','PATCH',
    {kind:'module',id:'events',published:false})).status,200);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM sharika_event_awards').get().n,0);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM sharika_center_audit').get().n,4);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM sharika_admin_audit').get().n,2);
 }finally{sql.close();}
});
test('Draft and expired Events cannot be marked as member-published by Private Center',async()=>{
 const {sql,db}=fixture();
 try{
  assert.equal((await admin(db,'events','POST',event)).status,201);
  let response=await center(db,'/api/v1/center/admin/visibility','PATCH',
    {kind:'event',id:'event:1',published:true});
  assert.equal(response.status,409);
  assert.equal((await response.json()).error,'event_not_ready');
  const old={...event,status:'published',
    starts_at:'2020-01-01T00:00:00.000Z',ends_at:'2020-01-02T00:00:00.000Z'};
  assert.equal((await admin(db,'events/1','PATCH',old)).status,200);
  response=await center(db,'/api/v1/center/admin/visibility','PATCH',
    {kind:'event',id:'event:1',published:true});
  assert.equal(response.status,409);
  assert.equal((await response.json()).error,'event_expired');
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM sharika_center_publishing WHERE kind='event'").get().n,0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sharika_center_audit').get().n,0);
 }finally{sql.close();}
});
test('CP/BD/Agency/Host rankings require settled ledger and enforce Publish/Hide',async()=>{
 const {sql,db}=fixture();
 try{
  const when=Date.parse('2026-11-20T06:00:00.000Z');
  sql.prepare('INSERT INTO sharika_bonds(id,type,uid_a,uid_b,created_at_ms) VALUES(?,?,?,?,?)')
    .run(1,'cp','qa:super','qa:member',when-100000);
  sql.prepare('INSERT INTO sharika_bond_gift_events VALUES(?,?,?,?,?)').run(1,1,'cp',12345,when);
  for(const [i,kind] of ['bd','agency','host_salary'].entries())
    sql.prepare('INSERT INTO sharika_agency_earnings VALUES(?,?,?,?,?)')
      .run(i+1,'qa:super',kind,125000,'2026-11-20 06:00:00');
  for(const kind of ['cp','bd','agency','host']){
    assert.equal((await center(db,'/api/v1/center/admin/visibility','PATCH',
      {kind:'ranking',id:kind,published:true})).status,200);
    const board=await readCenterRankings(db,'daily',kind,new Date('2026-11-20T11:00:00.000Z'));
    assert.equal(board.leaders.length,1);
    assert.equal(board.leaders[0].total,kind==='cp'?12345:12.5);
  }
  let response=await center(db,'/api/v1/center/manifest','GET',undefined,'qa:member');
  assert.deepEqual((await response.json()).rankings.map(x=>x.id).sort(),['agency','bd','cp','host']);
  assert.equal((await center(db,'/api/v1/center/admin/visibility','PATCH',
    {kind:'ranking',id:'gift',published:true})).status,409,'No unverified Gift leaderboard');
  assert.equal((await center(db,'/api/v1/center/admin/visibility','PATCH',
    {kind:'ranking',id:'bd',published:false})).status,200);
  response=await center(db,'/api/v1/center/manifest','GET',undefined,'qa:member');
  assert.equal((await response.json()).rankings.some(x=>x.id==='bd'),false);
 }finally{sql.close();}
});

test('Game Event ranking aggregates all current server-owned win reasons, not bets or recharges',async()=>{
 const {sql,db}=fixture();
 try{
  const start='2035-11-20T00:00:00.000Z',end='2035-11-21T00:00:00.000Z';
  sql.prepare('INSERT INTO sharika_events(id,title,kind,starts_at,ends_at,status,gift_rules_json,scoring_mode) VALUES(?,?,?,?,?,?,?,?)')
    .run(7,'Verified game wins','game_tournament',start,end,'published','[]','game_wins');
  sql.prepare("INSERT INTO sharika_center_publishing(id,kind,title,published) VALUES('event:7','event','Verified game wins',1)").run();
  const awards=[
   ['royal_slots_win',10],['royal_ace_win',20],['cleopatra_win',30],
   ['greedy_classic_win',40],['food_deluxe_win',50],
   ['recharge',900000],['royal_slots_bet',-50]
  ];
  for(const [reason,amount] of awards)sql.prepare(
   'INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,reason,created_at) VALUES(?,?,?,?,?)')
   .run('qa:member','coins',amount,reason,'2035-11-20 11:00:00');
  sql.prepare('INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,reason,created_at) VALUES(?,?,?,?,?)')
   .run('qa:member','coins',900,'royal_slots_win','2035-11-21 10:00:00');
  const response=await handleEventApp({env:{DB:db},uid:'qa:member',
   request:new Request('https://qa.invalid/api/v1/events/7/ranking'),
   path:'/api/v1/events/7/ranking',cors:{},reply,fail});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.scoring,'game_wins');
  assert.equal(result.ranking.length,1);
  assert.equal(result.ranking[0].points,150);
  assert.equal(result.ranking[0].gift_count,5);
 }finally{sql.close();}
});


test('Bangladesh-only event is hidden from other countries even by direct leaderboard URL',async()=>{
 const {sql,db}=fixture();
 try{
  sql.prepare('INSERT INTO sharika_users(auth_uid,public_no,name,pic,status,country) VALUES(?,?,?,?,?,?)')
    .run('qa:visitor',10000004,'QA Visitor',null,'active','India');
  const bad={...event,country_code:'bd'};
  assert.equal((await admin(db,'events','POST',bad)).status,400,'Reject non-ISO upper case input');
  const payload={...event,country_code:'BD',status:'published'};
  const created=await admin(db,'events','POST',payload);
  assert.equal(created.status,201);
  const id=(await created.json()).id;
  assert.equal(sql.prepare('SELECT country_code FROM sharika_events WHERE id=?').get(id).country_code,'BD');
  assert.equal((await center(db,'/api/v1/center/admin/visibility','PATCH',
    {kind:'event',id:'event:'+id,published:true})).status,200);
  assert.equal((await center(db,'/api/v1/center/admin/visibility','PATCH',
    {kind:'module',id:'events',published:true})).status,200);
  const bd=await center(db,'/api/v1/center/manifest','GET',undefined,'qa:member');
  const india=await center(db,'/api/v1/center/manifest','GET',undefined,'qa:visitor');
  assert.deepEqual((await bd.json()).events.map(x=>x.id),[id]);
  assert.deepEqual((await india.json()).events,[]);
  const rankingPath='/api/v1/events/'+id+'/ranking';
  const forbidden=await handleEventApp({env:{DB:db},uid:'qa:visitor',
    request:new Request('https://qa.invalid'+rankingPath),
    path:rankingPath,cors:{},reply,fail});
  assert.equal(forbidden.status,403);
  assert.equal((await forbidden.json()).error,'event_hidden');
  const allowed=await handleEventApp({env:{DB:db},uid:'qa:member',
    request:new Request('https://qa.invalid'+rankingPath),
    path:rankingPath,cors:{},reply,fail});
  assert.equal(allowed.status,200);
  assert.deepEqual((await allowed.json()).ranking,[]);
 }finally{sql.close();}
});
