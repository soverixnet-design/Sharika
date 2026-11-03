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

test('room gift receipts remain in the scrollable chat, with sender and recipient',()=>{
  const css=readFileSync(new URL('../../app/royal-room-ui.css',import.meta.url),'utf8');
  assert.match(css,/\.sh-royal-room \.stage \{\s*flex:0 1 auto/);
  assert.match(css,/\.sh-royal-room \.chatw \{[\s\S]*?flex:1 1 210px/);
  assert.match(css,/\.sh-royal-room \.chat \{[\s\S]*?overflow-y:auto/);
  assert.doesNotMatch(css,/height:clamp\(32px,7vh,64px\)/);
  assert.match(adapter,/for\(const event of events\.slice\(-20\)\)appendGiftChatReceipt\(event\)/);
  const start=adapter.indexOf('    function appendGiftChatReceipt(event){');
  const end=adapter.indexOf('    function presentVerifiedGift(event){',start);
  assert.ok(start>=0&&end>start);
  const calls=[],avatarCalls=[],added=[];
  const badge={textContent:''};
  const row={
    dataset:{},
    classList:{add(value){added.push(value);}},
    querySelector(selector){
      return selector==='.lv'?badge:selector==='.mav'?{type:'avatar'}:null;
    }
  };
  const chat={querySelector(selector){return selector==='.msg:last-child'?row:null;}};
  const frame={
    document:{},$:(id)=>id==='chat'?chat:null,
    msg:(...args)=>calls.push(args)
  };
  const ctx=createContext({
    frame,shownGiftChatIds:new Set(),
    giftEventValue:()=>1500,
    roomAvatarForPublicId:()=>null,
    paintVerifiedAvatar:(...args)=>avatarCalls.push(args)
  });
  runInContext(adapter.slice(start,end),ctx);
  const gift={id:41,sender_name:'Soverix Net',sender_id:'10000001',
    sender_pic:'https://example.test/avatar.jpg',recipient_name:'Shakil',
    recipient_id:'10000003',name:'Rose',emoji:'🌹',quantity:3,price_coins:500};
  ctx.gift=gift;
  runInContext('appendGiftChatReceipt(gift)',ctx);
  runInContext('appendGiftChatReceipt(gift)',ctx);
  assert.equal(calls.length,1,'re-polling a settled gift must not duplicate chat');
  assert.equal(calls[0][0],'Soverix Net');
  assert.match(calls[0][2],/Rose ×3 to Shakil \(ID 10000003\)/);
  assert.match(calls[0][2],/1,500/);
  assert.equal(calls[0][3].gf,true);
  assert.equal(badge.textContent,'GIFT');
  assert.equal(row.dataset.shGiftId,'41');
  assert.equal(row.dataset.shSenderId,'10000001');
  assert.ok(added.includes('sh-room-gift-receipt'));
  assert.equal(avatarCalls.length,1);
  assert.equal(avatarCalls[0][1],gift.sender_pic);
});
