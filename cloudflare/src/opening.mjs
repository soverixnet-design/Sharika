// One verified previous-week champion per real app launch. No synthetic users.
const CATEGORIES=[
  ['sending','TOP SENDING'],['recharge','TOP RECHARGE'],['games','TOP GAMES']
];
const PUBLIC_ID=/^[0-9]{8}$/;
const SETTINGS_FIELDS=new Set(['enabled','mode','duration_seconds',
  'custom_user_id','custom_title','custom_subtitle','custom_image_url','expected_version']);
const asId=value=>String(value).padStart(8,'0');
const stamp=date=>date.toISOString().slice(0,19).replace('T',' ');

export function completedWeek(now=new Date()){
  const current=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),
    now.getUTCDate()-(now.getUTCDay()+6)%7));
  const previous=new Date(current.getTime()-7*86400000);
  return {start:stamp(previous),end:stamp(current),week_key:stamp(current).slice(0,10),
    previous_start:previous.toISOString(),previous_end:current.toISOString()};
}

export function validateOpeningSettings(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||
     Object.keys(body).some(key=>!SETTINGS_FIELDS.has(key)))return null;
  const out={};
  if(typeof body.enabled==='boolean')out.enabled=body.enabled?1:0;
  else if(body.enabled!==undefined)return null;
  if(body.mode!==undefined){
    if(!['automatic','custom'].includes(body.mode))return null;
    out.mode=body.mode;
  }
  if(body.duration_seconds!==undefined){
    if(!Number.isSafeInteger(body.duration_seconds)||body.duration_seconds<3||body.duration_seconds>30)
      return null;
    out.duration_seconds=body.duration_seconds;
  }
  for(const [name,max] of [['custom_user_id',8],['custom_title',60],
                            ['custom_subtitle',100],['custom_image_url',500]]){
    if(body[name]===undefined)continue;
    if(typeof body[name]!=='string'||body[name].length>max)return null;
    const value=body[name].trim();
    if(name==='custom_user_id'&&value&&!PUBLIC_ID.test(value))return null;
    if(name==='custom_image_url'&&value){
      let url;
      try{url=new URL(value);}catch(_){return null;}
      if(url.protocol!=='https:'||url.username||url.password||!url.hostname)return null;
    }
    out[name]=value;
  }
  if(!Number.isSafeInteger(body.expected_version)||body.expected_version<1)return null;
  if(!Object.keys(out).length)return null;
  return out;
}

function settingsView(row){
  return {enabled:!!row.enabled,mode:row.mode,duration_seconds:row.duration_seconds,
    custom_user_id:row.custom_user_id||'',custom_title:row.custom_title||'',
    custom_subtitle:row.custom_subtitle||'',custom_image_url:row.custom_image_url||'',
    version:row.version,updated_at:row.updated_at};
}

async function getSettings(db){
  return db.prepare('SELECT * FROM sharika_opening_settings WHERE id=1').first();
}

async function weeklyCandidates(db,week){
  const common='SELECT u.public_no,u.name,u.pic,u.wealth_level,u.charm_level,';
  const good=" JOIN sharika_users u ON u.auth_uid=t.user_uid WHERE u.status='active' ";
  const ending=' GROUP BY t.user_uid ORDER BY total DESC,u.public_no ASC LIMIT 15';
  const sent=common+'SUM(t.coins) AS total FROM '+
    '(SELECT sender_uid AS user_uid,CAST(quantity AS INTEGER)*CAST(price_coins AS INTEGER) AS coins '+
    'FROM sharika_gift_events WHERE created_at>=? AND created_at<?) t'+good+ending;
  const recharge=common+'SUM(t.coins) AS total FROM '+
    "(SELECT auth_uid AS user_uid,delta AS coins FROM sharika_wallet_ledger "+
    "WHERE created_at>=? AND created_at<? AND currency='coins' AND delta>0 "+
    "AND reason IN ('seller_recharge','manual_recharge')) t"+good+ending;
  const games=common+'SUM(t.coins) AS total FROM '+
    '(SELECT user_uid,payout AS coins FROM sharika_original_game_bets '+
    "WHERE settled_at>=? AND settled_at<? AND status='settled' AND payout>0 "+
    'UNION ALL SELECT user_uid,payout AS coins FROM sharika_game_bets '+
    "WHERE settled_at>=? AND settled_at<? AND status='settled' AND payout>0) t"+good+ending;
  const [a,b,c]=await Promise.all([
    db.prepare(sent).bind(week.start,week.end).all(),
    db.prepare(recharge).bind(week.start,week.end).all(),
    db.prepare(games).bind(week.start,week.end,week.start,week.end).all()
  ]);
  const used=new Set(),chosen=[];
  for(const [category,rows] of [a,b,c].entries()){
    const winner=(rows.results||[]).find(row=>Number(row.total)>0&&!used.has(row.public_no));
    if(!winner)continue;
    used.add(winner.public_no);
    chosen.push({category:CATEGORIES[category][0],title:CATEGORIES[category][1],
      public_id:asId(winner.public_no),name:winner.name,pic:winner.pic||null,
      total:Number(winner.total)||0,
      wealth_level:winner.wealth_level,charm_level:winner.charm_level});
  }
  return chosen;
}

