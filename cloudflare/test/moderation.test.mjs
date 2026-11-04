import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRoomModeration,handleRoomBanList } from '../src/moderation.mjs';

function setup({role='owner',closeFails=false,targetIsAdmin=false,targetIsOwner=false}={}) {
  const calls=[];
  const roomDO={
    async publishedFor(uid){calls.push({event:'publishedFor',uid});return [{sessionId:'session-one'}];},
    async withdrawUser(uid,all){calls.push({event:'withdraw',uid,all});return true;}
  };
  const db={
    prepare(sql){return {bind(...args){calls.push({event:'bind',sql,args});this.bound=args;return this;},
      async first(){
        if(sql.includes('FROM sharika_room_admins'))
          return this.bound[1]==='admin-uid'||
            (targetIsAdmin&&this.bound[1]==='guest-uid')?{active:1}:null;
        return {user_id:targetIsOwner?'owner-uid':'guest-uid',
          seat_no:2,muted:0,public_no:10000002};
      }};},
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
      request,env,uid:role==='owner'?'owner-uid':
        role==='admin'?'admin-uid':'guest-uid',
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
  assert.equal(calls.some(x=>x.event==='batch'),false);
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
  assert.equal(calls.find(c=>c.event==='batch').count,4);
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

test('a room admin can mute and kick a regular guest, without appointing other admins',async()=>{
  const {send}=setup({role:'admin'});
  const muted=await send('mute');
  assert.equal(muted.status,200);
  const kicked=await send('kick');
  assert.equal(kicked.status,200);
});

test('a room admin cannot kick, block, mute, unmute or remove another admin',async()=>{
  for(const action of ['kick','block','mute','unmute','remove_seat']){
    const otherAdmin=setup({role:'admin',targetIsAdmin:true});
    const denied=await otherAdmin.send(action);
    assert.equal(denied.status,403,action);
    assert.equal(denied.body.error,'cannot_moderate_room_admin',action);
    assert.equal(otherAdmin.calls.some(c=>['batch','close','withdraw'].includes(c.event)),
      false,action+' must not change the target, voice or room membership');
  }
  const ownerTarget=setup({role:'admin',targetIsOwner:true});
  const owner=await ownerTarget.send('mute');
  assert.equal(owner.status,403);
  assert.equal(owner.body.error,'cannot_moderate_room_owner');
});

test('Room Admin can block a regular guest until unblocked; owner/admin wallet is unchanged',async()=>{
  const {send,calls}=setup({role:'admin'});
  const r=await send('block');
  assert.equal(r.status,200);
  assert.equal(r.body.blocked_until_unblocked,true);
  assert.equal(r.body.banned_for_seconds,null);
  const ban=calls.find(x=>x.sql?.includes('INSERT INTO sharika_room_bans'));
  assert.ok(ban.args[2]>Date.now()+1000*60*60*24*365);
  assert.ok(calls.some(x=>x.sql?.includes('sharika_room_block_audit')));
  assert.equal(calls.find(x=>x.event==='withdraw').all,true);
  assert.equal(calls.some(x=>x.sql?.includes('sharika_users SET coins')),false);
});

test('Unblock clears room-scoped ban without altering user account or voice',async()=>{
  const {send,calls}=setup({role:'owner'});
  const r=await send('unblock');
  assert.equal(r.status,200);
  assert.equal(r.body.action,'unblock');
  assert.ok(calls.some(x=>x.sql?.includes('DELETE FROM sharika_room_bans')));
  assert.ok(calls.some(x=>x.sql?.includes('sharika_room_block_audit')));
  assert.equal(calls.some(x=>x.event==='publishedFor'),false);
  assert.equal(calls.find(x=>x.event==='batch').count,2);
});

test('Room Ban list is private to owner or assigned Room Admin',async()=>{
  const actions=[];
  const env={DB:{
    prepare(sql){actions.push(sql);return {bind(...args){this.args=args;return this;},
      async first(){return this.args?.[1]==='admin'?{active:1}:null;},
      async all(){return {results:[{public_no:10000002,name:'Guest',
        banned_until_ms:Date.UTC(3000,0,1)}]};}
    };}
  }};
  const call=async uid=>{
    const res=await handleRoomBanList({
      request:new Request('https://api.example/api/v1/rooms/10000001/bans'),
      env,uid,room:{owner_id:'owner'},roomId:'10000001',
      reply:(data,status)=>Response.json(data,{status}),
      fail:(error,status)=>Response.json({error},{status}),cors:{}
    });
    return {status:res.status,body:await res.json()};
  };
  const owner=await call('owner');
  assert.equal(owner.status,200);
  assert.deepEqual(owner.body.bans.map(x=>x.public_id),['10000002']);
  assert.equal(owner.body.bans[0].blocked_until_unblocked,true);
  assert.equal((await call('admin')).status,200);
  assert.equal((await call('member')).status,403);
  assert.ok(actions.some(sql=>sql.includes('b.banned_until_ms>?')));
});
