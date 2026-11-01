// Verified, admin-managed public alias. Permanent public_no/auth_uid never change.
const PREFIX='/api/v1/admin/special-ids';
const PUBLIC_ID=/^[0-9]{8}$/;
const SPECIAL_ID=/^[0-9]{4,7}$/;
const validDays=new Set([7,30,90]);
const fmt=no=>String(no).padStart(8,'0');

export const activeSpecialSelect=(userAlias='u')=>
  "(SELECT si.special_id FROM sharika_special_ids si WHERE si.auth_uid="+userAlias+
  ".auth_uid AND (si.expires_at IS NULL OR si.expires_at>datetime('now')) LIMIT 1) AS special_id";

export async function activeSpecial(db,authUid){
  return db.prepare("SELECT special_id,frame,expires_at FROM sharika_special_ids "+
    "WHERE auth_uid=? AND (expires_at IS NULL OR expires_at>datetime('now'))")
    .bind(authUid).first();
}

const resultRow=row=>({
  public_id:fmt(row.public_no),name:row.name,pic:row.pic||null,
  country:row.country||'',status:row.status,
  special_id:row.special_id||null,frame:row.frame||null,
  expires_at:row.expires_at||null
});

export async function handleSpecialAdmin({request,env,uid,actor,operation,cors,reply,fail}){
  if(!operation.startsWith('special-ids'))return null;
  if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
  const url=new URL(request.url),db=env.DB;
  if(operation==='special-ids/availability'&&request.method==='GET'){
    const value=url.searchParams.get('value')||'';
    if(!SPECIAL_ID.test(value))return fail('special_id_must_be_4_to_7_digits',400,cors);
    const reserved=await db.prepare(
      'SELECT 1 FROM sharika_special_ids WHERE special_id=? LIMIT 1'
    ).bind(value).first();
    return reply({special_id:value,available:!reserved},200,cors);
  }
  if(operation==='special-ids'&&request.method==='GET'){
    const q=(url.searchParams.get('q')||'').trim().slice(0,64);
    const query=q.toLowerCase();
    const rows=await db.prepare(
      'SELECT u.public_no,u.name,u.pic,u.country,u.status,s.special_id,s.frame,s.expires_at '+
      'FROM sharika_users u LEFT JOIN sharika_special_ids s ON s.auth_uid=u.auth_uid '+
      'WHERE (?=\'\' OR CAST(u.public_no AS TEXT)=? OR lower(u.name) LIKE ? OR s.special_id=?) '+
      'ORDER BY u.created_at DESC LIMIT 40'
    ).bind(query,query,'%'+query+'%',query).all();
    return reply({users:(rows.results||[]).map(resultRow),read_only:true},200,cors);
  }
  const revoke=/^special-ids\/([0-9]{8})\/revoke$/.exec(operation);
  if(revoke&&request.method==='PATCH'){
    const person=await db.prepare('SELECT auth_uid FROM sharika_users WHERE public_no=?')
      .bind(Number(revoke[1])).first();
    if(!person)return fail('user_not_found',404,cors);
    const existing=await db.prepare('SELECT special_id FROM sharika_special_ids WHERE auth_uid=?')
      .bind(person.auth_uid).first();
    if(!existing)return fail('special_id_not_found',404,cors);
    await db.batch([
      db.prepare('DELETE FROM sharika_special_ids WHERE auth_uid=?').bind(person.auth_uid),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'special_id_revoke',JSON.stringify({public_id:revoke[1],special_id:existing.special_id}))
    ]);
    return reply({revoked:true,public_id:revoke[1]},200,cors);
  }
  if(operation==='special-ids'&&request.method==='POST'){
    let body;
    try{
      const raw=await request.text();
      if(raw.length>2048)return fail('special_id_body_too_large',413,cors);
      body=JSON.parse(raw||'{}');
    }catch(_){return fail('invalid_special_id_json',400,cors);}
    if(!body||typeof body!=='object'||Array.isArray(body))
      return fail('invalid_special_id_body',400,cors);
    const publicNo=String(body.public_id||'');
    const specialId=String(body.special_id||'');
    const days=body.duration_days===null?null:Number(body.duration_days);
    if(!PUBLIC_ID.test(publicNo)||!SPECIAL_ID.test(specialId)||
       (days!==null&&!validDays.has(days))||body.frame!=='neon')
      return fail('invalid_special_id_assignment',400,cors);
    const person=await db.prepare('SELECT auth_uid,status FROM sharika_users WHERE public_no=?')
      .bind(Number(publicNo)).first();
    if(!person)return fail('user_not_found',404,cors);
    if(person.status!=='active')return fail('user_not_active',409,cors);
    const existing=await db.prepare('SELECT auth_uid FROM sharika_special_ids WHERE special_id=?')
      .bind(specialId).first();
    if(existing&&existing.auth_uid!==person.auth_uid)
      return fail('special_id_already_reserved',409,cors);
    const expiresAt=days===null?null:new Date(Date.now()+days*86400000)
      .toISOString().slice(0,19).replace('T',' ');
    try{
      await db.batch([
        db.prepare(
          'INSERT INTO sharika_special_ids(auth_uid,special_id,frame,expires_at,assigned_by) '+
          'VALUES(?,?,?,?,?) ON CONFLICT(auth_uid) DO UPDATE SET '+
          'special_id=excluded.special_id,frame=excluded.frame,'+
          'expires_at=excluded.expires_at,assigned_by=excluded.assigned_by,'+
          "updated_at=datetime('now')"
        ).bind(person.auth_uid,specialId,'neon',expiresAt,uid),
        db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
          .bind(uid,'special_id_assign',JSON.stringify({
            public_id:publicNo,special_id:specialId,duration_days:days,frame:'neon'
          }))
      ]);
    }catch(error){
      if(/UNIQUE|constraint/i.test(String(error?.message||'')))
        return fail('special_id_already_reserved',409,cors);
      throw error;
    }
    return reply({assigned:true,public_id:publicNo,special_id:specialId,
      display_id:specialId,frame:'neon',expires_at:expiresAt},200,cors);
  }
  return fail('special_id_method_not_allowed',405,cors);
}
