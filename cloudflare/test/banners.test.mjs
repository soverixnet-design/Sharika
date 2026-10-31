import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBannerInput,listPublicBanners,handleBannerAdmin} from '../src/banners.mjs';

const reply=(body,status)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json'}
});
const fail=(error,status)=>reply({error},status);
function fakeDb(){
  const calls=[],rows=[];
  const db={
    calls,rows,
    prepare(sql){
      return {
        sql,values:[],
        bind(...args){this.values=args;return this;},
        async first(){calls.push(['first',sql,this.values]);return null;},
        async all(){calls.push(['all',sql,this.values]);return {results:rows};},
        async run(){calls.push(['run',sql,this.values]);return {meta:{changes:1}};}
      };
    },
    async batch(stmts){
      calls.push(['batch',stmts.map(x=>({sql:x.sql,values:x.values}))]);
      return [{meta:{last_row_id:1,changes:1}},{meta:{changes:1}}];
    }
  };
  return db;
}
function call(db,operation,method='GET',body,role='super'){
  return handleBannerAdmin({
    env:{DB:db},uid:'owner-auth-uid',role,operation,
    request:new Request('https://example.test/api/v1/admin/'+operation,{
      method,body:body===undefined?undefined:JSON.stringify(body),
      headers:body===undefined?{}:{'content-type':'application/json'}
    }),cors:{},reply,fail
  });
}
test('banner input uses bounded text, colors and safe actions',()=>{
  assert.equal(normalizeBannerInput({title:' '}),null);
  assert.equal(normalizeBannerInput({title:'Hi',action:'javascript:alert(1)'}),null);
  assert.equal(normalizeBannerInput({title:'Hi',color_a:'url(http://attacker)'}),null);
  assert.equal(normalizeBannerInput({title:'Hi',coins:1000000}),null);
  assert.equal(normalizeBannerInput({title:'Hi',sort_order:101}),null);
  assert.equal(normalizeBannerInput({active:true},true).active,1);
  assert.deepEqual(normalizeBannerInput({title:' Hello ',action:'daily'}),{
    title:'Hello',subtitle:'',emoji:'🎉',color_a:'#9b4dff',color_b:'#ff3dc8',
    action:'daily',sort_order:0,active:0
  });
});
test('home banners are server-controlled active rows only',async()=>{
  const db=fakeDb();
  db.rows.push({id:5,title:'Welcome',subtitle:'Hello',emoji:'🎉',
    color_a:'#9b4dff',color_b:'#ff3dc8',action:'none',sort_order:0,active:1});
  assert.equal((await listPublicBanners(db))[0].title,'Welcome');
  assert.match(db.calls[0][1],/WHERE active=1 ORDER BY sort_order,id LIMIT 10/);
});
test('non-super admin can read but cannot mutate home banners',async()=>{
  const db=fakeDb();
  const read=await call(db,'banners','GET',undefined,'finance');
  assert.equal(read.status,200);
  assert.equal((await read.json()).read_only,true);
  const before=db.calls.length;
  const denied=await call(db,'banners','POST',{title:'No'},'finance');
  assert.equal(denied.status,403);
  assert.equal(db.calls.length,before);
});
test('super admin creates and updates banners with audited SQL',async()=>{
  const db=fakeDb();
  const created=await call(db,'banners','POST',{title:'Weekly room show',
    subtitle:'Friends meet today',emoji:'🎙️',action:'rank',
    color_a:'#9b4dff',color_b:'#0ea5e9',sort_order:1,active:true});
  assert.equal(created.status,201);
  const batch=db.calls.find(c=>c[0]==='batch');
  assert.match(batch[1][0].sql,/INSERT INTO sharika_banners/);
  assert.match(batch[1][1].sql,/sharika_admin_audit/);
  const invalid=await call(db,'banners/1','PATCH',{title:''});
  assert.equal(invalid.status,400);
  const missing=await call(db,'banners/1','PATCH',{active:false});
  assert.equal(missing.status,404);
});
