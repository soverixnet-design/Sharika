import test from 'node:test';
import assert from 'node:assert/strict';
import { handleVoiceOperation } from '../src/sfu.mjs';

const reply = (value,status=200) => Response.json(value,{status});
const fail = (error,status) => reply({error},status);
const readBody = request => request.json();
const owner = {owner_id:'u1'};
const member = {seat_no:null,muted:0};
const room = {
  async register() {return true;},
  async owns(uid,sid) {return sid==='session-one' ? {canPublish:true}:null;},
  async permittedPublications() {return [];},
  async publications() {return [];},
  async heartbeat() {return true;},
  async forget() {return true;}
};
const env = {
  REALTIME_SFU_APP_ID:'staging-app',
  REALTIME_SFU_APP_SECRET:'private-do-not-expose',
  VOICE_ROOMS:{getByName:()=>room}
};
const base = {env,room:owner,member,uid:'u1',roomId:'10000001',
  reply,fail,cors:{},readBody};
const req = (method,operation,data={}) => new Request(
  'https://sharika.example/api/v1/rooms/10000001/voice/'+operation,
  {method,...(method==='GET'?{}:{body:JSON.stringify(data)})}
);

test('cloudflare configuration never exposes the app secret',async()=>{
  const r=await handleVoiceOperation({...base,operation:'config',
    request:req('GET','config')});
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{provider:'cloudflare_sfu',publish:true});
  const absent=await handleVoiceOperation({...base,env:{},operation:'config',
    request:req('GET','config')});
  assert.equal(absent.status,503);
});
test('users without a mic seat cannot publish or mint a publisher session',async()=>{
  const r=await handleVoiceOperation({...base,uid:'u2',operation:'session',
    request:req('POST','session',{mode:'publish'})});
  assert.equal(r.status,403);
  assert.equal((await r.json()).error,'voice_publish_forbidden');
});
test('publish rejects invalid SDP and arbitrary track names without calling SFU',async()=>{
  const r=await handleVoiceOperation({...base,operation:'publish',
    request:req('POST','publish',{
      sessionId:'session-one',sessionDescription:{type:'offer',sdp:'bad'},
      mid:'0',trackName:'webcam'
    })});
  assert.equal(r.status,400);
});
test('subscriber cannot request a publication absent from the room',async()=>{
  const r=await handleVoiceOperation({...base,operation:'subscribe',
    request:req('POST','subscribe',{
      sessionId:'session-one',publications:[{sessionId:'foreign-one',trackName:'microphone'}]
    })});
  assert.equal(r.status,403);
  assert.equal((await r.json()).error,'voice_publication_forbidden');
});
test('new SFU session is owner-scoped and credentials remain server-side',async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.match(String(url),/\/v1\/apps\/staging-app\/sessions\/new$/);
    assert.equal(options.headers.Authorization,'Bearer private-do-not-expose');
    return Response.json({sessionId:'session-one'});
  };
  try {
    const r=await handleVoiceOperation({...base,operation:'session',
      request:req('POST','session',{mode:'publish'})});
    assert.equal(r.status,201);
    const result=await r.json();
    assert.equal(result.sessionId,'session-one');
    assert.equal(JSON.stringify(result).includes('private-do-not-expose'),false);
  }finally{globalThis.fetch=old;}
});
