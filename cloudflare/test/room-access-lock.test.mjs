import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {handleRequest} from '../src/index.mjs';
import {readRoomAccessLock,writeRoomAccessLock} from '../src/room-access-lock.mjs';

globalThis.crypto??=webcrypto;
const project='sharika-lock-test';
const actor='firebase:'+project+':member-1';
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const publicKey={...(await crypto.subtle.exportKey('jwk',pair.publicKey)),
  kid:'room-access-test',alg:'RS256',use:'sig'};
const encode=x=>Buffer.from(x instanceof Uint8Array?x:JSON.stringify(x)).toString('base64url');
async function token(){
  const now=Math.floor(Date.now()/1000);
  const first=encode({alg:'RS256',kid:'room-access-test',typ:'JWT'})+'.'+
    encode({aud:project,iss:'https://securetoken.google.com/'+project,
      sub:'member-1',exp:now+3600,iat:now-50,auth_time:now-50,email_verified:true});
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,
    new TextEncoder().encode(first));
  return first+'.'+encode(new Uint8Array(sig));
}
function fixture({owner=false,admin=false,member=false,locked=true}={}){
  const state={joined:member,locked,writes:[],batches:0};
  const db={
    prepare(sql){
      return {sql,args:[],bind(...args){this.args=args;return this;},
        async first(){
          if(sql.includes('FROM sharika_users WHERE auth_uid'))return {status:'active',public_no:10000010};
          if(sql.includes('FROM sharika_rooms WHERE id=?'))
            return {id:'10000001',owner_id:owner?actor:'other-owner',seat_count:20,theme:'mid'};
          if(sql.includes('FROM sharika_room_members WHERE room_id=? AND user_id=?'))
            return state.joined?{room_id:'10000001',user_id:actor,seat_no:null,muted:0}:null;
          if(sql.includes('FROM sharika_room_admins WHERE room_id=?'))
            return admin?{active:1}:null;
          if(sql.includes('FROM sharika_room_access_locks WHERE room_id=?'))
            return {locked:state.locked?1:0,updated_at:'2026-11-07 08:00:00'};
          return null;
        },
        async all(){return {results:[]};},
        async run(){
          state.writes.push(sql);
          if(sql.includes('INSERT OR IGNORE INTO sharika_room_members')){
            if(sql.includes('WHERE NOT EXISTS')&&state.locked)
              return {success:true,meta:{changes:0}};
            state.joined=true;
          }
          return {success:true,meta:{changes:1}};
        }
      };
    },
    async batch(statements){
      state.batches++;
      state.locked=statements[0].args[1]===1;
      state.writes.push(...statements.map(s=>s.sql));
      return statements.map(()=>({success:true}));
    }
  };
  const coordinator={
    async roomPolicyRead(){return {password_required:false};},
    async presenceJoin(){return {joined:true};},
    async beginRoomVisit(){return {started:true};},
    async roomEntryAnnounce(){return {announced:true};}
  };
  const env={DB:db,FIREBASE_PROJECT_ID:project,
    VOICE_ROOMS:{getByName:()=>coordinator}};
  return {state,db,env};
}
async function send(env,action,method='GET',body){
  const request=new Request('https://staging.example/api/v1/rooms/10000001/'+action,{
    method,headers:{Authorization:'Bearer '+await token()},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const previous=globalThis.fetch;
  globalThis.fetch=async url=>{
    assert.match(String(url),/securetoken@system\.gserviceaccount\.com/);
    return {ok:true,headers:new Headers({'cache-control':'max-age=300'}),
      json:async()=>({keys:[publicKey]})};
  };
  try{
    const response=await handleRequest(request,env);
    return {status:response.status,body:await response.json()};
  }finally{globalThis.fetch=previous;}
}

test('room access lock defaults open and persists with an audit entry',async()=>{
  const f=fixture({locked:false});
  assert.equal((await readRoomAccessLock(f.db,'10000001')).locked,false);
  const saved=await writeRoomAccessLock(f.db,'10000001',actor,true);
  assert.equal(saved.locked,true);
  assert.equal(f.state.batches,1);
  assert.ok(f.state.writes.some(sql=>sql.includes('sharika_room_access_lock_audit')));
  await assert.rejects(writeRoomAccessLock(f.db,'10000001',actor,'true'),TypeError);
});

test('only verified Owner or Room Admin may lock and unlock the entire room',async()=>{
  const guest=fixture({member:true,locked:false});
  const denied=await send(guest.env,'access-lock','PUT',{locked:true});
  assert.equal(denied.status,403);
  assert.equal(guest.state.batches,0);
  for(const role of [{owner:true},{admin:true}]){
    const f=fixture({...role,member:true,locked:false});
    const locked=await send(f.env,'access-lock','PUT',{locked:true});
    assert.equal(locked.status,200);
    assert.equal(locked.body.locked,true);
    const opened=await send(f.env,'access-lock','PUT',{locked:false});
    assert.equal(opened.status,200);
    assert.equal(opened.body.locked,false);
    assert.equal(f.state.batches,2);
  }
});

test('locking rejects new guests but keeps members and privileged re-entry',async()=>{
  const outsider=fixture({locked:true});
  const denied=await send(outsider.env,'join','POST',{});
  assert.equal(denied.status,403);
  assert.equal(denied.body.error,'room_locked');
  assert.equal(outsider.state.joined,false);
  const existing=fixture({locked:true,member:true});
  assert.equal((await send(existing.env,'join','POST',{})).status,200);
  for(const role of [{owner:true},{admin:true}]){
    const allowed=fixture({...role,locked:true});
    assert.equal((await send(allowed.env,'join','POST',{})).status,200);
    assert.equal(allowed.state.joined,true);
  }
});

test('invalid toggle values and unjoined callers fail closed',async()=>{
  const f=fixture({owner:true,member:true});
  const invalid=await send(f.env,'access-lock','PUT',{locked:'yes'});
  assert.equal(invalid.status,400);
  assert.equal(f.state.batches,0);
  const unjoined=fixture({owner:true});
  assert.equal((await send(unjoined.env,'access-lock')).status,403);
});

test('Android native allowlist, UI menu, migration and room-list badge are connected',()=>{
  const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
  assert.match(read('android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java'),
    /\/access-lock\$"\)\)\s*return method\.equals\("GET"\) \|\| method\.equals\("PUT"\)/);
  assert.match(read('android-staging/staging-connection.js'),/frame\.roomLockSheet=async function/);
  assert.match(read('app/royal-room-ui.js'),/menuItem\('🔒 Room Lock'/);
  assert.match(read('app/index.html'),/room-access-lock/);
  const migration=read('cloudflare/migrations/0057_room_access_locks.sql');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS sharika_room_access_locks/);
  assert.doesNotMatch(migration,/\bDELETE FROM\b|\bDROP TABLE\b/i);
});
