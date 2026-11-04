// Audited weekly room-owner coin settlement. Only gifts recorded in the new
// accrual table are paid here; older immediate roomgift:* credits are excluded.
const MAX_COINS=Number.MAX_SAFE_INTEGER;

export function roomWeekStartUTC(nowMs=Date.now()){
  if(!Number.isFinite(nowMs))throw Error('invalid_reward_time');
  const day=new Date(nowMs);
  const offset=(day.getUTCDay()+6)%7;
  return new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),
    day.getUTCDate()-offset)).toISOString().slice(0,10);
}

export async function settleDueRoomWeeks(db,nowMs=Date.now(),limit=40){
  if(!db)throw Error('room_reward_database_required');
  const currentWeek=roomWeekStartUTC(nowMs);
  const capped=Math.min(100,Math.max(1,Math.floor(limit)));
  const pending=await db.prepare(
    'SELECT a.room_id,a.owner_uid,a.week_start_utc,'+
    'SUM(a.reward_hundredths) AS earned '+
    'FROM sharika_room_weekly_accruals a '+
    'WHERE a.week_start_utc<? AND NOT EXISTS('+
    'SELECT 1 FROM sharika_room_weekly_payouts p WHERE p.room_id=a.room_id '+
    'AND p.owner_uid=a.owner_uid AND p.week_start_utc=a.week_start_utc) '+
    'GROUP BY a.room_id,a.owner_uid,a.week_start_utc '+
    'ORDER BY a.week_start_utc,a.room_id,a.owner_uid LIMIT ?'
  ).bind(currentWeek,capped).all();
  const settled=[],errors=[];
  for(const week of pending.results||[]){
    try{
      const roomId=week.room_id,ownerUid=week.owner_uid,
        weekStart=week.week_start_utc;
      if(!(Number(week.earned)>0))continue;
      // Cumulative hundredths retain fractions across week boundaries.
      const cumulative=await db.prepare(
        'SELECT COALESCE(SUM(reward_hundredths),0) AS amount '+
        'FROM sharika_room_weekly_accruals WHERE room_id=? AND owner_uid=? '+
        'AND week_start_utc<=?'
      ).bind(roomId,ownerUid,weekStart).first();
      const prior=await db.prepare(
        'SELECT COALESCE(SUM(coins_paid),0) AS coins '+
        'FROM sharika_room_weekly_payouts WHERE room_id=? AND owner_uid=? '+
        'AND week_start_utc<?'
      ).bind(roomId,ownerUid,weekStart).first();
      const allHundredths=Number(cumulative?.amount)||0;
      const prevCoins=Number(prior?.coins)||0;
      if(!Number.isSafeInteger(allHundredths)||allHundredths<0||
         !Number.isSafeInteger(prevCoins)||prevCoins<0)
        throw Error('room_reward_invalid_total');
      const paidCoins=Math.floor(allHundredths/100)-prevCoins;
      if(!Number.isSafeInteger(paidCoins)||paidCoins<0)
        throw Error('room_reward_invalid_difference');
      const carry=allHundredths%100;
      // Deliberately plain INSERT (not OR IGNORE): on a duplicate, D1 batch
      // rolls back wallet + ledger too. NULL assertion prevents a newer week
      // from paying before a previous unsettled week, including cron overlap.
      const statements=[db.prepare(
        'INSERT INTO sharika_room_weekly_payouts '+
        '(room_id,owner_uid,week_start_utc,earned_hundredths,coins_paid,carry_hundredths) '+
        'VALUES(?,?,?,CASE WHEN EXISTS('+
        'SELECT 1 FROM sharika_room_weekly_accruals a '+
        'WHERE a.room_id=? AND a.owner_uid=? AND a.week_start_utc<? '+
        'AND NOT EXISTS(SELECT 1 FROM sharika_room_weekly_payouts p '+
        'WHERE p.room_id=a.room_id AND p.owner_uid=a.owner_uid '+
        'AND p.week_start_utc=a.week_start_utc)) THEN NULL ELSE ? END,?,?)'
      ).bind(roomId,ownerUid,weekStart,roomId,ownerUid,weekStart,
        Number(week.earned),paidCoins,carry)];
      if(paidCoins>0){
        statements.push(db.prepare(
          "UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins<=? "+
          "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?"
        ).bind(MAX_COINS-paidCoins,paidCoins,ownerUid));
        statements.push(db.prepare(
          "INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) "+
          "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),"+
          "'room_weekly_reward',?)"
        ).bind(ownerUid,paidCoins,ownerUid,
          'roomweek:'+roomId+':'+ownerUid+':'+weekStart));
      }
      await db.batch(statements);
      settled.push({room_id:roomId,owner_uid:ownerUid,
        week_start_utc:weekStart,coins_paid:paidCoins});
    }catch(error){
      // Unique conflict is an expected concurrent/retried run. All other
      // failures leave this week pending for the next scheduled attempt.
      errors.push(String(error?.message||error).slice(0,160));
    }
  }
  return {settled,attempted:(pending.results||[]).length,errors};
}
