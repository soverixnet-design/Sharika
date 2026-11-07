import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleFamilyApp} from '../src/family.mjs';

function fixture(role='leader',targetUid='member'){
  const calls=[];
  const DB={
    prepare(sql){
      return {
        sql,args:[],
        bind(...values){this.args=values;return this;},
        async first(){
          calls.push({method:'first',sql,args:this.args});
          if(sql.startsWith('SELECT auth_uid,public_no,name,minor'))
            return {auth_uid:'viewer',public_no:10000001};
          if(sql.startsWith("SELECT * FROM sharika_family_policy"))
            return {key:'standard',active:1,owner_bps:500,bd_bps:500,
              conversion_enabled:1,coins_per_crystal:70,max_members:30};
          if(sql.includes('SELECT mode FROM sharika_family_settlement_preferences'))
            return {mode:'monthly'};
          if(sql.includes('COUNT(mm.user_uid) AS member_count'))
            return {id:1,name:'Royal',role,status:'active'};
          if(sql.startsWith('SELECT m.user_uid,m.role,m.joined_at'))
            return {user_uid:targetUid,role:'member',joined_at:'2026-11-01 00:00:00',
              public_no:10000009,name:'Member Nine',pic:null};
          if(sql.startsWith('SELECT COUNT(*) AS gift_count'))
            return {gift_count:2,gift_items:3,total_diamonds:4000};
          if(sql.includes('FROM sharika_family_crystal_ledger'))
            return {units:90000};
          if(sql.includes('FROM sharika_family_crystal_transfers'))
            return {units:0};
          return null;
        },
        async all(){
          calls.push({method:'all',sql,args:this.args});
          if(sql.includes('GROUP BY substr(e.created_at'))
            return {results:[{day:'2026-11-04',gift_count:2,diamonds:4000}]};
          if(sql.includes('e.id,e.created_at,e.quantity,e.price_coins'))
            return {results:[{id:7,created_at:'2026-11-04 11:00:00',
              quantity:2,price_coins:2000,gift_name:'Royal Rose'}]};
          return {results:[]};
        }
      };
    }
  };
  return {DB,calls};
}
const reply=(body,status)=>Response.json(body,{status});
const fail=(error,status)=>Response.json({error},{status});
async function report(f,uid='viewer'){
  const path='/api/v1/family/members/10000009/report';
  const request=new Request('https://staging.test'+path);
  const response=await handleFamilyApp({request,env:{DB:f.DB},uid,path,cors:{},reply,fail});
  return {response,data:await response.json()};
}
test('owner gets dated, verified regular-gift member report with private salary unset',async()=>{
  const f=fixture('leader','member');
  const {response,data}=await report(f);
  assert.equal(response.status,200);
  assert.equal(data.member.public_id,'10000009');
  assert.equal(data.summary.total_diamonds,4000);
  assert.equal(data.summary.salary_coins,null);
  assert.equal(data.daily[0].day,'2026-11-04');
  assert.equal(data.events[0].diamonds,4000);
  assert.equal(data.crystal_wallet.available_units,90000);
  assert.equal(data.source,'verified_regular_gifts_after_join');
  const sql=f.calls.map(x=>x.sql).join('\n');
  assert.match(sql,/g.tab IN \(0,1\)/);
  assert.match(sql,/e.created_at>=\?/);
});
test('a regular Family member cannot inspect another member report',async()=>{
  const f=fixture('member','different-user');
  const {response,data}=await report(f,'viewer');
  assert.equal(response.status,403);
  assert.equal(data.error,'family_member_report_forbidden');
  assert.equal(f.calls.filter(x=>x.sql.includes('SELECT COUNT(*) AS gift_count')).length,0);
});
test('a regular Family member can inspect only their own report',async()=>{
  const f=fixture('member','viewer');
  const {response}=await report(f);
  assert.equal(response.status,200);
});
test('new royal Family UI preserves BD separation and verified API access',()=>{
  const code=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const bridge=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
  assert.match(code,/renderRoyalFamily=function\(data\)/);
  assert.match(code,/sh-fam-v2-member/);
  assert.match(code,/sh-fam-v2-stats/);
  assert.match(code,/showFamilyMemberReport/);
  assert.match(code,/openRoyalBD/);
  assert.match(code,/bd.onclick=openRoyalBD/);
  assert.match(code,/showFamilySellerDirectory/);
  assert.match(code,/family\/members\/'\+encodeURIComponent\(id\)\+'\/report/);
  assert.match(bridge,/family\/members\/\[0-9\]\{8\}\/report/);
  assert.match(code,/@media\(prefers-reduced-motion:reduce\)/);
});
