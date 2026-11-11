import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const native=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');

test('email login recovers a valid Firebase session after a delayed native reply',async()=>{
  const start=ui.indexOf('  window.API.login = async function (identity, password) {');
  const end=ui.indexOf('  let googleLoginBusy = false;',start);
  assert.ok(start>=0&&end>start);
  const calls=[];
  const context=createContext({
    authAttemptId:0,
    playVirtualIdentityAllowed:false,
    window:{API:{}},
    document:{getElementById:()=>null},
    native:async action=>{
      calls.push(action);
      if(action==='emailSignIn')throw new Error('Request timed out');
      if(action==='session')return {signedIn:true,emailVerified:true,email:'member@example.com'};
      throw new Error('Unexpected native action');
    },
    authenticated:async account=>({email:account.email}),
    showConnectionRecovery:()=>assert.fail('A valid session must recover cleanly'),
    errText:error=>error.message
  });
  runInContext(ui.slice(start,end),context);
  const login=await context.window.API.login('member@example.com','secret');
  assert.equal(login.ok,true);
  assert.equal(login.acct.email,'member@example.com');
  assert.deepEqual(calls,['emailSignIn','session']);
});

test('expired login response cannot resume another email account',async()=>{
  const start=ui.indexOf('  window.API.login = async function (identity, password) {');
  const end=ui.indexOf('  let googleLoginBusy = false;',start);
  const context=createContext({
    authAttemptId:0,playVirtualIdentityAllowed:false,window:{API:{}},
    native:async action=>action==='emailSignIn'
      ?Promise.reject(new Error('Request timed out'))
      :{signedIn:true,emailVerified:true,email:'different@example.com'},
    authenticated:async()=>assert.fail('Do not attach a mismatched session'),
    errText:error=>error.message
  });
  runInContext(ui.slice(start,end),context);
  const login=await context.window.API.login('member@example.com','secret');
  assert.equal(login.ok,false);
  assert.match(login.msg,/connection timed out/i);
});

test('Android room entry requests have a dedicated network queue',()=>{
  assert.match(native,/private final ExecutorService roomEntryIo = Executors\.newFixedThreadPool\(2\)/);
  assert.match(native,/isRoomEntryRoute\(path\) \? roomEntryIo : io/);
  assert.match(native,/\(join\|members\)/);
  assert.match(native,/roomEntryIo\.shutdownNow\(\)/);
  const signIn=native.slice(native.indexOf('    private void emailSignIn('),native.indexOf('    private void passwordReset('));
  assert.doesNotMatch(signIn,/\.reload\(\)/);
});

test('verified room has a bounded loading warning and explicit retry',()=>{
  assert.match(ui,/roomJoiningWatchdog=setTimeout\(\(\)=>\{/);
  assert.match(ui,/Connection is slow\. You can retry or return to rooms\./);
  assert.match(ui,/retry\.onclick=async\(\)=>\{/);
  assert.match(ui,/showRoomJoinIssue\(room,'Seat connection failed: '/);
  const sync=ui.slice(ui.indexOf('  async function syncFrameOnce(room,frame) {'),
    ui.indexOf('  function revealVerifiedRoom(room,frame){'));
  assert.match(sync,/const ownerFetch=api\('GET','\/users\/'\+room\.id\)\.then\(owner=>\{/);
  assert.match(sync,/const data = await api\('GET','\/rooms\/'\+room\.id\+'\/members'\)/);
  assert.doesNotMatch(sync,/await Promise\.all\(\[\s*api\('GET','\/rooms\/'\+room\.id\+'\/members'/);
  const members=worker.slice(worker.indexOf("action === 'members' && request.method === 'GET'"),
    worker.indexOf("action === 'voice-token' && request.method === 'POST'"));
  assert.match(members,/=await Promise\.all\(\[/);
  assert.doesNotMatch(members,/\.roomPolicyRead\(\)/);
  assert.match(members,/const visibleMembers=live/);
});
