// Shared room wallpapers. Admin uploads use the existing checked R2 Media
// Studio; D1 stores only a stable public media path, never file bytes.
const CATALOG=/^catalog:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
const MEDIA=/^\/api\/v1\/media\/([a-f0-9-]{36})\.(png|jpg|webp)$/;

export const isCatalogTheme=value=>typeof value==='string'&&CATALOG.test(value);

export async function catalogWallpaper(db,theme,origin){
  const match=CATALOG.exec(theme||'');
  if(!match)return null;
  const item=await db.prepare(
    'SELECT media_path FROM sharika_room_theme_catalog WHERE id=?'
  ).bind(match[1]).first();
  return item?.media_path&&MEDIA.test(item.media_path)
    ?origin+item.media_path:null;
}

export async function selectableCatalogTheme(db,theme){
  const match=CATALOG.exec(theme||'');
  if(!match)return false;
  const item=await db.prepare(
    'SELECT 1 AS allowed FROM sharika_room_theme_catalog WHERE id=? AND active=1'
  ).bind(match[1]).first();
  return Number(item?.allowed)===1;
}

function serial(row,origin){
  return {key:'catalog:'+row.id,name:row.name,
    image_url:origin+row.media_path,active:!!row.active,
    sort_order:Number(row.sort_order)||0};
}

export async function publicRoomThemes({request,env,cors,reply,fail}){
  if(request.method!=='GET')return fail('method_not_allowed',405,cors);
  const rows=await env.DB.prepare(
    'SELECT id,name,media_path,active,sort_order FROM sharika_room_theme_catalog '+
    'WHERE active=1 ORDER BY sort_order,name LIMIT 100'
  ).all();
  return reply({themes:(rows.results||[]).map(row=>serial(row,new URL(request.url).origin))},200,cors);
}

export async function adminRoomThemes({request,env,uid,role,operation,cors,reply,fail}){
  if(!['super','support'].includes(role))return fail('admin_permission_denied',403,cors);
  const origin=new URL(request.url).origin;
  if(request.method==='GET'&&operation==='room-themes'){
    const rows=await env.DB.prepare(
      'SELECT id,name,media_path,active,sort_order FROM sharika_room_theme_catalog '+
      'ORDER BY sort_order,name LIMIT 150'
    ).all();
    return reply({themes:(rows.results||[]).map(row=>serial(row,origin))},200,cors);
  }
  if(role!=='super')return fail('admin_permission_denied',403,cors);
  if(!['POST','PATCH'].includes(request.method))return fail('method_not_allowed',405,cors);
  const id=operation==='room-themes'?null:operation.slice('room-themes/'.length);
  if((request.method==='POST'&&id)||(request.method==='PATCH'&&
      !CATALOG.test('catalog:'+id)))return fail('invalid_room_theme_id',400,cors);
  const raw=await request.text();
  if(raw.length>3000)return fail('room_theme_input_too_large',413,cors);
  let data;
  try{data=JSON.parse(raw||'{}');}catch{return fail('invalid_room_theme',400,cors);}
  if(!data||typeof data!=='object'||Array.isArray(data))
    return fail('invalid_room_theme',400,cors);
  const name=typeof data.name==='string'?data.name.trim():null;
  const order=data.sort_order;
  if((name!==null&&(name.length<1||name.length>60))||
     (order!==undefined&&(!Number.isInteger(order)||order<0||order>10000))||
     (data.active!==undefined&&typeof data.active!=='boolean'))
    return fail('invalid_room_theme',400,cors);
  let mediaPath=null;
  if(data.image_url!==undefined){
    try{
      const parsed=new URL(data.image_url);
      if(parsed.origin!==origin||parsed.search||parsed.hash||
         !MEDIA.test(parsed.pathname))return fail('invalid_room_theme_image',400,cors);
      mediaPath=parsed.pathname;
    }catch{return fail('invalid_room_theme_image',400,cors);}
    if(!env.MEDIA_BUCKET)return fail('media_storage_not_configured',503,cors);
    const key='studio/'+mediaPath.slice('/api/v1/media/'.length);
    const file=await env.MEDIA_BUCKET.head(key);
    if(!file||!String(file.httpMetadata?.contentType||'').startsWith('image/'))
      return fail('room_theme_image_not_uploaded',404,cors);
  }
  if(request.method==='POST'){
    if(!name||!mediaPath)return fail('room_theme_name_and_image_required',400,cors);
    const newId=crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO sharika_room_theme_catalog(id,name,media_path,active,sort_order,added_by_uid) '+
      'VALUES(?,?,?,?,?,?)'
    ).bind(newId,name,mediaPath,data.active===false?0:1,order||0,uid).run();
    await env.DB.prepare(
      'INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)'
    ).bind(uid,'room_theme_create',JSON.stringify({id:newId,name})).run();
    return reply({key:'catalog:'+newId,created:true},201,cors);
  }
  const result=await env.DB.prepare(
    'UPDATE sharika_room_theme_catalog SET name=COALESCE(?,name),'+
    'media_path=COALESCE(?,media_path),active=COALESCE(?,active),'+
    'sort_order=COALESCE(?,sort_order),updated_at=datetime(\'now\') WHERE id=?'
  ).bind(name,mediaPath,data.active===undefined?null:Number(data.active),
    order===undefined?null:order,id).run();
  if(!result.meta?.changes)return fail('room_theme_not_found',404,cors);
  await env.DB.prepare(
    'INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)'
  ).bind(uid,'room_theme_update',JSON.stringify({id,active:data.active})).run();
  return reply({key:'catalog:'+id,updated:true},200,cors);
}
