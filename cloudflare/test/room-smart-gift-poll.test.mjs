import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');

function sourceBetween(start,end) {
  const first=adapter.indexOf(start);
  const last=adapter.indexOf(end,first);
  assert.ok(first>=0&&last>first,'expected source boundary: '+start);
  return adapter.slice(first,last);
}

function deferred() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

test('one verified video gift renders one parade, not simultaneous small and fullscreen overlays',()=>{
  const overlays=[],receipts=[];
  const ctx=createContext({
    shownGiftEvents:new Set(),FEATURED_GIFT_TAB:1,frame:{},
    appendGiftChatReceipt:event=>receipts.push(event.id),
    verifiedMediaUrl:value=>value,
    isVideoMedia:value=>typeof value==='string'&&value.endsWith('.mp4'),
    queueGiftPresentation:(frame,event,featured)=>overlays.push([event.id,featured])
  });
  runInContext(sourceBetween('    function presentVerifiedGift(event){',
    '    let giftPollInFlight=null;'),ctx);

  ctx.presentVerifiedGift({id:11,tab:1,animation_url:'https://media.test/gift.mp4'});
  ctx.presentVerifiedGift({id:11,tab:1,animation_url:'https://media.test/gift.mp4'});
  ctx.presentVerifiedGift({id:12,tab:0,animation_url:'https://media.test/rose.mp4'});
  ctx.presentVerifiedGift({id:13,tab:0,animation_url:'https://media.test/rose.png'});
  assert.deepEqual(overlays,[[11,true],[12,true],[13,false]]);
  assert.deepEqual(receipts,[11,11,12,13],
    'repeated polling can still update chat receipts, but animations are deduplicated');
});

function feedHarness() {
  const requests=[],presented=[],walletReloads=[];
  const ctx=createContext({
    api(method,path){
      assert.equal(method,'GET');
      assert.equal(path,'/rooms/10000001/gifts');
      const request=deferred();
      requests.push(request);
      return request.promise;
    },
    lastGiftEventId:null,
    room:{id:'10000001',owner_id:'room-owner'},
    session:{user:{id:'a-guest'}},
    profile:{public_id:'10000003'},
    frame:{seats:[]},
    presentVerifiedGift(event){presented.push(event.id);},
    reloadWallet:async()=>walletReloads.push('refreshed')
  });
  runInContext(sourceBetween('    let giftPollInFlight=null;',
    '    async function setRoomAdmin(publicId,makeAdmin){'),ctx);
  return {ctx,requests,presented,walletReloads};
}

test('slow polling performs only one network fetch until the previous request settles',async()=>{
  const {ctx,requests,presented}=feedHarness();
  const one=ctx.pollGiftEvents();
  const two=ctx.pollGiftEvents();
  const three=ctx.pollGiftEvents();
  assert.equal(requests.length,1,'same room must not launch overlapping GET /gifts');
  assert.equal(one,two);
  assert.equal(two,three);
  requests[0].resolve({events:[{id:21,sender_id:'somebody',recipient_id:'someone-else'}]});
  await Promise.all([one,two,three]);
  assert.deepEqual(presented,[21]);

  const next=ctx.pollGiftEvents();
  assert.equal(requests.length,2);
  requests[1].resolve({events:[{id:21,sender_id:'somebody',recipient_id:'someone-else'}]});
  await next;
  assert.deepEqual(presented,[21],'old gift must not replay after the cursor advances');
});

test('newly sent gift queues one fresh receipt fetch behind an in-flight passive poll',async()=>{
  const {ctx,requests,presented}=feedHarness();
  const initial=ctx.pollGiftEvents();
  requests[0].resolve({events:[]});
  await initial;
  const pending=ctx.pollGiftEvents();
  const receipt=ctx.pollGiftEvents('transaction-42');
  assert.equal(requests.length,2);
  requests[1].resolve({events:[]});
  await pending;
  await Promise.resolve();
  assert.equal(requests.length,3,'confirmed gift must be checked after the passive response');
  requests[2].resolve({events:[{id:42,transaction_id:'transaction-42',
    sender_id:'10000003',recipient_id:'10000003'}]});
  await receipt;
  assert.deepEqual(presented,[42]);
});

test('failed gift poll releases its single-flight lock so later retries still work',async()=>{
  const {ctx,requests}=feedHarness();
  const first=ctx.pollGiftEvents();
  requests[0].reject(new Error('network unavailable'));
  await assert.rejects(first,/network unavailable/);
  const retry=ctx.pollGiftEvents();
  assert.equal(requests.length,2);
  requests[1].resolve({events:[]});
  await retry;
});

function roomsHarness() {
  const requests=[];
  const ctx=createContext({
    session:{user:{id:'alice'}},
    reloadRoomsOnce(){
      const request=deferred();
      requests.push(request);
      return request.promise;
    }
  });
  runInContext(sourceBetween('  let roomsRequestNo=0;',
    '  async function reloadRoomsOnce() {'),ctx);
  return {ctx,requests};
}

test('room-list heartbeat reuses a slow verified GET instead of restarting UI loading',async()=>{
  const {ctx,requests}=roomsHarness();
  const first=ctx.reloadRooms(true);
  const second=ctx.reloadRooms(true);
  assert.equal(requests.length,1);
  assert.equal(first,second);
  requests[0].resolve('room cards from server');
  await first;
  assert.equal(requests.length,1);
  const next=ctx.reloadRooms(true);
  assert.equal(requests.length,2);
  requests[1].resolve('new cards');
  assert.equal(await next,'new cards');
});

test('room setting edits get one fresh room list after an older background poll',async()=>{
  const {ctx,requests}=roomsHarness();
  const passive=ctx.reloadRooms(true);
  const edited=ctx.reloadRooms();
  const otherEdit=ctx.reloadRooms();
  assert.equal(requests.length,1);
  assert.equal(edited,otherEdit);
  requests[0].resolve('old rooms');
  await passive;
  await Promise.resolve();
  assert.equal(requests.length,2,'settings change must not reuse stale pre-edit snapshot');
  requests[1].resolve('new rooms');
  assert.equal(await edited,'new rooms');
});

test('switching accounts must not coalesce a new user room list with the previous identity',async()=>{
  const {ctx,requests}=roomsHarness();
  const oldUser=ctx.reloadRooms(true);
  ctx.session={user:{id:'bob'}};
  const newUser=ctx.reloadRooms(true);
  assert.equal(requests.length,2);
  requests[0].resolve('old');
  requests[1].resolve('bob rooms');
  assert.equal(await oldUser,'old');
  assert.equal(await newUser,'bob rooms');
  assert.match(adapter,/requestNo!==roomsRequestNo \|\| session\?\.user\?\.id!==userId/);
  assert.match(adapter,/document\.visibilityState==='visible'\)reloadRooms\(true\)/);
});
