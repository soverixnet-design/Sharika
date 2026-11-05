import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleAdminMediaUpload,servePublicMedia,safeMediaUrl} from '../src/admin-media.mjs';

const reply=(value,status=200)=>Response.json(value,{status});
const fail=(error,status)=>reply({error},status);
const movie=new Uint8Array([0,0,0,18,0x66,0x74,0x79,0x70,0x69,0x73,0x6f,0x6d,
  0,0,0,0,0,0,0,0]);
function fixture(){
  const records=new Map(),audits=[];
  const env={
    MEDIA_BUCKET:{
      async put(key,data,options){records.set(key,{bytes:data,options});},
      async head(key){
        const record=records.get(key);
        return record&&{size:record.bytes.byteLength,httpEtag:'"demo-etag"',
          httpMetadata:record.options.httpMetadata};
      },
      async get(key,options){
        const record=records.get(key);
        if(!record)return null;
        const range=options?.range;
        const bytes=range?record.bytes.slice(range.offset,range.offset+range.length):record.bytes;
        return {body:new Response(bytes).body};
      }
    },
    DB:{prepare(){return{bind(...args){return{async run(){audits.push(args);}};}};}}
  };
  return {env,records,audits};
}
function uploadRequest(body=movie,headers={}){
  return new Request('https://sharika-api-staging.example/api/v1/admin/media/upload',{
    method:'POST',headers:{'content-type':'video/mp4',
      'x-sharika-media-category':'video','x-sharika-media-size':String(body.byteLength),
      ...headers},body
  });
}
function upload(env,request,role='super'){
  return handleAdminMediaUpload({request,env,uid:'verified-admin',role,
    cors:{},reply,fail});
}
test('only Super Admin may upload, with configured R2 storage',async()=>{
  const {env,records}=fixture();
  assert.equal((await upload(env,uploadRequest(),'finance')).status,403);
  assert.equal(records.size,0);
  delete env.MEDIA_BUCKET;
  assert.equal((await upload(env,uploadRequest())).status,503);
});
test('uploads validate media type, byte budget and file signatures',async()=>{
  const {env,records}=fixture();
  assert.equal((await upload(env,uploadRequest(movie,{'content-type':'text/html'}))).status,415);
  assert.equal((await upload(env,uploadRequest(movie,{'x-sharika-media-category':'image'}))).status,400);
  assert.equal((await upload(env,uploadRequest(movie,{'x-sharika-media-size':'27000000'}))).status,413);
  const bogus=new Uint8Array(20);bogus.fill(7);
  assert.equal((await upload(env,uploadRequest(bogus))).status,400);
  assert.equal(records.size,0);
});
test('uploaded video has opaque public URL, supports ranged playback, and is audited',async()=>{
  const {env,records,audits}=fixture();
  const response=await upload(env,uploadRequest());
  assert.equal(response.status,201);
  const body=await response.json();
  assert.match(body.url,/^https:\/\/sharika-api-staging\.example\/api\/v1\/media\/[a-f0-9-]{36}\.mp4$/);
  assert.equal(records.size,1);
  assert.equal(audits[0][1],'media_upload');
  const all=await servePublicMedia(new Request(body.url),env,new URL(body.url).pathname);
  assert.equal(all.status,200);
  assert.equal(all.headers.get('content-type'),'video/mp4');
  assert.deepEqual(new Uint8Array(await all.arrayBuffer()),movie);
  const partial=await servePublicMedia(new Request(body.url,{headers:{range:'bytes=4-7'}}),
    env,new URL(body.url).pathname);
  assert.equal(partial.status,206);
  assert.equal(partial.headers.get('content-range'),'bytes 4-7/20');
  assert.deepEqual(new Uint8Array(await partial.arrayBuffer()),movie.slice(4,8));
  const invalid=await servePublicMedia(new Request(body.url,{headers:{range:'bytes=22-29'}}),
    env,new URL(body.url).pathname);
  assert.equal(invalid.status,416);
});
test('catalogue media URL validation rejects scripts and embedded credentials',()=>{
  assert.equal(safeMediaUrl('javascript:alert(1)'),null);
  assert.equal(safeMediaUrl('https://user:pass@host/file.mp4'),null);
  assert.equal(safeMediaUrl('https://cdn.example/file.mp4'),'https://cdn.example/file.mp4');
});
test('catalogue and room events expose sound and animation without altering coin settlement',()=>{
  const api=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const admin=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');
  const android=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  for(const key of ['g.animation_url,g.audio_url','animation_url:e.animation_url','audio_url:e.audio_url'])
    assert.ok(api.includes(key),key);
  for(const key of ['mediaStudio(\'gift-media\')','mediaStudio(\'cos-media\')',
    'x-sharika-media-size','gift-audio-url'])assert.ok(admin.includes(key),key);
  assert.match(android,/sh-gift-parade-video/);
  assert.match(android,/remote_animation_url/);
});
