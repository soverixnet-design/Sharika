import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {readPublicShowcase} from '../src/profile-showcase.mjs';

function dbFixture(){
  const sqlite=new DatabaseSync(':memory:');
  const dir=new URL('../migrations/',import.meta.url);
  for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(new URL(name,dir),'utf8'));
  for(const [no,uid,name] of [
    [10000001,'showcase-owner','Owner'],[10000002,'showcase-friend','Friend'],
    [10000003,'showcase-supporter','Donor']]){
    sqlite.prepare('INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor) VALUES(?,?,?,\'2000-01-01\',0)')
      .run(no,uid,name);
  }
  const d1={prepare(sql){return {bind(...params){return {
    async all(){return {results:sqlite.prepare(sql).all(...params)}}
  }}}}};
  return {sqlite,d1};
}

test('real public collections are initially empty, including unearned gift and frame',async()=>{
  const {sqlite,d1}=dbFixture();
  try{
    for(const section of ['friends','followers','following','supporters','gift','medal','vehicle','headwear','impression']){
      const data=await readPublicShowcase(d1,'showcase-owner',section);
      assert.equal(data.items.length,0,section);
      assert.equal(data.read_only,true);
    }
    assert.equal(await readPublicShowcase(d1,'showcase-owner','admin'),null);
    assert.equal(await readPublicShowcase(d1,'showcase-owner','gift',-1),null);
  }finally{sqlite.close();}
});

test('Friendship, supporters, gifts and purchases come from real rows',async()=>{
  const {sqlite,d1}=dbFixture();
  try{
    sqlite.prepare("INSERT INTO sharika_follows(follower_uid,followed_uid) VALUES('showcase-friend','showcase-owner')").run();
    const invite=sqlite.prepare('INSERT INTO sharika_bond_invites(sender_uid,recipient_uid,type,gift_id,held_coins,request_id,status,created_at_ms,expires_at_ms) '+
      "VALUES('showcase-owner','showcase-friend','friendship',3,1200,'showcase-friend-invite-1','accepted',?,?)")
      .run(Date.now()-86400000,Date.now()+86400000);
    sqlite.prepare('INSERT INTO sharika_bonds(id,type,uid_a,uid_b,pair_key,created_at_ms) '+
      "VALUES(?,'friendship','showcase-friend','showcase-owner','showcase-friend:showcase-owner',?)")
      .run(invite.lastInsertRowid,Date.now()-86400000);
    sqlite.prepare("INSERT INTO sharika_rooms(id,owner_id,name) VALUES('10000001','showcase-owner','Room')").run();
    sqlite.prepare("INSERT INTO sharika_room_members(room_id,user_id) VALUES('10000001','showcase-owner')").run();
    const gift=sqlite.prepare("INSERT INTO sharika_gifts(name,emoji,price_coins,active) VALUES('Rose','🌹',200,1)").run();
    const transaction=sqlite.prepare('INSERT INTO sharika_gift_transactions(sender_uid,room_id,gift_id,quantity,recipient_ids_json,total_coins,request_id) VALUES(?,?,?,?,?,?,?)')
      .run('showcase-supporter','10000001',gift.lastInsertRowid,3,'["10000001"]',600,'showcase-gift-transaction');
    sqlite.prepare('INSERT INTO sharika_gift_events(transaction_id,room_id,sender_uid,recipient_uid,gift_id,quantity,price_coins) VALUES(?,?,?,?,?,?,?)')
      .run(transaction.lastInsertRowid,'10000001','showcase-supporter','showcase-owner',gift.lastInsertRowid,3,200);
    sqlite.prepare("INSERT INTO sharika_cosmetic_inventory(auth_uid,item_id,source,request_id,expires_at_ms) "+
      "VALUES('showcase-owner','frame_style:royal-gold','purchase','showcase-frame-001',?)")
      .run(Date.now()-1000);
    const friend=(await readPublicShowcase(d1,'showcase-owner','friends')).items;
    assert.equal(friend.length,1);assert.equal(friend[0].id,'10000002');
    assert.equal((await readPublicShowcase(d1,'showcase-owner','followers')).items[0].id,'10000002');
    const donors=(await readPublicShowcase(d1,'showcase-owner','supporters')).items;
    assert.equal(donors.length,1);assert.equal(donors[0].coins,600);
    const gifts=(await readPublicShowcase(d1,'showcase-owner','gift')).items;
    assert.equal(gifts.length,1);assert.equal(gifts[0].quantity,3);
    assert.equal(gifts[0].name,'Rose');
    const frames=(await readPublicShowcase(d1,'showcase-owner','headwear')).items;
    assert.equal(frames.length,1);assert.equal(frames[0].source,'purchase');
    assert.equal(frames[0].expired,1,'expired purchase is still visible');
    assert.equal((await readPublicShowcase(d1,'showcase-owner','supporters',20)).items.length,0);
    assert.equal((await readPublicShowcase(d1,'showcase-friend','supporters')).items.length,0,
      'another user cannot inherit the owner\'s donors');
  }finally{sqlite.close();}
});

test('public cover storage is separate from avatar and profile background must be owner-controlled',()=>{
  const migration=readFileSync(new URL('../migrations/0076_public_profile_cover_images.sql',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const native=readFileSync(new URL(
    '../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS sharika_user_cover_images/);
  assert.match(worker,/path==='\/api\/v1\/me\/cover-image' && request\.method==='PUT'/);
  assert.match(worker,/const user=await assertActive\(env.DB,uid\)/);
  assert.match(worker,/if\(profileCoverPath && request\.method==='GET'\)/);
  assert.match(native,/path\.equals\("\/api\/v1\/me\/cover-image"\)/);
  assert.match(ui,/canonicalId===profile\?\.public_id/);
  assert.match(ui,/native\('pickProfilePhoto'\)/);
  assert.match(ui,/openRoyalProfileMore\(root,id,section\)/);
});

test('compact public profile does not hide uploaded covers or overflow CP and collections',()=>{
  const css=readFileSync(new URL('../../app/royal-profile.css',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  assert.doesNotMatch(ui,/#pfo \.sh-ranked-profile \.cov\{height:115px;background:/,
    'legacy gold background with !important masked uploaded cover photos');
  assert.match(ui,/cover\.style\.setProperty\('background-image',/,
    'a successfully saved cover must be visible even against older styles');
  assert.match(css,/#pfo #pfc \.pf\.sh-ranked-profile \.cov\s*\{[^}]*height:176px!important/);
  assert.match(ui,/#pfo \.sh-ranked-profile \.pfh>\.pavw\{/,
    'large hero avatar rules must not inflate the nested CP couple avatars');
  assert.match(css,/#pfo #pfc \.pf\.sh-ranked-profile \.sh-royal-cp-owner \.pavw\s*\{/);
  assert.match(css,/\.sh-royal-cp-owner \.pavw>\.sh-sovera-frame\.fxr\.sh-svip-frame/);
  assert.match(css,/#pfc \.sh-public-collection-grid \{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/#pfc \.sh-public-collection-tile \{[^}]*overflow:hidden;/);
  assert.match(css,/#pfc \.sh-public-item-image \{[^}]*overflow:hidden;/);
});
