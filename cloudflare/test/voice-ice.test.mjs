import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const begin=source.indexOf('  function localIceCandidates(peer) {');
const end=source.indexOf('  async function disconnectSfu()',begin);
assert.ok(begin>0&&end>begin);

const srflx='a=candidate:1 1 udp 2122260223 10.0.0.2 12345 typ srflx raddr 0.0.0.0 rport 0\r\n';
const host='a=candidate:2 1 udp 2122260223 10.0.0.3 10000 typ host\r\n';

function harness(sdp,gathering='gathering') {
  const timers=new Map(),handlers=new Map(),logs=[];
  let next=0;
  const peer={
    iceGatheringState:gathering,localDescription:{sdp},
    addEventListener(name,fn){handlers.set(name,fn);},
    removeEventListener(name){handlers.delete(name);}
  };
  const context={peer,console:{warn(...args){logs.push(args);}},
    setTimeout(fn,delay){const id=++next;timers.set(id,{fn,delay});return id;},
    clearTimeout(id){timers.delete(id);}
  };
  runInNewContext(source.slice(begin,end),context);
  return {
    peer,timers,handlers,logs,
    wait:phase=>runInNewContext(`waitIce(peer,${JSON.stringify(phase)})`,context),
    fire(ms){const item=[...timers].find(([,timer])=>timer.delay===ms);
      assert.ok(item,'expected timer at '+ms+'ms');
      item[1].fn();}
  };
}

test('published UDP server-reflexive candidates allow faster SFU negotiation',async()=>{
  const h=harness('v=0\r\n'+host+srflx);
  const pending=h.wait('publish');
  h.fire(2200);
  await pending;
  assert.equal(h.timers.size,0);
  assert.equal(h.handlers.size,0);
});

test('blocked alternate TURN ports cannot discard a usable host candidate',async()=>{
  const h=harness('v=0\r\n'+host);
  const pending=h.wait('receive');
  h.fire(2200);
  assert.ok(h.timers.size>0,'host alone should allow time for TURN relay');
  h.fire(7000);
  await pending;
  assert.match(h.logs[0].join(' '),/ICE gathering incomplete: receive/);
});

test('ICE with no local candidates reports a real network failure',async()=>{
  const h=harness('v=0\r\n');
  const pending=h.wait('publish');
  h.fire(7000);
  await assert.rejects(pending,/no ICE network candidates \(publish\)/);
});

test('already completed ICE gathering can proceed without a timer',async()=>{
  const h=harness('v=0\r\n'+host,'complete');
  await h.wait('receive');
  assert.equal(h.timers.size,0);
});

test('publishing and receiving gather ICE separately and recovery can use TURN relay',()=>{
  assert.match(source,/await waitIce\(state\.receivePC,'receive'\)/);
  assert.match(source,/await waitIce\(state\.publishPC,'publish'\)/);
  assert.match(source,/iceConfig\.iceTransportPolicy='relay'/);
  assert.match(source,/iceConfig\.iceServers\.some\(server=>server\.username\)/);
});
