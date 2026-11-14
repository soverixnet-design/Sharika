// Server-owned diamond exchange terms. Default is 100 diamonds -> 40 coins.
// Persisted terms are Super-Admin controlled, revisioned and audited in D1.
export const DEFAULT_EXCHANGE_RATE=Object.freeze({
  diamonds_per_unit:100,coins_per_unit:40,revision:1,persisted:false,max_diamonds_per_exchange:1_000_000
});
const RATE_MIN=1,RATE_MAX=10000;
export const MAX_DIAMONDS=100_000_000;
const LEGACY_MAX_DIAMONDS=1_000_000;
const MAX_CREDIT=1000000000;
const validUnits=(n)=>Number.isSafeInteger(n)&&n>=RATE_MIN&&n<=RATE_MAX;
const respondRate=rate=>({
  diamonds_per_unit:rate.diamonds_per_unit,
  coins_per_unit:rate.coins_per_unit,
  revision:rate.revision,
  max_diamonds_per_exchange:Math.min(rate.max_diamonds_per_exchange,
    Math.floor(MAX_CREDIT/rate.coins_per_unit)*rate.diamonds_per_unit),
  editable:!!rate.persisted
});
export async function readExchangeRate(db){
  let row;
  try{
    row=await db.prepare(
      'SELECT diamonds_per_unit,coins_per_unit,revision,max_diamonds_per_exchange FROM sharika_exchange_rate WHERE id=1'
    ).first();
  }catch(error){
    // Older staging schemas use the current 100:40 default while migration is
    // separately approved. Other SQL errors must never be concealed.
    if(/no such column: max_diamonds_per_exchange/i.test(String(error?.message||error)))
      row=await db.prepare('SELECT diamonds_per_unit,coins_per_unit,revision FROM sharika_exchange_rate WHERE id=1').first();
    else if(/no such table:\s*sharika_exchange_rate/i.test(String(error?.message||error)))
      return {...DEFAULT_EXCHANGE_RATE};
    else throw error;
  }
  if(!row)return {...DEFAULT_EXCHANGE_RATE};
  const from=Number(row.diamonds_per_unit),to=Number(row.coins_per_unit);
  const revision=Number(row.revision);
  if(!validUnits(from)||!validUnits(to)||!Number.isSafeInteger(revision)||revision<1)
    throw Error('invalid_exchange_configuration');
  return {diamonds_per_unit:from,coins_per_unit:to,revision,persisted:true,
    max_diamonds_per_exchange:Number(row.max_diamonds_per_exchange)||LEGACY_MAX_DIAMONDS,
    limit_editable:row.max_diamonds_per_exchange!==undefined};
}
export {respondRate};
export function exchangeCredit(diamonds,rate){
  if(!Number.isSafeInteger(diamonds)||diamonds<rate.diamonds_per_unit||
     diamonds>(rate.max_diamonds_per_exchange??LEGACY_MAX_DIAMONDS)||diamonds%rate.diamonds_per_unit!==0)return null;
  const coins=(diamonds/rate.diamonds_per_unit)*rate.coins_per_unit;
  return Number.isSafeInteger(coins)&&coins>0&&coins<=MAX_CREDIT?coins:null;
}
export async function handleAdminExchangeRate({request,db,uid,role,reply,fail,cors,playAudit=false}){
  if(request.method==='GET'){
    const current=await readExchangeRate(db);
    return reply({...respondRate(current),read_only:role!=='super',limit_editable:!!current.limit_editable,
      configured_max_diamonds:current.max_diamonds_per_exchange},200,cors);
  }
  if(request.method!=='PATCH')return fail('admin_method_not_allowed',405,cors);
  if(role!=='super')return fail('admin_permission_denied',403,cors);
  let body;
  try{
    const raw=await request.text();
    if(raw.length>2048)return fail('invalid_exchange_rate',400,cors);
    body=JSON.parse(raw||'{}');
  }catch(_){return fail('invalid_exchange_rate',400,cors);}
  if(!body||typeof body!=='object'||Array.isArray(body)||
     !validUnits(body.diamonds_per_unit)||!validUnits(body.coins_per_unit)||
     !Number.isSafeInteger(body.expected_revision)||body.expected_revision<1)
    return fail('invalid_exchange_rate',400,cors);
  const current=await readExchangeRate(db);
  if(!current.persisted)return fail('exchange_rate_migration_pending',503,cors);
  const max=body.max_diamonds_per_exchange??current.max_diamonds_per_exchange;
  if(!Number.isSafeInteger(max)||max<body.diamonds_per_unit||max>MAX_DIAMONDS)
    return fail('invalid_exchange_limit',400,cors);
  if(body.max_diamonds_per_exchange!==undefined&&!current.limit_editable)
    return fail('exchange_limit_migration_pending',503,cors);
  if(current.revision!==body.expected_revision)
    return fail('exchange_rate_changed',409,cors);
  if(current.diamonds_per_unit===body.diamonds_per_unit&&
     current.coins_per_unit===body.coins_per_unit&&current.max_diamonds_per_exchange===max)
    return reply({...respondRate(current),unchanged:true},200,cors);
  const nextRevision=current.revision+1;
  const limitArgs=current.limit_editable?[max]:[];
  // If a concurrent admin edited the rate, the CHECK constraint rejects
  // revision=0 and rolls back the rate update AND the audit in one D1 batch.
  try{
    await db.batch([
      db.prepare('UPDATE sharika_exchange_rate SET diamonds_per_unit='+ 
        'CASE WHEN revision=? THEN ? ELSE 0 END,coins_per_unit=?,revision=revision+1,'+
        (current.limit_editable?'max_diamonds_per_exchange=?,':'')+
        "updated_by=?,updated_at=datetime('now') WHERE id=1")
        .bind(current.revision,body.diamonds_per_unit,body.coins_per_unit,...limitArgs,playAudit?null:uid),
      db.prepare('INSERT INTO '+(playAudit?'sharika_play_exchange_audit':'sharika_admin_audit')+
        '(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'diamond_exchange_rate_change',JSON.stringify({
          old:{diamonds_per_unit:current.diamonds_per_unit,coins_per_unit:current.coins_per_unit},
          next:{diamonds_per_unit:body.diamonds_per_unit,coins_per_unit:body.coins_per_unit},
          limit_before:current.max_diamonds_per_exchange,limit_after:max,revision:nextRevision
        }))
    ]);
  }catch(error){
    if(/CHECK constraint/i.test(String(error?.message||error)))
      return fail('exchange_rate_changed',409,cors);
    throw error;
  }
  return reply({diamonds_per_unit:body.diamonds_per_unit,
    coins_per_unit:body.coins_per_unit,revision:nextRevision,
    max_diamonds_per_exchange:max,limit_editable:!!current.limit_editable,editable:true,read_only:false},200,cors);
}