export async function handleOpeningApp({request,env,uid,path,cors,reply,fail}){
  if(path!=='/api/v1/opening/next')return null;
  if(request.method!=='POST')return fail('method_not_allowed',405,cors);
  const active=await env.DB.prepare('SELECT 1 FROM sharika_users WHERE auth_uid=? AND status=?')
    .bind(uid,'active').first();
  if(!active)return fail('profile_unavailable',403,cors);
  const settings=await getSettings(env.DB);
  if(!settings||!settings.enabled)return reply({show:false,reason:'disabled'},200,cors);
  const week=completedWeek(),duration_seconds=settings.duration_seconds;
  let candidates;
  if(settings.mode==='custom'){
    let user=null;
    if(settings.custom_user_id){
      user=await env.DB.prepare('SELECT public_no,name,pic,wealth_level,charm_level FROM sharika_users '+
        "WHERE public_no=? AND status='active'")
        .bind(Number(settings.custom_user_id)).first();
      if(!user)return reply({show:false,reason:'custom_user_unavailable'},200,cors);
    }
    if(!user&&!settings.custom_image_url&&!settings.custom_title)
      return reply({show:false,reason:'custom_not_set'},200,cors);
    candidates=[{category:'custom',title:settings.custom_title||'SHARIKA STAR',
      subtitle:settings.custom_subtitle||'',public_id:user?asId(user.public_no):'',
      name:user?.name||'',pic:settings.custom_image_url||user?.pic||null,
      total:null,wealth_level:user?.wealth_level??null,charm_level:user?.charm_level??null}];
  }else candidates=await weeklyCandidates(env.DB,week);
  if(!candidates.length)return reply({show:false,reason:'no_verified_previous_week_winners',
    previous_week:{start:week.previous_start,end:week.previous_end}},200,cors);
  // D1 atomically advances the authenticated viewer's position. Its week_key
  // resets the sequence on the first launch of every new week.
  const cursor=await env.DB.prepare(
    'INSERT INTO sharika_opening_cursors(viewer_uid,week_key,opens) VALUES(?,?,1) '+
    'ON CONFLICT(viewer_uid) DO UPDATE SET week_key=excluded.week_key,'+
    'opens=CASE WHEN sharika_opening_cursors.week_key=excluded.week_key '+
    'THEN sharika_opening_cursors.opens+1 ELSE 1 END,updated_at=datetime(\'now\') '+
    'RETURNING opens'
  ).bind(uid,week.week_key+':'+settings.version).first();
  const sequence=Math.max(1,Number(cursor?.opens)||1);
  return reply({show:true,duration_seconds,sequence,
    slot:(sequence-1)%candidates.length+1,slots:candidates.length,
    previous_week:{start:week.previous_start,end:week.previous_end},
    person:candidates[(sequence-1)%candidates.length]},200,cors);
}

export async function handleOpeningAdmin({request,env,uid,actor,operation,cors,reply,fail}){
  if(operation!=='opening')return null;
  if(request.method==='GET'){
    const settings=await getSettings(env.DB);
    const week=completedWeek();
    const winners=await weeklyCandidates(env.DB,week);
    return reply({settings:settingsView(settings),
      next_week_winners:winners,previous_week:week.previous_start,
      read_only:actor.role!=='super'},200,cors);
  }
  if(request.method!=='PATCH')return fail('method_not_allowed',405,cors);
  if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
  const raw=await request.text();
  if(raw.length>2048)return fail('opening_settings_too_large',413,cors);
  let input;
  try{input=JSON.parse(raw||'{}');}catch(_){return fail('invalid_opening_settings',400,cors);}
  const changes=validateOpeningSettings(input);
  if(!changes)return fail('invalid_opening_settings',400,cors);
  const expected=input.expected_version;
  const keys=Object.keys(changes);
  if(changes.custom_user_id){
    const user=await env.DB.prepare("SELECT 1 FROM sharika_users WHERE public_no=? AND status='active'")
      .bind(Number(changes.custom_user_id)).first();
    if(!user)return fail('custom_user_unavailable',400,cors);
  }
  const updated=await env.DB.prepare('UPDATE sharika_opening_settings SET '+
    keys.map(key=>key+'=?').join(',')+",version=version+1,updated_at=datetime('now') "+
    'WHERE id=1 AND version=? RETURNING *')
    .bind(...keys.map(key=>changes[key]),expected).first();
  if(!updated)return fail('opening_settings_stale',409,cors);
  await env.DB.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
    .bind(uid,'opening_settings_update',JSON.stringify({version:updated.version,fields:keys})).run();
  return reply({saved:true,settings:settingsView(updated)},200,cors);
}
