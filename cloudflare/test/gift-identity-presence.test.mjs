import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const room=readFileSync(new URL('../src/voice-room.mjs',import.meta.url),'utf8');

test('room profile nameplate fits both ranked and room-opened ID cards',()=>{
  assert.match(adapter,/#pfo \.sh-royal-profile-effects img\{display:block/);
  assert.match(adapter,/max-width:100%;height:auto;max-height:64px;object-fit:contain/);
  assert.match(adapter,/img\[src\*="legend-tag"\]/);
  assert.match(adapter,/#pfo\{overflow-x:hidden!important/);
  assert.doesNotMatch(adapter,/textContent='🪙 Send seller coins to ID '/);
  assert.match(adapter,/button\.id='sharika-recharge-seller-wallet'/);
});

test('verified gift feed provides identities and the public receipt spells out both people',()=>{
  assert.match(worker,/su\.name AS sender_name,su\.pic AS sender_pic/);
  assert.match(worker,/ru\.name AS recipient_name,ru\.pic AS recipient_pic/);
  assert.match(worker,/transaction_id:e\.transaction_id/);
  const start=adapter.indexOf('  function giftEventValue(event){');
  const end=adapter.indexOf('  function queueGiftPresentation',start);
  assert.ok(start>=0&&end>start);
  const context=createContext({});
  runInContext(adapter.slice(start,end),context);
  const sentence=runInContext(`giftEventText({sender_id:'10000001',sender_name:'Soverix Net',
    recipient_id:'10000003',recipient_name:'MD shakil',name:'Royal Rose',
    emoji:'🌹',quantity:3,price_coins:500})`,context);
  assert.match(sentence,/Soverix Net \(ID 10000001\) sent 🌹 Royal Rose ×3 to MD shakil \(ID 10000003\)/);
  assert.match(sentence,/1,500/);
});

test('top gift parade lasts 10 seconds with avatars and lower receipts remain visible',()=>{
  assert.match(adapter,/FEATURED_GIFT_TAB=1/);
  assert.match(adapter,/Number\(event\.tab\)===FEATURED_GIFT_TAB/);
  assert.match(adapter,/animation:shGiftParade 10s linear forwards/);
  assert.match(adapter,/giftParticipant\(doc,item\.sender_name,item\.sender_id,item\.sender_pic\)/);
  assert.match(adapter,/giftParticipant\(doc,item\.recipient_name,item\.recipient_id,item\.recipient_pic\)/);
  assert.match(adapter,/frame\.setTimeout\(\(\)=>\{box\.remove\(\);next\(\);\},featured\?10000:4700\)/);
  assert.match(adapter,/presentVerifiedGift\(event\)/);
});

test('room roster uses expiring verified presence without deleting D1 members',()=>{
  assert.match(room,/async presenceRoomMembers\(roomId\)/);
  assert.match(room,/last_seen>=\? LIMIT 100/);
  const start=worker.indexOf("if (parts.length === 5 && action === 'members'");
  const end=worker.indexOf("if (parts.length === 5 && action === 'voice-token'",start);
  const section=worker.slice(start,end);
  assert.match(section,/new Set\(await presence\.presenceRoomMembers\(roomId\)\)/);
  assert.match(section,/visibleMembers=visibleMembers\.filter/);
  assert.match(section,/visibleMembers\.map\(x =>/);
  assert.doesNotMatch(section,/DELETE FROM sharika_room_members|UPDATE sharika_room_members/);
  assert.match(adapter,/\},8000\);/);
});
