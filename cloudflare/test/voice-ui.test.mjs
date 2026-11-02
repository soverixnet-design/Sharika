import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext,runInContext} from 'node:vm';
import {readFileSync} from 'node:fs';

// Browser-only adapter is syntax-checked in npm check. These assertions
// protect the user-facing seat and microphone recovery wiring from regression.
const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');

test('guest can tap an open seat without an invitation dialog',()=>{
  assert.match(ui,/\.seat\.empty\[data-i\]/);
  assert.match(ui,/room\.owner_id===session\?\.user\?\.id\)return/);
  assert.match(ui,/api\('PUT','\/rooms\/'\+room\.id\+'\/seat',\{seat_no:seat\}\)/);
});
test('both SFU peer connections have Cloudflare STUN discovery',()=>{
  assert.match(ui,/stun:stun\.cloudflare\.com:3478/);
  assert.equal((ui.match(/new RTCPeerConnection\(SHARIKA_ICE_CONFIG\)/g)||[]).length,2);
});
test('mic button retries a failed capture or an interrupted uplink',()=>{
  assert.match(ui,/async function restartMicrophone\(roomId\)/);
  assert.match(ui,/if\(failed\|\|!track\|\|track\.readyState!=='live'\)/);
  assert.match(ui,/return restartMicrophone\(window\.cur\?\.id\|\|wantedVoiceRoom\)/);
});

