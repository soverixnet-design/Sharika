import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleInviteApp,handleInviteAdmin,signupReferralStatements} from '../src/invites.mjs';
import {inviteDeviceDigest,inviteDeviceBinding} from '../src/invite-device.mjs';
import {firstRechargeBonusCoins} from '../src/first-recharge.mjs';

const reply=(body,status)=>Response.json(body,{status});
const fail=(error,status)=>Response.json({error},{status});

function fixture(){
  const sql=new DatabaseSync(':memory:');
  for(const name of ['0001_initial.sql','0011_referrals.sql',
    '0032_invite_cash_and_first_recharge.sql',
    '0033_invite_admin_rules_devices_bank.sql',
    '0069_invite_usd_to_virtual_coins.sql']){
    sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  }
  // First-recharge read dependencies, without altering real migration schemas.
  sql.exec('CREATE TABLE sharika_coin_seller_transfers ('+
    'seller_uid TEXT,target_uid TEXT);');
  sql.exec('CREATE TABLE sharika_manual_recharge_reviews ('+
    'user_uid TEXT,status TEXT);');
  const members=[['alice',10000001,0],['bob',10000002,0],
    ['finance',10000003,0],['child',10000004,1]];
  for(const [uid,id,minor] of members){
    sql.prepare('INSERT INTO sharika_users(auth_uid,public_no,name,birthdate,minor,coins) '+
      'VALUES(?,?,?,?,?,?)').run(uid,id,uid,'2000-01-01',minor,2000);
  }
  for(const [uid,digest] of [['alice','a'.repeat(64)],['bob','b'.repeat(64)]]){
    sql.prepare('INSERT INTO sharika_invite_devices(user_uid,device_digest,invite_eligible) '+
      'VALUES(?,?,1)').run(uid,digest);
  }
  const env={DB:null,INVITE_DEVICE_PEPPER:'test-secret-device-pepper-at-least-32-characters'};
  const DB={prepare(query){
    const stmt=sql.prepare(query);
    const handle={args:[],bind(...values){this.args=values;return this;},
      async first(){return stmt.get(...this.args)||null;},
      async all(){return {results:stmt.all(...this.args)};},
      async run(){const r=stmt.run(...this.args);return {meta:{changes:r.changes}};}};
    return handle;
  },async batch(statements){
    sql.exec('BEGIN');
    try{
      const result=[];
      for(const s of statements)result.push(await s.run());
      sql.exec('COMMIT');return result;
    }catch(error){sql.exec('ROLLBACK');throw error;}
  }};
  env.DB=DB;
  const app=async(uid,path,method='GET',body)=>{
    const response=await handleInviteApp({request:new Request('https://staging.test'+path,
      {method,body:body?JSON.stringify(body):undefined}),env,uid,path,cors:{},reply,fail});
    return {status:response.status,data:await response.json()};
  };
  const admin=async(uid,role,operation,method='GET',body)=>{
    const response=await handleInviteAdmin({
      request:new Request('https://staging.test/api/v1/admin/'+operation,
        {method,body:body?JSON.stringify(body):undefined}),env,uid,
      actor:{role},operation,cors:{},reply,fail
    });
    return {status:response.status,data:await response.json()};
  };
  return {sql,DB,app,admin,env};
}
test('one real referral earns 100k coins and pending virtual USD credits; old cash API is disabled',async()=>{
  const f=fixture();
  f.sql.prepare('UPDATE sharika_users SET coins=100000 WHERE auth_uid=?').run('bob');
  await f.DB.batch(signupReferralStatements({db:f.DB,uid:'bob',inviterUid:'alice'}));
  const wallet=f.sql.prepare('SELECT coins FROM sharika_users WHERE auth_uid=?').get('alice');
  assert.equal(wallet.coins,102000);
  const earning=await f.app('alice','/api/v1/invites');
  assert.equal(earning.status,200);
  assert.equal(earning.data.cash_balance.pending_cents,10);
  assert.equal(earning.data.cash_balance.available_cents,0);
  assert.equal(earning.data.signup_inviter_reward,100000);
  assert.equal(earning.data.signup_invitee_reward,100000);
  const attempt=await f.app('alice','/api/v1/invites/withdrawals','POST',{
    amount_cents:5000,request_id:'withdraw-no-approved-cash'
  });
  assert.equal(attempt.status,410);
  assert.equal(attempt.data.error,'cash_withdrawals_disabled_virtual_coins_only');
  assert.equal((await f.app('alice','/api/v1/invites/withdrawals')).status,410);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sharika_invite_withdrawals').get().n,0);
  f.sql.close();
});

