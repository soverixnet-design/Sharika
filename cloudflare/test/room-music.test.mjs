import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

// Execute the real Cloudflare Durable Object methods with a SQLite engine,
// rather than just asserting the new endpoint has the right text.
const source=readFileSync(new URL('../src/voice-room.mjs',import.meta.url),'utf8')
  .replace(/^import \{ DurableObject \} from 'cloudflare:workers';\s*/,'')
  .replace('export class SharikaVoiceRoom','class SharikaVoiceRoom');
const VoiceRoom=new Function('DurableObject',source+'\nreturn SharikaVoiceRoom;')(
  class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}
);
function fixture(){
  const db=new DatabaseSync(':memory:');
  const ctx={storage:{sql:{exec(query,...values){
    const statement=db.prepare(query);
    const rows=/^\s*(SELECT|PRAGMA)/i.test(query)?statement.all(...values):
      (statement.run(...values),[]);
    return {toArray(){return rows;}};
  }}},blockConcurrencyWhile(callback){return callback();}};
  return {room:new VoiceRoom(ctx,{DB:{}}),db};
}

test('music library only lists enabled tracks to room listeners',async()=>{
  const {room,db}=fixture();
  try{
    await room.musicLibraryCreate('Licensed track','https://cdn.example.com/song.mp3');
    await room.musicLibraryCreate('Unpublished','https://cdn.example.com/other.ogg');
    assert.equal((await room.musicLibraryList()).tracks.length,2);
    await room.musicLibraryUpdate(2,'Unpublished','https://cdn.example.com/other.ogg',false);
    const active=await room.musicLibraryList();
    assert.deepEqual(active.tracks.map(x=>x.title),['Licensed track']);
    assert.equal(await room.musicLibraryTrack(2),null);
    assert.equal((await room.musicLibraryList(true)).tracks.length,2);
    assert.deepEqual(await room.musicLibraryUpdate(999,'X','https://a.com/x.mp3',true),
      {error:'music_track_not_found'});
  }finally{db.close();}
});

test('one room has revisioned library/local/off state and controller-scoped MP3 heartbeat',async()=>{
  const {room,db}=fixture();
  try{
    assert.equal((await room.roomMusicRead()).mode,'off');
    const song={id:3,title:'Night song',url:'https://cdn.example.com/night.mp3'};
    let row=await room.roomMusicSet('owner','library',song);
    assert.equal(row.mode,'library');
    assert.equal(row.url,song.url);
    assert.equal(row.track_id,3);
    assert.equal(row.revision,1);
    assert.equal('controller_uid' in row,false);
    row=await room.roomMusicSet('room-admin','local',{title:'Phone MP3'});
    assert.equal(row.mode,'local');
    assert.equal(row.revision,2);
    assert.equal(row.url,'');
    assert.deepEqual(await room.roomMusicSet('another-admin','heartbeat'),
      {error:'music_controller_changed'});
    assert.equal((await room.roomMusicSet('room-admin','heartbeat')).revision,2);
    assert.equal((await room.roomMusicSet('owner','stop_self')).mode,'local');
    assert.equal((await room.roomMusicStopFor('owner')).mode,'local');
    assert.equal((await room.roomMusicSet('room-admin','stop_self')).mode,'off');
    assert.equal((await room.roomMusicRead()).revision,3);
  }finally{db.close();}
});

test('stale phone MP3 is retired by server without old room audio surviving',async()=>{
  const {room,db}=fixture();
  try{
    await room.roomMusicSet('owner','local',{title:'From phone'});
    db.prepare('UPDATE room_music_state SET updated_at_ms=? WHERE id=1')
      .run(Date.now()-30000);
    const state=await room.roomMusicRead();
    assert.equal(state.mode,'off');
    assert.equal(state.revision,2);
    assert.equal((await room.roomMusicRead()).revision,2);
  }finally{db.close();}
});

test('only authenticated Room Owner/Admin can change music; native bridge limits paths',()=>{
  const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const java=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
  const admin=readFileSync(new URL('../src/music-library.mjs',import.meta.url),'utf8');
  assert.match(worker,/room\.owner_id!==uid&&!await isRoomAdmin\(env,roomId,uid\)/);
  assert.match(worker,/coordinator\.roomMusicSet\(uid,mode,track\)/);
  assert.match(admin,/actor\.role!=='super'/);
  assert.match(java,/\/api\/v1\/music-library/);
  assert.match(java,/\/music\$"\)/);
  assert.match(adapter,/sender\.replaceTrack\(mixed\)/);
  assert.match(adapter,/if\(musicPoll\)\{clearInterval\(musicPoll\)/);
});
