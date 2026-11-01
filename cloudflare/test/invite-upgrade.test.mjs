import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceDigest,deviceAllowed,inviteSettings,publicInviteLanding,
  claimInvite,requestCashout,handleInviteAdminUpgrade
} from '../src/invite-upgrade.mjs';

const settings={enabled:1,claim_hours:48,inviter_coins:5000,
  invitee_total_coins:10000,recharge_percent:5,cash_enabled:0,
  inviter_cash_cents:0,invitee_cash_cents:0,withdrawals_enabled:0,
  min_withdraw_cents:100};
const reply=(data,status)=>Response.json(data,{status});
const fail=(error,status)=>Response.json({error},{status});
const nowSql=()=>new Date(Date.now()-3600000).toISOString().slice(0,19).replace('T',' ');
function fakeDb({device=[],already=false,minor=0,config=settings,admins=[]}={}){
  const queries=[],batches=[];
  const db={
    prepare(sql){return {sql,args:[],
      bind(...a){this.args=a;return this;},
      async first(){
        queries.push({sql,args:this.args});
        if(sql.includes('SELECT * FROM sharika_invite_settings'))return config;
        if(sql.includes('SELECT minor FROM sharika_users'))return {minor};
        if(sql.includes('SELECT created_at,minor,coins FROM sharika_users'))
          return {created_at:nowSql(),minor,coins:2000};
        if(sql.includes('SELECT 1 FROM sharika_referrals'))return already?{yes:1}:null;
        if(sql.includes('SELECT auth_uid,status,minor,coins FROM sharika_users'))
          return {auth_uid:'inviter',status:'active',minor:0,coins:0};
        if(sql.includes('FROM sharika_invite_withdrawals WHERE id='))return null;
        if(sql.includes('SELECT COALESCE(SUM(delta_cents),0)'))return {cents:0};
        if(sql.includes('COUNT(*) AS pending'))return {pending:0};
        if(sql.includes('SUM(CASE WHEN delta_cents>0'))return {awarded_cents:0};
        if(sql.includes('FROM sharika_notifications WHERE recipient_uid='))
          return {id:7,recipient_uid:'owner',kind:'system',title:'Bank withdrawal request'};
        return null;
      },
      async all(){
        queries.push({sql,args:this.args});
        if(sql.includes('FROM sharika_referral_devices'))return {results:device};
        if(sql.includes('FROM sharika_admin_roles'))return {results:admins};
        return {results:[]};
      },
      async run(){
        queries.push({sql,args:this.args});
        return {meta:{changes:1}};
      }
    };},
    async batch(stmts){batches.push(stmts);return stmts.map(()=>({meta:{changes:1}}));}
  };
  return {db,queries,batches};
}
const request=(path,method='GET',body,device='0123456789abcdef')=>
  new Request('https://stage.test'+path,{method,
    headers:{...(device?{'x-sharika-device':device}:{}),
      ...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
test('one Android device produces a stable digest, no raw identifier stored',async()=>{
  const req=request('/api/v1/invites');
  const a=await deviceDigest(req,{});
  assert.match(a,/^[0-9a-f]{64}$/);
  assert.equal(a,await deviceDigest(req,{}));
  assert.equal(a.includes('0123456789abcdef'),false);
  assert.equal(await deviceDigest(request('/i/10000001','GET',null,''),{}),null);
  const f=fakeDb({device:[{device_hash:a,owner_uid:'other'}]});
  assert.equal(await deviceAllowed(f.db,'new',a),false);
});
test('public link is a valid no-auth landing page with Play install referral',async()=>{
  const res=publicInviteLanding(request('/i/10000012'),'/i/10000012');
  assert.equal(res.status,200);
  const html=await res.text();
  assert.match(html,/sharika:\/\/invite\/10000012/);
  assert.match(html,/sharika_invite%3D10000012/);
  assert.equal(publicInviteLanding(request('/i/bad'),'/i/bad'),null);
});
test('manual claim within configured 48 hours batches device, referral and coin credit',async()=>{
  const f=fakeDb();
  const res=await claimInvite({request:request('/api/v1/invites/claim','POST',
    {invite_code:'10000002'}),env:{DB:f.db},uid:'new',cors:{},reply,fail});
  assert.equal(res.status,200);
  assert.equal(f.batches.length,1);
  const sql=f.batches[0].map(x=>x.sql).join('\n');
  assert.match(sql,/INSERT OR IGNORE INTO sharika_referral_devices/);
  assert.match(sql,/INSERT INTO sharika_referrals/);
  assert.equal(f.batches[0].some(x=>x.args?.includes('referral_claim')),true);
  assert.deepEqual((await res.json()).invitee_coins,8000);
});
test('no claim without native device, no self claim, no duplicate',async()=>{
  const base={uid:'new',cors:{},reply,fail};
  const x=await claimInvite({...base,request:request('/api/v1/invites/claim','POST',
    {invite_code:'10000002'},''),env:{DB:fakeDb().db}});
  assert.equal(x.status,403);
  const y=await claimInvite({...base,request:request('/api/v1/invites/claim','POST',
    {invite_code:'10000002'}),env:{DB:fakeDb({already:true}).db}});
  assert.equal(y.status,409);
});
test('cashout is disabled by default and encrypted bank account required',async()=>{
  const f=fakeDb();
  const result=await requestCashout({request:request('/api/v1/invites/withdrawals',
    'POST',{request_id:'550e8400-e29b-41d4-a716-446655440000',amount_cents:200,
      bank_name:'Test Bank',account_name:'Someone',account_number:'ABCDEF12',payout_country:'BD'}),
    env:{DB:f.db},uid:'new',cors:{},reply,fail});
  assert.equal(result.status,403);
  assert.equal(f.batches.length,0);
});
test('bank cashout alerts super admin without revealing bank account details',async()=>{
  const f=fakeDb({config:{...settings,cash_enabled:1,withdrawals_enabled:1},
    admins:[{auth_uid:'owner'}]});
  const pending=[];
  const result=await requestCashout({request:request('/api/v1/invites/withdrawals',
    'POST',{request_id:'550e8400-e29b-41d4-a716-446655440000',amount_cents:200,
      bank_name:'Test Bank',account_name:'Someone',account_number:'ABCDEF12',payout_country:'BD'}),
    env:{DB:f.db,REFERRAL_PAYOUT_KEY:Buffer.alloc(32,7).toString('base64')},
    uid:'new',cors:{},reply,fail,ctx:{waitUntil(p){pending.push(p);}}});
  await Promise.all(pending);
  assert.equal(result.status,201);
  assert.equal(f.batches.length,1);
  const notice=f.queries.find(x=>x.sql.includes('INSERT OR IGNORE INTO sharika_notifications'));
  assert.ok(notice);
  assert.equal(notice.args.includes('owner'),true);
  assert.match(notice.args.join(' '),/Bank withdrawal request/);
  assert.equal(notice.args.join(' ').includes('ABCDEF12'),false);
  assert.equal(pending.length,1);
});
test('invite settings write requires super admin, every integer in supported range',async()=>{
  const f=fakeDb();
  const denied=await handleInviteAdminUpgrade({
    request:request('/api/v1/admin/invites','PATCH',settings),
    env:{DB:f.db},uid:'admin',actor:{role:'finance'},
    operation:'invites',cors:{},reply,fail
  });
  assert.equal(denied.status,403);
  const allowed=await handleInviteAdminUpgrade({
    request:request('/api/v1/admin/invites','PATCH',settings),
    env:{DB:f.db},uid:'admin',actor:{role:'super'},
    operation:'invites',cors:{},reply,fail
  });
  assert.equal(allowed.status,200);
  assert.equal(f.batches.length,1);
  const unsafe=await handleInviteAdminUpgrade({
    request:request('/api/v1/admin/invites','PATCH',{
      ...settings,cash_enabled:1,invitee_cash_cents:100}),
    env:{DB:f.db},uid:'admin',actor:{role:'super'},
    operation:'invites',cors:{},reply,fail
  });
  assert.equal(unsafe.status,503);
  assert.equal(f.batches.length,1);
});
