// Single server-owned rate card. Admin edits affect future grants only; every
// historical coin ledger entry and USD earning keeps its settled amount.
export const DEFAULT_INVITE_RULES=Object.freeze({
  inviter_coins:100000,invitee_coins:100000,invite_usd_cents:10,
  inviter_recharge_percent:5,first_recharge_percent:40,
  recharge_coins_per_usd:500000,withdrawal_option_1_cents:5000,
  withdrawal_option_2_cents:10000,claim_window_hours:48,version:1
});
export const INVITE_RULE_BOUNDS=Object.freeze({
  inviter_coins:[0,1000000],invitee_coins:[2000,1000000],
  invite_usd_cents:[0,10000],inviter_recharge_percent:[0,50],
  first_recharge_percent:[0,100],recharge_coins_per_usd:[1000,1000000],
  withdrawal_option_1_cents:[1000,1000000],
  withdrawal_option_2_cents:[1000,1000000],claim_window_hours:[1,168]
});
export const RULE_FIELDS=Object.keys(INVITE_RULE_BOUNDS);

export async function readInviteRules(db){
  const row=await db.prepare('SELECT * FROM sharika_invite_reward_rules WHERE id=1').first();
  return row?Object.fromEntries([...RULE_FIELDS,'version'].map(key=>
    [key,Number(row[key])])):{...DEFAULT_INVITE_RULES};
}
export function validateInviteRules(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).length!==RULE_FIELDS.length)return null;
  const clean={};
  for(const field of RULE_FIELDS){
    const num=value[field],range=INVITE_RULE_BOUNDS[field];
    if(!Number.isSafeInteger(num)||num<range[0]||num>range[1])return null;
    clean[field]=num;
  }
  if(clean.withdrawal_option_1_cents>=clean.withdrawal_option_2_cents)return null;
  return clean;
}
