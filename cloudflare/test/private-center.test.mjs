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


test('global Events OFF prevents exposing even individually published event cards',async()=>{
 const statements=[];
 const db={prepare(sql){
  return {bind(...args){this.args=args;return this;},async all(){
    statements.push({sql,args:this.args||[]});
    if(sql.includes("SELECT p.id,p.kind,p.title,p.sort_order FROM"))return {results:[
      {id:'rich',kind:'ranking',title:'Rich Ranking',sort_order:1}
    ]};
    if(sql.includes('JOIN sharika_game_catalog'))return {results:[]};
    if(sql.includes('FROM sharika_events'))throw Error('should_never_query_private_events');
    return {results:[]};
  }};
 }};
 const res=await invoke({path:'/api/v1/center/manifest',db});
 assert.equal(res.status,200);
 const result=await res.json();
 assert.equal(result.events.length,0);
 assert.equal(statements.some(q=>q.sql.includes('FROM sharika_events')),false);
});
test('only approved scheduled events expose verified banner and real prize details',async()=>{
 const db={prepare(sql){
  const statement={sql,args:[],bind(...args){this.args=args;return this;},
   async all(){
    if(sql.includes("SELECT p.id,p.kind,p.title,p.sort_order FROM"))return {results:[
     {id:'events',kind:'module',title:'Event Center',sort_order:1},
     {id:'rich',kind:'ranking',title:'Rich Ranking',sort_order:2}
    ]};
    if(sql.includes('JOIN sharika_game_catalog'))return {results:[]};
    if(sql.includes('FROM sharika_events')){
     assert.match(sql,/e\.ends_at>\?/);
     assert.doesNotMatch(sql,/e\.starts_at<=\?/);
     return {results:[{id:7,title:'Golden Weekend',kind:'gift_race',
      description:'Official gift race',starts_at:'2099-01-01T00:00:00.000Z',
      ends_at:'2099-01-03T00:00:00.000Z',prize_1:100,prize_2:50,prize_3:25,
      banner_version:2,reward_labels_json:'["Gold Crown","Silver","Bronze"]'}]};
    }
    return {results:[]};
   }};
  return statement;
 }};
 const res=await invoke({path:'/api/v1/center/manifest',db});
 assert.equal(res.status,200);
 const data=await res.json();
 assert.deepEqual(data.events.map(e=>e.title),['Golden Weekend']);
 assert.deepEqual(data.events[0].prizes,[100,50,25]);
 assert.equal(data.events[0].status,'scheduled');
 assert.deepEqual(data.events[0].reward_labels,['Gold Crown','Silver','Bronze']);
 assert.equal(data.events[0].banner_url,'/api/center/events/7/banner?v=2');
});
test('unimplemented generic Event ranking may not be published with fabricated winners',async()=>{
 const db=fakeDb();
 const result=await invoke({path:'/api/v1/center/admin/visibility',method:'PATCH',db,
  uid:'firebase:example:super',data:{kind:'ranking',id:'event',published:true}});
 assert.equal(result.status,409);
 assert.equal((await result.json()).error,'ranking_source_not_ready');
 assert.equal(db.events.length,0);
});
