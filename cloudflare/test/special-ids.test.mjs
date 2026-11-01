import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSpecialAdmin,activeSpecialSelect,activeSpecial} from '../src/special-ids.mjs';

function mockDb({reserved=false,target=true,assigned=false}={}){
  const calls=[];
  const db={
    prepare(sql){
      const entry={sql,args:[]};calls.push(entry);
      return {
        bind(...args){entry.args=args;return this;},
        async first(){
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
  const request=new Request(url,{method,
    headers:body===undefined?{}:{'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)});
  const response=await handleSpecialAdmin({
    request,env:{DB:db},uid:'owner_uid',actor:{role},operation,
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
test('the Special ID must be 4-7 digits; permanent account ID remains unchanged',async()=>{
  const invalid=await run({method:'POST',body:{
    public_id:'10000001',special_id:'10000001',duration_days:30,frame:'neon'
  }});
  assert.equal(invalid.status,400);
  const valid=await run({method:'POST',body:{
    public_id:'10000001',special_id:'777777',duration_days:30,frame:'neon'
  }});
  assert.equal(valid.status,200);
  assert.equal(valid.data.public_id,'10000001');
  assert.equal(valid.data.display_id,'777777');
  assert.equal(valid.calls.at(-1).batch,2);
  assert.ok(valid.calls.some(call=>call.sql?.includes('INSERT INTO sharika_admin_audit')));
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
