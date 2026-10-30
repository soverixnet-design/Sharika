import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveInviter,handleInviteApp,handleInviteAdmin,signupCoins,signupReferralStatements,rechargeBonusCoins,rechargeReferralStatements} from '../src/invites.mjs';
const reply=(data,status)=>Response.json(data,{status});
const fail=(error,status)=>Response.json({error},{status});
function mock({inviter=true,active=true,self=false,profile=true,referred=true}={}){
  const state={queries:[],writes:0};
  const DB={
    prepare(sql){
      return {sql,args:[],
        bind(...args){this.args=args;return this;},
        async first(){
          state.queries.push({sql,args:this.args});
          if(sql.includes('SELECT u.auth_uid,u.status,u.coins FROM sharika_referrals'))
            return referred?{auth_uid:'bob',status:active?'active':'blocked',coins:500}:null;
          if(sql.includes("SELECT auth_uid,public_no,status FROM sharika_users"))
            return inviter?{auth_uid:self?'alice':'bob',public_no:10000002,status:active?'active':'blocked'}:null;
          if(sql.includes("SELECT public_no FROM sharika_users WHERE auth_uid"))
            return profile?{public_no:10000001}:null;
          if(sql.includes("COUNT(*) AS n FROM sharika_referrals"))
            return {n:2};
          if(sql.includes('JOIN sharika_users u ON u.auth_uid=r.inviter_uid'))
            return {public_no:10000003};
          return null;
        },
        async all(){
          state.queries.push({sql,args:this.args});
          if(sql.includes('WHERE r.inviter_uid=?'))return {results:[
            {public_no:10000010,name:'Friend A',created_at:'2026-10-30 01:00:00'}
          ]};
          if(sql.includes('JOIN sharika_users a ON a.auth_uid=r.inviter_uid'))
            return {results:[{inviter_no:10000001,referred_no:10000010,created_at:'2026-10-30 01:00:00'}]};
          return {results:[]};
        },
        async run(){state.writes++;return {success:true};}
      };
    }
  };
  return {DB,state};
}
async function resolve(f,inviteCode){
  const x=await resolveInviter({db:f.DB,uid:'alice',inviteCode,fail,cors:{}});
  if(x.error)return {status:x.error.status,data:await x.error.json()};
  return x;
}
test('blank invite at signup does not look up or modify referral data',async()=>{
  const f=mock();
  const r=await resolve(f,'');
  assert.equal(r.inviter,null);
  assert.equal(f.state.queries.length,0);
});
test('eight-digit invite resolves only an existing active registered account',async()=>{
  const f=mock();
  const x=await resolve(f,'10000002');
  assert.equal(x.inviter.auth_uid,'bob');
  assert.equal(f.state.queries[0].args[0],10000002);
  assert.equal(f.state.writes,0);
});
test('invalid and nonexistent codes cannot create fake referrals',async()=>{
  assert.equal((await resolve(mock(),'bad-code')).status,400);
  assert.equal((await resolve(mock({inviter:false}),'10000002')).status,404);
  assert.equal((await resolve(mock({active:false}),'10000002')).status,404);
});
test('self referral is rejected',async()=>{
  assert.equal((await resolve(mock({self:true}),'10000002')).status,403);
});
test('real inviter dashboard exposes public IDs, actual bonus totals and no private UIDs',async()=>{
  const f=mock();
  const request=new Request('https://example.test/api/v1/invites');
  const response=await handleInviteApp({request,env:{DB:f.DB},uid:'alice',
    path:'/api/v1/invites',cors:{},reply,fail});
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.invite_code,'10000001');
  assert.equal(data.total_invites,2);
  assert.equal(data.referrals[0].public_id,'10000010');
  assert.equal(data.invited_by,'10000003');
  assert.equal(data.signup_bonus_coins,0);
  assert.equal(data.recharge_bonus_coins,0);
  assert.equal(data.signup_inviter_reward,5000);
  assert.equal(data.signup_invitee_reward,10000);
  assert.equal(data.recharge_bonus_percent,5);
  assert.equal(data.bonus_enabled,true);
  assert.equal(JSON.stringify(data).includes('alice'),false);
  assert.equal(f.state.writes,0);
});
test('user without active profile cannot see referral records',async()=>{
  const f=mock({profile:false});
  const response=await handleInviteApp({
    request:new Request('https://example.test/api/v1/invites'),
    env:{DB:f.DB},uid:'alice',path:'/api/v1/invites',cors:{},reply,fail
  });
  assert.equal(response.status,403);
});
test('finance may read referral records, support cannot',async()=>{
  const f=mock(),request=new Request('https://example.test/api/v1/admin/invites');
  const allowed=await handleInviteAdmin({request,env:{DB:f.DB},actor:{role:'finance'},
    operation:'invites',cors:{},reply,fail});
  const data=await allowed.json();
  assert.equal(allowed.status,200);
  assert.equal(data.total_invites,2);
  assert.equal(data.read_only,true);
  assert.equal(data.bonus_enabled,true);
  const forbidden=await handleInviteAdmin({request,env:{DB:f.DB},actor:{role:'support'},
    operation:'invites',cors:{},reply,fail});
  assert.equal(forbidden.status,403);
  assert.equal(f.state.writes,0);
});

test('invited registration has exactly 10,000 starting coins and one 5,000 inviter grant',()=>{
  const f=mock();
  assert.equal(signupCoins(false),2000);
  assert.equal(signupCoins(true),10000);
  const statements=signupReferralStatements({db:f.DB,uid:'new-user',inviterUid:'bob'});
  assert.equal(statements.length,3);
  assert.match(statements[0].sql,/INSERT INTO sharika_referrals/);
  assert.deepEqual(statements[0].args,['new-user','bob']);
  assert.match(statements[1].sql,/UPDATE sharika_users/);
  assert.equal(statements[1].args[1],5000);
  assert.match(statements[2].sql,/sharika_wallet_ledger/);
  assert.equal(statements[2].args[1],5000);
  assert.equal(statements[2].args[3],'referral-signup:new-user');
});
test('verified seller recharge rewards exactly 5 percent, rounded down',async()=>{
  const f=mock();
  assert.equal(rechargeBonusCoins(1000),50);
  assert.equal(rechargeBonusCoins(100),5);
  assert.equal(rechargeBonusCoins(19),0);
  assert.equal(rechargeBonusCoins(1000000),50000);
  const result=await rechargeReferralStatements({
    db:f.DB,recipientUid:'new-user',sellerUid:'seller',requestId:'req-123456789',amount:1000
  });
  assert.equal(result.bonus,50);
  assert.equal(result.statements.length,2);
  assert.equal(result.statements[0].args[1],50);
  assert.equal(result.statements[1].args[1],50);
  assert.equal(result.statements[1].args[3],'referral-recharge:seller:req-123456789');
});
test('no commission without an active referrer or at less than 20 coin recharge',async()=>{
  const f=mock({referred:false});
  assert.equal((await rechargeReferralStatements({
    db:f.DB,recipientUid:'someone',sellerUid:'seller',requestId:'req-123456789',amount:1000
  })).bonus,0);
  const blocked=mock({active:false});
  assert.equal((await rechargeReferralStatements({
    db:blocked.DB,recipientUid:'someone',sellerUid:'seller',requestId:'req-123456789',amount:1000
  })).statements.length,0);
  assert.equal((await rechargeReferralStatements({
    db:mock().DB,recipientUid:'someone',sellerUid:'seller',requestId:'req-123456789',amount:19
  })).bonus,0);
});
