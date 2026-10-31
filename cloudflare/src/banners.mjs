// Verified, non-financial home banners controlled only by Sharika Super Admin.
const ACTIONS=new Set(['none','daily','recharge','rank','invite']);
const COLORS=/^#[0-9a-fA-F]{6}$/;
const BANNER_FIELDS=new Set(['title','subtitle','emoji','color_a','color_b','action','sort_order','active']);
function rowView(row){
  return {id:Number(row.id),title:row.title,subtitle:row.subtitle||'',
    emoji:row.emoji||'🎉',color_a:row.color_a,color_b:row.color_b,
    action:row.action||'none',sort_order:Number(row.sort_order)||0,active:!!row.active};
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
export async function listPublicBanners(db){
  const rows=await db.prepare(
    'SELECT id,title,subtitle,emoji,color_a,color_b,action,sort_order,active '+
    'FROM sharika_banners WHERE active=1 ORDER BY sort_order,id LIMIT 10'
  ).all();
  return (rows.results||[]).map(rowView);
}
export async function handleBannerAdmin({request,env,uid,role,operation,cors,reply,fail}){
  const path=operation==='banners';
  const update=/^banners\/([1-9][0-9]{0,8})$/.exec(operation);
  if(!path&&!update)return null;
  if(request.method==='GET'&&path){
    const rows=await env.DB.prepare(
      'SELECT id,title,subtitle,emoji,color_a,color_b,action,sort_order,active '+
      'FROM sharika_banners ORDER BY sort_order,id LIMIT 100'
    ).all();
    return reply({banners:(rows.results||[]).map(rowView),read_only:role!=='super'},200,cors);
  }
  if(role!=='super')return fail('admin_permission_denied',403,cors);
  if(!(path&&request.method==='POST')&&!(update&&request.method==='PATCH'))
    return fail('admin_method_not_allowed',405,cors);
  const length=Number(request.headers.get('content-length')||0);
  if(length>4096)return fail('banner_body_too_large',413,cors);
  const raw=await request.text();
  if(raw.length>4096)return fail('banner_body_too_large',413,cors);
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
