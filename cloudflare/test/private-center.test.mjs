import test from 'node:test';
import assert from 'node:assert/strict';
import {centerPublished,handlePrivateCenter} from '../src/private-center.mjs';

function fakeDb(){
 const events=[];
 const db={events};
 db.prepare=(sql)=>({
  bind(...args){
   return {
    async first(){
     if(sql.startsWith('SELECT published'))return args[0]==='game'&&args[1]==='royal-ace'?{published:1}:null;
     if(sql.includes('FROM sharika_admin_roles'))return args[0]==='firebase:example:super'?{role:'super'}:null;
     if(sql.includes('FROM sharika_center_publishing WHERE id=?'))return {id:args[0],kind:args[1],published:0};
     return null;
    },
    async all(){return {results:[]}},
    async run(){events.push({sql,args});return {success:true};}
   };
  },
  async all(){return {results:[]}}
 });
 db.batch=async stmts=>{for(const statement of stmts)await statement.run();return []};
 return db;
}
const reply=(v,status=200)=>new Response(JSON.stringify(v),{status});
const fail=(reason,status=400)=>new Response(JSON.stringify({error:reason}),{status});
const invoke=({path,method='GET',data,uid='firebase:example:user',db=fakeDb()})=>
 handlePrivateCenter({request:new Request('https://unit.test'+path,{
   method,headers:{'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})
  }),path,db,uid,reply,fail,cors:{}});
test('hidden and published games are distinguishable by database',async()=>{
 const db=fakeDb();
 assert.equal(await centerPublished(db,'game','royal-ace'),true);
 assert.equal(await centerPublished(db,'game','cleopatra'),false);
 assert.equal(await centerPublished(db,'game','../oops'),false);
});
test('non-admin cannot list or publish hidden modules',async()=>{
 const res=await invoke({path:'/api/v1/center/admin/state'});
 assert.equal(res.status,403);
 const changed=await invoke({path:'/api/v1/center/admin/visibility',method:'PATCH',
  data:{id:'royal-ace',kind:'game',published:true}});
 assert.equal(changed.status,403);
});
test('odds updates cannot be smuggled through anonymous or non-admin requests',async()=>{
 const result=await invoke({path:'/api/v1/center/admin/odds-draft',method:'PATCH',
  data:{game_id:'royal-ace',win_rate_basis_points:3500,target_rtp_basis_points:9000,notes:'test'}});
 assert.equal(result.status,403);
});
test('invalid publication is rejected even for super admin',async()=>{
 const res=await invoke({path:'/api/v1/center/admin/visibility',method:'PATCH',
  uid:'firebase:example:super',data:{id:'../evil',kind:'game',published:true}});
 assert.equal(res.status,400);
});
test('an empty publishing table returns no phantom games or rankings',async()=>{
 const res=await invoke({path:'/api/v1/center/manifest'});
 assert.equal(res.status,200);
 const data=await res.json();
 assert.deepEqual(data.games,[]);
 assert.deepEqual(data.rankings,[]);
 assert.deepEqual(data.events,[]);
});
