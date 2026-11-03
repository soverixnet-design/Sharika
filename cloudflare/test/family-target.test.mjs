import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleFamilyApp, familyGiftCommissionStatements} from '../src/family.mjs';

const reply=(body,status)=>new Response(JSON.stringify(body),{status});
const fail=(error,status)=>reply({error},status);

test('Family gift target includes verified regular owner gifts independent of Crystal commission',async()=>{
  const calls=[];
  const db={
    prepare(sql){
      const statement={sql,values:[],bind(...v){this.values=v;return this;},
        async first(){
          calls.push({sql,values:this.values});
          if(sql.startsWith('SELECT auth_uid,public_no,name,minor'))
            return {auth_uid:'owner',public_no:10000001,name:'Owner',minor:0};
          if(sql.startsWith('SELECT * FROM sharika_family_policy'))
            return {active:1,owner_bps:1000,bd_bps:500,max_members:20,
              conversion_enabled:0,coins_per_crystal:1,settlement_mode:'monthly'};
          if(sql.includes('COUNT(mm.user_uid) AS member_count'))
            return {id:1,name:'Royal',level:1,status:'active',owner_uid:'owner',
              bd_uid:'bd',role:'leader',owner_no:10000001,owner_name:'Owner',
              bd_no:10000002,member_count:1};
          if(sql.includes('AS total_diamonds'))
            return {total_gifts:6,total_coins:102800,daily_gifts:6,
              weekly_gifts:6,monthly_gifts:6,total_diamonds:102800,
              daily_diamonds:102800,weekly_diamonds:102800,
              monthly_diamonds:102800};
          if(sql.includes('SUM(crystal_units)'))return {units:0};
          return null;
        },
        async all(){calls.push({sql,values:this.values});return {results:[]};}
      };
      return statement;
    }
  };
  const path='/api/v1/family/me';
  const response=await handleFamilyApp({request:new Request('https://test.invalid'+path),
    env:{DB:db},uid:'owner',path,cors:{},reply,fail});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.deepEqual(data.target_progress,{
    unit:'diamonds',today:102800,week:102800,month:102800,
    lifetime:102800,source:'settled_regular_gifts_after_family_join'
  });
  assert.equal(data.activity.total_gifts,6);
  assert.equal(data.wallet.total_units,0);
  const progressSql=calls.find(c=>c.sql.includes('AS total_diamonds'))?.sql||'';
  assert.match(progressSql,/JOIN sharika_family_members fm ON fm.user_uid=e.sender_uid/);
  assert.match(progressSql,/e.created_at>=fm.joined_at/);
  assert.match(progressSql,/g.tab IN \(0,1\)/);
  assert.doesNotMatch(progressSql,/e.sender_uid<>f.owner_uid/);
  const inserts=familyGiftCommissionStatements(db,'owner','gift-test-id-123',0);
  assert.ok(inserts.some(s=>s.sql.includes('e.sender_uid<>f.owner_uid')),
    'Owner self-gifts still do not earn owner Crystal commissions');
});

test('Royal Family UI presents diamond target values and user refresh',()=>{
  const ui=readFileSync(new URL(
    '../../android-staging/staging-connection.js',import.meta.url),'utf8');
  for(const required of ['Family Diamond Gift Target','data.target_progress',
    'fmtDiamonds(progress.month)','fmtDiamonds(progress.lifetime)',
    'sh-fam-refresh-target','await reloadRoyalFamily()'])
    assert.ok(ui.includes(required),required+' must be displayed by Android bridge');
});
