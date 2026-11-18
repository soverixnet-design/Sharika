import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const main=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');

test('room and home game buttons always prefer hosted native Cloudflare Game Center',()=>{
  assert.match(source,/function showGameCard\(doc,insideRoom,showToast\)/);
  assert.match(source,/native\('openHostedGameCenter',\{insideRoom:!!insideRoom\}\)\.catch/);
  const route=source.slice(source.indexOf('  function showGameCard('),source.indexOf('  function showPlayLegacyGames('));
  assert.ok(route.includes("native('openHostedGameCenter'"));
  assert.ok(!route.includes('const portal=insideRoom?ensureRoomGamePortal'),
    'no stale HTML menu in staging route');
  assert.match(route,/reason==='hosted_game_center_unavailable'/);
  assert.match(route,/playStoreMode===true/);
  assert.match(main,/case "openHostedGameCenter":/);
  assert.match(main,/roomGameDialog=SharikaRoomGameDialog\.show\(this\)/);
  assert.match(main,/new Intent\(this,SharikaGameCenterActivity\.class\)/);
});

test('legacy two-column menu remains strictly for explicitly rejected Play build',()=>{
  const start=source.indexOf('  function showPlayLegacyGames(');
  const end=source.indexOf('  const gamesShortcut=',start);
  assert.ok(start>0&&end>start,'Play-only legacy fallback still present');
  const fallback=source.slice(start,end);
  assert.match(fallback,/if\(playStoreMode!==true\)return/);
  assert.match(fallback,/Sharika Royal Games/);
  assert.match(source,/if\(gamesShortcut\)gamesShortcut\.onclick=\(\)=>showGameCard\(document,false,toast\)/);
  assert.match(source,/if\(games\)games\.onclick=\(\)=>showGameCard\(document,true,toast\)/);
});
