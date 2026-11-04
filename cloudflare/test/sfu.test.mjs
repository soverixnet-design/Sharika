import test from 'node:test';
import assert from 'node:assert/strict';
import { handleVoiceOperation,forceCloseMicrophone } from '../src/sfu.mjs';

const reply = (value,status=200) => Response.json(value,{status});
const fail = (error,status) => reply({error},status);
const readBody = request => request.json();
const owner = {owner_id:'u1'};
const member = {seat_no:null,muted:0};
const room = {
  async roomPolicyRead(){return {super_mic:true};},
  async register() {return true;},
  async owns(uid,sid) {return sid==='session-one' ? {canPublish:true,requiresReady:true}:null;},
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
  assert.deepEqual(await r.json(),{provider:'cloudflare_sfu',publish:true,
    iceServers:[{urls:['stun:stun.cloudflare.com:3478']}],relayAvailable:false});
  const absent=await handleVoiceOperation({...base,env:{},operation:'config',
    request:req('GET','config')});
  assert.equal(absent.status,503);
});
test('Cloudflare TURN credentials reach verified phones with an explicit relay status',async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.match(String(url),/\/credentials\/generate-ice-servers$/);
    assert.equal(options.headers.authorization,'Bearer turn-private-token');
    assert.equal(JSON.parse(options.body).ttl,86400);
    return Response.json({iceServers:[
      {urls:['stun:stun.cloudflare.com:3478']},
      {urls:['turn:turn.cloudflare.com:3478?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp'],
        username:'temporary-username',credential:'temporary-password'}
    ]},{status:201});
  };
  try{
    const r=await handleVoiceOperation({...base,
      env:{...env,REALTIME_TURN_KEY_ID:'turn-key',REALTIME_TURN_API_TOKEN:'turn-private-token'},
      operation:'config',request:req('GET','config')});
    assert.equal(r.status,200);
    const config=await r.json();
    assert.equal(config.relayAvailable,true);
    assert.equal(config.iceServers.length,2);
    assert.equal(config.iceServers[1].username,'temporary-username');
    assert.equal(JSON.stringify(config).includes('turn-private-token'),false);
  }finally{globalThis.fetch=old;}
});
test('users without a mic seat cannot publish or mint a publisher session',async()=>{
  const r=await handleVoiceOperation({...base,uid:'u2',operation:'session',
    request:req('POST','session',{mode:'publish'})});
  assert.equal(r.status,403);
  assert.equal((await r.json()).error,'voice_publish_forbidden');
});
test('unmuted guest on an open mic seat can publish without any invitation',async()=>{
  const r=await handleVoiceOperation({...base,uid:'u2',member:{seat_no:3,muted:0},
    operation:'config',request:req('GET','config')});
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{provider:'cloudflare_sfu',publish:true,
    iceServers:[{urls:['stun:stun.cloudflare.com:3478']}],relayAvailable:false});
});
test('listener and muted seated guest cannot publish microphone audio',async()=>{
  for(const guest of [{seat_no:null,muted:0},{seat_no:3,muted:1}]){
    const r=await handleVoiceOperation({...base,uid:'u2',member:guest,
      operation:'session',request:req('POST','session',{mode:'publish'})});
    assert.equal(r.status,403);
    assert.equal((await r.json()).error,'voice_publish_forbidden');
  }
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
  const readiness=[];
  const registerRoom={...room,async register(uid,sid,canPublish,requiresReady){
    readiness.push(requiresReady);return true;
  }};
  globalThis.fetch=async(url,options)=>{
    assert.match(String(url),/\/v1\/apps\/staging-app\/sessions\/new$/);
    assert.equal(options.headers.Authorization,'Bearer private-do-not-expose');
    return Response.json({sessionId:'session-one'});
  };
  try {
    const r=await handleVoiceOperation({...base,
      env:{...env,VOICE_ROOMS:{getByName:()=>registerRoom}},operation:'session',
      request:req('POST','session',{mode:'publish'})});
    assert.equal(r.status,201);
    const result=await r.json();
    assert.equal(result.sessionId,'session-one');
    assert.equal(JSON.stringify(result).includes('private-do-not-expose'),false);
    const modern=await handleVoiceOperation({...base,
      env:{...env,VOICE_ROOMS:{getByName:()=>registerRoom}},operation:'session',
      request:req('POST','session',{mode:'publish',readiness:'connected-v1'})});
    assert.equal(modern.status,201);
    assert.deepEqual(readiness,[false,true]);
  }finally{globalThis.fetch=old;}
});

