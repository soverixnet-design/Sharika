import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {completedWeek,validateOpeningSettings,handleOpeningApp,
  handleOpeningAdmin} from '../src/opening.mjs';

const reply=(body,status=200)=>Response.json(body,{status});
const fail=(error,status)=>reply({error},status);

function fixture(){
  const db=new DatabaseSync(':memory:');
  const folder=new URL('../migrations/',import.meta.url);
  for(const name of readdirSync(folder).filter(n=>n.endsWith('.sql')).sort())
    db.exec(readFileSync(new URL(name,folder),'utf8'));
  const d1={prepare(sql){return {bind(...args){return {
    async first(){return db.prepare(sql).get(...args)||null;},
    async all(){return {results:db.prepare(sql).all(...args)};},
    async run(){return {meta:db.prepare(sql).run(...args)}}
  };},async first(){return db.prepare(sql).get()||null;}};}};
  const users=[['viewer',10000011],['sender',10000012],
    ['recharger',10000013],['gamer',10000014]];
  for(const [uid,id] of users)
    db.prepare('INSERT INTO sharika_users(auth_uid,public_no,name,birthdate,minor,coins) VALUES(?,?,?,\'2000-01-01\',0,90000)')
      .run(uid,id,uid.toUpperCase());
  return {db,d1};
}

