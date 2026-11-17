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
  assert.doesNotMatch(assistant,/api\('GET','\/users\/'/);
  assert.match(assistant,/\.find\(item=>String\(item\.owner_id\)===String\(accountId\)\)/);
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


test('room endpoint returns only the authenticated account room in a mocked D1 call',async()=>{
  const route=block(backend,
    "if(path==='/api/v1/me/room' && request.method==='GET'){",
    "if (path === '/api/v1/me/location')");
  const exec=Function('path','request','env','uid','cors','assertActive','reply',
    'return (async()=>{'+route+'return null;})()');
  const owners=new Map([
    ['account-A',{id:'10000011',name:'Room A',seat_count:12,theme:'mid',created_at:null}],
    ['account-B',{id:'10000022',name:'Room B',seat_count:8,theme:'gold',created_at:null}]
  ]);
  for(const id of ['account-A','account-B','account-C']){
    let checked=null,bound=null;
    const env={DB:{prepare(sql){
      assert.match(sql,/owner_id=\? LIMIT 1/);
      return {bind(owner){
        bound=owner;
        return {first:async()=>owners.get(owner)||null};
      }};
    }}};
    const result=await exec('/api/v1/me/room',
      {method:'GET',body:{owner_id:'account-B'}},env,id,{},
      async(_,principal)=>{checked=principal;},
      payload=>payload);
    assert.equal(checked,id);
    assert.equal(bound,id);
    assert.deepEqual(result.room?.name,owners.get(id)?.name);
    if(id==='account-C')assert.equal(result.room,null);
  }
});


test('older staging API fallback cannot expose a different user room or invent missing rooms',async()=>{
  const responseSource=block(ui,'async function ownAccountResponse(','async function respond(question){');
  async function simulate(meRoom,listRooms){
    const requests=[];
    const api=async(method,path)=>{
      requests.push(path);
      if(path==='/me/room'){
        if(meRoom instanceof Error)throw meRoom;
        return {room:meRoom};
      }
      if(path==='/rooms')return {rooms:listRooms};
      throw new Error('Unexpected API call: '+path);
    };
    const reply=Function('api','ownCoinCount','ownLevel',
      responseSource+'return ownAccountResponse;')(api,()=>null,()=>null);
    return {reply,requests};
  }
  const other={id:'10000002',owner_id:'other-user',name:'Other Room',seat_count:8};
  const mine={id:'10000003',owner_id:'my-user',name:'My Verified Room',seat_count:12};
  const active=await simulate(new Error('404'),[other,mine]);
  assert.match(await active.reply('room','my-user',1),/My Verified Room/);
  assert.deepEqual(active.requests,['/me/room','/rooms']);
  const missing=await simulate(new Error('404'),[other]);
  await assert.rejects(missing.reply('room','my-user',1),/temporarily unavailable/);
  const authoritative=await simulate(null,[other]);
  assert.match(await authoritative.reply('room','my-user',1),/কোনো রুম নেই/);
  assert.deepEqual(authoritative.requests,['/me/room']);
});


test('Royal Assistant redesign has branded 3D controls and adaptive mobile layout',()=>{
  const assistant=ui.slice(ui.indexOf('// SHARIKA_ASSISTANT_HELP_20261117'));
  assert.match(assistant,/#sh-assistant-trigger\{/);
  assert.match(assistant,/linear-gradient\(145deg,#fff3c8/);
  assert.match(assistant,/#sh-assistant-hero\{/);
  assert.match(assistant,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(assistant,/@media\(max-height:610px\)/);
  assert.match(assistant,/#sh-assistant-panel:not\(\.sh-as-chatting\) #sh-assistant-chips\{/);
  assert.match(assistant,/grid-template-rows:repeat\(4,minmax\(62px,1fr\)\)/);
  assert.match(assistant,/#sh-assistant-panel:not\(\.sh-as-chatting\) #sh-assistant-log\{display:none\}/);
  assert.match(assistant,/#sh-assistant-panel\.sh-as-chatting #sh-assistant-hero\{display:none\}/);
  assert.match(assistant,/id="sh-assistant-title"/);
  assert.match(assistant,/id="sh-assistant-log" role="log"/);
  assert.match(assistant,/aria-label="দ্রুত সাহায্য"/);
  assert.match(assistant,/overlay\.querySelector\('#sh-assistant-panel'\)\?\.classList\.add\('sh-as-chatting'\)/);
  assert.match(assistant,/overlay\.querySelector\('#sh-assistant-panel'\)\?\.classList\.remove\('sh-as-chatting'\)/);
  assert.match(assistant,/graphic\.innerHTML=quickCardMeta\[label\]\?\.svg\|\|''/);
  assert.match(assistant,/wrap\.textContent=label/);
  assert.match(assistant,/sub\.textContent=quickCardMeta\[label\]\?\.sub\|\|''/);
  assert.doesNotMatch(assistant,/input\.focus\(\)/);
});

test('Assistant quick prompts do not silently change the verified-account API contract',()=>{
  const assistant=ui.slice(ui.indexOf('// SHARIKA_ASSISTANT_HELP_20261117'));
  for(const endpoint of ["/wallet","/me","/me/room"]){
    assert.ok(assistant.includes("api('GET','"+endpoint+"')"));
  }
  assert.match(assistant,/message\.textContent=String\(text\)/);
  assert.match(assistant,/window\.sharikaAssistantClear=clearAssistant/);
});
