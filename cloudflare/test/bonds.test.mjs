import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleBondApp,handleBondAdmin,readBondProfile,readBondRanking,
  roomBondPairs,expireBondInvites} from '../src/bonds.mjs';

const NOW=Date.UTC(2026,9,31,12);
const IDS=['10000001','10000002','10000003','10000004'];

function stageDB(){
  const sqlite=new DatabaseSync(':memory:');
  const folder=new URL('../migrations/',import.meta.url);
  for(const name of readdirSync(folder).filter(n=>n.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(new URL(name,folder),'utf8'));
  IDS.forEach((id,i)=>sqlite.prepare('INSERT INTO sharika_users'+
    '(public_no,auth_uid,name,birthdate,minor,coins) VALUES(?,?,?,?,?,?)')
    .run(Number(id),'person-'+i,'Person '+i,'2000-01-01',0,50_000));
  const d1={
    prepare(sql){
      let args=[];
      const stmt={bind(...params){args=params;return stmt;},
        async first(){return sqlite.prepare(sql).get(...args)||null;},
        async all(){return {results:sqlite.prepare(sql).all(...args)};},
        async run(){const result=sqlite.prepare(sql).run(...args);
          return {meta:{changes:result.changes,last_row_id:Number(result.lastInsertRowid)}};}};
      return stmt;
    },
    async batch(statements){
      sqlite.exec('BEGIN IMMEDIATE');
      try{const result=[];for(const stmt of statements)result.push(await stmt.run());
        sqlite.exec('COMMIT');return result;
      }catch(error){sqlite.exec('ROLLBACK');throw error;}
    }
  };
  const response=(payload,status=200)=>Response.json(payload,{status});
  const fail=(code,status)=>response({error:code},status);
  async function call(uid,path,method='GET',body=null,nowMs=NOW){
    const request=new Request('https://staging.example/api/v1'+path,{
      method,...(body===null?{}:{body:JSON.stringify(body)})
    });
    const result=await handleBondApp({request,env:{DB:d1},uid,path:'/api/v1'+path,
      cors:{},reply:response,fail,nowMs});
    return {status:result.status,data:await result.json()};
  }
  async function admin(role,operation,method='GET',body=null){
    const request=new Request('https://staging.example/api/v1/admin/'+operation,{
      method,...(body===null?{}:{body:JSON.stringify(body)})
    });
    const result=await handleBondAdmin({request,env:{DB:d1},uid:'person-3',
      actor:{role},operation,cors:{},reply:response,fail});
    return {status:result.status,data:await result.json()};
  }
  return {sqlite,d1,call,admin};
}

test('new additive migration seeds distinct CP and Friendship gift boxes',()=>{
  const {sqlite}=stageDB();
  try{
    const list=sqlite.prepare('SELECT type,name,price_coins FROM sharika_bond_gifts ORDER BY id').all();
    assert.equal(list.length,4);
    assert.equal(list.filter(g=>g.type==='cp').length,2);
    assert.equal(list.filter(g=>g.type==='friendship').length,2);
    assert.ok(list.every(g=>g.price_coins>0));
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_bonds').get().n,0);
  }finally{sqlite.close();}
});

test('CP invite is held once, bound only on recipient approval, and cannot link a second partner',async()=>{
  const {sqlite,d1,call}=stageDB();
  try{
    const request={gift_id:1,recipient_public_id:IDS[1],request_id:'bond-test-req-0001'};
    const issued=await call('person-0','/bonds/invite','POST',request);
    assert.equal(issued.status,201);
    assert.equal(issued.data.held_coins,5200);
    assert.equal(sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='person-0'").get().coins,44800);
    const duplicate=await call('person-0','/bonds/invite','POST',request);
    assert.equal(duplicate.data.duplicate,true);
    assert.equal(sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='person-0'").get().coins,44800);
    const stranger=await call('person-2','/bonds/invites/'+issued.data.invite_id+'/respond',
      'POST',{accept:true});
    assert.equal(stranger.status,403);
    assert.equal((await readBondProfile(d1,'person-0')).cp,null);
    const accepted=await call('person-1','/bonds/invites/'+issued.data.invite_id+'/respond',
      'POST',{accept:true});
    assert.equal(accepted.status,201);
    const publicDetail=await call('person-2','/bonds/profile/'+IDS[1]);
    assert.equal(publicDetail.data.recent_gifters[0].id,IDS[0]);
    assert.equal(publicDetail.data.recent_gifters[0].coins,5200);
    assert.equal((await readBondProfile(d1,'person-0')).cp.partner.id,IDS[1]);
    assert.equal((await readBondProfile(d1,'person-1')).cp.partner.id,IDS[0]);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_active_cp_slots').get().n,2);
    sqlite.prepare('INSERT INTO sharika_cosmetic_equipped(auth_uid,kind,item_id) '+
      "VALUES('person-1','frame_style','frame_style:royal-gold')").run();
    assert.equal((await readBondProfile(d1,'person-0')).cp.partner.frame_style,'royal-gold');
    const boosted=await call('person-0','/bonds/gift','POST',{
      gift_id:2,recipient_public_id:IDS[1],request_id:'bond-pair-gift-0001'});
    assert.equal(boosted.status,201);
    assert.equal(boosted.data.spent_coins,18800);
    assert.equal((await call('person-0','/bonds/gift','POST',{
      gift_id:2,recipient_public_id:IDS[1],request_id:'bond-pair-gift-0001'})).data.duplicate,true);
    assert.equal((await readBondProfile(d1,'person-1')).gifts_received,2);
    assert.equal(sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='person-0'").get().coins,26000);
    const second=await call('person-0','/bonds/invite','POST',{
      gift_id:2,recipient_public_id:IDS[2],request_id:'bond-test-req-0002'});
    assert.equal(second.status,409);
    const ranking=await readBondRanking(d1,'cp','daily',NOW);
    assert.equal(ranking.leaders.length,1);
    assert.equal(ranking.leaders[0].total,24000);
    assert.equal(ranking.leaders[0].b.frame_style,'royal-gold');
    const room=sqlite.prepare('INSERT INTO sharika_rooms(id,owner_id,name) VALUES(?,?,?)');
    room.run(IDS[0],'person-0','Couple room');
    sqlite.prepare("INSERT INTO sharika_room_members(room_id,user_id,role,seat_no) VALUES(?,?,'owner',NULL)")
      .run(IDS[0],'person-0');
    sqlite.prepare("INSERT INTO sharika_room_members(room_id,user_id,seat_no) VALUES(?,?,1)")
      .run(IDS[0],'person-1');
    assert.deepEqual((await roomBondPairs(d1,IDS[0])).map(p=>p.type),['cp']);
    const unbound=await call('person-1','/bonds/'+accepted.data.bond_id+'/unbind','POST',{});
    assert.equal(unbound.status,200);
    assert.equal((await readBondProfile(d1,'person-0')).cp,null);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_active_cp_slots').get().n,0);
    assert.equal((await readBondRanking(d1,'cp','daily',NOW)).leaders.length,0);
    const another=await call('person-0','/bonds/invite','POST',{
      gift_id:2,recipient_public_id:IDS[2],request_id:'bond-test-req-0003'});
    assert.equal(another.status,201);
  }finally{sqlite.close();}
});

test('multiple Friendship links work, declined and expired invitations refund exactly once',async()=>{
  const {sqlite,d1,call}=stageDB();
  try{
    const first=await call('person-0','/bonds/invite','POST',{
      gift_id:3,recipient_public_id:IDS[1],request_id:'friend-req-test-0001'});
    const second=await call('person-0','/bonds/invite','POST',{
      gift_id:4,recipient_public_id:IDS[2],request_id:'friend-req-test-0002'});
    assert.equal(first.status,201);assert.equal(second.status,201);
    assert.equal((await call('person-1','/bonds/invites/'+first.data.invite_id+'/respond',
      'POST',{accept:true})).status,201);
    assert.equal((await call('person-2','/bonds/invites/'+second.data.invite_id+'/respond',
      'POST',{accept:true})).status,201);
    assert.equal((await readBondProfile(d1,'person-0')).friendships.length,2);
    assert.equal((await readBondRanking(d1,'friendship','daily',NOW)).leaders.length,2);
    const declined=await call('person-0','/bonds/invite','POST',{
      gift_id:3,recipient_public_id:IDS[3],request_id:'friend-req-test-0003'});
    const balanceBefore=sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='person-0'").get().coins;
    const refund=await call('person-3','/bonds/invites/'+declined.data.invite_id+'/respond',
      'POST',{accept:false});
    assert.equal(refund.data.refunded_coins,1200);
    assert.equal(sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='person-0'").get().coins,balanceBefore+1200);
    assert.equal((await call('person-3','/bonds/invites/'+declined.data.invite_id+'/respond',
      'POST',{accept:false})).data.duplicate,true);
    assert.equal(sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='person-0'").get().coins,balanceBefore+1200);
    const timed=await call('person-3','/bonds/invite','POST',{
      gift_id:3,recipient_public_id:IDS[0],request_id:'friend-req-test-0004'},NOW);
    assert.equal(timed.status,201);
    assert.equal(await expireBondInvites(d1,NOW+25*3_600_000),1);
    assert.equal(await expireBondInvites(d1,NOW+26*3_600_000),0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sharika_wallet_ledger WHERE request_id LIKE 'bond:refund:%'").get().n,2);
  }finally{sqlite.close();}
});

test('new requests cannot double-hold a pair or leave overlapping CP proposals',async()=>{
  const {sqlite,call}=stageDB();
  try{
    const first=await call('person-0','/bonds/invite','POST',{
      gift_id:1,recipient_public_id:IDS[1],request_id:'cp-one-request-01'});
    assert.equal(first.status,201);
    const held=sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='person-0'").get().coins;
    const repeated=await call('person-0','/bonds/invite','POST',{
      gift_id:1,recipient_public_id:IDS[1],request_id:'cp-repeat-req-02'});
    assert.equal(repeated.status,409);
    assert.equal(repeated.data.error,'bond_invite_pair_pending');
    const opposite=await call('person-1','/bonds/invite','POST',{
      gift_id:1,recipient_public_id:IDS[0],request_id:'cp-opposite-003'});
    assert.equal(opposite.status,409);
    const different=await call('person-0','/bonds/invite','POST',{
      gift_id:1,recipient_public_id:IDS[2],request_id:'cp-another-0004'});
    assert.equal(different.status,409);
    assert.equal(different.data.error,'cp_invite_already_pending');
    assert.equal(sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='person-0'").get().coins,held);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_bond_invites').get().n,1);
    assert.throws(()=>sqlite.prepare('INSERT INTO sharika_bond_invites'+
      '(sender_uid,recipient_uid,type,gift_id,held_coins,request_id,created_at_ms,expires_at_ms) '+
      'VALUES(?,?,?,?,?,?,?,?)').run('person-1','person-0','cp',1,5200,
      'cp-direct-0005',NOW,NOW+86400000),/bond_invite_pair_pending/);
    const friendship=await call('person-0','/bonds/invite','POST',{
      gift_id:3,recipient_public_id:IDS[2],request_id:'friend-one-0006'});
    assert.equal(friendship.status,201);
    const reverse=await call('person-2','/bonds/invite','POST',{
      gift_id:4,recipient_public_id:IDS[0],request_id:'friend-reverse-07'});
    assert.equal(reverse.status,409);
    assert.equal(reverse.data.error,'bond_invite_pair_pending');
  }finally{sqlite.close();}
});

test('bond invite daily limit prevents spam without debiting the wallet',async()=>{
  const {sqlite,call}=stageDB();
  try{
    const insert=sqlite.prepare('INSERT INTO sharika_bond_invites'+
      '(sender_uid,recipient_uid,type,gift_id,held_coins,request_id,status,created_at_ms,expires_at_ms) '+
      "VALUES('person-0','person-1','friendship',3,1200,?,'declined',?,?)");
    for(let i=0;i<20;i++)insert.run('past-invite-'+String(i).padStart(6,'0'),NOW-1000,NOW+86400000);
    const before=sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='person-0'").get().coins;
    const rate=await call('person-0','/bonds/invite','POST',{
      gift_id:3,recipient_public_id:IDS[2],request_id:'too-many-invites-01'});
    assert.equal(rate.status,429);
    assert.equal(rate.data.error,'bond_invite_rate_limited');
    assert.equal(sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='person-0'").get().coins,before);
    assert.throws(()=>insert.run('past-invite-over-002',NOW,NOW+86400000),
      /bond_invite_rate_limited/);
  }finally{sqlite.close();}
});

test('incoming bond invitations remain visible beyond 60 outgoing entries',async()=>{
  const {sqlite,call}=stageDB();
  try{
    const incoming=await call('person-1','/bonds/invite','POST',{
      gift_id:3,recipient_public_id:IDS[0],request_id:'incoming-old-0001'});
    assert.equal(incoming.status,201);
    // Simulate a legacy account with numerous previously pending outgoing
    // invitations. New sends are now bounded to 20 per rolling 24 hours.
    const insert=sqlite.prepare('INSERT INTO sharika_bond_invites'+
      '(sender_uid,recipient_uid,type,gift_id,held_coins,request_id,status,created_at_ms,expires_at_ms) '+
      "VALUES('person-0','person-2','friendship',3,1200,?,'declined',?,?)");
    for(let i=0;i<61;i++)insert.run('legacy-outgoing-'+String(i).padStart(5,'0'),
      NOW-(70-i)*86400000,NOW+86400000);
    sqlite.prepare("UPDATE sharika_bond_invites SET status='pending' WHERE sender_uid='person-0'").run();
    const inbox=await call('person-0','/bonds/me');
    assert.equal(inbox.status,200);
    assert.equal(inbox.data.received.length,1);
    assert.equal(inbox.data.received[0].id,incoming.data.invite_id);
    assert.equal(inbox.data.sent.length,60);
  }finally{sqlite.close();}
});

test('public profile uses actual follow/visitor/gift records, no fabricated counts',async()=>{
  const {sqlite,d1,call}=stageDB();
  try{
    const initial=await readBondProfile(d1,'person-0');
    assert.equal(initial.followers,0);assert.equal(initial.visitors,0);
    sqlite.prepare('INSERT INTO sharika_follows(follower_uid,followed_uid) VALUES(?,?)')
      .run('person-1','person-0');
    assert.equal((await call('person-1','/bonds/visits/'+IDS[0],'POST',{})).status,200);
    assert.equal(sqlite.prepare('SELECT last_seen_at_ms FROM sharika_profile_visits').get().last_seen_at_ms,NOW);
    assert.equal((await call('person-1','/bonds/visits/'+IDS[0],'POST',{})).status,200);
    assert.equal(sqlite.prepare('SELECT last_seen_at_ms FROM sharika_profile_visits').get().last_seen_at_ms,NOW);
    assert.equal((await call('person-1','/bonds/visits/'+IDS[0],'POST',{},NOW+300001)).status,200);
    assert.equal(sqlite.prepare('SELECT last_seen_at_ms FROM sharika_profile_visits').get().last_seen_at_ms,NOW+300001);
    const result=await call('person-2','/bonds/profile/'+IDS[0]);
    assert.equal(result.data.followers,1);
    assert.equal(result.data.visitors,1);
    assert.equal(result.data.gifts_received,0);
  }finally{sqlite.close();}
});

test('finance admin can read policy, only super admin can change gift prices and flags',async()=>{
  const {sqlite,admin,call}=stageDB();
  try{
    assert.equal((await admin('finance','bonds')).status,200);
    assert.equal((await admin('finance','bonds','PATCH',{cp_enabled:false})).status,403);
    assert.equal((await admin('support','bonds')).status,403);
    const changed=await admin('super','bonds','PATCH',{
      cp_enabled:false,friendship_enabled:true,expiry_hours:48});
    assert.equal(changed.status,200);
    assert.equal(changed.data.config.policy.cp_enabled,false);
    assert.equal((await call('person-0','/bonds/invite','POST',{
      gift_id:1,recipient_public_id:IDS[1],request_id:'bond-test-disabled-1'})).status,403);
    assert.equal((await admin('super','bonds/gifts/3','PATCH',{price_coins:3000})).status,200);
    assert.equal(sqlite.prepare('SELECT price_coins FROM sharika_bond_gifts WHERE id=3').get().price_coins,3000);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sharika_admin_audit WHERE action LIKE 'bond_%'").get().n,2);
  }finally{sqlite.close();}
});

test('Android ID profile, room links, gift tabs and exact native routes are wired',()=>{
  const web=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const java=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
  assert.match(web,/function mountBondDetails\(/);
  assert.match(web,/function decorateBondSeatOverlay\(/);
  assert.match(web,/💝 CP/);
  assert.match(web,/🤝 Friends/);
  assert.match(web,/bond_pairs/);
  assert.match(web,/await reloadWallet\(\)\.catch\(\(\)=>\{\}\)/);
  assert.match(web,/Daily invitation limit reached \(20 in 24 hours\)/);
  assert.match(web,/\x2fbonds\x2frankings\?type=/);
  assert.match(java,/bonds\/catalog/);
  assert.match(java,/bonds\/invites\/\[1-9\]/);
});
