import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const java=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
const app=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const routes=java.slice(java.indexOf('private boolean allowedApi('),java.indexOf('private void callStagingApi('));

test('Android bridge allows server-backed cosmetics, events, wallet rate and room rewards',()=>{
  for(const [route,method] of [
    ['/api/v1/events','GET'],
    ['/api/v1/cosmetics','GET'],
    ['/api/v1/wallet/exchange-rate','GET']
  ])assert.ok(routes.includes(`if (path.equals("${route}")) return method.equals("${method}");`),route);
  assert.match(routes,/path\.equals\("\/api\/v1\/cosmetics\/purchase"\) \|\|\s*path\.equals\("\/api\/v1\/cosmetics\/equip"\)\) return method\.equals\("POST"\)/);
  assert.match(routes,/\^\/api\/v1\/rooms\/\[0-9\]\{8\}\/rewards\$/);
  assert.match(app,/api\('GET','\/events'\)/);
  assert.match(app,/api\('GET','\/wallet\/exchange-rate'\)/);
  assert.match(app,/api\('GET','\/rooms\/'\+room\.id\+'\/rewards'\)/);
  assert.match(worker,/handleEventApp/);
  assert.match(worker,/action==='rewards'/);
});

test('room-entry polling permits only a bounded numeric cursor before generic query rejection',()=>{
  const cursor=routes.indexOf('/entries\\\\?after=');
  const reject=routes.indexOf('if (path.contains("?")) return false;');
  assert.ok(cursor>=0&&reject>cursor,'entry cursor route must precede query rejection');
  assert.match(routes,/entries\\\\\?after=\(0\|\[1-9\]\[0-9\]\{0,11\}\)/);
  assert.match(app,/api\('GET','\/rooms\/'\+room\.id\+'\/entries\?after='/);
  assert.match(worker,/action==='entries'/);
  assert.match(routes,/path\.contains\("\.\."\)/);
  assert.doesNotMatch(routes,/path\.equals\("\/api\/v1\/admin\/events"\)/);
});

test('HD room backgrounds are saved through an owner-authenticated route and displayed for guests',()=>{
  assert.match(routes,/rooms\/\[0-9\]\{8\}\/theme-image\$"\)\)\s*return method\.equals\("PUT"\)/);
  assert.match(app,/api\('PUT','\/rooms\/'\+room\.id\+'\/theme-image'/);
  assert.match(app,/verifiedThemeUrl\(data\.theme_background_url\)/);
  assert.match(app,/highDefinition\?\[1920,1600,1440,1280,1080,900\]/);
  assert.match(worker,/SELECT image_base64 FROM sharika_room_theme_images WHERE room_id=/);
  assert.match(worker,/room_owner_only/);
});

test('room emoji sync is confined to authenticated room reactions and bounded cursors',()=>{
  const cursor=routes.indexOf('/reactions\\\\?after=');
  const reject=routes.indexOf('if (path.contains("?")) return false;');
  assert.ok(cursor>=0&&cursor<reject,'reaction cursor must precede query rejection');
  assert.match(routes,/rooms\/\[0-9\]\{8\}\/reactions\$"\)\)\s*return method\.equals\("POST"\)/);
  assert.match(app,/api\('POST','\/rooms\/'\+room\.id\+'\/reactions'/);
  assert.match(app,/api\('GET','\/rooms\/'\+room\.id\+'\/reactions\?after='/);
  assert.match(worker,/action==='reactions'/);
  assert.match(worker,/take_mic_seat_first/);
});

test('premium membership is routed only through verified authenticated Android endpoints',()=>{
  assert.match(routes,/path\.equals\("\/api\/v1\/premium"\)\) return method\.equals\("GET"\)/);
  assert.match(routes,/path\.equals\("\/api\/v1\/premium\/purchase"\) \|\|\s*path\.equals\("\/api\/v1\/premium\/daily\/claim"\)\) return method\.equals\("POST"\)/);
  assert.match(app,/api\('GET','\/premium'\)/);
  assert.match(app,/api\('POST','\/premium\/purchase'/);
  assert.match(app,/api\('POST','\/premium\/daily\/claim'/);
  assert.match(app,/nextWalletRequestId\('premium'\)/);
  assert.match(worker,/handlePremiumApp/);
  assert.doesNotMatch(routes,/path\.equals\("\/api\/v1\/admin\/premium"\)/);
});
