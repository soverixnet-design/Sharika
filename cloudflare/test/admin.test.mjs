import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAdminOperation, readGiftRankings } from '../src/admin.mjs';

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
          if(sql.includes("m.body LIKE '[Sharika report]%'")) return {results:[{
            id:57,reporter_no:10000002,created_at:'2026-10-31 02:00:00',
            body:'[Sharika report] user ID 10000003 · Member\\nReason: Spam messages'
          }]};
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
  assert.deepEqual(response.data.write_scopes,['user_status','gift_catalog','support_reply','seller_approval','seller_stock_allocation','daily_reward_config']);
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

test('settlement audit is read-only and inaccessible to support staff',async()=>{
  const finance=await handle('finance','/api/v1/admin/gift-settlements');
  assert.equal(finance.status,200);
  assert.deepEqual(finance.data.settlements,[]);
  assert.equal(finance.data.limited_to,100);
  assert.equal(finance.data.read_only,true);
  assert.ok(finance.calls.some(c=>c.sql?.includes('FROM sharika_gift_transactions t')));
  assert.ok(!finance.calls.some(c=>c.batch));
  const denied=await handle('support','/api/v1/admin/gift-settlements');
  assert.equal(denied.status,403);
  assert.equal(denied.data.error,'admin_permission_denied');
  assert.equal(denied.calls.length,1);
});

test('gift settlement maps exact Lucky/regular room and recipient entitlement without fan-out',async()=>{
  const seen=[];
  const db={prepare(sql){
    seen.push(sql);
    return {
      bind(){return this;},
      async first(){return {role:'finance',public_no:10000001,name:'Auditor'};},
      async all(){return {results:[
        {id:31,room_id:'12345678',sender_no:10000002,name:'Rose',emoji:'🌹',
          tab:2,quantity:2,total_coins:120,created_at:'2026-10-31 02:00:00',
          payout_coins:240,max_multiplier:2,lucky_room_hundredths:120,
          regular_room_hundredths:null,recipient_hundredths:600,recipient_count:1},
        {id:30,room_id:'12345678',sender_no:10000003,name:'Flower',emoji:'🌼',
          tab:0,quantity:1,total_coins:200,created_at:'2026-10-31 01:00:00',
          payout_coins:null,max_multiplier:null,lucky_room_hundredths:null,
          regular_room_hundredths:2000,recipient_hundredths:0,recipient_count:3}
      ]};}
    };
  }};
  const request=new Request('https://api.example.test/api/v1/admin/gift-settlements');
  const response=await handleAdminOperation({request,env:{DB:db},uid:'finance_uid',
    path:new URL(request.url).pathname,cors:{},
    reply:(payload,status)=>Response.json(payload,{status}),
    fail:(error,status)=>Response.json({error},{status})});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.settlements.length,2);
  assert.deepEqual(body.settlements.map(s=>({
    id:s.transaction_id,kind:s.kind,payout:s.lucky_payout_coins,
    recipients:s.recipient_count,room:s.room_reward_hundredths,
    recipient:s.recipient_diamond_hundredths
  })),[
    {id:31,kind:'lucky',payout:240,recipients:1,room:120,recipient:600},
    {id:30,kind:'regular',payout:null,recipients:3,room:2000,recipient:0}
  ]);
  assert.equal(body.settlements[0].sender_id,'10000002');
  assert.equal(body.settlements[0].spent_coins,120);
  assert.equal(body.settlements[0].room_reward_status,'room_accrued_not_owner_paid');
  const sql=seen[1];
  assert.match(sql,/LEFT JOIN sharika_lucky_gift_outcomes o/);
  assert.match(sql,/LEFT JOIN sharika_regular_room_rewards rr/);
  assert.match(sql,/LEFT JOIN sharika_lucky_room_rewards lr/);
  assert.match(sql,/SUM\(x\.earned_hundredths\)/);
  assert.match(sql,/COUNT\(\*\) FROM sharika_gift_events e/);
  assert.match(sql,/ORDER BY t\.id DESC LIMIT 100/);
  assert.doesNotMatch(sql,/JOIN sharika_gift_events e ON e.transaction_id=t.id/);
});
test('admin gift rankings are read-only and finance-role gated',async()=>{
  const yes=await handle('finance','/api/v1/admin/rankings?kind=room&period=daily');
  assert.equal(yes.status,200);
  assert.deepEqual(yes.data.leaders,[]);
  assert.equal(yes.data.source,'settled_gift_events');
  const denied=await handle('support','/api/v1/admin/rankings');
  assert.equal(denied.status,403);
  const invalid=await handle('super','/api/v1/admin/rankings?kind=bogus');
  assert.equal(invalid.status,400);
});
test('gift ranking SQL totals real events using parameterized UTC boundaries',async()=>{
  let captured;
  const db={prepare(sql){
    captured={sql,args:null};
    return {bind(...args){captured.args=args;return this;},
      async all(){return {results:[{public_no:10000002,name:'Real sender',
        pic:null,wealth_level:3,charm_level:4,total:120}]};}};
  }};
  const data=await readGiftRankings(db,'weekly','rich');
  assert.equal(data.leaders[0].public_id,'10000002');
  assert.equal(data.leaders[0].total,120);
  assert.match(captured.sql,/SUM\(CAST\(e.quantity AS INTEGER\)\*CAST\(e.price_coins AS INTEGER\)\)/);
  assert.match(captured.sql,/e.created_at>=\? AND e.created_at<\?/);
  const [start,end]=captured.args;
  assert.equal(new Date(start.replace(' ','T')+'Z').getUTCDay(),1);
  assert.equal((Date.parse(end.replace(' ','T')+'Z')-Date.parse(start.replace(' ','T')+'Z'))/86400000,7);
  assert.equal(await readGiftRankings(db,'2020','rich'),null);
});