test('publisher is discovered only after ICE-connected ready signal',async()=>{
  const old=globalThis.fetch;
  let readyCalls=0;
  const roomWithReady={...room,
    async markPublished(uid,sessionId,trackName){
      assert.equal(uid,'u1');assert.equal(sessionId,'session-one');
      assert.equal(trackName,'microphone');readyCalls++;return true;
    }};
  globalThis.fetch=async()=>Response.json({
    sessionDescription:{type:'answer',sdp:'v=0\r\n'+'a'.repeat(70)},
    tracks:[{mid:'0'}]
  });
  try{
    const publish=await handleVoiceOperation({...base,
      env:{...env,VOICE_ROOMS:{getByName:()=>roomWithReady}},
      operation:'publish',request:req('POST','publish',{
        sessionId:'session-one',
        sessionDescription:{type:'offer',sdp:'v=0\r\n'+'a'.repeat(70)},
        mid:'0',trackName:'microphone'
      })});
    assert.equal(publish.status,200);
    assert.equal(readyCalls,0,'an SDP answer is not an active microphone');
    const ready=await handleVoiceOperation({...base,
      env:{...env,VOICE_ROOMS:{getByName:()=>roomWithReady}},
      operation:'ready',request:req('POST','ready',{sessionId:'session-one'})});
    assert.equal(ready.status,200);
    assert.equal(readyCalls,1);
  }finally{globalThis.fetch=old;}
});

test('legacy APKs without /voice/ready remain audible while new clients use ready gating',async()=>{
  const old=globalThis.fetch;
  let readyCalls=0;
  const legacyRoom={...room,
    async owns(){return {canPublish:true,requiresReady:false};},
    async markPublished(uid,sid,track){
      assert.equal(track,'microphone');readyCalls++;return true;
    }};
  globalThis.fetch=async()=>Response.json({
    sessionDescription:{type:'answer',sdp:'v=0\r\n'+'a'.repeat(70)},
    tracks:[{mid:'0'}]
  });
  try{
    const result=await handleVoiceOperation({...base,
      env:{...env,VOICE_ROOMS:{getByName:()=>legacyRoom}},
      operation:'publish',request:req('POST','publish',{
        sessionId:'session-one',
        sessionDescription:{type:'offer',sdp:'v=0\r\n'+'a'.repeat(70)},
        mid:'0',trackName:'microphone'
      })});
    assert.equal(result.status,200);
    assert.equal(readyCalls,1);
  }finally{globalThis.fetch=old;}
});

test('unseated guest cannot activate somebody else\'s microphone',async()=>{
  const r=await handleVoiceOperation({...base,uid:'u2',
    operation:'ready',request:req('POST','ready',{sessionId:'session-one'})});
  assert.equal(r.status,403);
  assert.equal((await r.json()).error,'voice_publish_forbidden');
});

test('owner moderation force-closes verified local microphone MIDs, not remote tracks',async()=>{
  const old=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),method:options.method||'GET'});
    assert.equal(options.headers.Authorization,'Bearer private-do-not-expose');
    if(!options.method)return Response.json({tracks:[
      {location:'local',trackName:'microphone',status:'active',mid:'0'},
      {location:'remote',trackName:'microphone',status:'active',mid:'1'},
      {location:'local',trackName:'camera',status:'active',mid:'2'}
    ]});
    assert.equal(options.method,'PUT');
    assert.equal(String(url).endsWith('/sessions/session-one/tracks/close'),true);
    assert.deepEqual(JSON.parse(options.body),{tracks:[{mid:'0'}],force:true});
    return Response.json({tracks:[{mid:'0'}]});
  };
  try{
    const r=await forceCloseMicrophone(env,'session-one');
    assert.equal(r.closed,1);
    assert.equal(calls.length,2);
  }finally{globalThis.fetch=old;}
});
