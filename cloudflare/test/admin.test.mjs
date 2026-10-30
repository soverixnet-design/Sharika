import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAdminOperation } from '../src/admin.mjs';

function mock(role) {
  const calls = [];
  const db = {
    async batch(statements) { calls.push({batch:statements.length}); return statements.map((_,i)=>({meta:{last_row_id:11,changes:1}})); },
    prepare(sql) {
      const row = {
        bind(...args) { calls.push({sql,args}); return this; },
        async first() {
          if (sql.includes('FROM sharika_admin_roles a')) {
            return role ? {role, public_no:10000001, name:'Owner'} : null;
          }
          if (sql.startsWith('SELECT u.auth_uid')) return {
            auth_uid:'other_uid',status:'active',name:'Other',admin_role:null
          };
          if (sql.startsWith('SELECT * FROM sharika_gifts')) return {
            id:3,name:'Rose',active:0,price_coins:5,tab:0
          };
          return {users:1,rooms:1,active_gifts:0,ledger_entries:1,coins_total:2000,diamonds_total:0};
        },
        async all() {
          if (sql.includes('FROM sharika_users')) return {results:[{
            public_no:10000001,name:'Owner',country:'BD',coins:2000,diamonds:0,
            wealth_level:1,charm_level:1,status:'active',created_at:'2026-10-30'
          }]};
          return {results:[]};
        }
      };
      return row;
    }
  };
  return {db,calls};
}
async function handle(role, path, method='GET', body) {
  const {db,calls}=mock(role);
  const request=new Request('https://api.example.test'+path,{method,
    headers:body===undefined?{}:{'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)});
  const result=await handleAdminOperation({request,env:{DB:db},uid:'firebase_uid',
    path:new URL(request.url).pathname,cors:{},
    reply:(payload,status)=>Response.json(payload,{status}),
    fail:(error,status)=>Response.json({error},{status})
  });
  return {status:result.status,data:await result.json(),calls};
}

test('no registered role means 403 even with a verified Firebase actor',async()=>{
  const response=await handle(null,'/api/v1/admin/status');
  assert.equal(response.status,403);
  assert.equal(response.data.error,'admin_forbidden');
});
test('role is checked from D1 and does not expose private Firebase UID',async()=>{
  const response=await handle('super','/api/v1/admin/status');
  assert.equal(response.status,200);
  assert.equal(response.data.public_id,'10000001');
  assert.equal(response.data.role,'super');
  assert.equal(response.data.read_only,false);
  assert.deepEqual(response.data.write_scopes,['user_status','gift_catalog','support_reply']);
  assert.equal(JSON.stringify(response.data).includes('firebase_uid'),false);
});
test('super admins cannot mutate wallets or admin roles in staging',async()=>{
  const response=await handle('super','/api/v1/admin/users/10000001/wallet','POST');
  assert.equal(response.status,405);
  assert.equal(response.data.error,'admin_write_not_enabled');
  assert.equal(response.calls.length,1);
});
test('support is denied financial ledger, finance is denied room moderation',async()=>{
  assert.equal((await handle('support','/api/v1/admin/ledger')).status,403);
  assert.equal((await handle('finance','/api/v1/admin/rooms')).status,403);
});
test('admin search stays parameterized and public IDs stay eight digits',async()=>{
  const response=await handle('super','/api/v1/admin/users?q=Owner');
  assert.equal(response.status,200);
  assert.equal(response.data.users[0].public_id,'10000001');
  assert.equal(response.data.users[0].public_no,undefined);
  assert.equal(response.calls[1].args[0],'%owner%');
});
test('unknown admin module does not silently succeed',async()=>{
  const response=await handle('super','/api/v1/admin/recharge-requests');
  assert.equal(response.status,501);
  assert.equal(response.data.error,'admin_module_not_ready');
});

test('only super admin can block a non-admin user with an audit record',async()=>{
  const path='/api/v1/admin/users/10000002/status';
  const blocked=await handle('super',path,'PATCH',{status:'blocked',reason:'Abusive conduct'});
  assert.equal(blocked.status,200);
  assert.equal(blocked.data.public_id,'10000002');
  assert.equal(blocked.data.status,'blocked');
  assert.equal(blocked.calls.at(-1).batch,2);
  const denied=await handle('support',path,'PATCH',{status:'blocked',reason:'Abusive conduct'});
  assert.equal(denied.status,403);
});

test('gift catalog creation defaults disabled, financial mutations stay unavailable',async()=>{
  const response=await handle('super','/api/v1/admin/gifts','POST',{
    name:'Rose',emoji:'🌹',tab:0,price_coins:5
  });
  assert.equal(response.status,201);
  assert.equal(response.data.created,true);
  assert.equal(response.calls.at(-1).batch,2);
  const rejected=await handle('finance','/api/v1/admin/gifts','POST',{
    name:'Rose',price_coins:5
  });
  assert.equal(rejected.status,403);
});

test('support inbox is role-protected and never exposes messages to finance',async()=>{
  const support=await handle('support','/api/v1/admin/support');
  assert.equal(support.status,200);
  assert.deepEqual(support.data.conversations,[]);
  const finance=await handle('finance','/api/v1/admin/support');
  assert.equal(finance.status,403);
});

test('support replies require validated text even for an assigned support agent',async()=>{
  const invalid=await handle('support','/api/v1/admin/support/10000002/reply','POST',{
    body:'',request_id:'adm:sample123456'
  });
  assert.equal(invalid.status,400);
  assert.equal(invalid.data.error,'invalid_support_reply');
  const finance=await handle('finance','/api/v1/admin/support/10000002/reply','POST',{
    body:'Hello',request_id:'adm:sample123456'
  });
  assert.equal(finance.status,403);
});

test('gift history is real D1 data and available only to finance or super roles',async()=>{
  const finance=await handle('finance','/api/v1/admin/gift-events');
  assert.equal(finance.status,200);
  assert.deepEqual(finance.data.events,[]);
  const denied=await handle('support','/api/v1/admin/gift-events');
  assert.equal(denied.status,403);
  assert.equal(denied.data.error,'admin_permission_denied');
});
