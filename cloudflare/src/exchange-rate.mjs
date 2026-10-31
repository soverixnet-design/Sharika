// Server-owned diamond exchange terms. Default is exactly 100 diamonds -> 70 coins.
// Persisted terms are Super-Admin controlled, revisioned and audited in D1.
export const DEFAULT_EXCHANGE_RATE=Object.freeze({
  diamonds_per_unit:100,coins_per_unit:70,revision:1,persisted:false
});
const RATE_MIN=1,RATE_MAX=10000;
const MAX_DIAMONDS=1000000;
const MAX_CREDIT=1000000000;
const validUnits=(n)=>Number.isSafeInteger(n)&&n>=RATE_MIN&&n<=RATE_MAX;
const respondRate=rate=>({
  diamonds_per_unit:rate.diamonds_per_unit,
  coins_per_unit:rate.coins_per_unit,
  revision:rate.revision,
  editable:!!rate.persisted
});
export async function readExchangeRate(db){
  let row;
  try{
    row=await db.prepare(
      'SELECT diamonds_per_unit,coins_per_unit,revision FROM sharika_exchange_rate WHERE id=1'
    ).first();
  }catch(error){
    // Older staging schemas keep the known 100:70 terms while migration is
    // separately approved. Other SQL errors must never be concealed.
    if(/no such table:\s*sharika_exchange_rate/i.test(String(error?.message||error)))
      return {...DEFAULT_EXCHANGE_RATE};
    throw error;
  }
  if(!row)return {...DEFAULT_EXCHANGE_RATE};
  const from=Number(row.diamonds_per_unit),to=Number(row.coins_per_unit);
  const revision=Number(row.revision);
  if(!validUnits(from)||!validUnits(to)||!Number.isSafeInteger(revision)||revision<1)
    throw Error('invalid_exchange_configuration');
  return {diamonds_per_unit:from,coins_per_unit:to,revision,persisted:true};
}
export {respondRate};
export function exchangeCredit(diamonds,rate){
  if(!Number.isSafeInteger(diamonds)||diamonds<rate.diamonds_per_unit||
     diamonds>MAX_DIAMONDS||diamonds%rate.diamonds_per_unit!==0)return null;
  const coins=(diamonds/rate.diamonds_per_unit)*rate.coins_per_unit;
  return Number.isSafeInteger(coins)&&coins>0&&coins<=MAX_CREDIT?coins:null;
}
export async function handleAdminExchangeRate({request,db,uid,role,reply,fail,cors}){
  if(request.method==='GET'){
    const current=await readExchangeRate(db);
    return reply({...respondRate(current),read_only:role!=='super'},200,cors);
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
  if(current.revision!==body.expected_revision)
    return fail('exchange_rate_changed',409,cors);
  if(current.diamonds_per_unit===body.diamonds_per_unit&&
     current.coins_per_unit===body.coins_per_unit)
    return reply({...respondRate(current),unchanged:true},200,cors);
  const nextRevision=current.revision+1;
  // If a concurrent admin edited the rate, the CHECK constraint rejects
  // revision=0 and rolls back the rate update AND the audit in one D1 batch.
  try{
    await db.batch([
      db.prepare('UPDATE sharika_exchange_rate SET diamonds_per_unit='+ 
        'CASE WHEN revision=? THEN ? ELSE 0 END,coins_per_unit=?,revision=revision+1,'+
        "updated_by=?,updated_at=datetime('now') WHERE id=1")
        .bind(current.revision,body.diamonds_per_unit,body.coins_per_unit,uid),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'diamond_exchange_rate_change',JSON.stringify({
          old:{diamonds_per_unit:current.diamonds_per_unit,coins_per_unit:current.coins_per_unit},
          next:{diamonds_per_unit:body.diamonds_per_unit,coins_per_unit:body.coins_per_unit},
          revision:nextRevision
        }))
    ]);
  }catch(error){
    if(/CHECK constraint/i.test(String(error?.message||error)))
      return fail('exchange_rate_changed',409,cors);
    throw error;
  }
  return reply({diamonds_per_unit:body.diamonds_per_unit,
    coins_per_unit:body.coins_per_unit,revision:nextRevision,
    editable:true,read_only:false},200,cors);
}
