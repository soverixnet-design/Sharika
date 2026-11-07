import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The room/home Games picker must be able to fetch the catalog before cards
// are shown. A missing native allowlist entry yields staging_route_not_available
// on Android even when the Cloudflare endpoint works.
test('Android permits only authenticated GET game catalog; no bet bypass', () => {
  const java=readFileSync(new URL(
    '../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',
    import.meta.url),'utf8');
  const start=java.indexOf('private boolean allowedApi(String method, String path)');
  const end=java.indexOf('private void callStagingApi',start);
  assert.ok(start>0 && end>start);
  const allow=java.slice(start,end);
  assert.match(allow,
    /if \(path\.equals\("\/api\/v1\/game-catalog"\)\) return method\.equals\("GET"\);/);
  assert.doesNotMatch(allow,/path\.startsWith\("\/api\/v1\/games"/);
});

test('Games picker and Cloudflare Worker agree on the exact catalog path', () => {
  const client=readFileSync(new URL('../../android-staging/staging-connection.js',
    import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.ok(client.includes("api('GET','/game-catalog')"));
  assert.ok(worker.includes("path==='/api/v1/game-catalog'&&request.method==='GET'"));
  assert.ok(client.includes('Games are temporarily unavailable:'));
});
