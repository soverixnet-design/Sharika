import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionFetch,missingProductionPrerequisites}
  from '../src/production-readiness.mjs';
import {runtimeEnvironment,presenceCoordinatorName,musicLibraryCoordinatorName}
  from '../src/runtime-environment.mjs';
import {readFileSync} from 'node:fs';

test('the production API refuses every method and never calls app handlers',async()=>{
  let called=0;
  const fetch=createProductionFetch(async()=>{called++;return new Response('unsafe');});
  for(const method of ['GET','POST','DELETE']) {
    const response=await fetch(new Request('https://production.example/api/v1/me', {method}),{});
    assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{error:'production_not_ready'});
    assert.equal(response.headers.get('cache-control'),'no-store');
  }
  assert.equal(called,0);
});

test('a dashboard-only activation flag cannot skip the production release review',async()=>{
  const configured={
    SHARIKA_ENV:'production',SHARIKA_PUBLIC_API_ENABLED:'true',
    SHARIKA_PRODUCTION_CLIENT_LINKS_REVIEWED:'true',
    SHARIKA_COINS_CASH_REDEEMABLE:'false',
    SHARIKA_PLAY_BILLING_ENABLED:'false',
    SHARIKA_AUTOMATIC_RANKING_REWARDS_ENABLED:'false',
    FIREBASE_PROJECT_ID:'sharika-voice-chat-app',
    REALTIME_SFU_APP_ID:'local-placeholder', REALTIME_SFU_APP_SECRET:'local-placeholder',
    DB:{prepare(){}}, MEDIA_BUCKET:{get(){}}, VOICE_ROOMS:{getByName(){}},
    SHARIKA_ACTION_RATE_LIMIT:{limit(){}}, SHARIKA_FINANCE_RATE_LIMIT:{limit(){}},
  };
  assert.deepEqual(missingProductionPrerequisites(configured),[]);
  let called=false;
  const fetch=createProductionFetch(()=>{called=true;return new Response('live');});
  const response=await fetch(new Request('https://production.example/health'),configured);
  assert.equal(response.status,503);
  assert.equal(called,false);
});

test('missing financial throttles, identity and real-time credentials block readiness',()=>{
  const missing=missingProductionPrerequisites({SHARIKA_ENV:'production'});
  for(const name of ['activation_flag','production_d1','production_r2','voice_coordinator',
    'action_rate_limit','finance_rate_limit','firebase_project','realtime_sfu_credentials',
    'client_and_invite_urls'])assert.ok(missing.includes(name),name);
});

test('presence and music coordinators are isolated by environment',()=>{
  assert.equal(runtimeEnvironment({SHARIKA_ENV:'production'}),'production');
  assert.equal(presenceCoordinatorName({SHARIKA_ENV:'production'}),'sharika:presence:production');
  assert.equal(musicLibraryCoordinatorName({SHARIKA_ENV:'production'}),'sharika:music-library:production');
  assert.equal(presenceCoordinatorName({SHARIKA_ENV:'staging'}),'sharika:presence:staging');
  assert.equal(musicLibraryCoordinatorName({}),'sharika:music-library:staging');
});

test('production config uses only isolated resources with public routes disabled',()=>{
  const config=JSON.parse(readFileSync(new URL('../wrangler.production.jsonc',import.meta.url),'utf8'));
  assert.equal(config.name,'sharika-api-production');
  assert.equal(config.main,'src/production-entry.mjs');
  assert.equal(config.workers_dev,false);
  assert.equal(config.preview_urls,false);
  assert.deepEqual(config.triggers.crons,[]);
  assert.equal(config.vars.SHARIKA_PUBLIC_API_ENABLED,'false');
  assert.equal(config.d1_databases[0].database_name,'sharika-production');
  assert.equal(config.d1_databases[0].database_id,'44425c0a-c691-4e39-a11a-a6e29089d1a3');
  assert.equal(config.r2_buckets[0].bucket_name,'sharika-production-media');
  assert.equal(config.durable_objects.bindings[0].name,'VOICE_ROOMS');
  assert.deepEqual(config.ratelimits.map(x=>x.namespace_id),['410301','410302']);
  assert.equal(config.observability.traces.enabled,true);
});
