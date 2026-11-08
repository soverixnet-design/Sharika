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