test('reviewer alone can approve referral earnings, and may not review own account',async()=>{
  const f=fixture();
  await f.DB.batch(signupReferralStatements({db:f.DB,uid:'bob',inviterUid:'alice'}));
  const payload={referred_public_id:'10000002',approved:true};
  assert.equal((await f.admin('alice','finance','invites/earnings/verify','POST',payload)).status,403);
  assert.equal((await f.admin('finance','support','invites/earnings/verify','POST',payload)).status,403);
  const verified=await f.admin('finance','finance','invites/earnings/verify','POST',payload);
  assert.equal(verified.status,200);
  assert.equal(f.sql.prepare('SELECT status FROM sharika_invite_usd_earnings '+
    'WHERE referred_uid=?').get('bob').status,'approved');
  assert.equal((await f.admin('finance','finance','invites/earnings/verify','POST',payload)).status,409);
  const view=await f.app('alice','/api/v1/invites');
  assert.equal(view.data.cash_balance.available_cents,10);
  f.sql.close();
});

test('500 approved referral credits exchange exactly once into 25M virtual coins',async()=>{
  const f=fixture();
  const addMember=f.sql.prepare('INSERT INTO sharika_users(auth_uid,public_no,name,birthdate,minor) '+
    "VALUES(?,?,?,'2000-01-01',0)");
  const addEarning=f.sql.prepare('INSERT INTO sharika_invite_usd_earnings '+
    "(referred_uid,inviter_uid,amount_cents,status) VALUES(?,'alice',10,'approved')");
  for(let i=0;i<500;i++){
    const uid='ref-'+i;
    addMember.run(uid,10000100+i,uid);
    addEarning.run(uid);
  }
  const before=await f.app('alice','/api/v1/invites/convert');
  assert.equal(before.data.balance.available_cents,5000);
  assert.equal(before.data.coins_per_usd,500000);
  const request={amount_cents:5000,request_id:'convert-500-invites-one'};
  const result=await f.app('alice','/api/v1/invites/convert','POST',request);
  assert.equal(result.status,201);
  assert.equal(result.data.coins,25000000);
  assert.equal((await f.app('alice','/api/v1/invites/convert','POST',request)).data.duplicate,true);
  assert.equal((await f.app('alice','/api/v1/invites/convert','POST',{
    amount_cents:5000,request_id:'convert-500-invites-two'
  })).status,409);
  assert.equal((await f.app('bob','/api/v1/invites/convert','POST',request)).status,409);
  const after=await f.app('alice','/api/v1/invites/convert');
  assert.equal(after.data.balance.available_cents,0);
  assert.equal(after.data.balance.converted_cents,5000);
  assert.equal(after.data.balance.converted_coins,25000000);
  assert.equal(after.data.history.length,1);
  assert.equal(f.sql.prepare('SELECT coins FROM sharika_users WHERE auth_uid=?')
    .get('alice').coins,25002000);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sharika_invite_withdrawals').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sharika_invite_usd_coin_conversions').get().n,1);
  const ledger=f.sql.prepare("SELECT delta,reason FROM sharika_wallet_ledger "+
    "WHERE auth_uid='alice' AND reason='invite_usd_to_coins'").get();
  assert.equal(ledger.delta,25000000);
  assert.equal(ledger.reason,'invite_usd_to_coins');
  f.sql.close();
});

