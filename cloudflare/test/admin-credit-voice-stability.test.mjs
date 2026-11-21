import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {handleStaffAdmin} from '../src/staff.mjs';

const reply=(data,status)=>Response.json(data,{status});
const fail=(error,status)=>Response.json({error},{status});

test('canonical member ID wins over a different user special ID collision',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE sharika_users(
        auth_uid TEXT PRIMARY KEY,public_no INTEGER UNIQUE NOT NULL,
        name TEXT,coins INTEGER,status TEXT,country TEXT
      );
      CREATE TABLE sharika_special_ids(
        auth_uid TEXT,special_id TEXT UNIQUE,expires_at TEXT
      );
      INSERT INTO sharika_users VALUES
        ('canonical',10000001,'Member A',150,'active','BD'),
        ('special-owner',10000002,'Member B',200,'active','OM'),
        ('special-only',10000003,'Member C',300,'active','IN');
      INSERT INTO sharika_special_ids VALUES
        ('special-owner','10000001',NULL),
        ('special-only','777',NULL);
    `);
    const DB={prepare(sql){
      const statement=db.prepare(sql);
      return {bind(...values){return {async first(){return statement.get(...values)||null;}};}};
    }};
    const lookup=async id=>{
      const request=new Request('https://example.test/api/v1/admin/recharge-user/recipient?id='+id);
      const response=await handleStaffAdmin({
        request,env:{DB},uid:'admin-uid',actor:{role:'super'},
        operation:'recharge-user/recipient',reply,fail,cors:{}
      });
      return {status:response.status,data:await response.json()};
    };
    const member=await lookup('10000001');
    assert.equal(member.status,200);
    assert.equal(member.data.recipient.public_id,'10000001');
    assert.equal(member.data.recipient.name,'Member A');
    const special=await lookup('777');
    assert.equal(special.status,200);
    assert.equal(special.data.recipient.public_id,'10000003');
  }finally{db.close();}
});

const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const admin=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');

test('an external admin grant is refreshed only via the authenticated wallet on foreground and a passive interval',async()=>{
  const start=adapter.indexOf('  let lastPassiveWalletCheck=0,passiveWalletRequest=null;');
  const end=adapter.indexOf('  async function refreshWalletAfterConfirmedTransaction(',start);
  assert.ok(start>0&&end>start);
  const handlers=new Map();
  let walletReads=0,periodic=null;
  const doc={hidden:false,addEventListener:(event,fn)=>handlers.set('doc:'+event,fn)};
  const win={addEventListener:(event,fn)=>handlers.set('win:'+event,fn)};
  const ctx={session:{user:{id:'test-uid'}},document:doc,window:win,
    reloadWallet:async()=>{walletReads++;return {coins:123};},
    errText:e=>String(e),console,
    setInterval:(fn,ms)=>{assert.equal(ms,30000);periodic=fn;}
  };
  runInNewContext(adapter.slice(start,end),ctx);
  assert.equal(typeof periodic,'function');
  handlers.get('doc:visibilitychange')();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(walletReads,1);
  periodic(); // 25-second guard avoids a second fetch immediately
  assert.equal(walletReads,1);
  doc.hidden=true;
  handlers.get('doc:visibilitychange')();
  assert.equal(walletReads,1);
  doc.hidden=false;
  handlers.get('win:pageshow')();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(walletReads,2);
  assert.match(adapter,/const wallet = await api\('GET','\/wallet'\)/);
  assert.match(adapter,/if\(document.hidden\|\|!joinedRoom\|\|wantedVoiceRoom!==joinedRoom.id\)return;/);
  assert.match(adapter,/scheduleVoiceRetry\(roomId,'foreground voice transport check'\)/);
});

test('admin direct credits are scoped to Staging and require an explicit environment acknowledgement',()=>{
  const start=admin.indexOf('async function mountDirectRecharge(root){');
  const end=admin.indexOf('P.rech=async function()',start);
  assert.ok(start>0&&end>start);
  const source=admin.slice(start,end);
  assert.match(source,/STAGING WALLET ONLY/);
  assert.match(source,/direct-confirm-staging/);
  assert.match(source,/button.disabled=!checkedRecipient\|\|!confirmedStaging.checked/);
  assert.match(source,/play-testers\?q=/);
  assert.match(source,/target_public_id:target,expected_recipient_id:checkedRecipient.public_id/);
});
