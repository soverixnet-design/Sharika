import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');

function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

function roomSyncHarness(){
  const start=ui.indexOf('  function syncFrame(room,frame,passive=false) {');
  const end=ui.indexOf('  async function syncFrameOnce(room,frame) {',start);
  assert.ok(start>=0&&end>start,'single-flight adapter must exist');
  const requests=[];
  const context=createContext({
    window:{cur:{id:'10000001'}},
    syncFrameOnce(){
      const request=deferred();
      requests.push(request);
      return request.promise;
    }
  });
  runInContext(ui.slice(start,end),context);
  return {sync:context.syncFrame,requests,room:{id:'10000001'},frame:{seats:[{i:0}]}};
}

test('slow periodic seat polls reuse one in-flight request instead of invalidating the initial room snapshot',async()=>{
  const {sync,requests,room,frame}=roomSyncHarness();
  const first=sync(room,frame);
  const passive1=sync(room,frame,true);
  const passive2=sync(room,frame,true);
  assert.equal(requests.length,1,'only one native/network request during long loading');
  assert.equal(passive1,first);
  assert.equal(passive2,first);
  requests[0].resolve('verified seats');
  assert.equal(await first,'verified seats');
  assert.equal(frame.__sharikaSeatSyncInFlight,null);
  assert.equal(requests.length,1);
});

test('seat or moderator changes request one fresh sync after a slow poll',async()=>{
  const {sync,requests,room,frame}=roomSyncHarness();
  const first=sync(room,frame,true);
  const updated1=sync(room,frame);
  const updated2=sync(room,frame);
  assert.equal(requests.length,1);
  assert.equal(updated1,updated2,'simultaneous explicit changes share one refresh');
  requests[0].resolve('old seats');
  await first;
  // Resolving the active request starts one new authenticated fetch.
  await Promise.resolve();
  assert.equal(requests.length,2);
  requests[1].resolve('new seats');
  assert.equal(await updated1,'new seats');
  assert.equal(frame.__sharikaSeatSyncInFlight,null);
});

test('a delayed join cannot hold the room layout or survive Back and reentry',async()=>{
  const start=ui.indexOf('  let roomMembership=Promise.resolve();');
  const end=ui.indexOf('  // Preserve original recharge/exchange artwork',start);
  assert.ok(start>=0&&end>start);
  const events=[],firstJoin=deferred(),cleanup=deferred(),secondJoin=deferred();
  const iframe={contentDocument:null};
  const window={
    cur:null,
    openRoom(room,preview){
      assert.equal(preview,true);
      window.cur=room;
      events.push('paint');
    },
    leaveRoom(){window.cur=null;events.push('back');}
  };
  let joins=0;
  const context=createContext({
    window,document:{getElementById:id=>id==='rf'?iframe:null},
    session:{user:{id:'guest'}},joinedRoom:null,roomFrameDocument:null,
    joinRoomWithPassword(){
      events.push('join');
      return joins++===0?firstJoin.promise:secondJoin.promise;
    },
    api(method,path){
      assert.equal(method,'POST');
      assert.equal(path,'/rooms/10000001/leave');
      events.push('leave');
      return cleanup.promise;
    },
    setRoomScreenAwake(){},resumeRoomAudio(){},resetRoomMusic(){},
    releaseVoice:async()=>{},clearInterval(){},
    framePoll:null,giftPoll:null,chatPoll:null,entryPoll:null,reactionPoll:null,invitePoll:null,
    heartbeatPresence:()=>events.push('presence'),
    ensureVoiceConnected:async()=>events.push('voice'),
    console:{warn(){}},toast:message=>assert.fail(message)
  });
  runInContext(ui.slice(start,end),context);

  const room={id:'10000001'};
  const first=window.openRoom(room);
  assert.deepEqual(events,['paint']);
  await Promise.resolve();
  assert.deepEqual(events,['paint','join']);
  await window.openRoom(room);
  assert.equal(joins,1);
  window.leaveRoom();
  const second=window.openRoom(room);
  firstJoin.resolve(true);
  await new Promise(setImmediate);
  assert.deepEqual(events,['paint','join','back','paint','leave']);
  cleanup.resolve();
  await first;
  await new Promise(setImmediate);
  assert.equal(joins,2);
  secondJoin.resolve(true);
  await second;
  assert.deepEqual(events,['paint','join','back','paint','leave','join','presence','voice']);
});

