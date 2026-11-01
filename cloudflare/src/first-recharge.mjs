// One-time 40% bonus for the recipient's first independently verified recharge.
// 500,000 recharge coins are the *displayed* equivalent of USD 1.00; a seller
// transfer is not, by itself, proof that an external dollar payment was made.
export const RECHARGE_COINS_PER_USD=500_000;
export const FIRST_RECHARGE_BONUS_PERCENT=40;
const MAX_USER_BALANCE=1_000_000_000_000;

export function firstRechargeBonusCoins(coins,percent=FIRST_RECHARGE_BONUS_PERCENT){
  if(!Number.isSafeInteger(coins)||coins<1)return 0;
  return Math.floor(coins*percent/100);
}

export async function firstRechargeBonusStatements({db,recipientUid,kind,reference,coins,balance,rules}){
  if(!['seller','manual'].includes(kind)||typeof reference!=='string'||
     reference.length<1||reference.length>150||!Number.isSafeInteger(coins)||coins<1)
    throw new Error('invalid_first_recharge');
  const bonus=firstRechargeBonusCoins(coins,rules?.first_recharge_percent??FIRST_RECHARGE_BONUS_PERCENT);
  const [seller,manual,claimed]=await Promise.all([
    db.prepare('SELECT 1 FROM sharika_coin_seller_transfers WHERE target_uid=? '+
      'AND seller_uid<>target_uid LIMIT 1').bind(recipientUid).first(),
    db.prepare("SELECT 1 FROM sharika_manual_recharge_reviews WHERE user_uid=? "+
      "AND status='approved' LIMIT 1").bind(recipientUid).first(),
    db.prepare('SELECT 1 FROM sharika_first_recharge_bonuses WHERE recipient_uid=?')
      .bind(recipientUid).first()
  ]);
  if(seller||manual||claimed)return {bonus:0,statements:[]};
  if(!Number.isSafeInteger(Number(balance))||Number(balance)>MAX_USER_BALANCE-coins-bonus)
    throw new Error('recipient_balance_limit');
  const key='first-recharge:'+kind+':'+reference;
  return {bonus,statements:[
    db.prepare('INSERT INTO sharika_first_recharge_bonuses '+
      '(recipient_uid,recharge_kind,recharge_reference,recharge_coins,bonus_coins) '+
      'VALUES(?,?,?,?,?)').bind(recipientUid,kind,reference,coins,bonus),
    ...(bonus>0?[
    db.prepare("UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins<=? "+
      "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?")
      .bind(MAX_USER_BALANCE-bonus,bonus,recipientUid),
    db.prepare('INSERT INTO sharika_wallet_ledger '+
      '(auth_uid,currency,delta,balance_after,reason,request_id) '+
      "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),"+
      "'first_recharge_bonus',?)").bind(recipientUid,bonus,recipientUid,key)
    ]:[])
  ]};
}
