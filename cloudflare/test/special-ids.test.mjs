import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSpecialAdmin,activeSpecialSelect,activeSpecial} from '../src/special-ids.mjs';

function mockDb({reserved=false,target=true,assigned=false,publicCollision=false}={}){
  const calls=[];
  const db={
    prepare(sql){
      const entry={sql,args:[]};calls.push(entry);
      return {
        bind(...args){entry.args=args;return this;},
        async first(){
          if(sql.includes('SELECT 1 FROM sharika_users WHERE public_no=?'))
            return publicCollision?{public_no:10000003}:null;
          if(sql.includes('WHERE public_no=?'))
            return target?{auth_uid:'target_uid',status:'active'}:null;
          if(sql.includes('WHERE special_id=?'))
            return reserved?{auth_uid:'someone_else'}:null;
          if(sql.includes('WHERE auth_uid=?'))
            return assigned?{special_id:'777777'}:null;
          return null;
        },
        async all(){return {results:[]};}
      };
    },
    async batch(items){calls.push({batch:items.length});return items.map(()=>({meta:{changes:1}}));}
  };
  return {db,calls};
}
async function run({operation='special-ids',method='GET',body,role='super',state}={}){
  const {db,calls}=mockDb(state);
  const url='https://api.example.test/api/v1/admin/'+operation;
  const routeOperation=operation.split('?')[0];
  const request=new Request(url,{method,
    headers:body===undefined?{}:{'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)});
  const response=await handleSpecialAdmin({
    request,env:{DB:db},uid:'owner_uid',actor:{role},operation:routeOperation,
    cors:{},reply:(data,status)=>Response.json(data,{status}),
    fail:(error,status)=>Response.json({error},{status})
  });
  return {status:response.status,data:await response.json(),calls};
}

test('only Super Admin can manage Special IDs',async()=>{
  const denied=await run({role:'finance'});
  assert.equal(denied.status,403);
  assert.equal(denied.data.error,'admin_permission_denied');
});
test('Special IDs accept 1–10 decimal digits and preserve the real account ID',async()=>{
  for(const value of ['0','1','10','777777','10000003','1234567890']){
    const valid=await run({method:'POST',body:{
      public_id:'10000001',special_id:value,duration_days:30,frame:'neon'
    }});
    assert.equal(valid.status,200,value);
    assert.equal(valid.data.public_id,'10000001');
    assert.equal(valid.data.display_id,value);
    assert.equal(valid.calls.at(-1).batch,2);
    assert.ok(valid.calls.some(call=>call.sql?.includes('INSERT INTO sharika_admin_audit')));
  }
  for(const value of ['', '12345678901','1a','-1','1.0',' 7']){
    const invalid=await run({method:'POST',body:{
      public_id:'10000001',special_id:value,duration_days:30,frame:'neon'
    }});
    assert.equal(invalid.status,400,value);
    assert.ok(!invalid.calls.some(call=>call.batch));
  }
});
test('an 8-digit alias cannot shadow a real member ID',async()=>{
  const conflict=await run({method:'POST',state:{publicCollision:true},body:{
    public_id:'10000001',special_id:'10000003',duration_days:30,frame:'neon'
  }});
  assert.equal(conflict.status,409);
  assert.equal(conflict.data.error,'special_id_conflicts_with_account_id');
  assert.ok(!conflict.calls.some(call=>call.batch));
});
test('availability includes alias and immutable member ID conflicts',async()=>{
  for(const value of ['1','1234567890']){
    const a=await run({operation:'special-ids/availability?value='+value});
    assert.equal(a.status,200);
    assert.equal(a.data.available,true);
  }
  const collision=await run({
    operation:'special-ids/availability?value=10000003',
    state:{publicCollision:true}
  });
  assert.equal(collision.data.available,false);
  const invalid=await run({operation:'special-ids/availability?value=12345678901'});
  assert.equal(invalid.status,400);
  assert.equal(invalid.data.error,'special_id_must_be_1_to_10_digits');
});
test('duplicate Special ID is rejected with no write',async()=>{
  const response=await run({method:'POST',state:{reserved:true},body:{
    public_id:'10000001',special_id:'777777',duration_days:null,frame:'neon'
  }});
  assert.equal(response.status,409);
  assert.equal(response.data.error,'special_id_already_reserved');
  assert.ok(!response.calls.some(x=>x.batch));
});
test('nonexistent target cannot receive a Special ID',async()=>{
  const response=await run({method:'POST',state:{target:false},body:{
    public_id:'10000001',special_id:'777777',duration_days:7,frame:'neon'
  }});
  assert.equal(response.status,404);
});
test('revoke requires a stored assignment and writes audit in the same batch',async()=>{
  const missing=await run({operation:'special-ids/10000001/revoke',
    method:'PATCH',state:{assigned:false},body:{}});
  assert.equal(missing.status,404);
  const revoked=await run({operation:'special-ids/10000001/revoke',
    method:'PATCH',state:{assigned:true},body:{}});
  assert.equal(revoked.status,200);
  assert.equal(revoked.data.revoked,true);
  assert.equal(revoked.calls.at(-1).batch,2);
});
test('lookup helper only reads unexpired aliases',()=>{
  assert.match(activeSpecialSelect('u'),/expires_at>datetime\('now'\)/);
});
