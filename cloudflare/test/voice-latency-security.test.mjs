import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readBoundedJson} from '../src/request-body.mjs';

const root=new URL('../src/index.mjs',import.meta.url);
const worker=readFileSync(root,'utf8');
const client=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');

const bodyStart=worker.indexOf('async function readBody(request) {');
const bodyEnd=worker.indexOf('function corsFor(request, env) {',bodyStart);
assert.ok(bodyStart>0&&bodyEnd>bodyStart);
const readBody=new Function('MAX_BODY',worker.slice(bodyStart,bodyEnd)+'\nreturn readBody;')(20000);

test('bounded Worker JSON parser accepts normal and Unicode requests',async()=>{
  const payload={message:'Hello 😃 বাংলায়',value:25};
  const req=new Request('https://staging.invalid/api/v1/test',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
  });
  assert.deepEqual(await readBody(req),payload);
});

test('large JSON is rejected during streaming before buffering the entire upload',async()=>{
  let chunks=0,wasCancelled=false;
  const stream=new ReadableStream({
    pull(controller){
      chunks++;
      controller.enqueue(new Uint8Array(15000).fill(65));
    },
    cancel(){wasCancelled=true;}
  });
  const req=new Request('https://staging.invalid/api/v1/test',{
    method:'POST',duplex:'half',body:stream
  });
  await assert.rejects(readBody(req),/body_too_large/);
  assert.ok(chunks<=6,'stream must not be fully buffered');
  assert.equal(wasCancelled,true);
});

test('Content-Length oversized preflight does not consume the request body',async()=>{
  let read=false;
  // Native Request() may eagerly pull its input stream before the handler
  // runs; a deliberately inert request double measures only readBody().
  const req={
    headers:{get(name){return name==='content-length'?'1000000':null;}},
    body:{getReader(){read=true;throw new Error('should_not_read');}},
    async text(){read=true;throw new Error('should_not_read');}
  };
  await assert.rejects(readBody(req),/body_too_large/);
  assert.equal(read,false);
});

test('all game bet parsers reject oversized streamed requests',async()=>{
  const body=new ReadableStream({
    pull(controller){controller.enqueue(new Uint8Array(5000).fill(65));}
  });
  const req=new Request('https://staging.invalid/api/v1/games/bet',{
    method:'POST',duplex:'half',body
  });
  await assert.rejects(readBoundedJson(req),/body_too_large/);
  assert.deepEqual(await readBoundedJson(new Request('https://staging.invalid/test',{
    method:'POST',body:JSON.stringify({round_no:123,amount:1000})
  })),{round_no:123,amount:1000});
  for(const filename of ['original-games.mjs','sovera-gaddy.mjs','greedy-wheel.mjs']){
    const source=readFileSync(new URL('../src/'+filename,import.meta.url),'utf8');
    assert.match(source,/import \{readBoundedJson\} from '\.\/request-body\.mjs'/);
    assert.match(source,/b=await readBoundedJson\(request\)/);
  }
});

test('SFU ICE negotiation no longer waits four seconds after a usable TURN relay',async()=>{
  const start=client.indexOf('  function localIceCandidates(peer) {');
  const end=client.indexOf('  async function disconnectSfu() {',start);
  assert.ok(start>0&&end>start);
  const {waitIce}=new Function('setTimeout','clearTimeout',
    client.slice(start,end)+'\nreturn {waitIce};')(setTimeout,clearTimeout);
  const listeners=new Map();
  const peer={
    iceGatheringState:'gathering',
    localDescription:{sdp:'a=candidate:0 1 UDP 100 192.0.2.1 5000 typ relay\r\n'},
    getConfiguration(){return {iceServers:[{username:'short-lived-turn',urls:['turn:relay.example:3478']}]};},
    addEventListener(name,callback){listeners.set(name,callback);},
    removeEventListener(name){listeners.delete(name);}
  };
  const started=Date.now();
  const connected=waitIce(peer,'subscribe');
  listeners.get('icecandidate')({candidate:{candidate:'candidate:0 1 UDP 100 192.0.2.1 5000 typ relay'}});
  await connected;
  assert.ok(Date.now()-started<450,'ready relay should not wait for 900/4000 ms timers');
  assert.equal(listeners.size,0,'ICE event listeners must be released');
});
