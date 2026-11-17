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
