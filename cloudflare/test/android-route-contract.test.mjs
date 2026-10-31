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
