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

test('uploaded Luxury MP4 presents sound-capable fullscreen media and a tap fallback',async()=>{
  const start=adapter.indexOf('  function giftPresentationCss(doc){');
  const end=adapter.indexOf('  function decorateRoomPeople(frame){',start);
  assert.ok(start>=0&&end>start);
  const callbacks=[],elements=[];
  let blockAutoplay=true;
  const element=tag=>{
    const node={tag,children:[],attrs:{},className:'',textContent:'',muted:false,
      classList:{add(value){node.className+=' '+value;}},
      setAttribute(key,value){node.attrs[key]=value;},
      append(...children){node.children.push(...children);},
      appendChild(child){node.children.push(child);},
      insertBefore(child,sibling){node.children.splice(node.children.indexOf(sibling),0,child);},
      querySelectorAll(selector){return selector==='video,audio'?
        node.children.filter(child=>child.tag==='video'||child.tag==='audio'):[];},
      remove(){node.removed=true;},pause(){node.paused=true;},
      play(){node.playCalls=(node.playCalls||0)+1;
        return blockAutoplay&&!node.muted?Promise.reject(new Error('gesture required')):
          Promise.resolve();}
    };
    elements.push(node);return node;
  };
  const doc={head:{appendChild(){}},body:{children:[],appendChild(node){this.children.push(node);}},
    createElement:element,getElementById(){return null;}};
  const frame={document:doc,setTimeout(fn,ms){callbacks.push({fn,ms});}};
  const ctx=createContext({
    verifiedMediaUrl:url=>url,isVideoMedia:url=>/\.mp4$/.test(url),
    formatCompactCoins:value=>String(value),paintVerifiedAvatar(){}
  });
  runInContext(adapter.slice(start,end),ctx);
  ctx.frame=frame;
  ctx.gift={id:25,tab:1,name:'Royal Wedding',emoji:'💍',quantity:1,
    sender_name:'Sender',recipient_name:'Receiver',price_coins:1000000,
    animation_url:'https://example.test/royal-wedding.mp4',audio_url:''};
  runInContext('queueGiftPresentation(frame,gift,true)',ctx);
  await new Promise(resolve=>setImmediate(resolve));
  const overlay=doc.body.children[0];
  assert.match(overlay.className,/sh-gift-parade-video/);
  assert.equal(overlay.attrs['aria-label'],'Large gift celebration');
  const video=elements.find(node=>node.tag==='video');
  assert.equal(video.src,ctx.gift.animation_url);
  assert.equal(video.playsInline,true);
  assert.equal(video.autoplay,true);
  assert.equal(video.muted,true,'blocked autoplay must restart muted for the receiver');
  assert.equal(video.playCalls,2);
  assert.ok(elements.some(node=>node.attrs['aria-label']==='Play gift sound'));
  assert.deepEqual(callbacks.map(x=>x.ms),[10000,10000]);
  blockAutoplay=false;
  const sound=elements.find(node=>node.attrs['aria-label']==='Play gift sound');
  sound.onclick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(video.muted,false);
  assert.equal(video.playCalls,3);
  assert.equal(sound.removed,true);
  callbacks[1].fn();
  assert.equal(overlay.removed,true);
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
  assert.match(adapter,/for\(const event of events\)presentVerifiedGift\(event\)/);
  assert.doesNotMatch(adapter,/for\(const event of events\.slice\(-20\)\)appendGiftChatReceipt\(event\)/);
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
