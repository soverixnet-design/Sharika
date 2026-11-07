import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sensitiveActionClass, allowSensitiveAction } from '../src/security-rate-limit.mjs';

test('voice signaling and read-only routes are never rate-limited', async () => {
  assert.equal(sensitiveActionClass('GET','/api/v1/sellers/transfers'),null);
  assert.equal(sensitiveActionClass('POST','/api/v1/rooms/10000001/voice/heartbeat'),null);
  assert.equal(sensitiveActionClass('POST','/api/v1/rooms/10000001/voice/publish'),null);
  assert.equal(await allowSensitiveAction({env:{SHARIKA_ENV:'production'},uid:'u',path:'/api/v1/rooms/10000001/voice/ready',method:'POST'}),true);
});

test('verified financial writes have a smaller independent counter', async () => {
  const used=[];
  const env={
    SHARIKA_ENV:'staging',
    SHARIKA_ACTION_RATE_LIMIT:{limit:async x=>{used.push(['action',x.key]);return {success:true};}},
    SHARIKA_FINANCE_RATE_LIMIT:{limit:async x=>{used.push(['finance',x.key]);return {success:true};}}
  };
  const cases=[
    ['/api/v1/sellers/transfer','finance'],
    ['/api/v1/admin/sellers/allocate','finance'],
    ['/api/v1/rooms/10000001/gifts','finance'],
    ['/api/v1/games/food-wheel/bet','finance'],
    ['/api/v1/original-games/sovera-food/bet','finance'],
    ['/api/v1/profile','action'],
    ['/api/v1/rooms/10000001/chat','action']
  ];
  for(const [path,category] of cases){
    assert.equal(sensitiveActionClass('POST',path),category,path);
    assert.equal(await allowSensitiveAction({env,uid:'verified-u',path,method:'POST'}),true);
  }
  assert.deepEqual(used.map(([group,key])=>[group,key]),cases.map(([,group])=>[group,'verified-u:'+group]));
});

test('security limiter denies the over-limit request and fails closed in production', async () => {
  const path='/api/v1/sellers/transfer';
  assert.equal(await allowSensitiveAction({env:{SHARIKA_ENV:'production'},uid:'u',path,method:'POST'}),false);
  assert.equal(await allowSensitiveAction({env:{SHARIKA_ENV:'staging'},uid:'u',path,method:'POST'}),true);
  assert.equal(await allowSensitiveAction({
    env:{SHARIKA_ENV:'staging',SHARIKA_FINANCE_RATE_LIMIT:{limit:async()=>({success:false})}},
    uid:'u',path,method:'POST'
  }),false);
});

test('Admin CSP and Android auth/voice guards remain in staging source', () => {
  const admin=readFileSync(new URL('../src/admin-frontend-worker.mjs',import.meta.url),'utf8');
  const android=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const gradle=readFileSync(new URL('../../android-staging/app/build.gradle',import.meta.url),'utf8');
  assert.match(admin,/content-security-policy/);
  assert.match(admin,/sha256-/);
  assert.match(admin,/frame-ancestors 'none'/);
  assert.match(admin,/object-src 'none'/);
  assert.doesNotMatch(android,/cdn\.jsdelivr\.net\/npm\/livekit-client/);
  assert.match(android,/verified Cloudflare SFU required/);
  assert.match(gradle,/sharika-staging-auth-guard/);
  assert.match(gradle,/Secure login unavailable/);
});
