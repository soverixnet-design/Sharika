import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {listRoomBanners,handleRoomBannerAdmin} from '../src/room-banners.mjs';

const endpoint='https://sharika-api-staging.soverixnet.workers.dev';
const reply=(body,status)=>({body,status});
const fail=(code,status)=>({error:code,status});
const request=(method,path='/api/v1/admin/room-banners',value)=>
  new Request(endpoint+path,{method,...(value===undefined?{}:{body:JSON.stringify(value),
    headers:{'content-type':'application/json'}})});
function mockDB(row={id:1,placement:'game',image_bytes:0}){
  const queries=[];
  return {queries,
    prepare(sql){
      const state={sql,arguments:[]};
      queries.push(state);
      return {
        bind(...args){state.arguments=args;return this;},
        async first(){return row;},
        async all(){return {results:[]};}
      };
    },
    async batch(){return [{meta:{last_row_id:1}},{meta:{changes:1}}];}
  };
}
const context=(db,role='super')=>({db,uid:'admin-uid',role,reply,fail,cors:{}});

test('public room banners use only active uploaded artwork and country scope',async()=>{
  const db=mockDB();
  const result=await listRoomBanners(db,endpoint,'BD');
  assert.deepEqual(result,[]);
  const query=db.queries[0];
  assert.match(query.sql,/active=1 AND image_bytes>0/);
  assert.match(query.sql,/country_code='' OR country_code=\?/);
  assert.deepEqual(query.arguments,['BD','BD']);
});

test('room banners fail closed before optional staging migration exists',async()=>{
  const db={prepare:()=>({bind(){return this;},
    all:async()=>{throw Error('D1_ERROR: no such table: sharika_room_banners');}})};
  assert.deepEqual(await listRoomBanners(db,endpoint,'IN'),[]);
});

test('untrusted country and external image data are not returned',async()=>{
  const row={id:2,title:'Games',placement:'game',country_code:'BD',
    action:'games',sort_order:1,active:1,image_bytes:300,image_version:4};
  const db={prepare(sql){
    return {bind(){return this;},all:async()=>({results:[row]})};
  }};
  const result=await listRoomBanners(db,endpoint,'BD');
  assert.equal(result.length,1);
  assert.deepEqual(Object.keys(result[0]).sort(),
    ['id','title','placement','country_code','action','active','sort_order','image_url'].sort());
  assert.equal(result[0].image_url,endpoint+'/api/v1/room-banners/2/image?v=4');
  assert.equal(result[0].action,'games');
});

test('only Super Admin may publish or upload a room banner',async()=>{
  for(const method of ['POST','PATCH','PUT','DELETE']){
    const operation=method==='POST'?'room-banners':
      method==='PATCH'?'room-banners/1':'room-banners/1/image';
    const db=mockDB();
    const response=await handleRoomBannerAdmin({
      request:request(method),...context(db,'support'),operation
    });
    assert.equal(response.status,403);
    assert.equal(response.error,'admin_permission_denied');
    assert.equal(db.queries.length,0);
  }
});

test('publishing requires verified image bytes',async()=>{
  const db=mockDB({id:1,placement:'game',image_bytes:0});
  const response=await handleRoomBannerAdmin({
    request:request('PATCH','/api/v1/admin/room-banners/1',{active:true}),
    ...context(db),operation:'room-banners/1'
  });
  assert.equal(response.status,409);
  assert.equal(response.error,'room_banner_image_required');
});

test('server rejects unsupported action and malicious country codes',async()=>{
  for(const value of [
    {title:'Open',placement:'game',action:'pay'},
    {title:'Open',placement:'game',country_code:'BD;DELETE'},
    {title:'Open',placement:'wallet'},
    {title:'' ,placement:'game'}
  ]){
    const db=mockDB();
    const response=await handleRoomBannerAdmin({
      request:request('POST','/api/v1/admin/room-banners',value),
      ...context(db),operation:'room-banners'
    });
    assert.equal(response.status,400);
    assert.equal(response.error,'invalid_room_banner');
  }
});

test('the room banner feature preserves live room permissions and does not mutate wallets',()=>{
  const root=new URL('../../',import.meta.url);
  const index=readFileSync(new URL('cloudflare/src/index.mjs',root),'utf8');
  const admin=readFileSync(new URL('cloudflare/src/admin.mjs',root),'utf8');
  const android=readFileSync(new URL('android-staging/staging-connection.js',root),'utf8');
  const ui=readFileSync(new URL('app/royal-room-ui.js',root),'utf8');
  const migration=readFileSync(new URL('cloudflare/migrations/0093_room_banner_positions.sql',root),'utf8');
  assert.match(index,/if\(path==='\/api\/v1\/room-banners'&&request.method==='GET'\)\{\s*await assertActive/);
  assert.match(index,/SELECT image_base64 FROM sharika_room_banners WHERE id=\?/);
  assert.match(index,/AND active=1 AND image_bytes>0/);
  assert.match(admin,/handleRoomBannerAdmin/);
  assert.match(android,/loadBanners:\(\)=>api\('GET','\/room-banners\?country='/);
  assert.match(ui,/sh-reference-event-banner/);
  assert.match(ui,/promoImagePattern/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS sharika_room_banners/);
  assert.doesNotMatch(migration,/UPDATE sharika_users|ALTER TABLE sharika_wallet|DELETE FROM/i);
});
