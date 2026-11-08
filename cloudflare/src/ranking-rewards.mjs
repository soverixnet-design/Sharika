// Weekly prize display rules: authenticated, Super Admin-configured, read only
// for app users. No rewards are credited by this module.
export const RANK_REWARD_KINDS=Object.freeze(['lucky','rich','charm','room','noble','games','recharge']);
const TYPES={frame_item_id:'frame_style',medal_item_id:'medal_style',
  entry_item_id:'entry_style'};
const rows=result=>result.results||[];
function policyTables(kind){
  const extra=kind==='noble'||kind==='games';
  return extra?['sharika_rank_reward_policy_extra','sharika_rank_reward_rules_extra']:
    ['sharika_rank_reward_policy','sharika_rank_reward_rules'];
}

export async function readRankingRewardPreview(db,kind){
  if(!RANK_REWARD_KINDS.includes(kind))return null;
  const [policyTable,ruleTable]=policyTables(kind);
  const [policy,results]=await Promise.all([
    db.prepare('SELECT enabled,revision,updated_at FROM '+policyTable+' '+
      'WHERE kind=?').bind(kind).first(),
    db.prepare('SELECT r.rank,r.coins,r.frame_item_id,r.medal_item_id,'+
      'r.entry_item_id,r.display_days,f.name AS frame_name,m.name AS medal_name,'+
      'e.name AS entry_name FROM '+ruleTable+' r '+
      'LEFT JOIN sharika_cosmetics_catalog f ON f.id=r.frame_item_id '+
      'LEFT JOIN sharika_cosmetics_catalog m ON m.id=r.medal_item_id '+
      'LEFT JOIN sharika_cosmetics_catalog e ON e.id=r.entry_item_id '+
      'WHERE r.kind=? ORDER BY r.rank').bind(kind).all()
  ]);
  if(!policy||rows(results).length!==7)throw Error('rank_reward_migration_required');
  return {kind,policy:{enabled:!!policy.enabled,revision:Number(policy.revision),
    updated_at:policy.updated_at},
    rules:rows(results).map(r=>({rank:Number(r.rank),coins:Number(r.coins),
      frame_name:r.frame_name||null,medal_name:r.medal_name||null,
      entry_name:r.entry_name||null,display_days:Number(r.display_days),
      frame_item_id:r.frame_item_id||null,medal_item_id:r.medal_item_id||null,
      entry_item_id:r.entry_item_id||null})),
    preview_only:true,automatic_awards:false,read_only:true};
}

export async function handleRankingRewardAdmin({request,db,uid,role,reply,fail,cors}){
  if(!['super','finance'].includes(role))return fail('admin_permission_denied',403,cors);
  if(request.method==='GET'){
    const kinds={};
    for(const kind of RANK_REWARD_KINDS)kinds[kind]=await readRankingRewardPreview(db,kind);
    const assets=await db.prepare('SELECT id,kind,name FROM sharika_cosmetics_catalog '+
      "WHERE active=1 AND kind IN ('frame_style','medal_style','entry_style') "+
      'ORDER BY kind,name LIMIT 250').all();
    return reply({kinds,assets:rows(assets),preview_only:true},200,cors);
  }
  if(request.method!=='PATCH')return fail('method_not_allowed',405,cors);
  if(role!=='super')return fail('admin_permission_denied',403,cors);
  const raw=await request.text();
  if(raw.length>18000)return fail('body_too_large',413,cors);
  let body;
  try{body=JSON.parse(raw);}catch(_){return fail('invalid_reward_rules',400,cors);}
  const kind=body?.kind,rules=body?.rules;
  if(!RANK_REWARD_KINDS.includes(kind)||typeof body.enabled!=='boolean'||
     !Number.isSafeInteger(body.revision)||body.revision<0||
     !Array.isArray(rules)||rules.length!==7||
     new Set(rules.map(x=>x?.rank)).size!==7||
     !rules.every(x=>x&&Number.isInteger(x.rank)&&x.rank>=1&&x.rank<=7&&
       Number.isSafeInteger(x.coins)&&x.coins>=0&&x.coins<=1000000&&
       Number.isInteger(x.display_days)&&x.display_days>=1&&x.display_days<=30&&
       Object.keys(TYPES).every(k=>x[k]===null||
         (typeof x[k]==='string'&&x[k].length>=3&&x[k].length<=70))))
    return fail('invalid_reward_rules',400,cors);
  const [policyTable,ruleTable]=policyTables(kind);
  const previous=await db.prepare('SELECT revision FROM '+policyTable+' '+
    'WHERE kind=?').bind(kind).first();
  if(!previous||Number(previous.revision)!==body.revision)
    return fail('reward_revision_changed',409,cors);
  for(const rule of rules){
    for(const [field,type] of Object.entries(TYPES)){
      if(!rule[field])continue;
      const valid=await db.prepare('SELECT 1 AS ok FROM sharika_cosmetics_catalog '+
        'WHERE id=? AND kind=? AND active=1').bind(rule[field],type).first();
      if(!valid)return fail('invalid_reward_asset',400,cors);
    }
  }
  // Atomic, optimistic revision guard. A stale concurrent PATCH violates
  // revision>=0 and aborts the entire D1 batch, including its audit row.
  const work=[db.prepare('UPDATE '+policyTable+' SET enabled=?, '+
    'revision=CASE WHEN revision=? THEN revision+1 ELSE -1 END,updated_by=?, '+
    "updated_at=datetime('now') WHERE kind=?")
    .bind(body.enabled?1:0,body.revision,uid,kind)];
  for(const r of rules){
    work.push(db.prepare('UPDATE '+ruleTable+' SET coins=?, '+
      'frame_item_id=?,medal_item_id=?,entry_item_id=?,display_days=? '+
      'WHERE kind=? AND rank=?').bind(r.coins,r.frame_item_id,r.medal_item_id,
      r.entry_item_id,r.display_days,kind,r.rank));
  }
  work.push(db.prepare('INSERT INTO sharika_rank_reward_audit '+
    '(admin_uid,kind,old_revision,new_revision,settings_json) VALUES(?,?,?,?,?)')
    .bind(uid,kind,body.revision,body.revision+1,JSON.stringify({enabled:body.enabled,rules})));
  try{await db.batch(work);}catch(error){
    if(String(error.message||'').includes('CHECK constraint'))
      return fail('reward_revision_changed',409,cors);
    throw error;
  }
  return reply(await readRankingRewardPreview(db,kind),200,cors);
}
