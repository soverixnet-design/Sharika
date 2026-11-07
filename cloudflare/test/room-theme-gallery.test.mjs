import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleRoomThemeAdmin,listRoomThemes,roomThemeId,validateCatalogTheme} from '../src/room-themes.mjs';
import {handleRequest} from '../src/index.mjs';

function memoryDb(){
  const rows=new Map(),audits=[];let nextId=1;
  return {rows,audits,prepare(sql){
    const statement={values:[],bind(...values){this.values=values;return this;},
      async first(){
        if(sql.startsWith('SELECT COUNT(*)'))return {count:rows.size};
        if(sql.startsWith('SELECT id,image_bytes')){
          const item=rows.get(this.values[0]);
          return item?{id:item.id,image_bytes:item.image_bytes}:null;
        }
        if(sql.startsWith('SELECT active,image_bytes')){
          const item=rows.get(this.values[0]);return item?{active:item.active,image_bytes:item.image_bytes}:null;
        }
        if(sql.startsWith('SELECT image_bytes,image_version')){
          const item=rows.get(this.values[0]);return item?{
            image_bytes:item.image_bytes,image_version:item.image_version}:null;
        }
        if(sql.startsWith('SELECT image_base64 FROM sharika_room_theme_catalog')){
          const item=rows.get(this.values[0]);
          return item?.image_bytes>0?{image_base64:item.image_base64}:null;
        }
        throw Error('Unexpected first SQL: '+sql);
      },
      async all(){
        const values=[...rows.values()].filter(x=>!sql.includes('WHERE active=1')||
          (x.active===1&&x.image_bytes>0));
        values.sort((a,b)=>a.sort_order-b.sort_order||a.id-b.id);
        return {results:values.slice(0,100)};
      },
      async run(){
        if(sql.startsWith('INSERT INTO sharika_room_theme_catalog')){
          const id=nextId++;
          rows.set(id,{id,name:this.values[0],sort_order:this.values[1],active:0,
            image_base64:'',image_bytes:0,image_version:1});
          return {meta:{changes:1,last_row_id:id}};
        }
        if(sql.startsWith('UPDATE sharika_room_theme_catalog SET image_base64')){
          const row=rows.get(this.values[2]);
          Object.assign(row,{image_base64:this.values[0],image_bytes:this.values[1],
            image_version:row.image_version+1});
          return {meta:{changes:1}};
        }
        if(sql.startsWith('UPDATE sharika_room_theme_catalog SET ')){
          const row=rows.get(this.values.at(-1));
          const names=sql.slice('UPDATE sharika_room_theme_catalog SET '.length)
            .split(",updated_at")[0].split(',').map(p=>p.split('=')[0]);
          names.forEach((name,i)=>{row[name]=this.values[i];});
          return {meta:{changes:1}};
        }
        if(sql.startsWith('INSERT INTO sharika_admin_audit')){
          audits.push(this.values);return {meta:{changes:1}};
        }
        throw Error('Unexpected run SQL: '+sql);
      }};
    return statement;
  },async batch(statements){return Promise.all(statements.map(s=>s.run()));}};
}
function response(payload,status=200){
  return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
}
function admin(db,role,method,operation,body){
  const request=new Request('https://sharika-api-staging.soverixnet.workers.dev/api/v1/admin/'+operation,{
    method,headers:body===undefined?{}:{'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  return handleRoomThemeAdmin({request,db,uid:'owner',role,operation,cors:{},
    reply:response,fail:(code,status)=>response({error:code},status)});
}
const origin='https://sharika-api-staging.soverixnet.workers.dev';

test('official theme upload is Super Admin-only and invisible until published',async()=>{
  const db=memoryDb();
  assert.equal((await admin(db,'support','POST','room-themes',{name:'Royal Palace'})).status,403);
  const created=await admin(db,'super','POST','room-themes',{name:'Royal Palace',sort_order:3});
  assert.equal(created.status,201);
  const {id}=await created.json();assert.equal(id,1);
  assert.deepEqual(await listRoomThemes(db,origin,true),[]);
  assert.equal((await admin(db,'super','PATCH','room-themes/'+id,{active:true})).status,409);
  assert.equal((await admin(db,'super','PUT','room-themes/'+id+'/image',{
    image_data:'data:text/html;base64,PHNjcmlwdD4='})).status,400);
  const bytes=Uint8Array.from([255,216,255,1,2,3,4,5,6,7,8,9,10,11,12,13,255,217]);
  const b64=btoa(String.fromCharCode(...bytes));
  assert.equal((await admin(db,'super','PUT','room-themes/'+id+'/image',{
    image_data:'data:image/jpeg;base64,'+b64})).status,200);
  assert.deepEqual(await listRoomThemes(db,origin,true),[]);
  assert.equal(await validateCatalogTheme(db,id),false);
  assert.equal((await admin(db,'super','PATCH','room-themes/'+id,{active:true})).status,200);
  assert.equal(await validateCatalogTheme(db,id),true);
  assert.deepEqual(await listRoomThemes(db,origin,true),[{
    id:1,name:'Royal Palace',sort_order:3,active:true,
    image_url:origin+'/api/v1/room-themes/1/image?v=2'
  }]);
  assert.equal(db.audits.length,3);
  assert.equal((await admin(db,'support','GET','room-themes')).status,200);
  assert.equal((await (await admin(db,'support','GET','room-themes')).json()).read_only,true);
  assert.equal((await admin(db,'super','PATCH','room-themes/1',{active:false})).status,200);
  assert.deepEqual(await listRoomThemes(db,origin,true),[]);
  assert.equal(db.rows.get(1).image_bytes,bytes.length,'unpublishing never deletes artwork');
});

test('public catalog and versioned image are readable without Firebase identity',async()=>{
  const db=memoryDb();
  db.rows.set(9,{id:9,name:'Garden',sort_order:0,active:1,
    image_bytes:18,image_version:4,
    image_base64:btoa(String.fromCharCode(...[255,216,255,1,2,3,4,5,6,7,8,9,10,11,12,13,255,217]))});
  const list=await handleRequest(new Request(origin+'/api/v1/room-themes'),{DB:db});
  assert.equal(list.status,200);
  const data=await list.json();
  assert.equal(data.themes[0].image_url,origin+'/api/v1/room-themes/9/image?v=4');
  const art=await handleRequest(new Request(origin+'/api/v1/room-themes/9/image?v=4'),{DB:db});
  assert.equal(art.status,200);
  assert.equal(art.headers.get('content-type'),'image/jpeg');
  assert.equal(art.headers.get('access-control-allow-origin'),'*');
  assert.equal((await art.arrayBuffer()).byteLength,18);
});

test('room theme references are bounded and separate from room-card cover URLs',()=>{
  assert.equal(roomThemeId('catalog:53'),53);
  for(const raw of ['catalog:0','catalog:001','catalog:1000000000','photo','catalog:1;DROP'])
    assert.equal(roomThemeId(raw),null,raw);
  const bridge=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const start=bridge.indexOf('  function pickRoomCover(');
  const end=bridge.indexOf('  function drawVerifiedRoomCards',start);
  const method=bridge.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.match(method,/if\(useAsTheme\)\{/);
  assert.match(method,/await api\('PUT','\/rooms\/'\+room\.id\+'\/theme-image'/);
  assert.match(method,/toast\('Room background saved for everyone · card photo unchanged/);
  assert.match(method,/return;\s*}\s*\/\/ Cover editing must never overwrite/);
  assert.match(method,/await api\('PUT','\/rooms\/'\+room\.id\+'\/cover'/);
});
