import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleAgencyAdmin,handleAgencyApp,readAgencyRankings} from '../src/agencies.mjs';

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  const folder=new URL('../migrations/',import.meta.url);
  for(const name of readdirSync(folder).filter(f=>f.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(new URL(name,folder),'utf8'));
  const users=['admin','bd','owner','host','sender'];
  for(let i=0;i<users.length;i++)sqlite.prepare('INSERT INTO sharika_users '+
    '(public_no,auth_uid,name,birthdate,minor,coins) VALUES(?,?,?,?,?,?)')
    .run(10000001+i,users[i],users[i],'2000-01-01',0,10_000);
  const db={
    prepare(sql){let params=[];
      const q={bind(...a){params=a;return q;},
        async first(){return sqlite.prepare(sql).get(...params)||null;},
        async all(){return {results:sqlite.prepare(sql).all(...params)};},
        async run(){const r=sqlite.prepare(sql).run(...params);
          return {meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}};}};
      return q;
    },
    async batch(list){sqlite.exec('BEGIN IMMEDIATE');
      try{const out=[];for(const s of list)out.push(await s.run());
        sqlite.exec('COMMIT');return out;}
      catch(error){sqlite.exec('ROLLBACK');throw error;}}
  };
  const env={DB:db},reply=(d,status=200)=>Response.json(d,{status}),
    fail=(code,status)=>reply({error:code},status);
  const app=async(uid,path,method='GET',payload)=>{
    const request=new Request('https://staging.example/api/v1/agency'+path,{method,
      ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    const response=await handleAgencyApp({request,env,uid,
      path:'/api/v1/agency'+path,cors:{},reply,fail});
    return {status:response.status,data:await response.json()};
  };
  const admin=async(role,path='',method='GET',payload)=>{
    const request=new Request('https://staging.example/api/v1/admin/agency'+path,{method,
      ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    const response=await handleAgencyAdmin({request,env,uid:'admin',actor:{role},
      operation:'agency'+path,cors:{},reply,fail});
    return {status:response.status,data:await response.json()};
  };
  const policy=(changes={})=>({enabled:true,host_bps:4000,agency_bps:1000,bd_bps:500,
    settlement_mode:'weekly',targets:['host','agency','bd'].flatMap(role=>
      ['daily','weekly','monthly'].map(period=>({role,period,target_coins:5000000}))),...changes});
  const gift=(ref,recipient='host',quantity=2,price=500)=>{
    sqlite.prepare('INSERT INTO sharika_gift_transactions '+
      '(sender_uid,room_id,gift_id,quantity,recipient_ids_json,total_coins,request_id) '+
      'VALUES(?,?,?,?,?,?,?)').run('sender','11111111',1,quantity,
        JSON.stringify([recipient]),quantity*price,ref);
    const tx=sqlite.prepare('SELECT id FROM sharika_gift_transactions WHERE request_id=?').get(ref).id;
    sqlite.prepare('INSERT INTO sharika_gift_events '+
      '(transaction_id,room_id,sender_uid,recipient_uid,gift_id,quantity,price_coins) '+
      'VALUES(?,?,?,?,?,?,?)').run(tx,'11111111','sender',recipient,1,quantity,price);
    return tx;
  };
  sqlite.prepare('INSERT INTO sharika_rooms(id,owner_id,name) VALUES(?,?,?)')
    .run('11111111','owner','Agency Voice Room');
  for(const user of ['owner','host','sender'])sqlite.prepare('INSERT INTO sharika_room_members '+
    '(room_id,user_id) VALUES(?,?)').run('11111111',user);
  sqlite.prepare('INSERT INTO sharika_gifts(name,price_coins,tab,active) VALUES(?,?,?,?)')
    .run('Testing gift',500,0,1);
  return {sqlite,db,app,admin,policy,gift};
}

test('agency migration defaults paused, 40/10/5 with separate 5M role targets; wallets preserved',async()=>{
  const f=fixture();
  try{
    const dashboard=await f.admin('finance');
    assert.equal(dashboard.status,200);
    assert.equal(dashboard.data.policy.enabled,false);
    assert.deepEqual([dashboard.data.policy.host_percent,dashboard.data.policy.agency_percent,
      dashboard.data.policy.bd_percent],[40,10,5]);
    assert.equal(dashboard.data.policy.targets.length,9);
    assert.ok(dashboard.data.policy.targets.every(t=>t.target_coins===5_000_000));
    assert.equal(dashboard.data.policy.payout_enabled,false);
    assert.equal(f.sqlite.prepare('SELECT SUM(coins) AS n FROM sharika_users').get().n,50_000);
    assert.equal((await f.admin('finance','','PATCH',f.policy())).status,403);
  }finally{f.sqlite.close();}
});

test('Super Admin assigns BD; BD creates Agency and owner automatically becomes Host',async()=>{
  const f=fixture();
  try{
    assert.equal((await f.app('bd','/create','POST',{owner_public_id:'10000003',
      name:'Royal Crystal',request_id:'bd-create-20261106'})).status,403);
    assert.equal((await f.admin('super','/bd','POST',{public_id:'10000002',
      active:true,can_grant:true})).status,200);
    const made=await f.app('bd','/create','POST',{owner_public_id:'10000003',
      name:'Royal Crystal',request_id:'bd-create-20261106'});
    assert.equal(made.status,201);
    assert.equal(made.data.agency_id,1);
    assert.equal((await f.app('bd','/create','POST',{owner_public_id:'10000003',
      name:'Royal Crystal',request_id:'bd-create-20261106'})).data.duplicate,true);
    const owner=await f.app('owner','/me');
    assert.equal(owner.data.roles.host,true);
    assert.equal(owner.data.roles.agency_owner,true);
    assert.equal(owner.data.hosts.length,1);
    const bd=await f.app('bd','/me');
    assert.equal(bd.data.bd_agencies.length,1);
    assert.equal(bd.data.bd_agencies[0].name,'Royal Crystal');
    const request=await f.app('host','/hosts/request','POST',{agency_id:1});
    assert.equal((await f.app('sender','/hosts/'+request.data.request_id+'/approve','POST')).status,403);
  }finally{f.sqlite.close();}
});

test('host application requires Owner approval; removed hosts cannot claim salary',async()=>{
  const f=fixture();
  try{
    await f.admin('super','/bd','POST',{public_id:'10000002',active:true,can_grant:true});
    await f.app('bd','/create','POST',{owner_public_id:'10000003',
      name:'Royal Crystal',request_id:'bd-create-20261106'});
    const req=await f.app('host','/hosts/request','POST',{agency_id:1});
    assert.equal(req.status,201);
    assert.equal((await f.app('sender','/hosts/'+req.data.request_id+'/approve','POST')).status,403);
    const approved=await f.app('owner','/hosts/'+req.data.request_id+'/approve','POST');
    assert.equal(approved.status,200);
    assert.equal((await f.app('host','/me')).data.roles.host,true);
    assert.equal((await f.app('owner','/hosts/10000004/remove','POST')).status,200);
    assert.equal((await f.app('host','/me')).data.roles.host,false);
    assert.equal((await f.app('owner','/hosts/10000003/remove','POST')).status,409);
  }finally{f.sqlite.close();}
});

test('D1 refuses simultaneous Family/Agency commission; activates safely without erasing history',async()=>{
  const f=fixture();
  try{
    assert.throws(()=>f.sqlite.prepare('UPDATE sharika_agency_policy SET active=1').run(),
      /legacy_family_commission_still_active/);
    assert.equal((await f.admin('super','','PATCH',f.policy({
      targets:f.policy().targets.map(t=>t.role==='host'&&t.period==='monthly'
        ?{...t,target_coins:10_000_000}:t)}))).status,200);
    assert.equal(f.sqlite.prepare("SELECT active FROM sharika_family_policy WHERE key='standard'").get().active,0);
    assert.equal(f.sqlite.prepare("SELECT active FROM sharika_agency_policy WHERE key='standard'").get().active,1);
    assert.equal(f.sqlite.prepare("SELECT target_coins FROM sharika_agency_targets WHERE role='host' "+
      "AND period='monthly'").get().target_coins,10_000_000);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_family_crystal_ledger').get().n,0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_agency_policy_audit').get().n,1);
    assert.equal((await f.admin('super','','PATCH',f.policy({host_bps:9900}))).status,400);
  }finally{f.sqlite.close();}
});

test('server-settled gifts yield immutable Host 40%, Agency 10%, BD 5% only once',async()=>{
  const f=fixture();
  try{
    await f.admin('super','/bd','POST',{public_id:'10000002',active:true,can_grant:true});
    await f.app('bd','/create','POST',{owner_public_id:'10000003',
      name:'Royal Crystal',request_id:'bd-create-20261106'});
    const req=await f.app('host','/hosts/request','POST',{agency_id:1});
    await f.app('owner','/hosts/'+req.data.request_id+'/approve','POST');
    f.gift('gift-before-agency-1');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_agency_commission_ledger').get().n,0);
    await f.admin('super','','PATCH',f.policy());
    f.gift('gift-after-agency-1');
    assert.deepEqual(f.sqlite.prepare('SELECT kind,rate_bps,units FROM sharika_agency_commission_ledger '+
      'ORDER BY kind').all().map(r=>({...r})),[
        {kind:'agency',rate_bps:1000,units:1_000_000},
        {kind:'bd',rate_bps:500,units:500_000},
        {kind:'host',rate_bps:4000,units:4_000_000}]);
    assert.equal(f.sqlite.prepare('SELECT SUM(coins) AS n FROM sharika_users').get().n,50_000);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_wallet_ledger').get().n,0);
    const me=await f.app('host','/me');
    assert.equal(me.data.earnings[0].accrued_units,'4000000');
    assert.equal(me.data.salary_status,'accrued_only_no_wallet_payout');
    assert.throws(()=>f.sqlite.prepare('UPDATE sharika_agency_commission_ledger SET units=1').run(),
      /agency_commission_immutable/);
    assert.throws(()=>f.sqlite.prepare('DELETE FROM sharika_agency_commission_ledger').run(),
      /agency_commission_immutable/);
    assert.throws(()=>f.gift('gift-after-agency-1'),/UNIQUE/);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_agency_commission_ledger').get().n,3);
  }finally{f.sqlite.close();}
});

test('BD removal stops BD accrual; Agency Owner and Host remain, rates change only on future gifts',async()=>{
  const f=fixture();
  try{
    await f.admin('super','/bd','POST',{public_id:'10000002',active:true,can_grant:true});
    await f.app('bd','/create','POST',{owner_public_id:'10000003',
      name:'Royal Crystal',request_id:'bd-create-20261106'});
    const req=await f.app('host','/hosts/request','POST',{agency_id:1});
    await f.app('owner','/hosts/'+req.data.request_id+'/approve','POST');
    await f.admin('super','','PATCH',f.policy());
    f.gift('gift-after-agency-1');
    await f.admin('super','','PATCH',f.policy({host_bps:4500,agency_bps:1000,bd_bps:500}));
    await f.admin('super','/bd','POST',{public_id:'10000002',active:false,can_grant:false});
    f.gift('gift-after-agency-2');
    const last=f.sqlite.prepare('SELECT kind,rate_bps FROM sharika_agency_commission_ledger '+
      'WHERE gift_event_id=(SELECT MAX(id) FROM sharika_gift_events) ORDER BY kind').all()
      .map(r=>({...r}));
    assert.deepEqual(last,[{kind:'agency',rate_bps:1000},{kind:'host',rate_bps:4500}]);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sharika_agency_commission_ledger WHERE kind='bd'").get().n,1);
  }finally{f.sqlite.close();}
});

test('Agency discovery hides Special ID owners and BD can resolve the alias for Agency grants',async()=>{
  const f=fixture();
  try{
    f.sqlite.prepare('INSERT INTO sharika_special_ids(auth_uid,special_id,assigned_by) '+
      'VALUES(?,?,?)').run('owner','7654321','admin');
    f.sqlite.prepare('INSERT INTO sharika_special_ids(auth_uid,special_id,assigned_by) '+
      'VALUES(?,?,?)').run('host','91919','admin');
    await f.admin('super','/bd','POST',{public_id:'10000002',active:true,can_grant:true});
    const made=await f.app('bd','/create','POST',{
      owner_public_id:'7654321',name:'Special Gold Agency',request_id:'bd-alias-20261106'});
    assert.equal(made.status,201);
    const listing=await f.app('sender','/discover');
    assert.equal(listing.data.agencies[0].owner_id,'7654321');
    assert.equal(JSON.stringify(listing.data).includes('10000003'),false);
    const join=await f.app('host','/hosts/request','POST',{agency_id:made.data.agency_id});
    assert.equal((await f.app('owner','/hosts/'+join.data.request_id+'/approve','POST')).status,200);
    const members=await f.app('owner','/me');
    assert.equal(members.data.hosts.some(h=>h.id==='91919'),true);
    assert.equal((await f.app('owner','/hosts/91919/remove','POST')).status,200);
  }finally{f.sqlite.close();}
});

test('Android bridge and Gold admin display Agency instead of Family navigation',()=>{
  const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const bridge=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
  const panel=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');
  assert.match(ui,/family\.onclick=openAgencyCenter/);
  assert.match(ui,/bd\.onclick=openAgencyCenter/);
  assert.match(ui,/\/agency\/hosts\/request/);
  assert.match(ui,/\/agency\/me/);
  assert.match(bridge,/\/api\/v1\/agency\/hosts\/request/);
  assert.match(bridge,/\/api\/v1\/agency\/me/);
  assert.match(bridge,/\/api\/v1\/agency\/rankings/);
  assert.match(panel,/P\.agency=async function/);
  assert.match(panel,/sh-agency-target-/);
  assert.match(panel,/BD · Agency · Host Center/);
  assert.match(panel,/NAV_ALL\[i\]\[0\]==='family'/);
});

test('Host, Agency and BD rankings derive only unique verified gift receipts',async()=>{
  const f=fixture();
  try{
    await f.admin('super','/bd','POST',{public_id:'10000002',active:true,can_grant:true});
    await f.app('bd','/create','POST',{owner_public_id:'10000003',
      name:'Royal Crystal',request_id:'bd-create-20261106'});
    const req=await f.app('host','/hosts/request','POST',{agency_id:1});
    await f.app('owner','/hosts/'+req.data.request_id+'/approve','POST');
    await f.admin('super','','PATCH',f.policy());
    f.gift('gift-after-agency-1');
    for(const kind of ['host','agency','bd']){
      const board=await readAgencyRankings(f.db,{kind,period:'monthly',
        now:Date.UTC(2026,10,6,12)});
      assert.equal(board.leaders[0].total,'1000');
      assert.equal(board.leaders.length,1);
    }
    assert.equal(await readAgencyRankings(f.db,{kind:'host;DROP TABLE',period:'weekly'}),null);
    assert.equal(await readAgencyRankings(f.db,{kind:'host',period:'unknown'}),null);
  }finally{f.sqlite.close();}
});
