import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeBannerInput,listPublicBanners,handleBannerAdmin} from '../src/banners.mjs';
import {handleRequest} from '../src/index.mjs';

const reply=(body,status)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json'}
});
const fail=(error,status)=>reply({error},status);
function fakeDb(){
  const calls=[],rows=[];
  const db={
    calls,rows,firstRow:null,
    prepare(sql){
      return {
        sql,values:[],
        bind(...args){this.values=args;return this;},
        async first(){calls.push(['first',sql,this.values]);return db.firstRow;},
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
    color_a:'#9b4dff',color_b:'#ff3dc8',action:'none',sort_order:0,active:1,
    image_version:7});
  const published=(await listPublicBanners(db,'https://example.test'))[0];
  assert.equal(published.title,'Welcome');
  assert.equal(published.image_url,'https://example.test/api/v1/banners/5/image?v=7');
  assert.match(db.calls[0][1],/WHERE b.active=1 ORDER BY b.sort_order,b.id LIMIT 10/);
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

test('banner gallery JPEG upload is super-only, size-bounded and audited',async()=>{
  const db=fakeDb();
  const jpeg=Buffer.from([255,216,255,224,0,0,0,0,0,0,0,0,0,0,255,217]);
  const image_data='data:image/jpeg;base64,'+jpeg.toString('base64');
  const forbidden=await call(db,'banners/4/image','PUT',{image_data},'finance');
  assert.equal(forbidden.status,403);
  assert.equal(db.calls.length,0);
  const missing=await call(db,'banners/4/image','PUT',{image_data});
  assert.equal(missing.status,404);
  db.firstRow={id:4,version:3};
  const invalid=await call(db,'banners/4/image','PUT',{image_data:'data:text/html;base64,SGk='});
  assert.equal(invalid.status,400);
  const saved=await call(db,'banners/4/image','PUT',{image_data});
  assert.equal(saved.status,200);
  assert.equal((await saved.json()).version,3);
  const audit=db.calls.find(c=>c[0]==='batch');
  assert.match(audit[1][0].sql,/INSERT INTO sharika_banner_images/);
  assert.match(audit[1][1].sql,/sharika_admin_audit/);
  assert.equal(audit[1][1].values[1],'banner_image_upload');
  assert.equal(audit[1][1].values[2].includes(image_data),false);
  const removed=await call(db,'banners/4/image','DELETE');
  assert.equal(removed.status,200);
  assert.match(db.calls.at(-1)[1][0].sql,/image_bytes=0,version=MIN/);
});

test('public JPEG banner endpoint does not require Firebase and keeps images non-executable',async()=>{
  const jpeg=Buffer.from([255,216,255,224,0,0,0,0,0,0,0,0,0,0,255,217]);
  const db=fakeDb();db.firstRow={image_base64:jpeg.toString('base64')};
  const response=await handleRequest(new Request('https://example.test/api/v1/banners/4/image'),
    {DB:db},{});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'image/jpeg');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),jpeg);
});

test('gallery upload and larger home carousel are wired without replacing recharge logic',()=>{
  const admin=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../../app/golden-home.css',import.meta.url),'utf8');
  const migration=readFileSync(new URL('../migrations/0044_home_banner_images.sql',import.meta.url),'utf8');
  assert.match(admin,/type="file" id="new-banner-image"/);
  assert.match(admin,/data-bimage-id/);
  assert.match(admin,/async function bannerJpeg\(file\)/);
  assert.match(admin,/api\('PUT','banners\/'\+input.dataset.bimageId\+'\/image'/);
  assert.match(ui,/verifiedBannerImageUrl\(row.image_url,row.id\)/);
  assert.match(ui,/window.CFG.banners=cards/);
  assert.match(css,/\.slide \{\s*height: 166px;/);
  assert.match(css,/\.top-recharge \{[\s\S]*?width: 34px; height: 36px;/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS sharika_banner_images/);
});
