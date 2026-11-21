// Country Management is Super Admin-only. User locations stay on the existing
// audited /admin/location endpoint; this module manages country-level content.
const COUNTRY=/^[A-Z]{2}$/;
const ROOM=/^[0-9]{8}$/;

export async function handleCountryAdmin({request,db,uid,role,operation,reply,fail,cors}) {
  if(role!=='super')return fail('admin_permission_denied',403,cors);
  const match=/^countries(?:\/([A-Z]{2}))?$/.exec(operation);
  if(!match)return fail('invalid_country_route',404,cors);
  if(request.method==='GET' && !match[1]){
    // Distinguish registered users from room owners. These are saved counts,
    // not live presence numbers or fabricated country statistics.
    const [users,rooms,settings]=await Promise.all([
      db.prepare("SELECT UPPER(TRIM(country)) AS country_code,COUNT(*) AS user_count FROM sharika_users WHERE status='active' AND length(trim(country))=2 GROUP BY UPPER(TRIM(country))").all(),
      db.prepare("SELECT UPPER(TRIM(u.country)) AS country_code,COUNT(*) AS room_count FROM sharika_rooms r JOIN sharika_users u ON u.auth_uid=r.owner_id WHERE u.status='active' AND length(trim(u.country))=2 GROUP BY UPPER(TRIM(u.country))").all(),
      db.prepare('SELECT country_code,pinned_room_id,notice,revision,updated_at FROM sharika_country_settings ORDER BY country_code').all()
    ]);
    const entries=new Map();
    const get=code=>{
      if(!COUNTRY.test(code))return null;
      if(!entries.has(code))entries.set(code,{
        country_code:code,user_count:0,room_count:0,
        pinned_room_id:'',notice:'',revision:0,updated_at:null
      });
      return entries.get(code);
    };
    for(const row of users.results||[]){const item=get(row.country_code);if(item)item.user_count=Number(row.user_count)||0;}
    for(const row of rooms.results||[]){const item=get(row.country_code);if(item)item.room_count=Number(row.room_count)||0;}
    for(const row of settings.results||[]){
      const item=get(row.country_code);
      if(item)Object.assign(item,{pinned_room_id:row.pinned_room_id||'',notice:row.notice||'',
        revision:Number(row.revision)||0,updated_at:row.updated_at});
    }
    return reply({countries:[...entries.values()].sort((a,b)=>a.country_code.localeCompare(b.country_code)),
      source:'verified_d1',can_edit:true},200,cors);
  }
  if(request.method!=='PUT'||!match[1])return fail('method_not_allowed',405,cors);
  const country=match[1];
  let body;
  try{const raw=await request.text();if(raw.length>1500)return fail('country_settings_too_large',400,cors);body=JSON.parse(raw);}
  catch{return fail('invalid_country_settings',400,cors);}
  if(!body||typeof body!=='object'||Array.isArray(body))return fail('invalid_country_settings',400,cors);
  const pin=body.pinned_room_id==null?'':body.pinned_room_id;
  const notice=body.notice;
  const expected=body.expected_revision;
  if(typeof pin!=='string'||(pin!==''&&!ROOM.test(pin))||
     typeof notice!=='string'||notice.length>280||
     !Number.isSafeInteger(expected)||expected<0)
    return fail('invalid_country_settings',400,cors);
  const nextNotice=notice.trim();
  if(pin){
    const owned=await db.prepare(
      "SELECT r.id FROM sharika_rooms r JOIN sharika_users u ON u.auth_uid=r.owner_id WHERE r.id=? AND u.status='active' AND UPPER(TRIM(u.country))=?"
    ).bind(pin,country).first();
    if(!owned)return fail('country_pinned_room_mismatch',409,cors);
  }
  const prior=await db.prepare(
    'SELECT pinned_room_id,notice,revision FROM sharika_country_settings WHERE country_code=?'
  ).bind(country).first();
  if((prior?Number(prior.revision):0)!==expected)
    return fail('country_settings_conflict',409,cors);
  const next=expected+1;
  let changed;
  if(prior){
    changed=await db.prepare(
      "UPDATE sharika_country_settings SET pinned_room_id=?,notice=?,revision=?,updated_by=?,updated_at=datetime('now') WHERE country_code=? AND revision=?"
    ).bind(pin,nextNotice,next,uid,country,expected).run();
  }else{
    changed=await db.prepare(
      "INSERT INTO sharika_country_settings(country_code,pinned_room_id,notice,revision,updated_by) SELECT ?,?,?,1,? WHERE NOT EXISTS(SELECT 1 FROM sharika_country_settings WHERE country_code=?)"
    ).bind(country,pin,nextNotice,uid,country).run();
  }
  if(!changed.meta?.changes)return fail('country_settings_conflict',409,cors);
  await db.prepare(
    'INSERT INTO sharika_country_settings_audit(country_code,actor_uid,old_pinned_room_id,pinned_room_id,old_notice,notice,revision) VALUES(?,?,?,?,?,?,?)'
  ).bind(country,uid,prior?.pinned_room_id||'',pin,prior?.notice||'',nextNotice,next).run();
  return reply({country_code:country,pinned_room_id:pin,notice:nextNotice,revision:next},200,cors);
}
