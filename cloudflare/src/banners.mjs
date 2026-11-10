// Verified, non-financial home banners controlled only by Sharika Super Admin.
const ACTIONS=new Set(['none','daily','recharge','rank','invite','events']);
const COLORS=/^#[0-9a-fA-F]{6}$/;
const BANNER_FIELDS=new Set(['title','subtitle','emoji','color_a','color_b','action','sort_order','active']);
async function readLimitedText(request,maximum){
  if(Number(request.headers.get('content-length')||0)>maximum)return null;
  if(!request.body)return '';
  const reader=request.body.getReader();
  const decoder=new TextDecoder();
  let bytes=0,raw='';
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    bytes+=value.byteLength;
    if(bytes>maximum){await reader.cancel();return null;}
    raw+=decoder.decode(value,{stream:true});
  }
  return raw+decoder.decode();
}
function rowView(row,origin=''){
  const id=Number(row.id),version=Number(row.image_version)||0;
  return {id:Number(row.id),title:row.title,subtitle:row.subtitle||'',
    emoji:row.emoji||'🎉',color_a:row.color_a,color_b:row.color_b,
    action:row.action||'none',sort_order:Number(row.sort_order)||0,active:!!row.active,
    image_url:origin&&Number.isSafeInteger(id)&&id>0&&
      Number.isSafeInteger(version)&&version>0
      ?origin+'/api/v1/banners/'+id+'/image?v='+version:null};
}
export function normalizeBannerInput(value,partial=false){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  if(Object.keys(value).some(key=>!BANNER_FIELDS.has(key)))return null;
  if(!partial&&typeof value.title!=='string')return null;
  const out={};
  for(const field of ['title','subtitle','emoji']){
    if(value[field]===undefined)continue;
    if(typeof value[field]!=='string')return null;
    const clean=value[field].trim();
    if((field==='title'&&(!clean||clean.length>80))||
       (field==='subtitle'&&clean.length>160)||
       (field==='emoji'&&clean.length>12))return null;
    out[field]=clean;
  }
  for(const field of ['color_a','color_b']){
    if(value[field]===undefined)continue;
    if(typeof value[field]!=='string'||!COLORS.test(value[field]))return null;
    out[field]=value[field];
  }
  if(value.action!==undefined){
    if(typeof value.action!=='string'||!ACTIONS.has(value.action))return null;
    out.action=value.action;
  }
  if(value.sort_order!==undefined){
    if(!Number.isSafeInteger(value.sort_order)||value.sort_order<0||value.sort_order>100)return null;
    out.sort_order=value.sort_order;
  }
  if(value.active!==undefined){
    if(typeof value.active!=='boolean')return null;
    out.active=value.active?1:0;
  }
  if(!Object.keys(out).length)return null;
  if(!partial)return {title:out.title,subtitle:out.subtitle||'',emoji:out.emoji||'🎉',
    color_a:out.color_a||'#9b4dff',color_b:out.color_b||'#ff3dc8',
    action:out.action||'none',sort_order:out.sort_order||0,active:out.active||0};
  return out;
}
async function bannerRows(db,publicOnly){
  const columns='b.id,b.title,b.subtitle,b.emoji,b.color_a,b.color_b,'+
    'b.action,b.sort_order,b.active';
  const where=publicOnly?' WHERE b.active=1':'';
  const limit=publicOnly?10:100;
  try{
    return await db.prepare('SELECT '+columns+
      ',CASE WHEN i.image_bytes>0 THEN i.version ELSE 0 END AS image_version '+
      'FROM sharika_banners b LEFT JOIN sharika_banner_images i ON i.banner_id=b.id'+
      where+' ORDER BY b.sort_order,b.id LIMIT '+limit).all();
  }catch(error){
    // Existing deployments continue serving text banners until the migration runs.
    if(!/no such table: sharika_banner_images/i.test(String(error)))throw error;
    return db.prepare('SELECT id,title,subtitle,emoji,color_a,color_b,action,sort_order,active '+
      'FROM sharika_banners'+(publicOnly?' WHERE active=1':'')+
      ' ORDER BY sort_order,id LIMIT '+limit).all();
  }
}
export async function listPublicBanners(db,origin=''){
  const rows=await bannerRows(db,true);
  return (rows.results||[]).map(row=>rowView(row,origin));
}
export async function handleBannerAdmin({request,env,uid,role,operation,cors,reply,fail}){
  const path=operation==='banners';
  const update=/^banners\/([1-9][0-9]{0,8})$/.exec(operation);
  const image=/^banners\/([1-9][0-9]{0,8})\/image$/.exec(operation);
  if(!path&&!update&&!image)return null;
  if(request.method==='GET'&&path){
    const rows=await bannerRows(env.DB,false);
    const origin=new URL(request.url).origin;
    return reply({banners:(rows.results||[]).map(row=>rowView(row,origin)),
      read_only:role!=='super'},200,cors);
  }
  if(role!=='super')return fail('admin_permission_denied',403,cors);
  if(image){
    if(request.method!=='PUT'&&request.method!=='DELETE')
      return fail('admin_method_not_allowed',405,cors);
    const bannerId=Number(image[1]);
    const exists=await env.DB.prepare('SELECT id FROM sharika_banners WHERE id=?')
      .bind(bannerId).first();
    if(!exists)return fail('banner_not_found',404,cors);
    if(request.method==='DELETE'){
      await env.DB.batch([
        env.DB.prepare('UPDATE sharika_banner_images SET image_base64=\'\','+
          'image_bytes=0,version=MIN(version+1,1000000000),'+
          "updated_at=datetime('now') WHERE banner_id=?").bind(bannerId),
        env.DB.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
          .bind(uid,'banner_image_remove',JSON.stringify({banner_id:bannerId}))
      ]);
      return reply({removed:true,id:bannerId},200,cors);
    }
    const raw=await readLimitedText(request,500000);
    if(raw===null)return fail('banner_image_too_large',413,cors);
    let body;
    try{body=JSON.parse(raw||'{}');}catch(_){return fail('invalid_banner_image',400,cors);}
    if(!body||Object.keys(body).length!==1||
       typeof body.image_data!=='string'||
       !body.image_data.startsWith('data:image/jpeg;base64,'))
      return fail('invalid_banner_image',400,cors);
    const base64=body.image_data.slice('data:image/jpeg;base64,'.length);
    if(base64.length<16||base64.length>480000||
       !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
      return fail('invalid_banner_image',400,cors);
    let binary;
    try{binary=atob(base64);}catch(_){return fail('invalid_banner_image',400,cors);}
    if(binary.length<16||binary.length>360000||
       binary.charCodeAt(0)!==255||binary.charCodeAt(1)!==216||
       binary.charCodeAt(2)!==255||
       binary.charCodeAt(binary.length-2)!==255||
       binary.charCodeAt(binary.length-1)!==217)
      return fail('invalid_banner_image',400,cors);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sharika_banner_images("+
        "banner_id,mime,image_base64,image_bytes) VALUES(?,'image/jpeg',?,?) "+
        'ON CONFLICT(banner_id) DO UPDATE SET image_base64=excluded.image_base64,'+
        'image_bytes=excluded.image_bytes,version=MIN(version+1,1000000000),'+
        "updated_at=datetime('now')").bind(bannerId,base64,binary.length),
      env.DB.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'banner_image_upload',JSON.stringify({banner_id:bannerId,bytes:binary.length}))
    ]);
    const saved=await env.DB.prepare('SELECT version FROM sharika_banner_images WHERE banner_id=?')
      .bind(bannerId).first();
    return reply({uploaded:true,id:bannerId,version:saved?.version||1},200,cors);
  }
  if(!(path&&request.method==='POST')&&!(update&&request.method==='PATCH'))
    return fail('admin_method_not_allowed',405,cors);
  const raw=await readLimitedText(request,4096);
  if(raw===null)return fail('banner_body_too_large',413,cors);
  let body;
  try{body=JSON.parse(raw||'{}');}catch(_){return fail('invalid_banner',400,cors);}
  const changes=normalizeBannerInput(body,!!update);
  if(!changes)return fail('invalid_banner',400,cors);
  if(update){
    const bannerId=Number(update[1]);
    const before=await env.DB.prepare('SELECT id FROM sharika_banners WHERE id=?')
      .bind(bannerId).first();
    if(!before)return fail('banner_not_found',404,cors);
    const keys=Object.keys(changes);
    await env.DB.batch([
      env.DB.prepare('UPDATE sharika_banners SET '+
        keys.map(key=>key+'=?').join(',')+",updated_at=datetime('now') WHERE id=?")
        .bind(...keys.map(key=>changes[key]),bannerId),
      env.DB.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'banner_update',JSON.stringify({banner_id:bannerId,fields:keys}))
    ]);
    return reply({updated:true,id:bannerId},200,cors);
  }
  const result=await env.DB.batch([
    env.DB.prepare('INSERT INTO sharika_banners(title,subtitle,emoji,color_a,color_b,action,sort_order,active) '+
      'VALUES(?,?,?,?,?,?,?,?)')
      .bind(changes.title,changes.subtitle,changes.emoji,changes.color_a,changes.color_b,
        changes.action,changes.sort_order,changes.active),
    env.DB.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
      .bind(uid,'banner_create',JSON.stringify({title:changes.title,active:changes.active}))
  ]);
  return reply({created:true,id:result[0]?.meta?.last_row_id||null},201,cors);
}