test('Top Recharge counts verified seller/manual credits only, not signup or game wins',async()=>{
  let sqlText='',bound=[];
  const db={prepare(sql){
    sqlText=sql;
    return {bind(...args){bound=args;return this;},
      async all(){return {results:[{
        public_no:10000031,name:'Verified buyer',pic:null,
        wealth_level:2,charm_level:1,total:4500
      }]};}};
  }};
  const top=await readGiftRankings(db,'weekly','recharge');
  assert.equal(top.source,'verified_recharge_ledger');
  assert.equal(top.read_only,true);
  assert.equal(top.leaders[0].public_id,'10000031');
  assert.equal(top.leaders[0].total,4500);
  assert.match(sqlText,/FROM sharika_wallet_ledger l/);
  assert.match(sqlText,/l.currency='coins'/);
  assert.match(sqlText,/l.delta>0/);
  assert.match(sqlText,/seller_recharge/);
  assert.match(sqlText,/manual_recharge/);
  assert.doesNotMatch(sqlText,/signup_welcome|game_win|referral_bonus/);
  assert.equal(bound.length,2);
  assert.equal(await readGiftRankings(db,'weekly','unsupported'),null);
});

test('only support/super can triage verified reports without editing wallet data',async()=>{
  const support=await handle('support','/api/v1/admin/reports');
  assert.equal(support.status,200);
  assert.equal(support.data.read_only,true);
  assert.equal(support.data.reports[0].reporter_public_id,'10000002');
  assert.equal(support.data.reports[0].id,57);
  assert.match(support.data.reports[0].body,/Sharika report/);
  assert.ok(!support.calls.some(c=>c.batch));
  assert.equal((await handle('super','/api/v1/admin/reports')).status,200);
  const blocked=await handle('finance','/api/v1/admin/reports');
  assert.equal(blocked.status,403);
  assert.equal(blocked.data.error,'admin_permission_denied');
});
