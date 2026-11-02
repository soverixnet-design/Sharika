import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleCosmeticAdmin} from '../src/cosmetics.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('all 97 bundled ornaments become catalogued, with 62 Royal roles admin-only',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('CREATE TABLE sharika_users (auth_uid TEXT PRIMARY KEY,frame_style TEXT,'+
      'entry_style TEXT,medal_style TEXT,name_tag_style TEXT)');
    db.exec(read('../migrations/0024_cosmetic_shop_and_entitlements.sql'));
    db.exec(read('../migrations/0034_svip_animated_assets.sql'));
    const roleSql=read('../migrations/0036_royal_role_frame_catalog.sql');
    db.exec(roleSql);
    db.exec(roleSql); // retrying a migration cannot duplicate catalog entries.

    const source=JSON.parse(read('../../android-staging/app/src/main/assets/sharika-premium/manifest.json'));
    const expected=new Set(source.map(item=>item.kind+':'+item.id));
    assert.equal(source.length,97);
    for(const item of db.prepare("SELECT id,kind,art_key,active,price_coins FROM sharika_cosmetics_catalog WHERE "+
      "art_key LIKE 'role-frame-%' OR art_key LIKE 'svip-%' OR art_key IN ('vip5-animated','noble-gold-microphone')").all()){
      assert.ok(expected.delete(item.id),item.id);
      assert.equal(item.active,0,item.id);
      assert.equal(item.price_coins,1000,item.id);
      assert.equal(item.id,item.kind+':'+item.art_key);
    }
    assert.equal(expected.size,0,'every packaged animation must be in the server catalog');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sharika_cosmetics_catalog WHERE art_key LIKE 'role-frame-%'").get().n,62);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sharika_cosmetic_inventory').get().n,0);
  }finally{db.close();}
});

test('Super Admin can grant an inactive Royal Role frame free, with audit and no wallet write',async()=>{
  let batch=[];
  const db={prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},
    async first(){
      if(sql.includes('FROM sharika_users'))return {auth_uid:'verified-recipient'};
      if(sql.includes('FROM sharika_cosmetics_catalog'))return {id:'frame_style:role-frame-28',kind:'frame_style',art_key:'role-frame-28'};
      if(sql.includes('FROM sharika_cosmetic_inventory'))return null;
      throw Error('unexpected SQL: '+sql);
    }};},async batch(statements){batch=statements;}};
  const response=await handleCosmeticAdmin({
    request:new Request('https://example.test/api/v1/admin/cosmetics/grant',{
      method:'POST',body:JSON.stringify({public_id:'10000001',item_id:'frame_style:role-frame-28'})
    }),db,uid:'verified-super',role:'super',path:'/api/v1/admin/cosmetics/grant',
    readBody:request=>request.json(),reply:(value,status)=>Response.json(value,{status}),
    fail:(error,status)=>Response.json({error},{status}),cors:{}
  });
  assert.equal(response.status,201);
  assert.deepEqual((await response.json()).item_id,'frame_style:role-frame-28');
  assert.equal(batch.length,3);
  assert.match(batch[0].sql,/INSERT INTO sharika_cosmetic_inventory/);
  assert.deepEqual(batch[0].args.slice(0,2),['verified-recipient','frame_style:role-frame-28']);
  assert.match(batch[1].sql,/INSERT INTO sharika_cosmetic_equipped/);
   assert.deepEqual(batch[1].args,['verified-recipient','frame_style','frame_style:role-frame-28']);
   assert.match(batch[2].sql,/INSERT INTO sharika_admin_audit/);
  assert.ok(batch.every(x=>!/UPDATE sharika_users|wallet_ledger/i.test(x.sql)));
});

test('mobile preview reserves clearance around the animated frame and grant is discoverable',()=>{
  const client=read('../../android-staging/staging-connection.js');
  const admin=read('../../admin/connection.js');
  assert.match(client,/min-height:210px;overflow:hidden/);
  assert.match(client,/margin:24px 0 24px;flex:none;overflow:visible/);
  assert.match(client,/background-size:contain!important;background-position:center!important/);
  assert.ok(admin.indexOf('id="sh-cos-grant-item"')<admin.indexOf('id="sh-cosmetic-list"'));
  assert.match(admin,/id="sh-cos-grant-filter"/);
  assert.match(admin,/id="sh-cos-grant-kind"/);
  assert.match(admin,/Give selected item to ID · Free/);
});

 test('granting an already owned frame re-equips it instead of disappearing from the profile',async()=>{
   let batch=[];
   const db={prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},
     async first(){
       if(sql.includes('FROM sharika_users'))return {auth_uid:'recipient'};
       if(sql.includes('FROM sharika_cosmetics_catalog'))return {
         id:'frame_style:role-frame-28',kind:'frame_style',art_key:'role-frame-28'};
       if(sql.includes('FROM sharika_cosmetic_inventory'))return {found:1};
       throw Error('unexpected SQL: '+sql);
     }};},async batch(statements){batch=statements;}};
   const response=await handleCosmeticAdmin({
     request:new Request('https://example.test/api/v1/admin/cosmetics/grant',{
       method:'POST',body:JSON.stringify({public_id:'10000001',item_id:'frame_style:role-frame-28'})
     }),db,uid:'super',role:'super',path:'/api/v1/admin/cosmetics/grant',
     readBody:request=>request.json(),reply:(value,status)=>Response.json(value,{status}),
     fail:(error,status)=>Response.json({error},{status}),cors:{}
   });
   const body=await response.json();
   assert.equal(response.status,200);
   assert.equal(body.duplicate,true);
   assert.equal(body.equipped,true);
   assert.equal(batch.length,3);
   assert.match(batch[0].sql,/ON CONFLICT\(auth_uid,item_id\) DO NOTHING/);
   assert.match(batch[1].sql,/ON CONFLICT\(auth_uid,kind\) DO UPDATE/);
   assert.equal(batch[2].args[1],'cosmetic_grant_re_equip');
 });
