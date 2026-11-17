// Admin-published room-only promotional artwork. No coins, gifts or bets.
const ID=/^[1-9][0-9]{0,8}$/;
const LOCATIONS=new Set(['game','event']);
const FIELDS=new Set(['title','placement','country_code','action','sort_order','active']);

function validCountry(value){
  return typeof value==='string'&&(value===''||/^[A-Z]{2}$/.test(value));
}
function normalize(body,partial=false){
  if(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).some(field=>!FIELDS.has(field)))return null;
  const out={};
  if(body.title!==undefined){
    if(typeof body.title!=='string'||!body.title.trim()||body.title.trim().length>70)return null;
    out.title=body.title.trim();
  }
  if(body.placement!==undefined){
    if(!LOCATIONS.has(body.placement))return null;
    out.placement=body.placement;
  }
  if(body.country_code!==undefined){
    const code=String(body.country_code||'').trim().toUpperCase();
    if(!validCountry(code))return null;
    out.country_code=code;
  }
  if(body.action!==undefined){
    if(!['none','games'].includes(body.action))return null;
    out.action=body.action;
  }
  if(body.sort_order!==undefined){
    if(!Number.isSafeInteger(body.sort_order)||body.sort_order<0||body.sort_order>10000)return null;
    out.sort_order=body.sort_order;
  }
  if(body.active!==undefined){
    if(typeof body.active!=='boolean')return null;
    out.active=body.active?1:0;
  }
  if(!Object.keys(out).length)return null;
  if(!partial&&(!out.title||!out.placement))return null;
  if(!partial)return {
    title:out.title,placement:out.placement,country_code:out.country_code||'',
    action:out.placement==='game'?'games':'none',
    sort_order:out.sort_order||0,active:0
  };
  // Promotional events are decorative; they cannot launch unrelated actions.
  if(out.placement==='event')out.action='none';
  if(out.placement==='game' && out.action && out.action!=='games')return null;
  return out;
}
function view(row,origin){
  const id=Number(row.id),version=Number(row.image_version)||0;
  return {id,title:String(row.title||'').slice(0,70),
    placement:row.placement,country_code:row.country_code||'',
    action:row.placement==='game'?'games':'none',
    active:Number(row.active)===1,sort_order:Number(row.sort_order)||0,
    image_url:Number(row.image_bytes)>0&&Number.isSafeInteger(version)&&version>0
      ?origin+'/api/v1/room-banners/'+id+'/image?v='+version:null};
}
function dbUnavailable(error){
  return /no such table: sharika_room_banners/i.test(String(error));
}
export async function listRoomBanners(db,origin,country=''){
  const code=validCountry(country)?country:'';
  try{
    const data=await db.prepare(
      'SELECT id,title,placement,country_code,action,sort_order,active,image_bytes,image_version '+
      'FROM sharika_room_banners WHERE active=1 AND image_bytes>0 '+
      "AND (country_code='' OR country_code=?) "+
      'ORDER BY CASE WHEN country_code=? THEN 0 ELSE 1 END,sort_order,id LIMIT 12'
    ).bind(code,code).all();
    return (data.results||[]).map(row=>view(row,origin));
  }catch(error){if(dbUnavailable(error))return [];throw error;}
}
async function readText(request,maxBytes){
  if(Number(request.headers.get('content-length')||0)>maxBytes)return null;
  const reader=request.body?.getReader();
  if(!reader)return '';
  const decoder=new TextDecoder();
  let result='',bytes=0;
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    bytes+=value.byteLength;
    if(bytes>maxBytes){await reader.cancel();return null;}
    result+=decoder.decode(value,{stream:true});
  }
  return result+decoder.decode();
}
export async function handleRoomBannerAdmin({request,db,uid,role,operation,reply,fail,cors}){
  const root=operation==='room-banners';
  const match=/^room-banners\/([1-9][0-9]{0,8})(\/image)?$/.exec(operation);
  if(!root&&!match)return null;
  const origin=new URL(request.url).origin;
  if(root&&request.method==='GET'){
    const all=await db.prepare(
      'SELECT id,title,placement,country_code,action,sort_order,active,image_bytes,image_version '+
      'FROM sharika_room_banners ORDER BY placement,country_code,sort_order,id LIMIT 100'
    ).all();
    return reply({banners:(all.results||[]).map(row=>view(row,origin)),
      read_only:role!=='super'},200,cors);
  }
  if(role!=='super')return fail('admin_permission_denied',403,cors);
  if(root&&request.method==='POST'){
    const raw=await readText(request,4096);
    if(raw===null)return fail('room_banner_body_too_large',413,cors);
    let body;
    try{body=JSON.parse(raw||'{}');}catch{return fail('invalid_room_banner',400,cors);}
    const data=normalize(body,false);
    if(!data)return fail('invalid_room_banner',400,cors);
    const count=await db.prepare('SELECT COUNT(*) AS n FROM sharika_room_banners').first();
    if(Number(count?.n||0)>=100)return fail('room_banner_catalog_full',409,cors);
    const results=await db.batch([
      db.prepare('INSERT INTO sharika_room_banners('+
        'title,placement,country_code,action,sort_order,active) VALUES(?,?,?,?,?,0)')
        .bind(data.title,data.placement,data.country_code,data.action,data.sort_order),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'room_banner_create',JSON.stringify({
          placement:data.placement,country_code:data.country_code,title:data.title}))
    ]);
    return reply({created:true,id:results[0]?.meta?.last_row_id||null,
      upload_required:true},201,cors);
  }
  if(!match)return fail('admin_method_not_allowed',405,cors);
  const id=Number(match[1]);
  const row=await db.prepare(
    'SELECT id,placement,image_bytes FROM sharika_room_banners WHERE id=?'
  ).bind(id).first();
  if(!row)return fail('room_banner_not_found',404,cors);
  if(match[2]==='/image'){
    if(request.method==='DELETE'){
      await db.batch([
        db.prepare("UPDATE sharika_room_banners SET image_base64='',image_bytes=0,"+
          "image_version=MIN(image_version+1,1000000000),active=0,updated_at=datetime('now') WHERE id=?")
          .bind(id),
        db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
          .bind(uid,'room_banner_image_remove',JSON.stringify({banner_id:id}))
      ]);
      return reply({removed:true,id},200,cors);
    }
    if(request.method!=='PUT')return fail('admin_method_not_allowed',405,cors);
    const raw=await readText(request,500000);
    if(raw===null)return fail('room_banner_image_too_large',413,cors);
    let body;
    try{body=JSON.parse(raw||'{}');}catch{return fail('invalid_room_banner_image',400,cors);}
    if(!body||Object.keys(body).length!==1||typeof body.image_data!=='string'||
       !body.image_data.startsWith('data:image/jpeg;base64,'))
      return fail('invalid_room_banner_image',400,cors);
    const b64=body.image_data.slice('data:image/jpeg;base64,'.length);
    if(b64.length<16||b64.length>480000||!/^[A-Za-z0-9+/]+={0,2}$/.test(b64))
      return fail('invalid_room_banner_image',400,cors);
    let binary;
    try{binary=atob(b64);}catch{return fail('invalid_room_banner_image',400,cors);}
    if(binary.length<16||binary.length>360000||binary.charCodeAt(0)!==255||
       binary.charCodeAt(1)!==216||binary.charCodeAt(2)!==255||
       binary.charCodeAt(binary.length-2)!==255||
       binary.charCodeAt(binary.length-1)!==217)
      return fail('invalid_room_banner_image',400,cors);
    await db.batch([
      db.prepare('UPDATE sharika_room_banners SET image_base64=?,image_bytes=?,'+
        "image_version=MIN(image_version+1,1000000000),updated_at=datetime('now') WHERE id=?")
        .bind(b64,binary.length,id),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'room_banner_image_upload',JSON.stringify({banner_id:id,bytes:binary.length}))
    ]);
    return reply({uploaded:true,id},200,cors);
  }
  if(request.method!=='PATCH')return fail('admin_method_not_allowed',405,cors);
  const raw=await readText(request,4096);
  if(raw===null)return fail('room_banner_body_too_large',413,cors);
  let body;
  try{body=JSON.parse(raw||'{}');}catch{return fail('invalid_room_banner',400,cors);}
  const changes=normalize(body,true);
  if(!changes)return fail('invalid_room_banner',400,cors);
  if(changes.active===1&&Number(row.image_bytes)<=0)
    return fail('room_banner_image_required',409,cors);
  const placement=changes.placement||row.placement;
  changes.action=placement==='game'?'games':'none';
  const keys=Object.keys(changes);
  await db.batch([
    db.prepare('UPDATE sharika_room_banners SET '+
      keys.map(key=>key+'=?').join(',')+",updated_at=datetime('now') WHERE id=?")
      .bind(...keys.map(key=>changes[key]),id),
    db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
      .bind(uid,'room_banner_update',JSON.stringify({banner_id:id,fields:keys}))
  ]);
  return reply({updated:true,id},200,cors);
}
