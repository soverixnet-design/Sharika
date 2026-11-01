import test from 'node:test';
import assert from 'node:assert/strict';
import {handleNotificationApp,handleNotificationAdmin,notifyUser,deliverNotification}
  from '../src/notifications.mjs';

const reply=(body,status=200)=>({status,body});
const fail=(code,status)=>({status,body:{error:code}});
function mockDb(){
  const calls=[];
  const db={prepare(sql){
    const item={sql,args:[]};calls.push(item);
    return {bind(...args){item.args=args;return this;},
      async first(){
        if(sql.includes('FROM sharika_users WHERE auth_uid='))return {auth_uid:'alice'};
        if(sql.includes('COUNT(*) AS n FROM sharika_notifications'))return {n:2};
        if(sql.includes('FROM sharika_notifications WHERE recipient_uid='))return {
          id:11,recipient_uid:'alice',kind:'official',title:'Official',
          body:'New policy',push_status:'pending'};
        return null;
      },
      async all(){
        if(sql.includes('FROM sharika_notifications')&&sql.includes('ORDER BY id DESC'))
          return {results:[{id:11,kind:'official',title:'Official',body:'New policy',read_at:null}]};
        return {results:[]};
      },
      async run(){return {meta:{changes:1}}}
    };
  }};
  return {db,calls};
}
const app=(db,path,method='GET',body={})=>handleNotificationApp({
  request:new Request('https://example.test'+path,{method,
    ...(method==='GET'?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})}),
  env:{DB:db},uid:'alice',path,cors:{},reply,fail
});
test('notifications are read for the authenticated recipient only',async()=>{
  const {db,calls}=mockDb();
  const result=await app(db,'/api/v1/notifications');
  assert.equal(result.status,200);
  assert.equal(result.body.unread_count,2);
  assert.equal(result.body.notifications[0].kind,'official');
  assert(calls.filter(c=>c.sql.includes('sharika_notifications')).every(
    c=>c.args.includes('alice')));
});
test('mark all as read cannot update other users',async()=>{
  const {db,calls}=mockDb();
  const result=await app(db,'/api/v1/notifications/read-all','POST');
  assert.equal(result.body.updated,1);
  assert(calls.some(c=>c.sql.includes('UPDATE sharika_notifications')&&c.args[0]==='alice'));
});
test('invalid device tokens are rejected and cannot use arbitrary methods',async()=>{
  const {db}=mockDb();
  const result=await app(db,'/api/v1/notifications/devices','POST',{token:'short'});
  assert.equal(result.status,400);
  assert.equal(result.body.error,'invalid_push_token');
});
test('non-super admins cannot publish announcements',async()=>{
  const {db,calls}=mockDb();
  const result=await handleNotificationAdmin({
    request:new Request('https://example.test',{method:'POST'}),env:{DB:db},
    uid:'alice',actor:{role:'support'},operation:'notifications',cors:{},reply,fail});
  assert.equal(result.status,403);
  assert.equal(calls.length,0);
});
test('idempotent server notification references a unique recipient and dedupe key',async()=>{
  const {db,calls}=mockDb();
  const item=await notifyUser(db,{recipientUid:'alice',kind:'official',
    title:'Official',body:'New policy',dedupeKey:'admin:test-123456789'});
  assert.equal(item.created,true);
  assert.equal(item.notification.recipient_uid,'alice');
  assert(calls.some(c=>c.sql.includes('INSERT OR IGNORE INTO sharika_notifications')&&
    c.args.includes('admin:test-123456789')&&c.args.includes('alice')));
});
test('a notification without FCM credential is never claimed as phone-delivered',async()=>{
  const {db,calls}=mockDb();
  const status=await deliverNotification({DB:db},{id:11,recipient_uid:'alice',
    kind:'official',title:'Official',body:'New policy'});
  assert.equal(status,'not_configured');
  assert(calls.some(c=>c.sql.includes('UPDATE sharika_notifications')&&c.args[0]==='not_configured'));
});
