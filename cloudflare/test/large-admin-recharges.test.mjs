import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
test('large verified recharges preserve old reviews, caps, receipt uniqueness and staff guard',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("CREATE TABLE sharika_users (auth_uid TEXT PRIMARY KEY)");
  db.exec("CREATE TABLE sharika_support_messages (id INTEGER PRIMARY KEY,user_id TEXT,sender_role TEXT,body TEXT)");
  db.exec("INSERT INTO sharika_users VALUES ('recipient'),('super'),('finance')");
  db.exec("INSERT INTO sharika_support_messages VALUES (1,'recipient','user','Recharge request · old')");
  db.exec("INSERT INTO sharika_support_messages VALUES (2,'recipient','user','Recharge request · new')");
  db.exec("INSERT INTO sharika_support_messages VALUES (3,'recipient','user','Recharge request · duplicate')");
  db.exec(read('0012_manual_recharge_reviews.sql'));
  db.exec(read('0022_staff_and_direct_recharges.sql'));
  db.prepare("INSERT INTO sharika_manual_recharge_reviews "+
    "(support_message_id,user_uid,admin_uid,status,coins,payment_method,payment_reference) "+
    "VALUES (1,'recipient','super','approved',1000000,'bKash','legacy-unique-123')").run();
  db.prepare("INSERT INTO sharika_admin_direct_recharges "+
    "(actor_uid,recipient_uid,coins,reason,request_id,balance_after) "+
    "VALUES ('super','recipient',900000,'Legacy verified grant','legacy-credit-123',900000)").run();

  db.exec(read('0039_large_admin_recharges.sql'));
  assert.equal(db.prepare('SELECT coins FROM sharika_manual_recharge_reviews WHERE support_message_id=1')
    .get().coins,1000000);
  assert.equal(db.prepare('SELECT coins FROM sharika_admin_direct_recharges WHERE id=1').get().coins,900000);
  db.prepare("INSERT INTO sharika_manual_recharge_reviews "+
    "(support_message_id,user_uid,admin_uid,status,coins,payment_method,payment_reference) "+
    "VALUES (2,'recipient','finance','approved',500000000000,'bKash','new-unique-123')").run();
  db.prepare("INSERT INTO sharika_admin_direct_recharges "+
    "(actor_uid,recipient_uid,coins,reason,request_id,balance_after) "+
    "VALUES ('super','recipient',999000000000,'Large verified grant','large-credit-123',999000900000)").run();
  assert.throws(()=>db.prepare("INSERT INTO sharika_manual_recharge_reviews "+
    "(support_message_id,user_uid,admin_uid,status,coins,payment_method,payment_reference) "+
    "VALUES (3,'recipient','finance','approved',1,'bKash','new-unique-123')").run(),
    /UNIQUE/);
  assert.throws(()=>db.exec("UPDATE sharika_manual_recharge_reviews SET coins=2 WHERE support_message_id=2"),
    /immutable_recharge_review/);
  assert.throws(()=>db.exec("UPDATE sharika_admin_direct_recharges SET coins=2 WHERE id=1"),
    /admin_recharge_immutable/);
  assert.throws(()=>db.prepare("INSERT INTO sharika_admin_direct_recharges "+
    "(actor_uid,recipient_uid,coins,reason,request_id,balance_after) "+
    "VALUES ('super','recipient',1000000000001,'Over balance maximum','too-large-credit',0)").run(),
    /CHECK/);
  db.prepare("INSERT INTO sharika_admin_staff_accounts "+
    "(auth_uid,login_email,display_name,permissions_json,daily_coin_limit,active,created_by) "+
    "VALUES (?,?,?,?,?,?,?)").run('staff-uid-verified-001','staff@example.test','Staff','[\"coin_recharge\"]',
      1000000,1,'recipient');
  assert.throws(()=>db.prepare("INSERT INTO sharika_admin_direct_recharges "+
    "(actor_uid,recipient_uid,coins,reason,request_id,balance_after) "+
    "VALUES (?,?,?,?,?,?)").run('staff-uid-verified-001','recipient',1000001,
      'Over staff quota','staff-too-much-123',1000001),/staff_daily_limit_exceeded/);
 }finally{db.close();}
});
