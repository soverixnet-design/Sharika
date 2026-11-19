import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const between=(start,end)=>{
 const first=source.indexOf(start);
 const last=source.indexOf(end,first+start.length);
 assert.ok(first>0&&last>first,'expected room runtime section: '+start);
 return source.slice(first,last);
};

test('Voice Health is a read-only local panel available in room Settings',()=>{
 const panel=between('function openVoiceHealthPage(){',"const settings=section('Room Settings')");
 assert.match(source,/row\(settings,'Voice Health','Local mic & network diagnostics',openVoiceHealthPage\)/);
 assert.match(panel,/inspectSfuAudio\(state\)/);
 assert.match(panel,/state\?\.lastMediaStats/);
 assert.match(panel,/Receiving connection/);
 assert.match(panel,/Microphone/);
 assert.match(panel,/Lost incoming packets/);
 assert.match(panel,/Incoming network route/);
 assert.match(panel,/Outgoing network route/);
 assert.match(panel,/No audio is recorded or sent to Admin/);
 assert.doesNotMatch(panel,/\bapi\s*\(/);
 assert.doesNotMatch(panel,/localStorage|sessionStorage|sendBeacon|fetch\s*\(|XMLHttpRequest|\.put\(/);
 assert.doesNotMatch(panel,/\.sdp|iceServers|password|credential|firebaseToken/i);
});

test('hidden room suspends only decorative arrivals/gift polling; foreground refreshes both',()=>{
 const entry=between('entryPoll=setInterval(()=>{','startRoomMusicPoll(room.id)');
 const gift=between('giftPoll=setInterval(()=>{','document.addEventListener(\'visibilitychange\',roomVisualVisibilityListener)');
 assert.match(entry,/if\(!document.hidden&&window.cur\?\.id===room.id\)/);
 assert.match(gift,/if\(!document.hidden&&window.cur\?\.id===room.id\)/);
 assert.match(gift,/if\(document.hidden\|\|!visitIsActive\(\)\)return/);
 assert.match(gift,/pollRoomEntries\(\)\.catch/);
 assert.match(gift,/pollGiftEvents\(\)\.catch/);
 const method=gift.match(/roomVisualVisibilityListener=\(\)=>\{([\s\S]*?)\n    \};/);
 assert.ok(method,'foreground callback is present');
 let arrivals=0,gifts=0;
 let hidden=true,active=true;
 const document={get hidden(){return hidden}};
 const visitIsActive=()=>active;
 const pollRoomEntries=()=>{arrivals++;return Promise.resolve()};
 const pollGiftEvents=()=>{gifts++;return Promise.resolve()};
 const handler=new Function('document','visitIsActive','pollRoomEntries','pollGiftEvents',
   'return ()=>{'+method[1]+'\n};')(
    document,visitIsActive,pollRoomEntries,pollGiftEvents);
 handler();
 assert.deepEqual([arrivals,gifts],[0,0],'background visual checks are idle');
 hidden=false;handler();
 assert.deepEqual([arrivals,gifts],[1,1],'return to room refreshes visual state once');
 active=false;handler();
 assert.deepEqual([arrivals,gifts],[1,1],'an exited room must not fetch');
});

test('room exit unregisters visibility observer, not foreground audio service',()=>{
 const stopping=between('function stopRoomServices(){','function leaveRoomMembership(room)');
 assert.match(stopping,/document.removeEventListener\('visibilitychange',roomVisualVisibilityListener\)/);
 assert.match(stopping,/roomVisualVisibilityListener=null/);
 assert.match(stopping,/releaseVoice\(\)\.catch/);
 assert.doesNotMatch(stopping,/stopRoomAudio\(/);
});

test('WebRTC receive, heartbeat and TURN recovery continue while WebView is hidden',()=>{
 const voice=between('async function connectSfu(roomId,canPublish','async function disconnectVoice()');
 const receiving=between('async function startSfuReceiving(state)','function stopSfuPublishing(state)');
 assert.match(receiving,/state\.publicationTimer=setInterval\(/);
 assert.match(receiving,/subscribeSfu\(state\)/);
 assert.match(voice,/inspectSfuAudio\(state\)/);
 assert.match(voice,/\/voice\/heartbeat/);
 assert.doesNotMatch(voice,/document\.hidden\)disconnectSfu/);
 const android=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
 const background=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/RoomAudioService.java',import.meta.url),'utf8');
 assert.match(android,/startForegroundService\(/);
 assert.match(background,/FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK/);
 assert.match(background,/FOREGROUND_SERVICE_TYPE_MICROPHONE/);
});
