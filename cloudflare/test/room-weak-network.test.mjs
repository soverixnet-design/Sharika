import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');

function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

function roomSyncHarness(){
  const start=ui.indexOf('  function syncFrame(room,frame,passive=false) {');
  const end=ui.indexOf('  async function syncFrameOnce(room,frame) {',start);
  assert.ok(start>=0&&end>start,'single-flight adapter must exist');
  const requests=[];
  const context=createContext({
    window:{cur:{id:'10000001'}},
    syncFrameOnce(){
      const request=deferred();
      requests.push(request);
      return request.promise;
    }
  });
  runInContext(ui.slice(start,end),context);
  return {sync:context.syncFrame,requests,room:{id:'10000001'},frame:{seats:[{i:0}]}};
}

test('slow periodic seat polls reuse one in-flight request instead of invalidating the initial room snapshot',async()=>{
  const {sync,requests,room,frame}=roomSyncHarness();
  const first=sync(room,frame);
  const passive1=sync(room,frame,true);
  const passive2=sync(room,frame,true);
  assert.equal(requests.length,1,'only one native/network request during long loading');
  assert.equal(passive1,first);
  assert.equal(passive2,first);
  requests[0].resolve('verified seats');
  assert.equal(await first,'verified seats');
  assert.equal(frame.__sharikaSeatSyncInFlight,null);
  assert.equal(requests.length,1);
});

test('seat or moderator changes request one fresh sync after a slow poll',async()=>{
  const {sync,requests,room,frame}=roomSyncHarness();
  const first=sync(room,frame,true);
  const updated1=sync(room,frame);
  const updated2=sync(room,frame);
  assert.equal(requests.length,1);
  assert.equal(updated1,updated2,'simultaneous explicit changes share one refresh');
  requests[0].resolve('old seats');
  await first;
  // Resolving the active request starts one new authenticated fetch.
  await Promise.resolve();
  assert.equal(requests.length,2);
  requests[1].resolve('new seats');
  assert.equal(await updated1,'new seats');
  assert.equal(frame.__sharikaSeatSyncInFlight,null);
});

test('room cosmetics never block the first verified member render',()=>{
  const start=ui.indexOf('  async function attachFrame(room) {');
  const end=ui.indexOf('  // Block simulated gift/chat bots',start);
  assert.ok(start>=0&&end>start);
  const attach=ui.slice(start,end);
  assert.match(attach,/loadVerifiedCosmetics\(\)\.then\(\(\)=>\{/);
  assert.doesNotMatch(attach,/await loadVerifiedCosmetics\(\)\.catch\(error=>console\.warn\('Cosmetic art:'/);
  assert.match(attach,/syncFrame\(room,frame,true\)\.catch\(error=>\{/);
});

test('voice publishing prefers low-bandwidth audio without making unsupported WebViews fail',()=>{
  const start=ui.indexOf('  async function startSfuPublishing(state) {');
  const end=ui.indexOf('  async function connectSfu(',start);
  assert.ok(start>=0&&end>start);
  const publish=ui.slice(start,end);
  assert.match(publish,/parameters\.encodings\[0\]\.maxBitrate=32000/);
  assert.match(publish,/await sender\.setParameters\(parameters\)/);
  assert.match(publish,/catch\(error\)\{\s*console\.warn\('Voice bandwidth preference unavailable:'/);
  assert.ok(publish.indexOf('await sender.setParameters(parameters)')<
    publish.indexOf('state.publishPC.createOffer()'));
});
