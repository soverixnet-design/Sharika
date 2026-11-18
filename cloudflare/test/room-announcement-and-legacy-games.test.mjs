import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src = relative => readFileSync(new URL(relative,import.meta.url),'utf8');

test('admin-enabled games including SuperAce are visible while legacy games stay preserved',()=>{
  const bridge=src('../../android-staging/staging-connection.js');
  assert.ok(bridge.includes("['greedy-wheel','cleopatra','food-deluxe','greedy-classic','royal-ace','fruit-royale'].includes(game.id)&&enabled.has(game.id)"));
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
  assert.match(ui,/rankRow\.append\(ranking\);[\s\S]*?roomControls\.append\(masthead,rankRow\);\s*top\?\.after\(roomControls\)/);
  assert.match(ui,/const items=view\.members\.map\(member=>/);
  assert.match(ui,/id\.textContent=member\.displayId/);
  assert.match(ui,/count\.onclick=showMembers/);
  assert.match(ui,/renderLiveMembers\(view\);\s*roomControls\.hidden=false/);
  const css=src('../../app/reference-room.css');
  assert.match(css,/\.sh-room-rank-button \{\s*position:static;/);
  assert.ok(ui.includes("v.loadRankings(period,offset,kind)"));
  assert.ok(ui.includes("['weekly','Weekly']"));
  assert.ok(ui.includes("['monthly','Monthly']"));
  assert.ok(ui.includes("['riches','Riches']"));
  assert.ok(ui.includes("['lucky','Lucky']"));
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
