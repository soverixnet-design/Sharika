import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAgencyApp} from '../src/agency.mjs';

const path='/api/v1/agency/hosts/assign';
const reply=(data,status)=>Response.json(data,{status});
const fail=(error,status)=>Response.json({error},{status});

function setup({owner=true,approved=true,alreadyElsewhere=false}={}){
  const queries=[],batch=[];
  const db={
    prepare(sql){
      return {sql,values:[],bind(...v){this.values=v;return this;},
        async first(){
          queries.push({sql,values:this.values});
          if(sql.includes('FROM sharika_users WHERE auth_uid=?'))
            return {auth_uid:'owner',public_no:10000001,status:'active',name:'Owner'};
          if(sql.includes('FROM sharika_agency_policy'))
            return {active:1,host_bps:4000,agency_bps:1000,bd_bps:500,settlement_mode:'weekly'};
          if(sql.includes('FROM sharika_families f JOIN sharika_users ou'))
            return {id:1,name:'Agency',status:'active',owner_uid:'owner',is_owner:owner?1:0};
          if(sql.includes('FROM sharika_family_members m'))
            return approved?{user_uid:'host'}:null;
          if(sql.includes('FROM sharika_agency_hosts WHERE host_uid=?'))
            return alreadyElsewhere?{family_id:2}:null;
          return null;
        }
      };
    },
    async batch(statements){batch.push(...statements);return statements.map(()=>({meta:{changes:1}}));}
  };
  return {db,queries,batch};
}

async function submit(db,active=true){
  const request=new Request('https://staging.example'+path,{
    method:'POST',body:JSON.stringify({agency_id:1,host_public_id:'10000002',active})
  });
  const response=await handleAgencyApp({
    request,env:{DB:db},uid:'owner',path,cors:{},reply,fail
  });
  return {status:response.status,body:await response.json()};
}

test('Agency Owner activates approved Host and logs to valid audit table atomically',async()=>{
  const {db,batch}=setup();
  const out=await submit(db,true);
  assert.equal(out.status,200);
  assert.equal(out.body.saved,true);
  assert.equal(batch.length,2);
  assert.match(batch[0].sql,/INSERT INTO sharika_agency_hosts/);
  assert.deepEqual(batch[0].values,['host',1,1,'owner']);
  assert.match(batch[1].sql,/INSERT INTO sharika_admin_audit\(actor_id,action,details_json\)/);
  assert.equal(batch[1].values[1],'agency_owner_host_assignment');
  assert.deepEqual(JSON.parse(batch[1].values[2]),{
    agency_id:1,host_public_id:'10000002',active:true
  });
  assert.ok(batch.every(x=>!x.sql.includes('sharika_family_activity')));
});

test('Agency Owner may pause Host without touching earned gift or wallet records',async()=>{
  const {db,batch}=setup();
  const out=await submit(db,false);
  assert.equal(out.status,200);
  assert.deepEqual(batch[0].values,['host',1,0,'owner']);
  assert.ok(batch.every(s=>!s.sql.includes('UPDATE sharika_users')));
  assert.ok(batch.every(s=>!s.sql.includes('UPDATE sharika_agency_earnings')));
  assert.equal(JSON.parse(batch[1].values[2]).active,false);
});

test('Non-owner, unapproved member and cross-Agency Host assignments fail closed',async()=>{
  for(const options of [{owner:false},{approved:false},{alreadyElsewhere:true}]){
    const {db,batch}=setup(options);
    const response=await submit(db,true);
    assert.equal(response.status,options.owner===false?403:409);
    assert.equal(batch.length,0);
  }
});
