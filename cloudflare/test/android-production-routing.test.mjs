import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const android=new URL('../../android-staging/',import.meta.url);
const read=path=>readFileSync(new URL(path,android),'utf8');
const staging='https://sharika-api-staging.soverixnet.workers.dev';

test('native API, messaging and HTTPS invite origin use release BuildConfig',()=>{
  const activity=read('app/src/main/java/com/soverixnet/sharika/SharikaActivity.java');
  const main=read('app/src/main/java/com/soverixnet/sharika/MainActivity.java');
  const push=read('app/src/main/java/com/soverixnet/sharika/SharikaMessagingService.java');
  const manifest=read('app/src/main/AndroidManifest.xml');
  assert.match(activity,/private static final String API_ORIGIN = BuildConfig\.SHARIKA_API_ORIGIN/);
  assert.match(activity,/Uri\.parse\(API_ORIGIN\)\.getHost\(\)\.equals\(uri\.getHost\(\)\)/);
  assert.match(main,/private static final String BACKEND = BuildConfig\.SHARIKA_API_ORIGIN/);
  assert.match(push,/BuildConfig\.SHARIKA_API_ORIGIN \+ "\/api\/v1\/notifications\/devices"/);
  for(const source of [activity,main,push])assert.ok(!source.includes(staging));
  assert.match(manifest,/android:host="\$\{sharikaInviteHost\}"/);
});

test('release assets target only the approved host, with debug URLs preserved',()=>{
  const gradle=read('app/build.gradle');
  assert.match(gradle,/def productionApiOrigin = System\.getenv\('SHARIKA_PLAY_API_ORIGIN'\)/);
  assert.match(gradle,/manifestPlaceholders = \[sharikaInviteHost: chosenPlayHost\]/);
  assert.match(gradle,/manifestPlaceholders = \[sharikaInviteHost: 'sharika-api-staging/);
  assert.match(gradle,/sourceSets\.release\.assets\.srcDir\(playConnectionAssets\)/);
  assert.match(gradle,/prepareSharikaPlayConnection/);
  assert.match(gradle,/chosenPlayOrigin == 'https:\/\/sharika-api-staging/);
  // Model the same literal replacement used by the release Copy task. The
  // existing source and debug path must never be rewritten in place.
  const source=read('staging-connection.js');
  const production='https://api.sharika.example';
  const transformed=source.replaceAll(staging,production)
    .replaceAll('sharika-api-staging\\.soverixnet\\.workers\\.dev','api\\.sharika\\.example');
  assert.ok(source.includes(staging));
  assert.ok(!transformed.includes('sharika-api-staging.soverixnet.workers.dev'));
  assert.ok(!transformed.includes('sharika-api-staging\\.soverixnet\\.workers\\.dev'));
  assert.match(transformed,/https:\/\/api\.sharika\.example\/invite\//);
  assert.match(transformed,/api\\\.sharika\\\.example/);
});

test('Play Android route gate blocks seller directories, cash withdrawals and paid bets',()=>{
  const source=read('app/src/main/java/com/soverixnet/sharika/SharikaActivity.java');
  const section=source.slice(source.indexOf('if (BuildConfig.SHARIKA_PLAY_BUILD) {',
    source.indexOf('private boolean allowedApi(')));
  for(const route of ['/api/v1/sellers','/api/v1/invites/withdrawals',
    '/api/v1/family/crystal/transfer','/api/v1/agency/salary/transfer',
    '/api/v1/greedy-wheel/bet'])assert.ok(section.includes(route),route);
  assert.match(section,/\(games\|original-games\)\/\[\^\/\]\+\/bet/);
  // Reject before any route-specific return, including the earlier Family
  // transfer route. A late gate would silently allow it in Play builds.
  const method=source.slice(source.indexOf('private boolean allowedApi('));
  assert.ok(method.indexOf('if (BuildConfig.SHARIKA_PLAY_BUILD) {') <
    method.indexOf('path.equals("/api/v1/family/crystal/transfer") ||'));
});

test('Play UI fails closed while selecting native mode and omits old recharge banners',()=>{
  const source=read('staging-connection.js');
  assert.match(source,/playStoreMode=null/);
  assert.match(source,/if\(playStoreMode!==false\)return;[\s\S]*?const listButton=/);
  assert.match(source,/if\(playStoreMode===null\)\{\s*playModeReady\.then\(\(\)=>showGameCard/);
  assert.match(source,/row\.action!=='recharge'/);
  assert.match(source,/event\.kind!=='game_tournament'/);
  assert.match(source,/playModeReady\.then\(\(\)=>refreshVerifiedBanners\(\)\)/);
});
