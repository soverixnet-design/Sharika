import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleFamilyApp} from '../src/family.mjs';

const reply=(body,status)=>new Response(JSON.stringify(body),{status});
const fail=(error,status)=>reply({error},status);
function reportDb({role='leader',bdActive=true,member=true}={}){
  const calls=[];
  const db={prepare(sql){
    const st={sql,values:[],bind(...values){this.values=values;return this;},
      async first(){
        calls.push({sql,values:this.values,mode:'first'});
        if(sql.startsWith('SELECT auth_uid,public_no,name,minor'))
          return {auth_uid:'owner',public_no:10000001,name:'Demo Host',minor:0};
        if(sql.startsWith('SELECT * FROM sharika_family_policy'))
          return {active:1,owner_bps:1000,bd_bps:500,settlement_mode:'monthly'};
        if(sql.includes('COUNT(mm.user_uid) AS member_count'))return member?{
          id:22,name:'Royal Agency',level:1,status:'active',role,owner_uid:'owner',
          bd_uid:'bd',owner_no:10000001,owner_name:'Owner',bd_no:10000002,
          member_count:2,joined_at:'2026-11-01 00:00:00'}:null;
        if(sql.startsWith('SELECT active,can_grant FROM sharika_bd_agents'))
          return bdActive?{active:1,can_grant:0}:{active:0,can_grant:0};
        if(sql.includes('AS lifetime_diamonds'))return {
          lifetime_gifts:3,lifetime_diamonds:2000,today_diamonds:150,
          week_diamonds:500,month_diamonds:1000};
        if(sql.includes('SUM(crystal_units)'))return {units:10000};
        return null;
      },
      async all(){
        calls.push({sql,values:this.values,mode:'all'});
        if(sql.includes('WITH gift_totals AS'))return {results:[{
          id:22,name:'Royal Agency',level:1,status:'active',owner_no:10000001,
          member_count:2,gift_count:3,lifetime_diamonds:2000,month_diamonds:1000,
          earned_crystal_units:50000,month_crystal_units:30000}]};
        if(sql.includes('AS host_no'))return {results:[{
          host_no:10000001,name:'Demo Host',role:'leader',gift_count:3,
          lifetime_diamonds:2000,month_diamonds:1000,joined_at:'2026-11-01'}]};
        if(sql.includes('AS gift_diamonds'))return {results:[{
          day:'2026-11-04',gift_count:2,gift_diamonds:500}]};
        return {results:[]};
      }};
    return st;
  }};
  return {db,calls};
}
function req(db,path,uid='owner'){
  return handleFamilyApp({request:new Request('https://example.test'+path),
    env:{DB:db},uid,path,cors:{},reply,fail});
}

test('BD dashboard is accessible only to the active authenticated BD',async()=>{
  const forbidden=reportDb({bdActive:false});
  const denied=await req(forbidden.db,'/api/v1/family/bd/overview');
  assert.equal(denied.status,403);
  assert.equal((await denied.json()).error,'bd_permission_denied');
  assert.ok(!forbidden.calls.some(c=>c.sql.includes('WITH gift_totals AS')));

  const allowed=reportDb({member:false});
  const response=await req(allowed.db,'/api/v1/family/bd/overview');
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.equal(payload.totals.agency_count,1);
  assert.equal(payload.totals.host_count,2);
  assert.equal(payload.totals.month_gift_diamonds,1000);
  assert.equal(payload.totals.earned_crystal_units,50000);
  assert.equal(payload.agencies[0].owner_id,'10000001');
  const scoped=allowed.calls.find(c=>c.sql.includes('WITH gift_totals AS'));
  assert.deepEqual(scoped.values,['owner','owner','owner']);
  assert.match(scoped.sql,/WHERE f\.bd_uid=\?/);
  assert.match(scoped.sql,/beneficiary_uid=\? AND kind='bd'/);
  assert.match(scoped.sql,/e\.created_at>=m\.joined_at/);
  assert.match(scoped.sql,/g\.tab IN \(0,1\)/);
  assert.ok(!allowed.calls.some(c=>/INSERT|UPDATE|DELETE/i.test(c.sql)));
});

test('Agency Host ranking blocks ordinary members and is limited to their agency',async()=>{
  const viewer=reportDb({role:'member'});
  const denied=await req(viewer.db,'/api/v1/family/agency/hosts');
  assert.equal(denied.status,403);
  assert.equal((await denied.json()).error,'agency_report_permission_denied');

  const leader=reportDb();
  const ok=await req(leader.db,'/api/v1/family/agency/hosts');
  assert.equal(ok.status,200);
  const payload=await ok.json();
  assert.equal(payload.hosts[0].host_id,'10000001');
  const sql=leader.calls.find(c=>c.sql.includes('AS host_no'));
  assert.deepEqual(sql.values,[22]);
  assert.match(sql.sql,/WHERE m\.family_id=\?/);
  assert.match(sql.sql,/EXISTS\(SELECT 1 FROM sharika_gifts/);
});

test('Host statement is personal, sourced from verified gifts and never awards salary',async()=>{
  const missing=reportDb({member:false});
  assert.equal((await req(missing.db,'/api/v1/family/host/statement')).status,403);
  const own=reportDb({role:'member'});
  const response=await req(own.db,'/api/v1/family/host/statement');
  assert.equal(response.status,200);
  const record=await response.json();
  assert.equal(record.host.id,'10000001');
  assert.equal(record.gifts.month_diamonds,1000);
  assert.equal(record.days[0].gift_diamonds,500);
  assert.equal(record.salary.state,'not_configured');
  assert.equal(record.salary.payable_units,0);
  assert.equal(record.salary.automatic_payment,false);
  const totals=own.calls.find(c=>c.sql.includes('AS lifetime_diamonds'));
  assert.deepEqual(totals.values,[22,'owner']);
  assert.match(totals.sql,/e\.created_at>=m\.joined_at/);
  assert.match(totals.sql,/g\.tab IN \(0,1\)/);
  assert.ok(!own.calls.some(c=>/INSERT|UPDATE|DELETE/i.test(c.sql)));
});

test('Android Agency screen renders role-specific live reports and uses 3D icon assets',()=>{
  const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  for(const required of ['/family/bd/overview','/family/agency/hosts','/family/host/statement',
    'My Host Statement','Agency Host Ranking','Salary Statement',"famIcon('ranking')",
    "famIcon('salary')",'sh-agency-report-row','renderBDOverview(data)'])
    assert.ok(ui.includes(required),required);
  const admin=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');
  assert.ok(admin.includes('BD · Agency · Host Control Center'));
  assert.ok(admin.includes('Host Salary Policy'));
  assert.ok(admin.includes('no salary has been credited'));
});