test('old pending bank requests remain preserved but can never be paid from the app or admin',async()=>{
  const f=fixture();
  f.sql.prepare('INSERT INTO sharika_invite_usd_earnings ' +
    "(referred_uid,inviter_uid,amount_cents,status) VALUES('bob','alice',6000,'approved')").run();
  f.sql.prepare('INSERT INTO sharika_invite_withdrawals '+
    '(inviter_uid,amount_cents,request_id) VALUES(?,?,?)')
    .run('alice',5000,'withdraw-review-test');
  const row=f.sql.prepare('SELECT id FROM sharika_invite_withdrawals').get();
  const payload={withdrawal_id:row.id,status:'paid',payment_reference:'BANK-TRANSFER-001'};
  assert.equal((await f.admin('finance','finance','invites/withdrawals/review','POST',{
    ...payload,confirm_identity_verified:true,confirm_external_payment:true
  })).status,410);
  assert.equal((await f.admin('finance','finance','invites/withdrawals/'+row.id)).status,410);
  assert.equal(f.sql.prepare('SELECT status FROM sharika_invite_withdrawals').get().status,'pending');
  const available=await f.app('alice','/api/v1/invites/convert');
  assert.equal(available.data.balance.available_cents,1000);
  assert.equal(available.data.balance.legacy_reserved_cents,5000);
  const attempt=await f.app('alice','/api/v1/invites/convert','POST',{
    amount_cents:5000,request_id:'reserved-old-withdrawal-123'
  });
  assert.equal(attempt.status,409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sharika_invite_usd_coin_conversions').get().n,0);
  f.sql.close();
});

test('super can edit nine future invite/recharge rates; finance cannot; historical earning stays fixed',async()=>{
  const f=fixture();
  await f.DB.batch(signupReferralStatements({db:f.DB,uid:'bob',inviterUid:'alice'}));
  const before=(await f.admin('alice','super','invites/rules')).data.rules;
  const modified={...before};delete modified.version;
  modified.inviter_coins=240000;
  modified.invitee_coins=180000;
  modified.invite_usd_cents=25;
  modified.recharge_coins_per_usd=650000;
  modified.first_recharge_percent=30;
  modified.withdrawal_option_1_cents=6000;
  modified.withdrawal_option_2_cents=12000;
  assert.equal((await f.admin('finance','finance','invites/rules','PATCH',{
    rules:modified,expected_version:1})).status,403);
  const changed=await f.admin('finance','super','invites/rules','PATCH',{
    rules:modified,expected_version:1});
  assert.equal(changed.status,200);
  assert.equal(changed.data.rules.version,2);
  assert.equal((await f.admin('finance','super','invites/rules','PATCH',{
    rules:modified,expected_version:1})).status,409);
  const publicView=await f.app('alice','/api/v1/invites');
  assert.equal(publicView.data.signup_inviter_reward,240000);
  assert.equal(publicView.data.recharge_coins_per_usd,650000);
  assert.equal(publicView.data.first_recharge_bonus_percent,30);
  assert.equal(publicView.data.cash_balance.pending_cents,10); // original receipt untouched
  assert.equal(firstRechargeBonusCoins(650000,modified.first_recharge_percent),195000);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sharika_admin_audit '+
    "WHERE action='invite_reward_rules_updated'").get().n,1);
  f.sql.close();
});

test('second account on the same proof is ineligible; a distinct phone is eligible',async()=>{
  const f=fixture();
  const add=f.sql.prepare('INSERT INTO sharika_users(auth_uid,public_no,name,birthdate,minor) '+
    "VALUES(?,?,?,'2000-01-01',0)");
  add.run('phone1',10002001,'A');add.run('phone2',10002002,'B');
  add.run('phone3',10002003,'C');
  const header={headers:{'x-sharika-device-proof':'c'.repeat(64)}};
  const digest=await inviteDeviceDigest(new Request('https://test.invalid',header),f.env);
  assert.equal(digest.length,64);
  const first=await inviteDeviceBinding(f.DB,'phone1',digest);
  assert.equal(first.eligible,true);
  await f.DB.batch(first.statements);
  const second=await inviteDeviceBinding(f.DB,'phone2',digest);
  assert.equal(second.eligible,false);
  assert.equal(second.reason,'device_already_used');
  await f.DB.batch(second.statements);
  const third=await inviteDeviceBinding(f.DB,'phone3',
    await inviteDeviceDigest(new Request('https://test.invalid',{
      headers:{'x-sharika-device-proof':'e'.repeat(64)}
    }),f.env));
  assert.equal(third.eligible,true);
  await f.DB.batch(third.statements);
  assert.equal(f.sql.prepare('SELECT invite_eligible FROM sharika_invite_devices '+
    'WHERE user_uid=?').get('phone2').invite_eligible,0);
  assert.equal((await inviteDeviceBinding(f.DB,'phone2',digest)).eligible,false);
  assert.equal(await inviteDeviceDigest(new Request('https://test.invalid'),f.env),null);
  f.sql.close();
});

test('malformed or unapproved conversion cannot change the virtual coin wallet',async()=>{
  const f=fixture();
  const before=f.sql.prepare("SELECT coins FROM sharika_users WHERE auth_uid='alice'").get().coins;
  const bad=await f.app('alice','/api/v1/invites/convert','POST',{
    amount_cents:1.5,request_id:'invalid-conversion-0001'
  });
  assert.equal(bad.status,400);
  const unavailable=await f.app('alice','/api/v1/invites/convert','POST',{
    amount_cents:5000,request_id:'insufficient-approved-credit-0001'
  });
  assert.equal(unavailable.status,409);
  assert.equal(f.sql.prepare("SELECT coins FROM sharika_users WHERE auth_uid='alice'").get().coins,before);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sharika_invite_usd_coin_conversions').get().n,0);
  f.sql.close();
});
