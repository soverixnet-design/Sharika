import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleCosmeticApp} from '../src/cosmetics.mjs';

const root=new URL('../../',import.meta.url);
const ui=readFileSync(new URL('android-staging/staging-connection.js',root),'utf8');
const sql=readFileSync(new URL('cloudflare/migrations/0043_official_cs_seller_animated_frames.sql',root),'utf8');
const items=[
  ['cs-royal-wings','CS Royal Wings'],
  ['coin-seller-royal','Coin Seller Crown']
];

test('both video frames retain transparent alpha and animation inside their WebP asset',()=>{
  for(const [key] of items){
    const path=new URL('android-staging/app/src/main/assets/sharika-premium/'+key+'.webp',root);
    const bytes=readFileSync(path);
    assert.ok(bytes.length>25000,key);
    assert.equal(bytes.toString('ascii',0,4),'RIFF',key);
    assert.equal(bytes.toString('ascii',8,12),'WEBP',key);
    assert.equal(bytes.toString('ascii',12,16),'VP8X',key);
    assert.equal(bytes[20]&0x12,0x12,'animated+alpha: '+key);
  }
});
test('Shop displays official-role frame previews without an ordinary Purchase action',()=>{
  for(const [key,name] of items){
    assert.ok(ui.includes("premiumItem('"+key+"','"+name),key);
    assert.ok(ui.includes("'frame_style:"+key+"'"),key);
    assert.ok(sql.includes("'frame_style:"+key+"'"),key);
  }
  assert.match(ui,/OFFICIAL_ROLE_FRAMES\.has\(x\.id\)/);
  assert.match(ui,/officialOnly\?'Admin only':'Purchase'/);
  assert.match(sql,/1000000,0/);
});
test('server forbids purchasing CS and seller role titles without Super Admin',async()=>{
  for(const [key] of items){
    let touched=false;
    const response=await handleCosmeticApp({
      request:new Request('https://sharika.example/api/v1/cosmetics/purchase',
        {method:'POST',body:'{}'}),path:'/api/v1/cosmetics/purchase',
      uid:'ordinary-user',
      db:{prepare(){touched=true;throw Error('DB should not be touched');}},
      readBody:async()=>({item_id:'frame_style:'+key,request_id:'official-frame-test-0001'}),
      fail:(error,status)=>Response.json({error},{status}),
      reply:(body,status)=>Response.json(body,{status}),cors:{}
    });
    assert.equal(response.status,403,key);
    assert.equal((await response.json()).error,'official_role_frame_admin_grant_only');
    assert.equal(touched,false);
  }
});
