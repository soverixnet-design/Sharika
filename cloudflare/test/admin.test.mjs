import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAdminOperation } from '../src/admin.mjs';

function mock(role) {
  const calls = [];
  const db = {
    prepare(sql) {
      const row = {
        bind(...args) { calls.push({sql,args}); return this; },
        async first() {
          if (sql.includes('FROM sharika_admin_roles a')) {
            return role ? {role, public_no:10000001, name:'Owner'} : null;
          }
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
async function handle(role, path, method='GET') {
  const {db,calls}=mock(role);
  const request=new Request('https://api.example.test'+path,{method});
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
  assert.equal(response.data.read_only,true);
  assert.equal(JSON.stringify(response.data).includes('firebase_uid'),false);
});
test('super admins still cannot mutate wallets, status or roles in staging',async()=>{
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