test('room palette and gallery photo are authoritative for every joined phone',()=>{
  assert.match(ui,/api\('GET','\/rooms\/'\+room\.id\+'\/members'\)/);
  assert.match(ui,/data\.theme_background_url/);
  assert.match(ui,/frame\.S\.bg=sharedImage/);
  assert.match(ui,/frame\.S\.theme=palette/);
  assert.match(ui,/pickRoomCover\(room,frame,true\)/);
  assert.match(ui,/api\('PATCH','\/rooms\/'\+room\.id,\{theme:nextTheme\}\)/);
  assert.match(ui,/api\('PATCH','\/rooms\/'\+room\.id,\{theme:'photo'\}\)/);
  assert.match(ui,/\.app\.hasbg\{background-position:center center!important;background-size:cover!important/);
});

test('seat emojis follow the authenticated speaker and remote events match the same public ID',()=>{
  assert.match(ui,/frame\.seatEmoji=function\(_ignoredIndex,emoji\)/);
  assert.match(ui,/frame\.seats\?\.find\(slot=>slot\?\.user_id===session\?\.user\?\.id\)/);
  assert.match(ui,/originalSeatEmoji\(mine\.i,emoji\)/);
  assert.match(ui,/frame\.seats\?\.find\(slot=>slot\?\.public_id===event\.public_id\)/);
  assert.match(ui,/originalSeatEmoji\(target\.i,emoji\)/);
  assert.match(ui,/Take an unlocked mic seat to show a seat emoji/);
});

test('a temporary room reaction network failure retries instead of disabling emojis forever',()=>{
  assert.match(ui,/reactionFailureCount=0;reactionRetryAfterMs=0/);
  assert.match(ui,/Date\.now\(\)<reactionRetryAfterMs/);
  assert.match(ui,/reactionRetryAfterMs=Date\.now\(\)\+Math\.min\(30000,1000\*2\*\*reactionFailureCount\)/);
  assert.match(ui,/if\(\/staging_route_not_available\|reaction_route_not_found\|migration_pending\/i\.test\(reason\)\)/);
});

test('room chat keeps an idempotency key across timed-out retries of the same text',()=>{
  assert.match(ui,/let pendingChatMessage=null/);
  assert.match(ui,/if\(!pendingChatMessage\|\|pendingChatMessage\.body!==body\)/);
  assert.match(ui,/request_id:pendingChatMessage\.requestId/);
  assert.match(ui,/await api\('POST','\/rooms\/'.*\+room\.id\+'\/chat'/s);
  assert.match(ui,/pendingChatMessage=null;\s*if\(messageInput/);
});

test('clicked seat profile resolves server ID, not the old seat-zero self shortcut',()=>{
  assert.match(ui,/event\.source!==frame\|\|event\.data\?\.t!=='profile'/);
  assert.match(ui,/event\.stopImmediatePropagation\(\)/);
  assert.match(ui,/api\('GET','\/users\/'\+publicId\)/);
  assert.match(ui,/Seat occupant has changed/);
  assert.match(ui,/detail\.textContent='ID '\+id/);
  assert.match(ui,/frame\.act\(action,index\)/);
  assert.match(ui,/fakeStats\.style\.display='none'/);
  assert.match(ui,/paintVerifiedAvatar\(root\.querySelector\('\.pfh \.pav3'\),member\.pic,document\)/);
  assert.match(ui,/api\(following\?'DELETE':'PUT','\/users\/'\+publicId\+'\/follow'\)/);
});

test('room gestures retry blocked incoming audio in both the app and room iframe',()=>{
  assert.match(ui,/function resumeRoomAudio\(\)/);
  assert.match(ui,/audio\.isConnected && audio\.srcObject && audio\.paused/);
  assert.match(ui,/doc\.addEventListener\('pointerdown',resumeRoomAudio/);
  assert.match(ui,/roomAudioFrame\.addEventListener\('load'/);
  assert.match(ui,/bindRoomAudioGesture\(roomAudioFrame\.contentDocument\)/);
  assert.match(ui,/audio\.play\(\)\.catch\(error=>/);
  assert.match(ui,/voiceRoom\.startAudio\(\)\.catch/);
});

test('blocked SFU audio actually resumes on a room tap, without restarting connected audio',async()=>{
  // Run the actual bridge functions in a minimal DOM/WebView-like VM. This is
  // behavioral coverage for autoplay policy, not a substitute for real phones.
  const start=ui.indexOf('  let sfuState = null;');
  const end=ui.indexOf('  let voiceRecoveryRoom=',start);
  const trackStart=ui.indexOf('  function addAudioTrack(state,event) {',end);
  const trackEnd=ui.indexOf('  async function subscribeSfu(state) {',trackStart);
  assert.ok(start>=0 && end>start && trackStart>end && trackEnd>trackStart);
  const listeners=()=>({
    handlers:new Map(),
    addEventListener(type,handler){this.handlers.set(type,handler);}
  });
  const innerDoc=listeners();
  const outerDoc=listeners();
  const frame=listeners();
  frame.contentDocument=innerDoc;
  let toastCount=0;
  frame.contentWindow={toast(){toastCount++;}};
  let playCount=0;
  const remoteAudio={
    paused:true,isConnected:false,srcObject:null,dataset:{},
    play(){
      playCount++;
      if(playCount===1)return Promise.reject({name:'NotAllowedError'});
      this.paused=false;
      return Promise.resolve();
    },
    pause(){this.paused=true;},
    remove(){this.isConnected=false;}
  };
  outerDoc.getElementById=id=>id==='rf'?frame:null;
  outerDoc.createElement=tag=>{
    assert.equal(tag,'audio');
    return remoteAudio;
  };
  outerDoc.body={appendChild(element){element.isConnected=true;}};
  const context=createContext({
    document:outerDoc,voiceRoom:null,voiceRoomId:null,
    MediaStream:class{constructor(tracks){this.tracks=tracks;}}
  });
  runInContext(ui.slice(start,end)+ui.slice(trackStart,trackEnd),context);
  const state={closed:false,audioElements:new Set()};
  context.remoteState=state;
  context.remoteTrack={addEventListener(){}};
  runInContext('sfuState=remoteState; addAudioTrack(remoteState,{track:remoteTrack});',context);
  await Promise.resolve(); // Allow the blocked autoplay rejection handler to run.
  assert.equal(playCount,1);
  assert.equal(toastCount,1);
  assert.ok(state.audioElements.has(remoteAudio));
  assert.ok(innerDoc.handlers.has('pointerdown'));
  assert.ok(outerDoc.handlers.has('pointerdown'));

  innerDoc.handlers.get('pointerdown')();
  assert.equal(playCount,2);
  assert.equal(remoteAudio.paused,false);
  innerDoc.handlers.get('pointerdown')();
  assert.equal(playCount,2,'a playing remote track should not be restarted');

  // A room iframe navigation must rebind gestures to its new document.
  const newRoomDoc=listeners();
  frame.contentDocument=newRoomDoc;
  frame.handlers.get('load')();
  assert.ok(newRoomDoc.handlers.has('pointerdown'));
  remoteAudio.paused=true;
  newRoomDoc.handlers.get('pointerdown')();
  assert.equal(playCount,3);

  // The LiveKit fallback gets its own audio-unlock retry on the same gesture.
  let startAudioCalls=0;
  context.voiceRoom={startAudio(){startAudioCalls++;return Promise.resolve();}};
  context.voiceRoomId='test-room';
  outerDoc.handlers.get('pointerdown')();
  assert.equal(startAudioCalls,1);

  // Departed rooms must not resume their stale SFU tracks.
  state.closed=true;
  context.voiceRoom=null;
  remoteAudio.paused=true;
  outerDoc.handlers.get('pointerdown')();
  assert.equal(playCount,3);
});

test('two-way audio recovers an ended microphone and a failed remote receiver',()=>{
  const begin=ui.indexOf('  let voiceRecoveryRoom=null,voiceRecoveryAttempts=0;');
  const end=ui.indexOf('  async function waitIce(peer)',begin);
  assert.ok(begin>=0 && end>begin);
  const timers=[],reconnects=[];
  const context=createContext({
    document:{getElementById:()=>null},
    console:{warn(){}},
    setTimeout(fn,delay){timers.push({fn,delay});return timers.length;},
    connectVoice(id){reconnects.push(id);return Promise.resolve({publishing:true});},
    errText(error){return String(error);}
  });
  runInContext("let sfuState=null,wantedVoiceRoom='roomA';"+ui.slice(begin,end),context);
  const ended={
    roomId:'roomA',closed:false,recoveryTimer:null,recoveryExhausted:false,
    canPublish:true,subscribed:new Set(),receivePC:null,
    publishPC:{connectionState:'connected'},
    media:{getAudioTracks:()=>[{readyState:'ended'}]}
  };
  context.testState=ended;
  runInContext("sfuState=testState;recoverSfuPublication(testState,'track ended')",context);
  const first=timers.shift();
  assert.equal(first.delay,1200);
  first.fn();
  assert.deepEqual(reconnects,['roomA']);
  const receiver={
    ...ended,recoveryTimer:null,
    media:{getAudioTracks:()=>[{readyState:'live'}]},
    subscribed:new Set(['other:microphone']),receivePC:{connectionState:'failed'}
  };
  context.testState=receiver;
  runInContext("sfuState=testState;recoverSfuPublication(testState,'remote failed')",context);
  const second=timers.shift();
  assert.equal(second.delay,3000);
  second.fn();
  assert.deepEqual(reconnects,['roomA','roomA']);
  assert.equal(runInContext(
    "micPreferenceRoom='roomA';micPreferenceEnabled=false;microphoneWanted('roomA')",
    context),false,'manual mute is preserved through reconnect');
  assert.equal(runInContext("microphoneWanted('roomB')",context),true,
    'a new room starts with the microphone enabled');
});

test('incoming voice and server permission changes are checked independently',()=>{
  assert.match(ui,/incoming audio path unavailable/);
  assert.match(ui,/state\.subscriptionFailures>=2/);
  assert.match(ui,/voice session heartbeat lost/);
  assert.match(ui,/sfuState\.canPublish!==!!eligible/);
  assert.doesNotMatch(ui,/!!sfuState\.media!==!!eligible/);
  assert.match(ui,/local\.enabled=microphoneWanted\(roomId\)/);
});

test('voice begins at verified join before the room art and iframe are ready',()=>{
  const enter=ui.indexOf('  window.openRoom=async function(room) {');
  const end=ui.indexOf('  const originalLeaveRoom=',enter);
  assert.ok(enter>=0&&end>enter);
  const entry=ui.slice(enter,end);
  assert.ok(entry.indexOf("await api('POST','/rooms/'+room.id+'/join',{})")>=0);
  assert.ok(entry.indexOf('ensureVoiceConnected(room.id)')>
    entry.indexOf("await api('POST','/rooms/'+room.id+'/join',{})"));
  assert.ok(entry.indexOf('ensureVoiceConnected(room.id)')<
    entry.indexOf('originalOpenRoom(room)'));
  assert.match(ui,/const voice=await ensureVoiceConnected\(room\.id\)/);
});

test('SFU starts listening independently of microphone capture',()=>{
  assert.match(ui,/async function startSfuReceiving\(state\)/);
  assert.match(ui,/const receiving=startSfuReceiving\(state\)\.then/);
  assert.match(ui,/const receiveError=await receiving/);
  assert.match(ui,/bootstrapTimers:\[\]/);
  assert.match(ui,/\[1200,3000,5500\]/);
  assert.match(ui,/for\(const timer of state\.bootstrapTimers\|\|\[\]\)clearTimeout\(timer\)/);
});

test('Android keeps the screen awake for an active room, including its mini-player',()=>{
  const java=readFileSync(new URL(
    '../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',
    import.meta.url),'utf8');
  assert.match(java,/case "roomScreenAwake":/);
  assert.match(java,/getWindow\(\)\.addFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/);
  assert.match(java,/getWindow\(\)\.clearFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/);
  assert.match(ui,/setRoomScreenAwake\(true\)/);
  assert.match(ui,/setRoomScreenAwake\(false\)/);
  assert.match(ui,/if\(prior\?\.id===room\.id\)/);
  assert.match(ui,/resumeRoomAudio\(\)/);
});

test('real speaker rings follow multiple authenticated microphones and never random seats',()=>{
  const begin=ui.indexOf('  const activeVoiceSpeakers=');
  const end=ui.indexOf('  // Android WebView may block',begin);
  assert.ok(begin>=0&&end>begin);
  const classes=[];
  const seats=[
    {i:0,user_id:'owner',muted:false},
    {i:1,user_id:'one',muted:false},
    {i:2,user_id:'two',muted:true},
    {i:3,empty:1}
  ];
  const frame={seats,seatEl(i){return {classList:{toggle(key,yes){
    classes.push([i,key,yes]);
  }}}}};
  const context=createContext({
    window:{cur:{id:'roomA'}},
    document:{getElementById:()=>({contentWindow:frame})}
  });
  runInContext("let wantedVoiceRoom='roomA';"+ui.slice(begin,end),context);
  context.speakerIds=new Set(['owner','one','two']);
  runInContext("setVoiceSpeakers('roomA',speakerIds)",context);
  assert.deepEqual(seats.map(s=>!!s.talk),[true,true,false,false]);
  assert.ok(classes.some(x=>x[0]===0&&x[1]==='talk'&&x[2]===true));
  assert.ok(classes.some(x=>x[0]===1&&x[1]==='talk'&&x[2]===true));
  assert.ok(classes.some(x=>x[0]===2&&x[1]==='talk'&&x[2]===false));
  runInContext('clearVoiceSpeakers()',context);
  assert.deepEqual(seats.map(s=>!!s.talk),[false,false,false,false]);
  assert.doesNotMatch(ui.slice(begin,end),/Math\.random/);
  assert.match(ui,/frame\.tick=function\(\)\{\};/,
    'staging disables the template random voice animation');
});

test('SFU voice activity measures live audio and clears the light on mute',()=>{
  const begin=ui.indexOf('  // A light-weight, audio-only voice activity meter.');
  const end=ui.indexOf('  function addAudioTrack(state,event)',begin);
  assert.ok(begin>=0&&end>begin);
  const updates=[];
  const context=createContext({
    Date,Math,Set,Uint8Array,
    setVoiceSpeakers(room,ids){updates.push([room,[...ids].sort()]);},
    window:{}
  });
  runInContext('let sfuState=null;'+ui.slice(begin,end),context);
  const loud={getByteTimeDomainData(bytes){bytes.fill(158);}};
  const quiet={getByteTimeDomainData(bytes){bytes.fill(128);}};
  const trackOne={readyState:'live',enabled:true,muted:false};
  const trackTwo={readyState:'live',enabled:true,muted:false};
  const state={roomId:'roomA',closed:false,speakingMeters:new Map(),publishPC:null};
  state.speakingMeters.set(trackOne,{
    userId:'one',local:false,analyser:loud,samples:new Uint8Array(64),lastActiveAt:0
  });
  state.speakingMeters.set(trackTwo,{
    userId:'two',local:false,analyser:loud,samples:new Uint8Array(64),lastActiveAt:0
  });
  context.state=state;
  runInContext('sfuState=state;sampleSfuSpeaking(state)',context);
  assert.deepEqual(updates.at(-1),['roomA',['one','two']]);
  trackOne.enabled=false;
  state.speakingMeters.get(trackTwo).analyser=quiet;
  state.speakingMeters.get(trackTwo).lastActiveAt=0;
  runInContext('sampleSfuSpeaking(state)',context);
  assert.deepEqual(updates.at(-1),['roomA',[]]);
  assert.match(ui,/state\.remoteMids\.get\(String\(event\.transceiver\?\.mid/);
  assert.match(ui,/watchSfuSpeaking\(state,local,session\?\.user\?\.id,true\)/);
  assert.match(ui,/speakingContext\.close\(\)\.catch/);
  assert.match(ui,/source\.connect\(analyser\)/);
  assert.doesNotMatch(ui.slice(begin,end),/source\.connect\(.*destination/);
});
