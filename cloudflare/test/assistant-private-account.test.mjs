import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const backend=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
function block(str,begin,end){
  const start=str.indexOf(begin),stop=str.indexOf(end,start+begin.length);
  assert.ok(start>=0&&stop>start,'Missing Assistant contract: '+begin);
  return str.slice(start,stop);
}

test('private room endpoint uses verified Firebase UID, not client-supplied identity',()=>{
  const auth=block(backend,'let actor;','const parts = path.split');
  assert.match(auth,/verifyFirebaseToken\(request\.headers\.get\('authorization'\), env\.FIREBASE_PROJECT_ID\)/);
  assert.match(auth,/const uid = actor\.uid/);
  const route=block(backend,
    "if(path==='/api/v1/me/room' && request.method==='GET'){",
    "if (path === '/api/v1/me/location')");
  assert.match(route,/await assertActive\(env\.DB,uid\)/);
  assert.match(route,/FROM sharika_rooms WHERE owner_id=\? LIMIT 1/);
  assert.match(route,/\.bind\(uid\)\.first\(\)/);
  assert.match(route,/return reply\(\{room:room\?/);
  assert.doesNotMatch(route,/request\.json|searchParams|url\.search|body\.owner|body\.id|owner_id\s*:/);
  assert.doesNotMatch(route,/SELECT \*/);
});

test('Assistant reads verified account state and guards against switched sessions',()=>{
  const assistant=ui.slice(ui.indexOf('// SHARIKA_ASSISTANT_HELP_20261117'));
  assert.match(assistant,/api\('GET','\/wallet'\)/);
  assert.match(assistant,/api\('GET','\/me'\)/);
  assert.match(assistant,/api\('GET','\/me\/room'\)/);
  assert.match(assistant,/String\(data\.user_id\)!==String\(accountId\)/);
  assert.match(assistant,/session\?\.user\?\.id!==accountId/);
  assert.match(assistant,/authAttemptId!==version/);
  assert.match(assistant,/requestId!==assistantRequest/);
  assert.match(assistant,/message\.textContent=String\(text\)/);
  assert.match(ui,/window\.sharikaAssistantClear\?\.\(\)/);
  assert.doesNotMatch(assistant,/api\('GET','\/users\/'|api\('GET','\/rooms'\)/);
  assert.doesNotMatch(assistant,/fetch\(|localStorage\.getItem|sessionStorage/);
});

test('Bengali and English private-account questions map to the right verified view',()=>{
  const classify=Function(block(ui,'const ownQueries=[','function clearAssistant(){')+
    'return privateIntent;')();
  assert.equal(classify('আমার ব্যালেন্স'),'wallet');
  assert.equal(classify('আমার কয়েন কত?'),'wallet');
  assert.equal(classify('my coins'),'wallet');
  assert.equal(classify('আমার লেভেল'),'level');
  assert.equal(classify('my profile'),'profile');
  assert.equal(classify('আমার রুমের তথ্য'),'room');
  assert.equal(classify('অন্যের ব্যালেন্স'),'other');
  assert.equal(classify('gift কীভাবে পাঠাব?'),null);
});

test('Balance and level formatting reject invalid state rather than inventing numbers',()=>{
  const formatters=Function(block(ui,'function ownCoinCount(value){',
    'async function ownAccountResponse(')+'return {ownCoinCount,ownLevel};')();
  assert.equal(formatters.ownCoinCount(0),'0');
  assert.equal(formatters.ownCoinCount(100000),'100,000');
  assert.equal(formatters.ownCoinCount(null),null);
  assert.equal(formatters.ownCoinCount(-1),null);
  assert.equal(formatters.ownCoinCount('not-a-number'),null);
  assert.equal(formatters.ownLevel(0),'0');
  assert.equal(formatters.ownLevel(undefined),null);
});
