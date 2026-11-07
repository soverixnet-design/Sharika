import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recordUserEvent} from '../src/transaction-notices.mjs';
import {handleNotificationApp} from '../src/notifications.mjs';

function noticeDb(){
  const records=new Map(),calls=[];
  const db={prepare(sql){
    const statement={sql,args:[],bind(...args){this.args=args;return this;},
      async first(){
        calls.push({sql,args:this.args});
        if(sql.includes('FROM sharika_users WHERE auth_uid='))return {auth_uid:this.args[0]};
        if(sql.includes('COUNT(*) AS n FROM sharika_notifications'))return {n:records.size};
        if(sql.includes('FROM sharika_notifications WHERE recipient_uid=? AND dedupe_key=?'))
          return records.get(this.args[0]+':'+this.args[1])||null;
        return null;
      },
      async all(){
        calls.push({sql,args:this.args});
        if(sql.includes('FROM sharika_notifications')&&sql.includes('ORDER BY id DESC')){
          const uid=this.args[0],before=this.args[1]??Infinity;
          return {results:[...records.values()].filter(r=>
            r.recipient_uid===uid&&r.id<before).sort((a,b)=>b.id-a.id).slice(0,101)};
        }
        return {results:[]};
      },
      async run(){
        calls.push({sql,args:this.args});
        if(sql.includes('INSERT OR IGNORE INTO sharika_notifications')){
          const [kind,title,body,dedupeKey,,uid]=this.args,key=uid+':'+dedupeKey;
          if(records.has(key))return {meta:{changes:0}};
          const id=records.size+1;
          records.set(key,{id,recipient_uid:uid,kind,title,body,dedupe_key:dedupeKey,
            read_at:null,created_at:'2026-11-04',push_status:'pending'});
          return {meta:{changes:1}};
        }
        return {meta:{changes:0}};
      }
    };return statement;
  }};
  return {db,records,calls};
}
test('a successful transaction creates one durable recipient-scoped receipt per request id',async()=>{
  const {db,records}=noticeDb();
  const event={db,recipientUid:'u1',title:'Recharge successful',body:'500,000 coins added',
    dedupeKey:'seller_recharge:42',kind:'reward'};
  assert.equal(await recordUserEvent(event),true);
  assert.equal(await recordUserEvent(event),false);
  assert.equal(records.size,1);
  assert.equal([...records.values()][0].recipient_uid,'u1');
});
test('failed and later successful purchases have separate audit receipts',async()=>{
  const {db,records}=noticeDb();
  assert.equal(await recordUserEvent({db,recipientUid:'u1',title:'Purchase failed',
    body:'Insufficient coins',dedupeKey:'cosmetic_purchase_failed:req123456789'}),true);
  assert.equal(await recordUserEvent({db,recipientUid:'u1',title:'Purchase completed',
    body:'Frame delivered',dedupeKey:'cosmetic_purchase_success:req123456789'}),true);
  assert.equal(records.size,2);
});
test('older notification pages are strictly scoped to requester',async()=>{
  const {db,calls}=noticeDb();
  for(let i=1;i<=104;i++)await recordUserEvent({db,recipientUid:'alice',
    title:'Notice',body:'Receipt',dedupeKey:'tx:'+String(i).padStart(8,'0')});
  await recordUserEvent({db,recipientUid:'bob',
    title:'Private',body:'Private',dedupeKey:'tx:private-bob'});
  const path='/api/v1/notifications/history/102';
  const result=await handleNotificationApp({request:new Request('https://sharika.test'+path),
    env:{DB:db},uid:'alice',path,cors:{},
    reply:(body,status)=>({body,status}),fail:(error,status)=>({error,status})});
  assert.equal(result.status,200);
  assert(result.body.notifications.every(x=>x.id<102&&x.body!=='Private'));
  assert(calls.some(x=>x.sql.includes('AND id<?')&&x.args[0]==='alice'&&x.args[1]===102));
});
test('recharge, purchase, Admin and Family operations emit user notifications',()=>{
  const files=['sellers.mjs','recharges.mjs','staff.mjs','cosmetics.mjs',
    'premium.mjs','special-ids.mjs','family.mjs'];
  for(const name of files){
    const source=readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
    assert.match(source,/recordUserEvent\(/,name);
  }
  const java=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  assert.match(java,/notifications\/history/);
  assert.match(ui,/View older notifications/);
});
