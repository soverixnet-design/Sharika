// Admin-curated backgrounds have no relationship to the room-card cover or
// user profile photo. Only versioned JPEGs are published; inactive artwork
// remains readable for rooms that selected it before it was unpublished.
const MAX_THEMES=100;
const FIELDS=new Set(['name','sort_order','active']);
const ID=/^[1-9][0-9]{0,8}$/;

async function limitedText(request,maxBytes){
  if(Number(request.headers.get('content-length')||0)>maxBytes)return null;
  if(!request.body)return '';
  const reader=request.body.getReader();
  const decoder=new TextDecoder();
  let bytes=0,raw='';
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    bytes+=value.byteLength;
    if(bytes>maxBytes){await reader.cancel();return null;}
    raw+=decoder.decode(value,{stream:true});
  }
  return raw+decoder.decode();
}
function normalizeInput(body,partial=false){
  if(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).some(k=>!FIELDS.has(k)))return null;
  const changes={};
  if(body.name!==undefined){
    if(typeof body.name!=='string')return null;
    const name=body.name.trim();
    if(!name||name.length>60)return null;
    changes.name=name;
  }
  if(body.sort_order!==undefined){
    if(!Number.isSafeInteger(body.sort_order)||body.sort_order<0||body.sort_order>10000)
      return null;
    changes.sort_order=body.sort_order;
  }
  if(body.active!==undefined){
    if(typeof body.active!=='boolean')return null;
    changes.active=body.active?1:0;
  }
  if(!Object.keys(changes).length||(!partial&&!changes.name))return null;
  return changes;
}
function view(row,origin){
  const id=Number(row.id),version=Number(row.image_version)||0;
  return {id,name:row.name,sort_order:Number(row.sort_order)||0,
    active:!!row.active,image_url:row.image_bytes>0&&version>0
      ?origin+'/api/v1/room-themes/'+id+'/image?v='+version:null};
}
export function roomThemeId(value){
  const match=/^catalog:([1-9][0-9]{0,8})$/.exec(String(value||''));
  return match?Number(match[1]):null;
}
export async function listRoomThemes(db,origin,publicOnly=true){
  const sql='SELECT id,name,sort_order,active,image_bytes,image_version '+
    'FROM sharika_room_theme_catalog '+
    (publicOnly?'WHERE active=1 AND image_bytes>0 ':'')+
    'ORDER BY sort_order,id LIMIT '+MAX_THEMES;
  const rows=await db.prepare(sql).all();
  return (rows.results||[]).map(row=>view(row,origin));
}
export async function catalogThemeImage(db,id,origin){
  if(!Number.isSafeInteger(id)||id<1)return null;
  const row=await db.prepare(
    'SELECT image_bytes,image_version FROM sharika_room_theme_catalog WHERE id=?'
  ).bind(id).first();
  return row?.image_bytes>0&&row.image_version>0
    ?origin+'/api/v1/room-themes/'+id+'/image?v='+row.image_version:null;
}
export async function validateCatalogTheme(db,id,activeOnly=true){
  const row=await db.prepare(
    'SELECT active,image_bytes FROM sharika_room_theme_catalog WHERE id=?'
  ).bind(id).first();
  return !!(row?.image_bytes>0&&(!activeOnly||row.active===1));
}
export async function handleRoomThemeAdmin({request,db,uid,role,operation,cors,reply,fail}){
  const root=operation==='room-themes';
  const match=/^room-themes\/([1-9][0-9]{0,8})(\/image)?$/.exec(operation);
  if(!root&&!match)return null;
  const origin=new URL(request.url).origin;
  if(root&&request.method==='GET'){
    const themes=await listRoomThemes(db,origin,false);
    return reply({themes,read_only:role!=='super'},200,cors);
  }
  if(role!=='super')return fail('admin_permission_denied',403,cors);
  const id=match?Number(match[1]):null;
  if(match){
    const existing=await db.prepare('SELECT id,image_bytes FROM sharika_room_theme_catalog WHERE id=?')
      .bind(id).first();
    if(!existing)return fail('room_theme_not_found',404,cors);
  }
  if(match?.[2]==='/image'){
    if(request.method!=='PUT')return fail('admin_method_not_allowed',405,cors);
    const raw=await limitedText(request,500000);
    if(raw===null)return fail('room_theme_image_too_large',413,cors);
    let body;
    try{body=JSON.parse(raw||'{}');}catch(_){return fail('invalid_room_theme_image',400,cors);}
    if(!body||Object.keys(body).length!==1||
        typeof body.image_data!=='string'||
        !body.image_data.startsWith('data:image/jpeg;base64,'))
      return fail('invalid_room_theme_image',400,cors);
    const b64=body.image_data.slice('data:image/jpeg;base64,'.length);
    if(b64.length<16||b64.length>480000||!/^[A-Za-z0-9+/]+={0,2}$/.test(b64))
      return fail('invalid_room_theme_image',400,cors);
    let binary;
    try{binary=atob(b64);}catch(_){return fail('invalid_room_theme_image',400,cors);}
    if(binary.length<16||binary.length>360000||
       binary.charCodeAt(0)!==255||binary.charCodeAt(1)!==216||
       binary.charCodeAt(2)!==255||binary.charCodeAt(binary.length-2)!==255||
       binary.charCodeAt(binary.length-1)!==217)
      return fail('invalid_room_theme_image',400,cors);
    await db.batch([
      db.prepare('UPDATE sharika_room_theme_catalog SET image_base64=?,image_bytes=?,'+
        "image_version=MIN(image_version+1,1000000000),updated_at=datetime('now') "+
        'WHERE id=?').bind(b64,binary.length,id),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'room_theme_image_upload',JSON.stringify({theme_id:id,bytes:binary.length}))
    ]);
    return reply({uploaded:true,id},200,cors);
  }
  if(root&&request.method==='POST'){
    const raw=await limitedText(request,4096);
    if(raw===null)return fail('room_theme_body_too_large',413,cors);
    let body;
    try{body=JSON.parse(raw||'{}');}catch(_){return fail('invalid_room_theme',400,cors);}
    const value=normalizeInput(body);
    if(!value)return fail('invalid_room_theme',400,cors);
    const count=await db.prepare('SELECT COUNT(*) AS count FROM sharika_room_theme_catalog').first();
    if(Number(count?.count)>=MAX_THEMES)return fail('room_theme_catalog_full',409,cors);
    const result=await db.batch([
      db.prepare('INSERT INTO sharika_room_theme_catalog(name,sort_order,active) VALUES(?,?,0)')
        .bind(value.name,value.sort_order||0),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'room_theme_create',JSON.stringify({name:value.name}))
    ]);
    return reply({created:true,id:result[0]?.meta?.last_row_id||null,
      upload_required:true},201,cors);
  }
  if(match&&!match[2]&&request.method==='PATCH'){
    const raw=await limitedText(request,4096);
    if(raw===null)return fail('room_theme_body_too_large',413,cors);
    let body;
    try{body=JSON.parse(raw||'{}');}catch(_){return fail('invalid_room_theme',400,cors);}
    const changes=normalizeInput(body,true);
    if(!changes)return fail('invalid_room_theme',400,cors);
    if(changes.active===1&&!await validateCatalogTheme(db,id,false))
      return fail('room_theme_image_required',409,cors);
    const keys=Object.keys(changes);
    await db.batch([
      db.prepare('UPDATE sharika_room_theme_catalog SET '+keys.map(k=>k+'=?').join(',')+
        ",updated_at=datetime('now') WHERE id=?")
        .bind(...keys.map(k=>changes[k]),id),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'room_theme_update',JSON.stringify({theme_id:id,fields:keys}))
    ]);
    return reply({updated:true,id},200,cors);
  }
  return fail('admin_method_not_allowed',405,cors);
}
