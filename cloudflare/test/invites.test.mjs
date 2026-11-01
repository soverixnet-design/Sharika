import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveInviter,handleInviteApp,handleInviteAdmin,signupCoins,signupReferralStatements,rechargeBonusCoins,rechargeReferralStatements,inviteExpiryMs,inviteRedeemEligible} from '../src/invites.mjs';
const reply=(data,status)=>Response.json(data,{status});
const fail=(error,status)=>Response.json({error},{status});
function mock({inviter=true,active=true,self=false,profile=true,referred=true,
  linked=false,createdAt=new Date().toISOString(),coins=2000}={}){
  const state={queries:[],writes:0,batches:[]};
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
          if(sql.includes('SELECT auth_uid,public_no,created_at,coins,status FROM sharika_users'))
            return profile?{auth_uid:'alice',public_no:10000001,created_at:createdAt,
              coins,status:active?'active':'blocked'}:null;
          if(sql.includes('SELECT public_no,created_at FROM sharika_users WHERE auth_uid'))
            return profile?{public_no:10000001,created_at:createdAt}:null;
          if(sql.includes('SELECT inviter_uid FROM sharika_referrals WHERE referred_uid'))
            return linked?{inviter_uid:'bob'}:null;
          if(sql.includes("SELECT 1 AS active FROM sharika_users"))
            return profile&&active?{active:1}:null;
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
          if(sql.includes('GROUP BY u.auth_uid ORDER BY invites DESC'))
            return {results:[{public_no:10000001,name:'Alice',invites:4},
              {public_no:10000002,name:'Bob',invites:2}]};
          if(sql.includes('JOIN sharika_users a ON a.auth_uid=r.inviter_uid'))
            return {results:[{inviter_no:10000001,referred_no:10000010,created_at:'2026-10-30 01:00:00'}]};
          return {results:[]};
        },
        async run(){state.writes++;return {success:true};}
      };
    },
    async batch(statements){
      state.batches.push(statements.map(s=>({sql:s.sql,args:s.args})));
      return statements.map(()=>({success:true}));
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
  assert.equal(data.signup_inviter_reward,100000);
  assert.equal(data.signup_invitee_reward,100000);
  assert.equal(data.invite_usd_cents_per_verified_user,10);
  assert.deepEqual(data.withdrawal_options_cents,[5000,10000]);
  assert.equal(data.recharge_coins_per_usd,500000);
  assert.equal(data.first_recharge_bonus_percent,40);
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

test('invited registration grants 100,000 coins to both and a pending 10¢ earning',()=>{
  const f=mock();
  assert.equal(signupCoins(false),2000);
  assert.equal(signupCoins(true),100000);
  const statements=signupReferralStatements({db:f.DB,uid:'new-user',inviterUid:'bob'});
  assert.equal(statements.length,4);
  assert.match(statements[0].sql,/INSERT INTO sharika_referrals/);
  assert.deepEqual(statements[0].args,['new-user','bob']);
  assert.match(statements[1].sql,/UPDATE sharika_users/);
  assert.equal(statements[1].args[1],100000);
  assert.match(statements[2].sql,/sharika_wallet_ledger/);
  assert.equal(statements[2].args[1],100000);
  assert.equal(statements[2].args[3],'referral-signup:new-user');
  assert.match(statements[3].sql,/sharika_invite_usd_earnings/);
  assert.deepEqual(statements[3].args,['new-user','bob',10]);
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

const redemption=(fixture,inviteCode='10000002')=>handleInviteApp({
  request:new Request('https://example.test/api/v1/invites/redeem',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({invite_code:inviteCode})
  }),env:{DB:fixture.DB},uid:'alice',path:'/api/v1/invites/redeem',
  cors:{},reply,fail
});

test('newly created account redeems one verified inviter and both coins are in one D1 batch',async()=>{
  const f=mock();
  const response=await redemption(f);
  assert.equal(response.status,201);
  const result=await response.json();
  assert.equal(result.invited_by,'10000002');
  assert.equal(result.inviter_reward,100000);
  assert.equal(result.invitee_extra_coins,98000);
  assert.equal(result.invitee_total_signup_coins,100000);
  assert.equal(f.state.batches.length,1);
  const statements=f.state.batches[0];
  assert.equal(statements.length,6);
  assert.match(statements[0].sql,/INSERT INTO sharika_referrals/);
  assert.deepEqual(statements[0].args,['alice','bob']);
  assert.equal(statements[1].args[1],100000);
  assert.equal(statements[3].args[2],10);
  assert.equal(statements[4].args[1],98000);
  assert.equal(statements[5].args[3],'referral-claim:alice');
  assert.equal(JSON.stringify(result).includes('bob'),false);
});

test('redemption cannot happen after expiry or for an already-linked account',async()=>{
  const expired=mock({createdAt:new Date(Date.now()-49*3600_000).toISOString()});
  assert.equal((await redemption(expired)).status,409);
  assert.equal(expired.state.batches.length,0);
  const linked=mock({linked:true});
  assert.equal((await redemption(linked)).status,409);
  assert.equal(linked.state.batches.length,0);
});

test('redemption rejects self-invitation, non-existent code, inactive inviter, and unsafe balances',async()=>{
  for(const [options,code,status] of [
    [{self:true},'10000002',403],
    [{inviter:false},'10000002',404],
    [{active:false},'10000002',403],
    [{},'bad',400],
    [{coins:1_000_000_000_000},'10000002',409]
  ]){
    const f=mock(options);
    const result=await redemption(f,code);
    assert.equal(result.status,status);
    assert.equal(f.state.batches.length,0);
  }
});

test('claim deadline parses SQLite and ISO timestamps in UTC, and returns correct eligibility',()=>{
  const sqlite=inviteExpiryMs('2026-11-01 12:00:00');
  const iso=inviteExpiryMs('2026-11-01T12:00:00Z');
  assert.equal(sqlite,iso);
  assert.equal(sqlite,Date.parse('2026-11-03T12:00:00Z'));
  assert.equal(inviteRedeemEligible({created_at:'2026-11-01 12:00:00',invited_by:null},
    Date.parse('2026-11-02T00:00:00Z')),true);
  assert.equal(inviteRedeemEligible({created_at:'2026-11-01 12:00:00',invited_by:'bob'},
    Date.parse('2026-11-02T00:00:00Z')),false);
  assert.equal(inviteExpiryMs('invalid'),0);
});

test('monthly invitation rankings count real referral rows and never promise cash prizes',async()=>{
  const f=mock();
  const response=await handleInviteApp({
    request:new Request('https://example.test/api/v1/invites/rankings'),
    env:{DB:f.DB},uid:'alice',path:'/api/v1/invites/rankings',cors:{},reply,fail
  });
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.period,'monthly');
  assert.equal(result.prize_status,'not_configured');
  assert.deepEqual(result.leaders.map(r=>r.id),['10000001','10000002']);
  assert.deepEqual(result.leaders.map(r=>r.total_invites),[4,2]);
  assert.equal(f.state.batches.length,0);
});
