import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src = relative => readFileSync(new URL(relative,import.meta.url),'utf8');

test('only existing Greedy Wheel is visible while legacy games stay preserved',()=>{
  const bridge=src('../../android-staging/staging-connection.js');
  assert.ok(bridge.includes('visibleGameCards=[greedyGame].filter(game=>enabled.has(game.id))'));
  assert.ok(!bridge.includes('requestedOriginalGames.has(game.id)'));
  assert.ok(bridge.includes('const catalogRequestNo=++gameCatalogRequestSequence'));
  assert.ok(!bridge.includes("visibleGameCards=originalGameCards.filter(game=>game.id==='fruit-royale'"));
  assert.ok(bridge.includes("'/original-games/'+current.item.id"));
});

test('compact verified ranking and owner-only room announcement endpoints',()=>{
  const ui=src('../../app/royal-room-ui.js');
  const worker=src('../src/index.mjs');
  const native=src('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java');
  const sql=src('../migrations/0056_room_announcements.sql');
  // Ranking is deliberately outside the tappable profile card. A past
  // test hard-coded the obsolete in-card trophy and blocked the QA APK.
  assert.ok(ui.includes("stack.append(rankRow)"));
  assert.ok(ui.includes('rankRow.append(ranking)'));
  assert.ok(!ui.includes('profile.append(ranking)'));
  assert.ok(ui.includes("ranking.onclick=()=>showRankings()"));
  assert.ok(ui.includes("v.loadRankings('monthly',offset)"));
  assert.ok(native.includes('/contributors'));
  assert.ok(ui.includes("menuItem('📣 Announcement'"));
  assert.ok(worker.includes("action==='announcement'"));
  assert.ok(worker.includes("if(room.owner_id!==uid)return fail('room_owner_only',403,cors)"));
  assert.ok(worker.includes('sharika_room_announcements'));
  assert.ok(native.includes('/announcement'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS sharika_room_announcements'));
});

test('room joins are recorded for signed-in members without paid entry styles',()=>{
  const worker=src('../src/index.mjs');
  const coordinator=src('../src/voice-room.mjs');
  const bridge=src('../../android-staging/staging-connection.js');
  assert.match(worker,/roomEntryAnnounce\(\s*uid,publicId\(entrant\.public_no\),txt\(entrant\.name,80\)\|\|'Member',entry\|\|'standard'/);
  assert.ok(!coordinator.includes('if(!style)return {announced:false};'));
  assert.ok(bridge.includes("verifiedName+' joined the room'"));
});

test('Nobel remains over seat frame with no extra layout row',()=>{
  const bridge=src('../../android-staging/staging-connection.js');
  const css=src('../../app/reference-room.css');
  const ui=src('../../app/royal-room-ui.js');
  assert.ok(bridge.includes("ornaments.classList.add('sh-seat-frame-badges')"));
  assert.ok(bridge.includes('avatar.appendChild(ornaments)'));
  assert.ok(!bridge.includes('el.appendChild(ornaments)'));
  assert.ok(css.includes('.sh-seat-frame-badges .sh-sovera-seat-medal'));
  assert.ok(css.includes('.sh-room-rank-row > .sh-room-rank-button'));
  assert.ok(ui.includes("rankRow.append(ranking)"));
});
