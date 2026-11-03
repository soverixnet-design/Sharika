import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleFamilyApp, handleFamilyAdmin } from '../src/family.mjs';

function fixture({role='leader',membership=true,joinState='rejected'}={}){
  const calls=[];
  const db={
    calls,
    prepare(sql){
      return {
        sql,values:[],
        bind(...values){this.values=values;return this;},
        async first(){
          calls.push({kind:'first',sql,values:this.values});
          if(sql.startsWith('SELECT auth_uid,public_no,name,minor'))return {auth_uid:'leader'};
          if(sql.startsWith("SELECT * FROM sharika_family_policy"))
            return {key:'standard',active:1,owner_bps:1000,bd_bps:500,
              max_members:20,settlement_mode:'monthly',conversion_enabled:0,coins_per_crystal:1};
          if(sql.includes('COUNT(mm.user_uid) AS member_count'))
            return membership?{id:1,name:'Royal',level:1,status:'active',owner_uid:'leader',
              bd_uid:'bd',role,owner_no:10000001,bd_no:10000002,member_count:2}:null;
          if(sql.includes('SELECT m.user_uid FROM sharika_family_members'))
            return {user_uid:'member'};
          if(sql.includes('SELECT m.user_uid,m.role FROM sharika_family_members'))
            return {user_uid:'member',role:'member'};
          if(sql.includes('SELECT id FROM sharika_families WHERE id=?'))
            return {id:1};
          if(sql.includes('SELECT id,state FROM sharika_family_join_requests'))
            return {id:5,state:joinState};
          if(sql.includes('SELECT id,owner_uid,status FROM sharika_families'))
            return {id:1,owner_uid:'leader',status:'active'};
          if(sql.startsWith('SELECT 1 FROM sharika_family_members'))return null;
          return null;
        },
        async all(){calls.push({kind:'all',sql,values:this.values});return {results:[]};},
        async run(){
          calls.push({kind:'run',sql,values:this.values});
          return {success:true,meta:{changes:1}};
        }
      };
    },
    async batch(statements){
      calls.push({kind:'batch',statements:statements.map(s=>({sql:s.sql,values:s.values}))});
      return statements.map(()=>({success:true,meta:{changes:1}}));
    }
  };
  return db;
}
const reply=(body,status)=>new Response(JSON.stringify(body),{status});
const fail=(code,status)=>new Response(JSON.stringify({error:code}),{status});
async function app(db,path,body={},uid='leader'){
  return handleFamilyApp({request:new Request('https://example.test'+path,{
    method:'POST',body:JSON.stringify(body)}),env:{DB:db},uid,path,
    cors:{},reply,fail});
}
async function admin(db,operation,body,role='super'){
  return handleFamilyAdmin({request:new Request('https://example.test/admin/'+operation,{
    method:'POST',body:JSON.stringify(body)}),env:{DB:db},uid:'admin',
    actor:{role},operation,cors:{},reply,fail});
}

test('only leader can transfer Family ownership',async()=>{
  const db=fixture({role:'member'});
  const denied=await app(db,'/api/v1/family/ownership/transfer',
    {new_owner_public_id:'10000004'});
  assert.equal(denied.status,403);
  assert.equal(db.calls.filter(x=>x.kind==='run').length,0);
  const allowed=fixture();
  const res=await app(allowed,'/api/v1/family/ownership/transfer',
    {new_owner_public_id:'10000004'});
  assert.equal(res.status,200);
  const update=allowed.calls.find(x=>x.kind==='run');
  assert.match(update.sql,/UPDATE sharika_families SET owner_uid/);
  assert.deepEqual(update.values,['member',1,'leader',1,'member']);
});

test('leader can change only non-leader roles and audit at DB trigger',async()=>{
  const db=fixture();
  const res=await app(db,'/api/v1/family/members/10000004/role',{role:'elder'});
  assert.equal(res.status,200);
  const update=db.calls.find(x=>x.kind==='run');
  assert.match(update.sql,/UPDATE sharika_family_members SET role/);
  assert.deepEqual(update.values,['elder',1,'member',1,'leader']);
  const invalid=await app(fixture(),'/api/v1/family/members/10000004/role',
    {role:'leader'});
  assert.equal(invalid.status,400);
});

test('removing a Family member couples the audit and deletion in one batch',async()=>{
  const db=fixture();
  const res=await app(db,'/api/v1/family/members/10000004/remove');
  assert.equal(res.status,200);
  const batch=db.calls.find(x=>x.kind==='batch');
  assert.equal(batch.statements.length,2);
  assert.match(batch.statements[0].sql,/sharika_family_activity/);
  assert.match(batch.statements[1].sql,/DELETE FROM sharika_family_members/);
});

test('rejected Family Join requests reopen with the same request ID',async()=>{
  const db=fixture({membership:false,joinState:'rejected'});
  const res=await app(db,'/api/v1/family/join',{family_id:1});
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{request_id:5,state:'pending',reopened:true});
  const update=db.calls.find(x=>x.kind==='run');
  assert.match(update.sql,/UPDATE sharika_family_join_requests SET state='pending'/);
  assert.deepEqual(update.values,[5,'leader',1]);
});

test('Family suspension is Super Admin-only and audit-batched',async()=>{
  const db=fixture();
  assert.equal((await admin(db,'family/1/status',{status:'suspended'},'finance')).status,403);
  const res=await admin(db,'family/1/status',{status:'suspended'});
  assert.equal(res.status,200);
  const batch=db.calls.find(x=>x.kind==='batch');
  assert.equal(batch.statements.length,3);
  assert.match(batch.statements[0].sql,/UPDATE sharika_families SET status/);
  assert.match(batch.statements[1].sql,/sharika_family_activity/);
  assert.match(batch.statements[2].sql,/sharika_admin_audit/);
});

test('Android native bridge explicitly permits authenticated Family routes only',()=>{
  const java=readFileSync(new URL(
    '../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',
    import.meta.url),'utf8');
  const first=java.indexOf('private boolean allowedApi(String method, String path)');
  const last=java.indexOf('private void callStagingApi',first);
  assert.ok(first>0&&last>first);
  const allow=java.slice(first,last);
  for(const route of [
    '/api/v1/family/me','/api/v1/family/ledger','/api/v1/family/bd/families',
    '/api/v1/family/requests','/api/v1/family/join','/api/v1/family/leave',
    '/api/v1/family/bd/grant','/api/v1/family/crystal/transfer',
    '/api/v1/family/ownership/transfer'
  ])assert.ok(allow.includes('"'+route+'"'),route+' must be explicitly allowlisted');
  assert.ok(allow.includes('family/requests/[1-9][0-9]{0,9}/(accept|reject)'));
  assert.ok(allow.includes('family/members/[0-9]{8}/(role|remove)'));
  assert.ok(!allow.includes('path.startsWith("/api/v1/family/")'));
  assert.ok(allow.includes('return method.equals("POST")'));
});
