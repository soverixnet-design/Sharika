import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleVoiceOperation} from '../src/sfu.mjs';

const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const coordinator=readFileSync(new URL('../src/voice-room.mjs',import.meta.url),'utf8');

async function voiceConfig({uid='owner',seat=null,throne=false,muted=0}={}) {
  const env={
    // The configured LiveKit fallback avoids network access in this test.
    LIVEKIT_API_KEY:'test',LIVEKIT_API_SECRET:'test',LIVEKIT_URL:'wss://voice.test',
    VOICE_ROOMS:{getByName:()=>({ownerThroneRead:async()=>throne})}
  };
  return handleVoiceOperation({
    request:{method:'GET'},env,room:{owner_id:'owner'},
    member:{seat_no:seat,muted},uid,roomId:'10000001',
    operation:'config',reply:data=>data,fail:error=>({error}),cors:{},
    readBody:async()=>({})
  });
}

test('no room microphone before taking a seat, including for owner',async()=>{
  assert.equal((await voiceConfig()).publish,false);
  assert.equal((await voiceConfig({uid:'guest'})).publish,false);
  assert.equal((await voiceConfig({uid:'owner',seat:2})).publish,true);
  assert.equal((await voiceConfig({uid:'owner',throne:true})).publish,true);
  assert.equal((await voiceConfig({uid:'owner',throne:true,muted:1})).publish,false);
  assert.equal((await voiceConfig({uid:'guest',throne:true})).publish,false);
});

test('owner throne is explicit, server-authorized and cleared on room exit',()=>{
  assert.match(coordinator,/CREATE TABLE IF NOT EXISTS room_owner_throne/);
  assert.match(coordinator,/async ownerThroneClear\(roomId,uid\)/);
  assert.match(coordinator,/owner\?\.owner_id!==uid\)return \{error:'room_owner_only'\}/);
  assert.match(coordinator,/bind\(seat===0\?null:seat,roomId,uid\)\.run\(\)/);
  assert.match(worker,/seat===0 \? room\.owner_id!==uid/);
  assert.match(worker,/owner_throne_seated:ownerThroneSeated/);
  assert.match(worker,/ownerThroneClear\?\.\(roomId,uid\)/);
  assert.match(adapter,/\['take','Sit on throne','take'\]/);
  assert.match(adapter,/action==='down' && seat>=0/);
  assert.match(adapter,/data\.owner_throne_seated===true/);
});

test('one purchase animates once for all gift recipients, with transparent background',()=>{
  assert.match(adapter,/const shownGiftCelebrations=new Set\(\)/);
  assert.match(adapter,/const celebrationKey=String\(event\.transaction_id/);
  assert.match(adapter,/if\(!shownGiftCelebrations\.has\(celebrationKey\)\)/);
  assert.match(adapter,/appendGiftChatReceipt\(event\);/);
  assert.match(adapter,/background:transparent;display:block;overflow:hidden/);
  assert.match(adapter,/mix-blend-mode:screen;visibility:hidden/);
  assert.match(adapter,/object-fit:contain;object-position:center center/);
  assert.match(adapter,/video\.setAttribute\('playsinline',''\)/);
  assert.match(adapter,/video\.controls=false/);
});
