// Global placement templates. The user's purchased/equipped cosmetics remain
// in the independent, server-verified inventory and are never changed here.
const SCREENS={
  main:{sections:['hero','stats','wallet','collection','account'],
    identity:['avatar','svip','name','id'],frame_scale:142,
    tag_position:'id',medal_position:'id',background:'original'},
  public:{sections:['cover','identity','levels','stats','actions'],
    identity:['avatar','name','id'],frame_scale:142,
    tag_position:'name',medal_position:'name',background:'original'}
};
const POSITIONS=new Set(['avatar','name','id']);
const BACKGROUNDS=new Set(['original','gold']);
const names=Object.keys(SCREENS);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const clone=o=>JSON.parse(JSON.stringify(o));
function permutation(actual,valid){
  return Array.isArray(actual)&&actual.length===valid.length&&
    actual.every(x=>typeof x==='string'&&valid.includes(x))&&
    new Set(actual).size===valid.length;
}
export function checkProfileLayout(screen,raw){
  if(!own(SCREENS,screen)||!raw||typeof raw!=='object'||Array.isArray(raw))
    return null;
  const baseline=SCREENS[screen];
  if(Object.keys(raw).length!==6||
    !['sections','identity','frame_scale','tag_position','medal_position','background']
      .every(k=>own(raw,k)))return null;
  if(!permutation(raw.sections,baseline.sections)||
     !permutation(raw.identity,baseline.identity)||
     !Number.isInteger(raw.frame_scale)||raw.frame_scale<110||raw.frame_scale>165||
     !POSITIONS.has(raw.tag_position)||!POSITIONS.has(raw.medal_position)||
     !BACKGROUNDS.has(raw.background))return null;
  return {
    sections:[...raw.sections],identity:[...raw.identity],frame_scale:raw.frame_scale,
    tag_position:raw.tag_position,medal_position:raw.medal_position,
    background:raw.background
  };
}
export function defaultProfileLayouts(){return clone(SCREENS);}
function safeStored(screen,raw){
  try{return checkProfileLayout(screen,JSON.parse(raw))||clone(SCREENS[screen]);}
  catch{return clone(SCREENS[screen]);}
}
export async function readPublishedProfileLayouts(db){
  const rows=(await db.prepare(
    'SELECT screen,published_json,revision FROM sharika_profile_layouts'
  ).all()).results||[];
  const layouts=defaultProfileLayouts(),revisions={main:0,public:0};
  for(const row of rows){
    if(!own(SCREENS,row.screen))continue;
    layouts[row.screen]=safeStored(row.screen,row.published_json);
    revisions[row.screen]=Number(row.revision)||0;
  }
  return {layouts,revisions};
}
async function adminList(db){
  const rows=(await db.prepare('SELECT * FROM sharika_profile_layouts').all()).results||[];
  const out={};
  for(const screen of names){
    const row=rows.find(x=>x.screen===screen);
    out[screen]={
      draft:row?safeStored(screen,row.draft_json):clone(SCREENS[screen]),
      published:row?safeStored(screen,row.published_json):clone(SCREENS[screen]),
      revision:Number(row?.revision)||0,
      can_rollback:!!row?.previous_json,
      updated_at:row?.updated_at||null
    };
  }
  return {screens:out};
}
async function ensureRow(db,screen){
  const base=JSON.stringify(SCREENS[screen]);
  await db.prepare(
    "INSERT INTO sharika_profile_layouts(screen,draft_json,published_json,revision) "+
    "VALUES(?,?,?,0) ON CONFLICT(screen) DO NOTHING"
  ).bind(screen,base,base).run();
}
export async function handleProfileLayoutAdmin({
  request,db,uid,role,reply,fail,cors
}){
  if(role!=='super')return fail('admin_permission_denied',403,cors);
  if(request.method==='GET')return reply(await adminList(db),200,cors);
  if(request.method!=='PATCH'&&request.method!=='POST')
    return fail('profile_layout_method_not_allowed',405,cors);
  let body;
  try{
    const raw=await request.text();
    if(raw.length>6400)return fail('profile_layout_request_too_large',413,cors);
    body=JSON.parse(raw);
  }catch{return fail('invalid_profile_layout',400,cors);}
  const screen=body?.screen,revision=body?.expected_revision;
  if(!own(SCREENS,screen)||!Number.isSafeInteger(revision)||revision<0)
    return fail('invalid_profile_layout',400,cors);
  const action=request.method==='PATCH'?'draft':body?.action;
  if(!['draft','publish','rollback'].includes(action)||
     (request.method==='POST'&&action==='draft'))
    return fail('invalid_profile_layout_action',400,cors);
  const layout=action==='draft'?checkProfileLayout(screen,body.layout):null;
  if(action==='draft'&&!layout)
    return fail('invalid_profile_layout',400,cors);
  await ensureRow(db,screen);
  const where=' WHERE screen=? AND revision=?';
  let statement;
  if(action==='draft'){
    statement=db.prepare(
      "UPDATE sharika_profile_layouts SET draft_json=?,revision=revision+1,"+
      "updated_at=datetime('now')"+where
    ).bind(JSON.stringify(layout),screen,revision);
  }else if(action==='publish'){
    statement=db.prepare(
      "UPDATE sharika_profile_layouts SET previous_json=published_json,"+
      "published_json=draft_json,revision=revision+1,updated_at=datetime('now')"+where
    ).bind(screen,revision);
  }else{
    statement=db.prepare(
      "UPDATE sharika_profile_layouts SET published_json=previous_json,"+
      "draft_json=previous_json,previous_json=published_json,"+
      "revision=revision+1,updated_at=datetime('now')"+where+
      ' AND previous_json IS NOT NULL'
    ).bind(screen,revision);
  }
  const result=await statement.run();
  if(Number(result?.meta?.changes)!==1)
    return fail('profile_layout_revision_changed_or_not_available',409,cors);
  await db.prepare(
    'INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)'
  ).bind(uid,'profile_layout_'+action,
    JSON.stringify({screen,expected_revision:revision,layout:action==='draft'?layout:undefined})
  ).run();
  return reply({saved:true,action,...await adminList(db)},200,cors);
}
