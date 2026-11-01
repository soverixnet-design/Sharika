// Sharika user notifications, Super-Admin announcements and Firebase Cloud Messaging.
// User data is always scoped to the Firebase-authenticated recipient.
const ID=/^[0-9]{8}$/;
const REQUEST_ID=/^[a-zA-Z0-9:_-]{12,80}$/;
const DEVICE_TOKEN=/^[A-Za-z0-9:_-]{30,512}$/;
const KINDS=new Set(['official','event','reward','gift','system']);
let oauthCache={accessToken:null,expiresAt:0};
const rows=result=>result?.results||[];
function short(value,max){return typeof value==='string'?value.trim().slice(0,max+1):'';}
function asPublic(no){return String(no).padStart(8,'0');}
async function readJson(request){
  const raw=await request.text();
  if(raw.length>3500)throw Error('notification_body_too_large');
  const body=JSON.parse(raw||'{}');
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('invalid_notification_body');
  return body;
}
export async function notifyUser(db,{recipientUid,kind,title,body,dedupeKey,createdBy=null}){
  if(!KINDS.has(kind)||!recipientUid||!dedupeKey)throw Error('invalid_notification');
  const result=await db.prepare(
    'INSERT OR IGNORE INTO sharika_notifications '+
    '(recipient_uid,kind,title,body,dedupe_key,created_by) '+
    'SELECT auth_uid,?,?,?,?,? FROM sharika_users WHERE auth_uid=? AND status=\'active\''
  ).bind(kind,title,body,dedupeKey,createdBy,recipientUid).run();
  const notification=await db.prepare(
    'SELECT id,recipient_uid,kind,title,body,read_at,push_status,created_at '+
    'FROM sharika_notifications WHERE recipient_uid=? AND dedupe_key=?'
  ).bind(recipientUid,dedupeKey).first();
  return {notification,created:Number(result.meta?.changes||0)>0};
}
function pemBytes(privateKey){
  const base64=privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  return Uint8Array.from(atob(base64),ch=>ch.charCodeAt(0));
}
function base64url(data){
  const bytes=typeof data==='string'?new TextEncoder().encode(data):new Uint8Array(data);
  let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
async function accessToken(env){
  const now=Math.floor(Date.now()/1000);
  if(oauthCache.accessToken&&oauthCache.expiresAt>now+60)return oauthCache.accessToken;
  const service=JSON.parse(env.FIREBASE_FCM_SERVICE_ACCOUNT_JSON);
  if(!service.client_email||!service.private_key||service.project_id!==env.FIREBASE_PROJECT_ID)
    throw Error('invalid_fcm_service_account');
  const key=await crypto.subtle.importKey('pkcs8',pemBytes(service.private_key),
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const header=base64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claims=base64url(JSON.stringify({iss:service.client_email,
    scope:'https://www.googleapis.com/auth/firebase.messaging',
    aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3500}));
  const unsigned=header+'.'+claims;
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned));
  const assertion=unsigned+'.'+base64url(signature);
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  const payload=await response.json();
  if(!response.ok||!payload.access_token)throw Error('fcm_oauth_failed');
  oauthCache={accessToken:payload.access_token,
    expiresAt:now+Math.min(Number(payload.expires_in)||3600,3600)};
  return oauthCache.accessToken;
}
async function sendDevice(env,token,data){
  const auth=await accessToken(env);
  const response=await fetch('https://fcm.googleapis.com/v1/projects/'+
    encodeURIComponent(env.FIREBASE_PROJECT_ID)+'/messages:send',{
      method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},
      body:JSON.stringify({message:{token,data,android:{priority:'HIGH'}}})
    });
  if(!response.ok){
    const body=await response.text();
    if(response.status===404||body.includes('UNREGISTERED'))return 'unregistered';
    throw Error('fcm_rejected_'+response.status);
  }
  return 'sent';
}
// Called after the D1 write is committed. FCM failure never rolls back a real notice.
export async function deliverNotification(env,notification){
  if(!notification)return 'missing';
  const db=env.DB;
  const devices=rows(await db.prepare(
    'SELECT token FROM sharika_push_devices WHERE auth_uid=? ORDER BY updated_at DESC LIMIT 5'
  ).bind(notification.recipient_uid).all());
  let status='no_device';
  if(!env.FIREBASE_FCM_SERVICE_ACCOUNT_JSON)status='not_configured';
  else if(devices.length){
    let delivered=0;
    for(const device of devices){
      try{
        const result=await sendDevice(env,device.token,{
          recipient_uid:String(notification.recipient_uid),kind:String(notification.kind),
          notification_id:String(notification.id),title:String(notification.title),
          body:String(notification.body)});
        if(result==='sent')delivered++;
        if(result==='unregistered')await db.prepare(
          'DELETE FROM sharika_push_devices WHERE token=? AND auth_uid=?'
        ).bind(device.token,notification.recipient_uid).run();
      }catch(error){console.error('fcm_notification_delivery',String(error.message||error));}
    }
    status=delivered?'sent':'failed';
  }
  await db.prepare(
    'UPDATE sharika_notifications SET push_status=? WHERE id=? AND push_status=\'pending\''
  ).bind(status,notification.id).run();
  return status;
}
export async function pushMessage(env,{recipientUid,senderUid,senderName,body,messageId}){
  if(!env.FIREBASE_FCM_SERVICE_ACCOUNT_JSON)return;
  const devices=rows(await env.DB.prepare(
    'SELECT token FROM sharika_push_devices WHERE auth_uid=? ORDER BY updated_at DESC LIMIT 5'
  ).bind(recipientUid).all());
  for(const device of devices){
    try{
      const status=await sendDevice(env,device.token,{
        recipient_uid:String(recipientUid),kind:'message',
        sender_uid:String(senderUid),title:'Message from '+String(senderName).slice(0,60),
        body:String(body).slice(0,160),message_id:String(messageId)});
      if(status==='unregistered')await env.DB.prepare(
        'DELETE FROM sharika_push_devices WHERE token=? AND auth_uid=?'
      ).bind(device.token,recipientUid).run();
    }catch(error){console.error('fcm_message_delivery',String(error.message||error));}
  }
}
export async function handleNotificationApp({request,env,uid,path,cors,reply,fail}){
  const db=env.DB;
  const active=await db.prepare(
    "SELECT auth_uid FROM sharika_users WHERE auth_uid=? AND status='active'"
  ).bind(uid).first();
  if(!active)return fail('profile_unavailable',403,cors);
  if(path==='/api/v1/notifications'&&request.method==='GET'){
    const [items,total]=await Promise.all([
      db.prepare('SELECT id,kind,title,body,read_at,created_at FROM sharika_notifications '+
        'WHERE recipient_uid=? ORDER BY id DESC LIMIT 100').bind(uid).all(),
      db.prepare('SELECT COUNT(*) AS n FROM sharika_notifications '+
        'WHERE recipient_uid=? AND read_at IS NULL').bind(uid).first()
    ]);
    return reply({notifications:rows(items),unread_count:Number(total?.n||0)},200,cors);
  }
  if(path==='/api/v1/notifications/read-all'&&request.method==='POST'){
    const saved=await db.prepare(
      "UPDATE sharika_notifications SET read_at=datetime('now') "+
      'WHERE recipient_uid=? AND read_at IS NULL'
    ).bind(uid).run();
    return reply({updated:Number(saved.meta?.changes||0)},200,cors);
  }
  const mark=/^\/api\/v1\/notifications\/([1-9][0-9]*)\/read$/.exec(path);
  if(mark&&request.method==='PATCH'){
    const saved=await db.prepare(
      "UPDATE sharika_notifications SET read_at=COALESCE(read_at,datetime('now')) "+
      'WHERE id=? AND recipient_uid=?'
    ).bind(Number(mark[1]),uid).run();
    if(!saved.meta?.changes){
      const exists=await db.prepare('SELECT id FROM sharika_notifications WHERE id=? AND recipient_uid=?')
        .bind(Number(mark[1]),uid).first();
      if(!exists)return fail('notification_not_found',404,cors);
    }
    return reply({read:true},200,cors);
  }
  if(path==='/api/v1/notifications/devices'){
    let payload;
    try{payload=await readJson(request);}catch(_){return fail('invalid_notification_body',400,cors);}
    const token=short(payload.token,512);
    if(!DEVICE_TOKEN.test(token))return fail('invalid_push_token',400,cors);
    if(request.method==='POST'){
      await db.prepare('INSERT INTO sharika_push_devices(token,auth_uid,platform) VALUES(?,? ,\'android\') '+
        'ON CONFLICT(token) DO UPDATE SET auth_uid=excluded.auth_uid,updated_at=datetime(\'now\')')
        .bind(token,uid).run();
      return reply({registered:true,device_push_configured:!!env.FIREBASE_FCM_SERVICE_ACCOUNT_JSON},200,cors);
    }
    if(request.method==='DELETE'){
      await db.prepare('DELETE FROM sharika_push_devices WHERE token=? AND auth_uid=?')
        .bind(token,uid).run();
      return reply({removed:true},200,cors);
    }
  }
  return fail('notification_route_not_found',404,cors);
}
export async function handleNotificationAdmin({request,env,uid,actor,operation,cors,reply,fail}){
  if(operation!=='notifications')return null;
  if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
  const db=env.DB;
  if(request.method==='GET'){
    const [campaigns,count]=await Promise.all([
      db.prepare("SELECT dedupe_key,kind,title,body,created_at,COUNT(*) AS recipients,"+
        "SUM(CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END) AS read_count,"+
        "SUM(CASE WHEN push_status='sent' THEN 1 ELSE 0 END) AS push_sent_count "+
        "FROM sharika_notifications WHERE created_by=? AND dedupe_key LIKE 'admin:%' "+
        'GROUP BY dedupe_key ORDER BY MAX(id) DESC LIMIT 30').bind(uid).all(),
      db.prepare("SELECT COUNT(*) AS n FROM sharika_push_devices").first()
    ]);
    return reply({campaigns:rows(campaigns),registered_devices:Number(count?.n||0),
      push_configured:!!env.FIREBASE_FCM_SERVICE_ACCOUNT_JSON},200,cors);
  }
  if(request.method!=='POST')return fail('method_not_allowed',405,cors);
  let body;
  try{body=await readJson(request);}catch(_){return fail('invalid_notification_body',400,cors);}
  const kind=short(body.kind,20),title=short(body.title,100),
    message=short(body.body,1000),requestId=short(body.request_id,80);
  const audience=body.audience;
  const publicNo=short(body.public_id,8);
  if(!['official','event','system'].includes(kind)||!title||title.length>100||!message||
     message.length>1000||!REQUEST_ID.test(requestId)||
     !['all','user'].includes(audience)||(audience==='user'&&!ID.test(publicNo)))
    return fail('invalid_notification_fields',400,cors);
  const dedupeKey='admin:'+requestId;
  const prior=await db.prepare(
    'SELECT title,body,kind,COUNT(*) AS n FROM sharika_notifications '+
    'WHERE created_by=? AND dedupe_key=?'
  ).bind(uid,dedupeKey).first();
  if(Number(prior?.n||0)>0){
    if(prior.title!==title||prior.body!==message||prior.kind!==kind)
      return fail('notification_request_conflict',409,cors);
    return reply({duplicate:true,recipients:Number(prior.n),push_configured:!!env.FIREBASE_FCM_SERVICE_ACCOUNT_JSON},200,cors);
  }
  const lastMinute=await db.prepare("SELECT COUNT(*) AS n FROM sharika_admin_audit "+
    "WHERE actor_id=? AND action='notification_sent' AND created_at>=datetime('now','-1 minute')")
    .bind(uid).first();
  if(Number(lastMinute?.n||0)>=3)return fail('notification_rate_limited',429,cors);
  const recipients=audience==='user'?
    rows(await db.prepare("SELECT auth_uid FROM sharika_users WHERE public_no=? AND status='active'")
      .bind(Number(publicNo)).all()):
    rows(await db.prepare("SELECT auth_uid FROM sharika_users WHERE status='active' ORDER BY public_no LIMIT 501").all());
  if(!recipients.length)return fail('no_verified_recipients',404,cors);
  if(recipients.length>500)return fail('audience_too_large_for_direct_delivery',409,cors);
  // Store the notification for each real active account, never for demo data.
  const saved=await db.batch([
    ...recipients.map(r=>db.prepare(
      'INSERT OR IGNORE INTO sharika_notifications'+
      '(recipient_uid,kind,title,body,dedupe_key,created_by) VALUES(?,?,?,?,?,?)'
    ).bind(r.auth_uid,kind,title,message,dedupeKey,uid)),
    db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
      .bind(uid,'notification_sent',JSON.stringify({
        audience,public_id:audience==='user'?publicNo:null,kind,
        request_id:requestId,recipient_count:recipients.length}))
  ]);
  const pending=rows(await db.prepare(
    'SELECT id,recipient_uid,kind,title,body FROM sharika_notifications '+
    'WHERE created_by=? AND dedupe_key=? AND push_status=\'pending\' LIMIT 500'
  ).bind(uid,dedupeKey).all());
  let sent=0;
  // Direct push dispatch is bounded; notice persistence is the source of truth.
  for(const item of pending){
    const status=await deliverNotification(env,item);
    if(status==='sent')sent++;
  }
  return reply({created:true,recipients:recipients.length,push_sent_to_users:sent,
    push_configured:!!env.FIREBASE_FCM_SERVICE_ACCOUNT_JSON},201,cors);
}
