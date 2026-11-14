import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Load the actual Durable Object methods with a small local platform shim;
// the real SQLite schema and SQL queries run unmodified during this test.
const source=readFileSync(new URL('../src/voice-room.mjs',import.meta.url),'utf8')
  .replace(/^import \{ DurableObject \} from 'cloudflare:workers';\s*/,'')
  .replace('export class SharikaVoiceRoom','class SharikaVoiceRoom');
const VoiceRoom=new Function('DurableObject',source+'\nreturn SharikaVoiceRoom;')(
  class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}
);

function coordinator(){
  const db=new DatabaseSync(':memory:');
  const ctx={
    storage:{sql:{
      exec(query,...values){
        const statement=db.prepare(query);
        const rows=/^\s*(SELECT|PRAGMA)/i.test(query)
          ?statement.all(...values):(statement.run(...values),[]);
        return {toArray(){return rows;}};
      }
    }},
    blockConcurrencyWhile(callback){return callback();}
  };
  return {room:new VoiceRoom(ctx,{DB:{}}),db};
}

test('room visit limits text chat and join events to after THIS entry',async()=>{
  const {room,db}=coordinator();
  try{
    await room.roomChatSend('sender-a','10000001','Old sender',
      'Old private history','chat:old-message-001');
    await room.roomEntryAnnounce('sender-a','10000001','Old sender','standard');
    assert.deepEqual((await room.roomChatRead('guest',0)).messages,[]);
    assert.deepEqual((await room.roomEntryRead('guest',0)).events,[]);
    assert.equal(await room.roomGiftAfter('guest'),null);

    await room.beginRoomVisit('guest',45);
    assert.equal(await room.roomGiftAfter('guest'),45);
    assert.deepEqual((await room.roomChatRead('guest',0)).messages,[]);
    assert.deepEqual((await room.roomEntryRead('guest',0)).events,[]);

    await room.roomChatSend('sender-b','10000002','New sender',
      'Only new text','chat:new-message-002');
    await room.roomEntryAnnounce('guest','10000003','Current visitor','standard');
    assert.deepEqual((await room.roomChatRead('guest',0)).messages.map(x=>x.body),
      ['Only new text']);
    assert.deepEqual((await room.roomEntryRead('guest',0)).events.map(x=>x.name),
      ['Current visitor']);
    assert.deepEqual((await room.roomChatRead('guest',999999)).messages,[]);

    await room.endRoomVisit('guest');
    assert.equal(await room.roomGiftAfter('guest'),null);
    assert.deepEqual((await room.roomChatRead('guest',0)).messages,[]);

    // Messages and another person's arrival while outside stay invisible.
    await room.roomChatSend('sender-c','10000004','Another sender',
      'While you were gone','chat:while-away-003');
    await room.roomEntryAnnounce('sender-c','10000004','Another sender','standard');
    await room.beginRoomVisit('guest',99);
    assert.deepEqual((await room.roomChatRead('guest',0)).messages,[]);
    assert.deepEqual((await room.roomEntryRead('guest',0)).events,[]);
    assert.equal(await room.roomGiftAfter('guest'),99);

    await room.roomChatSend('sender-d','10000005','Fresh sender',
      'Fresh after reentry','chat:after-reentry-004');
    await room.roomEntryAnnounce('guest','10000003','Current visitor','standard');
    assert.deepEqual((await room.roomChatRead('guest',0)).messages.map(x=>x.body),
      ['Fresh after reentry']);
    assert.deepEqual((await room.roomEntryRead('guest',0)).events.map(x=>x.name),
      ['Current visitor']);
  }finally{db.close();}
});

