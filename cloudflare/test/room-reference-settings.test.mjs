import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const fromRoot=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const worker=fromRoot('cloudflare/src/index.mjs');
const bridge=fromRoot('android-staging/staging-connection.js');
const native=fromRoot('android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java');
const room=fromRoot('app/royal-room-ui.js');
const style=fromRoot('app/royal-room-ui.css');
const migration=fromRoot('cloudflare/migrations/0094_room_introduction_tags.sql');

test('reference settings use cover, name, introduction, password, release notice, tags, theme and moderation',()=>{
  for(const text of ['Room cover settings','Room name','Introduction','Password',
    'Release notification','Tags','Theme','Admin','Black List','Forbidden List','Room reward']){
    assert.ok(bridge.includes(text),'Expected reference settings: '+text);
  }
  assert.match(bridge,/saveMain\.onclick=async\(\)=>\{/);
  assert.match(bridge,/detailsPath='\/rooms\/'\+room\.id\+'\/details'/);
  assert.match(bridge,/api\('GET',detailsPath\)/);
  assert.match(bridge,/api\('PUT',detailsPath,\{introduction\}\)/);
  assert.match(bridge,/api\('PUT',detailsPath,\{tag:key\}\)/);
  assert.match(bridge,/photo\.onclick=\(\)=>pickRoomCover\(room,frame\)/);
  assert.match(bridge,/api\('PUT','\/rooms\/'\+room\.id\+'\/announcement',\{text:value\}\)/);
  assert.match(style,/#sh-room-settings-page \.sh-room-settings-save/);
  assert.match(style,/#sh-room-settings-page \.sh-room-settings-cover-action/);
});

test('room details are authenticated, owner-only to edit and descriptive only',()=>{
  const block=worker.slice(worker.indexOf("if(parts.length===5&&action==='details'"),
    worker.indexOf("// Room-specific chat, microphone",worker.indexOf("if(parts.length===5&&action==='details'")));
  assert.match(block,/if\(!member\)return fail\('join_room_first',403,cors\)/);
  assert.match(block,/if\(room\.owner_id!==uid\)return fail\('room_owner_only',403,cors\)/);
  assert.match(block,/typeof value\.introduction!=='string'\|\|value\.introduction\.length>300/);
  assert.ok(block.includes("!['general','music','chat','friends','games'].includes(value.tag)"));
  assert.match(block,/tag_is_access_policy:false/);
  assert.match(block,/ON CONFLICT\(room_id\) DO UPDATE/);
  assert.doesNotMatch(block,/UPDATE sharika_rooms SET/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS sharika_room_details/);
  assert.doesNotMatch(migration,/CREATE TABLE.*wallet|DROP TABLE|DELETE FROM/i);
  assert.doesNotMatch(bridge,/Female Only.*api\('PUT',detailsPath/);
});

test('native WebView accepts only exact verified details and ranking filters',()=>{
  assert.match(native,/\/details\$/);
  assert.match(native,/return method\.equals\("GET"\) \|\| method\.equals\("PUT"\)/);
  assert.match(native,/kind=\(riches\|lucky\)/);
  assert.match(bridge,/loadRankings:\(period,offset=0,kind='riches'\)/);
  assert.ok(bridge.includes("'&kind='+encodeURIComponent(kind)"));
});

test('rankings are verified sender/receiver metrics, not fabricated results',()=>{
  const block=worker.slice(worker.indexOf("action==='contributors'"),
    worker.indexOf('// Claim against verified accruals',worker.indexOf("action==='contributors'")));
  assert.match(block,/if\(!member\)return fail\('join_room_first',403,cors\)/);
  assert.match(block,/invalid_ranking_kind/);
  assert.match(block,/SUM\(t\.total_coins\)/);
  assert.match(block,/SUM\(e\.price_coins\*e\.quantity\)/);
  assert.match(block,/JOIN sharika_users u ON u\.auth_uid=e\.recipient_uid/);
  assert.match(block,/kind,timezone:'UTC'/);
  assert.match(room,/v\.loadRankings\(period,offset,kind\)/);
  assert.match(room,/if\(result\.period!==period\|\|result\.kind!==kind\)/);
  assert.match(room,/for\(const position of \[2,1,3\]\)/);
  assert.match(style,/\.sh-ranking-podium/);
});

test('room reward remains server-governed 10% without enabling example tiers',()=>{
  assert.match(bridge,/Room commission: 10%/);
  assert.match(bridge,/Collect transfers only unpaid whole coins/);
  assert.match(bridge,/api\('POST',rewardsPath,\{\}\)/);
  assert.match(bridge,/The 5–8% example tiers in the reference screenshots are not active/);
  assert.match(worker,/regular_gift_percent:10/);
  assert.match(worker,/owner_wallet_credited_coins:paid/);
});