function addVerifiedWinners(db){
  const week=completedWeek();
  const historical=week.start.slice(0,10)+' 12:00:00';
  db.prepare("INSERT INTO sharika_rooms(id,owner_id,name) VALUES('10000012','sender','Real room')").run();
  db.prepare("INSERT INTO sharika_room_members(room_id,user_id,role) VALUES('10000012','sender','owner')").run();
  db.prepare("INSERT INTO sharika_room_members(room_id,user_id) VALUES('10000012','recharger')").run();
  const gift=db.prepare("INSERT INTO sharika_gifts(name,tab,price_coins,active) VALUES('Rose',0,50,1)").run();
  const txn=db.prepare('INSERT INTO sharika_gift_transactions(sender_uid,room_id,gift_id,quantity,recipient_ids_json,total_coins,request_id,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run('sender','10000012',gift.lastInsertRowid,2,'["10000013"]',100,'opening-gift-0001',historical);
  db.prepare('INSERT INTO sharika_gift_events(transaction_id,room_id,sender_uid,recipient_uid,gift_id,quantity,price_coins,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(txn.lastInsertRowid,'10000012','sender','recharger',gift.lastInsertRowid,2,50,historical);
  db.prepare('INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('recharger','coins',500,90000,'seller_recharge','opening-recharge-0001',historical);
  db.prepare('INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('viewer','coins',999999,90000,'signup_bonus','opening-bonus-0001',historical);
  const now=Date.now();
  db.prepare('INSERT INTO sharika_original_game_rounds(id,game,round_no,starts_ms,bet_closes_ms,closes_ms,seed_hex,commit_sha256) VALUES(?,?,?,?,?,?,?,?)')
    .run('opening-game-round','sovera-food',54,now-2000,now+20000,now+35000,
      'a'.repeat(64),'b'.repeat(64));
  const bet=db.prepare('INSERT INTO sharika_original_game_bets(game,round_no,round_id,user_uid,pick_index,amount,request_id) VALUES(?,?,?,?,?,?,?)')
    .run('sovera-food',54,'opening-game-round','gamer',0,10,'opening-game-bet-0001');
  db.prepare("UPDATE sharika_original_game_bets SET status='settled',payout=300,result_json='{}',settled_at=? WHERE id=?")
    .run(historical,bet.lastInsertRowid);
}

function app(d1,uid='viewer'){
  return handleOpeningApp({request:new Request('https://example.test/api/v1/opening/next',{method:'POST'}),
    env:{DB:d1},uid,path:'/api/v1/opening/next',cors:{},reply,fail});
}
function admin(d1,role='super',method='GET',body){
  return handleOpeningAdmin({
    request:new Request('https://example.test/api/v1/admin/opening',{
      method,body:body===undefined?undefined:JSON.stringify(body)}),
    env:{DB:d1},uid:'viewer',actor:{role},operation:'opening',cors:{},reply,fail
  });
}

test('a completed week is Monday 00:00 UTC through next Monday, not this week',()=>{
  assert.deepEqual(completedWeek(new Date('2026-11-01T14:00:00Z')),
    {start:'2026-10-19 00:00:00',end:'2026-10-26 00:00:00',week_key:'2026-10-26',
      previous_start:'2026-10-19T00:00:00.000Z',previous_end:'2026-10-26T00:00:00.000Z'});
  assert.equal(completedWeek(new Date('2026-11-02T00:01:00Z')).start,'2026-10-26 00:00:00');
});

test('admin opening settings reject malicious image schemes and out-of-range timer',()=>{
  assert.equal(validateOpeningSettings({enabled:false,expected_version:1}).enabled,0);
  assert.equal(validateOpeningSettings({enabled:true,expected_version:1,custom_image_url:'javascript:alert(1)'}),null);
  assert.equal(validateOpeningSettings({duration_seconds:2,expected_version:1}),null);
  assert.equal(validateOpeningSettings({mode:'custom',custom_user_id:'123',expected_version:1}),null);
  assert.equal(validateOpeningSettings({mode:'custom',expected_version:1,coins:999}),null);
});

test('each real launch advances one verified person: sending, recharge, games, repeat',async()=>{
  const {db,d1}=fixture();
  try{
    addVerifiedWinners(db);
    const seen=[];
    for(let i=0;i<4;i++){
      const response=await app(d1);
      assert.equal(response.status,200);
      const data=await response.json();
      assert.equal(data.show,true);
      assert.equal(data.duration_seconds,10);
      assert.equal(data.slots,3);
      seen.push([data.person.category,data.person.public_id]);
    }
    assert.deepEqual(seen,[['sending','10000012'],['recharge','10000013'],
      ['games','10000014'],['sending','10000012']]);
    assert.equal(db.prepare("SELECT opens FROM sharika_opening_cursors WHERE viewer_uid='viewer'").get().opens,4);
    const other=await (await app(d1,'sender')).json();
    assert.equal(other.person.category,'sending','each viewer owns their cursor');
  }finally{db.close();}
});

test('settings can be disabled or replaced with one custom user, super admin only',async()=>{
  const {db,d1}=fixture();
  try{
    addVerifiedWinners(db);
    const unauthorised=await admin(d1,'support','PATCH',{
      enabled:false,expected_version:1});
    assert.equal(unauthorised.status,403);
    const updated=await admin(d1,'super','PATCH',{
      enabled:true,mode:'custom',custom_user_id:'10000014',custom_title:'GAME KING',
      duration_seconds:10,expected_version:1});
    assert.equal(updated.status,200);
    const special=await (await app(d1)).json();
    assert.equal(special.person.title,'GAME KING');
    assert.equal(special.person.name,'GAMER');
    assert.equal(special.person.public_id,'10000014');
    const disabled=await admin(d1,'super','PATCH',{
      enabled:false,expected_version:2});
    assert.equal(disabled.status,200);
    assert.deepEqual(await (await app(d1)).json(),{show:false,reason:'disabled'});
  }finally{db.close();}
});

test('no fake winners appear when previous week has no verified activity',async()=>{
  const {db,d1}=fixture();
  try{
    const response=await (await app(d1)).json();
    assert.equal(response.show,false);
    assert.equal(response.reason,'no_verified_previous_week_winners');
  }finally{db.close();}
});

test('Android screen and admin page use server routes with one per launch',()=>{
  const source=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const native=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
  const panel=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');
  assert.match(source,/requestedOpening=true/);
  assert.match(source,/api\('POST','\/opening\/next'/);
  assert.match(source,/sh-o-profile/);
  assert.match(source,/sh-o-brand/);
  assert.match(source,/displayOpening\(data\)/);
  assert.match(native,/\/api\/v1\/opening\/next/);
  assert.match(panel,/P\.opening=async function/);
  assert.match(panel,/api\('PATCH','opening',next\)/);
});
