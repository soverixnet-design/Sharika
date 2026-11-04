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

test('client stops restoring historic gifts and clears offline demo messages',()=>{
  const adapter=readFileSync(
    new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../../app/royal-room-ui.css',import.meta.url),'utf8');
  assert.match(adapter,/frame\.\$\?\.\('chat'\)\?\.replaceChildren\(\)/);
  assert.match(adapter,/frame\.sys\?\.\('👋 '\+String\(event\.name\|\|'Member'\)\+' joined the room'\)/);
  assert.doesNotMatch(adapter,/familyBadge\.textContent='👑 '/);
  assert.match(css,/\.sh-royal-room \.top \.room\{\s*min-height:32px;height:33px/);
});