test('room cosmetics never block the first verified member render',()=>{
  const start=ui.indexOf('  function attachFrame(room) {');
  const end=ui.indexOf('  // Block simulated gift/chat bots',start);
  assert.ok(start>=0&&end>start);
  const attach=ui.slice(start,end);
  assert.match(attach,/loadVerifiedCosmetics\(\)\.then\(\(\)=>\{/);
  assert.doesNotMatch(attach,/await loadVerifiedCosmetics\(\)\.catch\(error=>console\.warn\('Cosmetic art:'/);
  assert.match(attach,/syncFrame\(room,frame,true\)\.catch\(error=>\{/);
});

test('voice publishing prefers low-bandwidth audio without making unsupported WebViews fail',()=>{
  const start=ui.indexOf('  async function startSfuPublishing(state) {');
  const end=ui.indexOf('  async function connectSfu(',start);
  assert.ok(start>=0&&end>start);
  const publish=ui.slice(start,end);
  assert.match(publish,/parameters\.encodings\[0\]\.maxBitrate=32000/);
  assert.match(publish,/await sender\.setParameters\(parameters\)/);
  assert.match(publish,/catch\(error\)\{\s*console\.warn\('Voice bandwidth preference unavailable:'/);
  assert.ok(publish.indexOf('await sender.setParameters(parameters)')<
    publish.indexOf('state.publishPC.createOffer()'));
});

test('Android Back leaves the active room after dismissing any room overlay',()=>{
  const script=readFileSync(new URL('../../android-staging/back-navigation.js',import.meta.url),'utf8');
  const events=[];
  let trayOpen=true;
  const on={contains:value=>value==='on'};
  const tray={classList:{contains:()=>trayOpen,remove(){trayOpen=false;events.push('close tray');}}};
  const roomDocument={getElementById:id=>({
    tray,min:{disabled:false,click(){events.push('minimize');}}
  })[id]};
  const window={leaveRoom(){events.push('leave');}};
  const document={
    getElementById:id=>({rw:{classList:on},rf:{contentDocument:roomDocument}})[id],
    querySelector:()=>null
  };
  runInContext(script,createContext({window,document}));
  assert.equal(window.sharikaHandleAndroidBack(),'handled');
  assert.deepEqual(events,['close tray']);
  assert.equal(window.sharikaHandleAndroidBack(),'handled');
  assert.deepEqual(events,['close tray','leave']);
});

test('a delayed voice config cannot reconnect an earlier visit to the same room',async()=>{
  const start=ui.indexOf('  let voiceOperation=Promise.resolve()');
  const end=ui.indexOf("  window.addEventListener('online'",start);
  const roomId='10000001';
  const firstConfig=deferred(),secondConfig=deferred();
  const configs=[firstConfig,secondConfig];
  const connected=[];
  const context=createContext({
    joinedRoom:{id:roomId},sfuState:null,voiceRoomId:null,
    voiceRetryTimer:null,voiceRecoveryAttempts:0,voiceRecoveryRoom:null,
    voiceRelayWarningRoom:null,voiceRetryNoticeAt:0,
    clearVoiceSpeakers(){},async disconnectVoice(){},
    api(){return configs.shift().promise;},
    verifiedIceConfig(){return {iceServers:[]};},
    connectSfu(id,publishing){connected.push([id,publishing]);return {publishing};},
    markLocalMicrophone(){},
    scheduleVoiceRetry(){assert.fail('stale visit should not retry');}
  });
  runInContext(ui.slice(start,end),context);
  const first=context.connectVoice(roomId);
  await new Promise(setImmediate);
  assert.equal(configs.length,1);
  context.joinedRoom=null;
  const cleanup=context.releaseVoice();
  context.joinedRoom={id:roomId};
  const second=context.connectVoice(roomId);
  firstConfig.resolve({provider:'cloudflare_sfu',publish:true,relayAvailable:true});
  assert.equal((await first).stale,true);
  await cleanup;
  await new Promise(setImmediate);
  assert.equal(configs.length,0);
  secondConfig.resolve({provider:'cloudflare_sfu',publish:false,relayAvailable:true});
  assert.equal((await second).publishing,false);
  assert.deepEqual(connected,[[roomId,false]]);
});
