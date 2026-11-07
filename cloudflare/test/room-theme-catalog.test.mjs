import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adminRoomThemes,publicRoomThemes,selectableCatalogTheme,catalogWallpaper}
  from '../src/room-theme-catalog.mjs';

const origin='https://sharika-api-staging.soverixnet.workers.dev';
const uuid='765c978a-f910-4491-a410-998877665544';
const image=origin+'/api/v1/media/'+uuid+'.webp';
const rows=[];
function fixture(){
  const calls=[];
  const db={prepare(sql){return {
    bind(...args){this.args=args;calls.push({sql,args});return this;},
    async first(){
      if(sql.startsWith('SELECT 1 AS allowed'))return {allowed:1};
      return {media_path:'/api/v1/media/'+uuid+'.webp'};
    },
    async all(){return {results:rows};},
    async run(){return {meta:{changes:1}};}
  };}};
  const env={DB:db,MEDIA_BUCKET:{async head(){return {
    httpMetadata:{contentType:'image/webp'}
  };}}};
  const handlers={env,uid:'super-uid',role:'super',cors:{},
    reply:(payload,status)=>Response.json(payload,{status}),
    fail:(error,status)=>Response.json({error},{status})};
  return {calls,db,env,handlers};
}

test('admin theme catalog uses approved R2 pictures, server authorization and audit',async()=>{
  const {calls,handlers}=fixture();
  const request=data=>new Request(origin+'/api/v1/admin/room-themes',{
    method:'POST',body:JSON.stringify(data)
  });
  const params={...handlers,operation:'room-themes'};
  const invalid=await adminRoomThemes({...params,request:request({
    name:'Fake',image_url:'https://untrusted.example/picture.webp'
  })});
  assert.equal(invalid.status,400);
  const denied=await adminRoomThemes({...params,role:'support',request:request({
    name:'Gold',image_url:image
  })});
  assert.equal(denied.status,403);
  const saved=await adminRoomThemes({...params,request:request({
    name:'Royal Gold',image_url:image,sort_order:2,active:true
  })});
  assert.equal(saved.status,201);
  assert.match((await saved.json()).key,/^catalog:[a-f0-9-]{36}$/);
  assert.ok(calls.some(c=>c.sql.includes('INSERT INTO sharika_room_theme_catalog')));
  assert.ok(calls.some(c=>c.sql.includes('INSERT INTO sharika_admin_audit')));
});

test('public list, active selection and guest wallpaper use the saved media path',async()=>{
  const {handlers,db}=fixture();
  rows.push({id:uuid,name:'Royal Gold',media_path:'/api/v1/media/'+uuid+'.webp',
    active:1,sort_order:2});
  try{
    const res=await publicRoomThemes({...handlers,request:new Request(origin+'/api/v1/room-themes')});
    assert.equal(res.status,200);
    const payload=await res.json();
    assert.equal(payload.themes[0].key,'catalog:'+uuid);
    assert.equal(payload.themes[0].image_url,image);
    assert.equal(await selectableCatalogTheme(db,'catalog:'+uuid),true);
    assert.equal(await catalogWallpaper(db,'catalog:'+uuid,origin),image);
    assert.equal(await selectableCatalogTheme(db,'catalog:javascript'),false);
  }finally{rows.pop();}
});

test('HD wallpaper picker never uploads to room cover or overwrites room profile',()=>{
  const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const begin=ui.indexOf('        if(useAsTheme){');
  const end=ui.indexOf('        const image_data=await jpegRoomPreview(file);',begin);
  assert.ok(begin>=0&&end>begin);
  const themeFlow=ui.slice(begin,end);
  assert.match(themeFlow,/\/theme-image/);
  assert.doesNotMatch(themeFlow,/\/cover/);
  assert.doesNotMatch(themeFlow,/frame\.S\.pic=/);
  assert.match(ui,/frame\.themeSheet=async function openSharedRoomThemes/);
  const royal=readFileSync(new URL('../../app/royal-room-ui.js',import.meta.url),'utf8');
  assert.match(royal,/top\.insertBefore\(games, settingsButton\)/);
  assert.match(royal,/menuItem\('🎮 Games'/);
});