test('two distinct clients see live joins and new messages, not each other\'s past history',async()=>{
  const {room,db}=coordinator();
  try{
    // Phone A is already in the room and sends before Phone B arrives.
    await room.beginRoomVisit('phone-a',0);
    await room.roomEntryAnnounce('phone-a','10000001','Soverix Net','standard');
    await room.roomChatSend('phone-a','10000001','Soverix Net',
      'Before B entered','chat:before-phone-b');
    assert.deepEqual((await room.roomChatRead('phone-a',0)).messages.map(x=>x.body),
      ['Before B entered']);

    // B joins: the old message and A's old entry are invisible only to B.
    await room.beginRoomVisit('phone-b',20);
    await room.roomEntryAnnounce('phone-b','10000003','Maryam','standard');
    assert.deepEqual((await room.roomChatRead('phone-b',0)).messages,[]);
    assert.deepEqual((await room.roomEntryRead('phone-b',0)).events.map(x=>x.name),
      ['Maryam']);
    assert.deepEqual((await room.roomEntryRead('phone-a',0)).events.map(x=>x.name),
      ['Soverix Net','Maryam']);
    await room.roomChatSend('phone-b','10000003','Maryam',
      'Hello after joining','chat:hello-from-b');
    assert.deepEqual((await room.roomChatRead('phone-b',0)).messages.map(x=>x.body),
      ['Hello after joining']);
    assert.deepEqual((await room.roomChatRead('phone-a',0)).messages.map(x=>x.body),
      ['Before B entered','Hello after joining']);

    // B departs; A's conversation continues and is never erased.
    await room.endRoomVisit('phone-b');
    await room.roomChatSend('phone-c','10000004','Listener',
      'While B was outside','chat:during-b-absence');
    assert.equal((await room.roomChatRead('phone-b',0)).messages.length,0);
    assert.equal((await room.roomChatRead('phone-a',0)).messages.length,3);

    await room.beginRoomVisit('phone-b',70);
    await room.roomEntryAnnounce('phone-b','10000003','Maryam','standard');
    assert.deepEqual((await room.roomChatRead('phone-b',0)).messages,[]);
    assert.deepEqual((await room.roomEntryRead('phone-b',0)).events.map(x=>x.name),
      ['Maryam']);
    await room.roomChatSend('phone-d','10000005','Live Guest',
      'Both phones can see this','chat:after-b-return');
    assert.deepEqual((await room.roomChatRead('phone-b',0)).messages.map(x=>x.body),
      ['Both phones can see this']);
    assert.deepEqual((await room.roomChatRead('phone-a',0)).messages.map(x=>x.body),
      ['Before B entered','Hello after joining','While B was outside',
        'Both phones can see this']);
    assert.equal(await room.roomGiftAfter('phone-b'),70);
  }finally{db.close();}
});

test('a duplicate mobile join does not duplicate arrival banners but a real re-entry does',async()=>{
  const {room,db}=coordinator();
  try{
    await room.beginRoomVisit('shakil',0);
    assert.deepEqual(await room.roomEntryAnnounce('shakil','10000014','Shakil','standard'),
      {announced:true});
    assert.deepEqual(await room.roomEntryAnnounce('shakil','10000014','Shakil','standard'),
      {announced:false,duplicate:true});
    assert.equal((await room.roomEntryRead('shakil',0)).events.length,1);
    await room.endRoomVisit('shakil');
    await room.beginRoomVisit('shakil',0);
    assert.deepEqual(await room.roomEntryAnnounce('shakil','10000014','Shakil','standard'),
      {announced:true});
    assert.equal((await room.roomEntryRead('shakil',0)).events.length,1,
      'new visitor sees only their latest arrival');
  }finally{db.close();}
});

test('occupied seats show names and reveal the visible ID in the member profile',()=>{
  const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../../app/reference-room.css',import.meta.url),'utf8');
  const seatDecorator=adapter.slice(adapter.indexOf('function decorateRoomSeats('),
    adapter.indexOf('function wireSoveraRoomFrames('));
  assert.doesNotMatch(seatDecorator,/frame\.sid|sh-verified-seat-id/);
  assert.match(adapter,/meta\.textContent='ID '\+String\(selected\.special_id\|\|selected\.display_id\|\|publicId\)/);
  assert.match(adapter,/recentJoinNames\.has\(memberId\)/);
  assert.match(css,/#grid\.grid:has\(>\.seat:nth-child\(17\)\) \.seat \.av\s*\{[^}]*width:clamp\(33px,9\.4vw,53px\)/);
  assert.doesNotMatch(css,/\.sh-verified-seat-id/);
  assert.doesNotMatch(adapter,/frame\.innerWidth,frame\.innerHeight\]\)/);
});

test('client stops restoring historic gifts and clears offline demo messages',()=>{
  const adapter=readFileSync(
    new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../../app/royal-room-ui.css',import.meta.url),'utf8');
  assert.match(adapter,/frame\.\$\?\.\('chat'\)\?\.replaceChildren\(\)/);
  assert.match(adapter,/entry\.textContent='👋 '\+verifiedName\+' joined the room'/);
  assert.match(adapter,/entry\.className='sh-verified-room-join'/);
  assert.doesNotMatch(adapter,/familyBadge\.textContent='👑 '/);
  assert.match(css,/\.sh-royal-room \.top \.room\{[\s\S]*?min-height:50px;height:50px/);
});
