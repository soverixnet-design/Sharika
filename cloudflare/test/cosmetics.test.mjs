import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readEquipped,readRoomEquipped,handleCosmeticApp,handleCosmeticAdmin} from '../src/cosmetics.mjs';
const source=(file)=>readFileSync(new URL(file,import.meta.url),'utf8');
const reply=(body,status)=>Response.json(body,{status});
const fail=(error,status)=>Response.json({error},{status});
const env={reply,fail,cors:{},uid:'verified-user',readBody:async request=>request.json()};
test('cosmetic styles are overridden only by server-owned inventory selection',async()=>{
 const db={prepare(sql){
   return {bind(){return this;},async all(){
     if(sql.includes('JOIN sharika_room_members'))return {results:[
       {auth_uid:'u1',kind:'entry_style',item_id:'entry_style:new-crown'},
       {auth_uid:'u2',kind:'frame_style',item_id:null}
     ]};
     return {results:[{kind:'entry_style',item_id:'entry_style:new-crown'},
       {kind:'frame_style',item_id:null}]};
   }};
 }};
 const mine=await readEquipped(db,'u1');
 assert.deepEqual(mine,{entry_style:'new-crown',frame_style:''});
 const room=await readRoomEquipped(db,'10000001');
 assert.equal(room.get('u1').entry_style,'new-crown');
 assert.equal(room.get('u2').frame_style,'');
});
test('non-super accounts cannot grant anyone a free cosmetic',async()=>{
 const response=await handleCosmeticAdmin({...env,db:null,role:'finance',
  request:new Request('https://test/api/v1/admin/cosmetics/grant',{method:'POST'}),
  path:'/api/v1/admin/cosmetics/grant'});
 assert.equal(response.status,403);
 assert.equal((await response.json()).error,'admin_permission_denied');
});
test('unowned entry, frame and name tag cannot be equipped for free',async()=>{
 const db={prepare(sql){
   return {bind(){return this;},async first(){return null;}};
 }};
 for(const kind of ['entry_style','frame_style','name_tag_style','medal_style']){
   const response=await handleCosmeticApp({...env,db,
    request:new Request('https://test/api/v1/cosmetics/equip',{
     method:'POST',body:JSON.stringify({kind,item_id:kind+':paid'})
    }),
    path:'/api/v1/cosmetics/equip'});
   assert.equal(response.status,403);
   assert.equal((await response.json()).error,'cosmetic_not_owned');
 }
});
test('cosmetic purchase debits coins and writes immutable wallet ledger in one D1 batch',async()=>{
 const batch=[];let query=0;
 const db={prepare(sql){
   return {sql,values:[],bind(...values){this.values=values;return this;},
    async first(){query++;
     if(sql.includes('FROM sharika_cosmetic_inventory'))return null;
     if(sql.includes('FROM sharika_cosmetics_catalog'))
       return {id:'entry_style:phoenix',price_coins:1000,active:1};
     if(sql.includes('SELECT coins,status'))return {coins:2000,status:'active'};
     if(sql.includes('SELECT coins FROM sharika_users'))return {coins:1000};
     throw Error('Unexpected query '+sql);
    }
   };
 },async batch(stmts){batch.push(stmts);}};
 const response=await handleCosmeticApp({...env,db,
  request:new Request('https://test/api/v1/cosmetics/purchase',{method:'POST',
   body:JSON.stringify({item_id:'entry_style:phoenix',request_id:'purchase_12345'})}),
  path:'/api/v1/cosmetics/purchase'});
 assert.equal(response.status,201);
 assert.equal((await response.json()).spent_coins,1000);
 assert.equal(batch.length,1);
 assert.equal(batch[0].length,3);
 assert.match(batch[0][0].sql,/UPDATE sharika_users SET coins=CASE/);
 assert.match(batch[0][1].sql,/INSERT INTO sharika_cosmetic_inventory/);
 assert.match(batch[0][2].sql,/INSERT INTO sharika_wallet_ledger/);
 assert.equal(query,4);
});
test('entry animation is fullscreen and published to other room members',()=>{
 const app=source('../../android-staging/staging-connection.js');
 const backend=source('../src/index.mjs');
 const room=source('../src/voice-room.mjs');
 const admin=source('../../admin/connection.js');
 const migration=source('../migrations/0024_cosmetic_shop_and_entitlements.sql');
 assert.doesNotThrow(()=>new Function(app));
 assert.doesNotThrow(()=>new Function(admin));
 assert.match(app,/object-fit:cover;object-position:center top/);
 assert.match(app,/\/rooms\/'\+room.id\+'\/entries\?after=/);
 assert.match(app,/\/cosmetics\/purchase/);
 assert.match(app,/\/cosmetics\/equip/);
 assert.match(backend,/cosmetic_purchase_or_grant_required/);
 assert.match(backend,/roomEntryAnnounce/);
 assert.match(room,/roomEntryRead/);
 assert.match(admin,/P\.cosmetics=async function/);
 assert.match(admin,/P\.store=P\.cosmetics/);
 assert.match(admin,/P\.md=P\.cosmetics/);
 assert.match(migration,/sharika_cosmetic_inventory/);
 assert.match(migration,/sharika_cosmetic_equipped/);
});
