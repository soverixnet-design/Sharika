import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleInviteApp,handleInviteAdmin,signupReferralStatements} from '../src/invites.mjs';

const reply=(body,status)=>Response.json(body,{status});
const fail=(error,status)=>Response.json({error},{status});

function fixture(){
  const sql=new DatabaseSync(':memory:');
  for(const name of ['0001_initial.sql','0011_referrals.sql',
    '0032_invite_cash_and_first_recharge.sql']){
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
  const app=async(uid,path,method='GET',body)=>{
    const response=await handleInviteApp({request:new Request('https://staging.test'+path,
      {method,body:body?JSON.stringify(body):undefined}),env:{DB},uid,path,cors:{},reply,fail});
    return {status:response.status,data:await response.json()};
  };
  const admin=async(uid,role,operation,method='GET',body)=>{
    const response=await handleInviteAdmin({
      request:new Request('https://staging.test/api/v1/admin/'+operation,
        {method,body:body?JSON.stringify(body):undefined}),env:{DB},uid,
      actor:{role},operation,cors:{},reply,fail
    });
    return {status:response.status,data:await response.json()};
  };
  return {sql,DB,app,admin};
}

test('one real referral earns 100k virtual coins and 10 pending USD cents, never cashes coins',async()=>{
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
  assert.equal(attempt.status,409);
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

test('500 approved real referrals permit exactly $50 reserved once, never automatic payment',async()=>{
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
  const before=await f.app('alice','/api/v1/invites/withdrawals');
  assert.equal(before.data.balance.available_cents,5000);
  assert.deepEqual(before.data.options_cents,[5000,10000]);
  const request={amount_cents:5000,request_id:'withdraw-500-invites-one'};
  const result=await f.app('alice','/api/v1/invites/withdrawals','POST',request);
  assert.equal(result.status,201);
  assert.equal(result.data.request.status,'pending');
  assert.equal((await f.app('alice','/api/v1/invites/withdrawals','POST',request)).status,200);
  assert.equal((await f.app('alice','/api/v1/invites/withdrawals','POST',{
    amount_cents:5000,request_id:'withdraw-500-invites-two'
  })).status,409);
  assert.equal((await f.app('child','/api/v1/invites/withdrawals','POST',request)).status,403);
  const after=await f.app('alice','/api/v1/invites/withdrawals');
  assert.equal(after.data.balance.available_cents,0);
  assert.equal(after.data.requests.length,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sharika_invite_withdrawals').get().n,1);
  assert.equal(after.data.external_payout_automated,false);
  f.sql.close();
});

test('only externally attested, identity-checked payment can be marked paid by finance',async()=>{
  const f=fixture();
  f.sql.prepare('INSERT INTO sharika_invite_withdrawals '+
    '(inviter_uid,amount_cents,request_id) VALUES(?,?,?)')
    .run('alice',5000,'withdraw-review-test');
  const row=f.sql.prepare('SELECT id FROM sharika_invite_withdrawals').get();
  const payload={withdrawal_id:row.id,status:'paid',payment_reference:'BANK-TRANSFER-001'};
  assert.equal((await f.admin('finance','finance','invites/withdrawals/review','POST',payload)).status,400);
  assert.equal((await f.admin('alice','finance','invites/withdrawals/review','POST',{
    ...payload,confirm_identity_verified:true,confirm_external_payment:true
  })).status,403);
  const done=await f.admin('finance','finance','invites/withdrawals/review','POST',{
    ...payload,confirm_identity_verified:true,confirm_external_payment:true
  });
  assert.equal(done.status,200);
  assert.equal(f.sql.prepare('SELECT status FROM sharika_invite_withdrawals').get().status,'paid');
  assert.equal((await f.admin('finance','finance','invites/withdrawals/review','POST',{
    ...payload,confirm_identity_verified:true,confirm_external_payment:true
  })).status,409);
  f.sql.prepare('INSERT INTO sharika_invite_withdrawals '+
    '(inviter_uid,amount_cents,request_id) VALUES(?,?,?)')
    .run('bob',5000,'second-withdrawal-review');
  const second=f.sql.prepare('SELECT id FROM sharika_invite_withdrawals '+
    'WHERE inviter_uid=?').get('bob');
  assert.equal((await f.admin('finance','finance','invites/withdrawals/review','POST',{
    ...payload,withdrawal_id:second.id,confirm_identity_verified:true,
    confirm_external_payment:true
  })).status,409);
  f.sql.close();
});
