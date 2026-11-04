import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = relative => readFileSync(new URL(relative,import.meta.url),'utf8');

test('three original game cards are visible when enabled; jackpot card remains hidden',()=>{
  const bridge=source('../../android-staging/staging-connection.js');
  assert.match(bridge,/new Set\(\['sovera-food','night-food','greedy-wheel'\]\)/);
  assert.match(bridge,/requestedOriginalGames\.has\(game\.id\)&&enabled\.has\(game\.id\)/);
  assert.doesNotMatch(bridge,/visibleGameCards=originalGameCards\.filter\(game=>game\.id==='fruit-royale'/);
  assert.ok(bridge.includes("'/original-games/'+current.item.id"));
});

test('room mini ranking, rewards and persistent announcements remain authenticated',()=>{
  const ui=source('../../app/royal-room-ui.js');
  const worker=source('../src/index.mjs');
  const native=source('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java');
  const sql=source('../migrations/0056_room_announcements.sql');
  assert.match(ui,/smallRank\.onclick=\(\)=>showRankings\('daily'\)/);
  assert.match(ui,/rewardChip\.onclick=showRewards/);
  assert.match(ui,/editAnnouncement\(\)/);
  assert.match(worker,/action==='announcement'/);
  assert.match(worker,/if\(room\.owner_id!==uid\)return fail\('room_owner_only',403,cors\)/);
  assert.match(worker,/sharika_room_announcements/);
  assert.ok(native.includes('/announcement
  assert.match(sql,/CREATE TABLE IF NOT EXISTS sharika_room_announcements/);
});

test('every verified room join creates a server event even without an entry effect',()=>{
  const worker=source('../src/index.mjs');
  const coordinator=source('../src/voice-room.mjs');
  const bridge=source('../../android-staging/staging-connection.js');
  assert.match(worker,/roomEntryAnnounce\(uid,publicId\(entrant\.public_no\),entrant\.name,entry\)/);
  assert.doesNotMatch(coordinator,/if\(!style\)return \{announced:false\}/);
  assert.match(bridge,/verifiedName\+' joined the room'/);
});
));
  assert.match(sql,/CREATE TABLE IF NOT EXISTS sharika_room_announcements/);
});

test('every verified room join creates a server event even without an entry effect',()=>{
  const worker=source('../src/index.mjs');
  const coordinator=source('../src/voice-room.mjs');
  const bridge=source('../../android-staging/staging-connection.js');
  assert.match(worker,/roomEntryAnnounce\(uid,publicId\(entrant\.public_no\),entrant\.name,entry\)/);
  assert.doesNotMatch(coordinator,/if\(!style\)return \{announced:false\}/);
  assert.match(bridge,/verifiedName\+' joined the room'/);
});
