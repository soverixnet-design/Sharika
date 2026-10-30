import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRoomModeration } from '../src/moderation.mjs';

function setup({role='owner',closeFails=false}={}) {
  const calls=[];
  const roomDO={
    async publishedFor(uid){calls.push({event:'publishedFor',uid});return [{sessionId:'session-one'}];},
    async withdrawUser(uid,all){calls.push({event:'withdraw',uid,all});return true;}
  };
  const db={
    prepare(sql){return {bind(...args){calls.push({event:'bind',sql,args});return this;},
      async first(){return {user_id:'guest-uid',seat_no:2,muted:0,public_no:10000002};}};},
    async batch(statements){calls.push({event:'batch',count:statements.length});return [];}
  };
  const env={DB:db,VOICE_ROOMS:{getByName(name){
    assert.equal(name,'sharika:10000001');return roomDO;
  }}};
  const closeAudio=async(_env,sid)=>{calls.push({event:'close',sid});
    if(closeFails)throw Error('SFU unavailable');};
  async function send(action,target='10000002'){
    const request=new Request('https://api.example/api/v1/rooms/10000001/moderate',{
      method:'POST',body:JSON.stringify({action,target_public_id:target})
    });
    const response=await handleRoomModeration({
      request,env,uid:role==='owner'?'owner-uid':'guest-uid',
      room:{owner_id:'owner-uid'},roomId:'10000001',cors:{},
      reply:(body,status)=>Response.json(body,{status}),
      fail:(error,status)=>Response.json({error},{status}),
      readBody:r=>r.json(),closeAudio
    });
    return {status:response.status,body:await response.json(),calls};
  }
  return {send,calls};
}

test('a guest cannot moderate other guests',async()=>{
  const {send,calls}=setup({role:'guest'});
  const r=await send('kick');
  assert.equal(r.status,403);
  assert.equal(r.body.error,'room_owner_only');
  assert.equal(calls.length,0);
});

test('owner mute force-closes publisher before updating D1 and audits the action',async()=>{
  const {send,calls}=setup();
  const r=await send('mute');
  assert.equal(r.status,200);
  assert.equal(r.body.action,'mute');
  assert.deepEqual(calls.filter(c=>['publishedFor','close','batch','withdraw'].includes(c.event))
    .map(c=>c.event),['publishedFor','close','batch','withdraw']);
  assert.equal(calls.find(c=>c.event==='batch').count,2);
  const update=calls.find(c=>c.sql?.includes('UPDATE sharika_room_members SET muted'));
  assert.deepEqual(update.args,[1,'10000001','guest-uid']);
});

test('owner kick creates a ten-minute server ban and removes member atomically',async()=>{
  const {send,calls}=setup();
  const r=await send('kick');
  assert.equal(r.status,200);
  assert.equal(r.body.banned_for_seconds,600);
  assert.equal(calls.find(c=>c.event==='batch').count,3);
  assert.equal(calls.find(c=>c.event==='withdraw').all,true);
  const ban=calls.find(c=>c.sql?.includes('INSERT INTO sharika_room_bans'));
  assert.ok(ban.args[2]>Date.now()+9*60_000);
});

test('if SFU cannot close a publication, moderation does not change D1',async()=>{
  const {send,calls}=setup({closeFails:true});
  const r=await send('mute');
  assert.equal(r.status,502);
  assert.equal(r.body.error,'voice_moderation_unavailable');
  assert.equal(calls.some(c=>c.event==='batch'),false);
  assert.equal(calls.some(c=>c.event==='withdraw'),false);
});

test('moderation rejects invalid target and action',async()=>{
  const {send,calls}=setup();
  assert.equal((await send('ban-forever')).status,400);
  assert.equal((await send('mute','not-an-id')).status,400);
  assert.equal(calls.length,0);
});

test('owner unmute updates D1 without interrupting active sessions',async()=>{
  const {send,calls}=setup();
  const r=await send('unmute');
  assert.equal(r.status,200);
  assert.equal(calls.some(c=>c.event==='close'),false);
  assert.equal(calls.find(c=>c.event==='batch').count,2);
});
