import {publicAppearanceSelect} from './cosmetics.mjs';

// Phase 2: read-only rankings from the immutable post-migration activity feed.
// Existing rich/charm/room/recharge rankings retain their historical queries.
const PERIODS=new Set(['daily','weekly','monthly']);
const KINDS={sending:'gift_sent',recharge:'recharge_approved',game:'game_settled'};
const GAME_METRICS={
  wins:'SUM(CASE WHEN e.payout_coins>0 THEN 1 ELSE 0 END)',
  stake:'SUM(e.amount_coins)',
  payout:'SUM(e.payout_coins)'
};
const GAME_CODES=new Set([
  'food-wheel','jackpot-fruit','sovera-food','night-food','greedy-wheel','fruit-royale'
]);
const stamp=date=>date.toISOString().slice(0,19).replace('T',' ');
const publicId=value=>String(value).padStart(8,'0');

export function verifiedRankingWindow(period,now=Date.now()){
  if(!PERIODS.has(period)||!Number.isFinite(now))return null;
  const start=new Date(now);
  start.setUTCHours(0,0,0,0);
  if(period==='weekly')start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
  if(period==='monthly')start.setUTCDate(1);
  const end=new Date(start);
  if(period==='daily')end.setUTCDate(end.getUTCDate()+1);
  if(period==='weekly')end.setUTCDate(end.getUTCDate()+7);
  if(period==='monthly')end.setUTCMonth(end.getUTCMonth()+1);
  return {start,end};
}

export async function readVerifiedRankings(db,{
  period='weekly',kind='sending',metric=null,game=null,now=Date.now()
}={}){
  const window=verifiedRankingWindow(period,now);
  if(!window||!Object.hasOwn(KINDS,kind))return null;
  if(kind==='game'){
    metric??='wins';
    if(!Object.hasOwn(GAME_METRICS,metric)||
      (game!==null&&!GAME_CODES.has(game)))return null;
  }else if(metric!==null||game!==null)return null;

  // Only fixed server-owned enum choices can become SQL expressions.
  // User inputs (window dates and optional game code) are always bound.
  const score=kind==='game'?GAME_METRICS[metric]:'SUM(e.amount_coins)';
  const gameFilter=game===null?'':' AND e.game_code=?';
  const appearance=publicAppearanceSelect();
  const special="(SELECT s.special_id FROM sharika_special_ids s WHERE s.auth_uid=u.auth_uid "+
    "AND (s.expires_at IS NULL OR s.expires_at>datetime('now')) LIMIT 1) AS special_id";
  const sql='SELECT u.public_no,u.name,u.pic,u.wealth_level,u.charm_level,'+
    special+','+appearance+',CAST('+score+' AS TEXT) AS total '+
    'FROM sharika_verified_activity_events e '+
    'JOIN sharika_users u ON u.auth_uid=e.user_uid '+
    "WHERE u.status='active' AND e.event_type=? "+
    'AND e.occurred_at>=? AND e.occurred_at<?'+gameFilter+' '+
    'GROUP BY e.user_uid HAVING '+score+'>0 '+
    'ORDER BY '+score+' DESC,u.public_no ASC LIMIT 50';
  const params=[KINDS[kind],stamp(window.start),stamp(window.end)];
  if(game!==null)params.push(game);
  const rows=(await db.prepare(sql).bind(...params).all()).results||[];
  const leaders=rows.map((row,i)=>({
    rank:i+1,
    // Never expose the hidden real public ID when a Special ID is active.
    display_id:row.special_id==null?publicId(row.public_no):String(row.special_id),
    name:row.name,pic:row.pic||null,wealth_level:row.wealth_level,
    charm_level:row.charm_level,
    frame_style:row.equipped_frame_style??row.frame_style??'',
    medal_style:row.equipped_medal_style??row.medal_style??'',
    name_tag_style:row.equipped_name_tag_style??row.name_tag_style??'',
    // SQL converts large integer totals to text before JS serialization.
    total:String(row.total??'0')
  }));
  return {
    kind,period,metric:kind==='game'?metric:'coins',game,
    start_at:window.start.toISOString(),end_at:window.end.toISOString(),
    leaders,units:kind==='game'&&metric==='wins'?'wins':'coins',
    source:'verified_activity_events',coverage:'post_migration_only',
    timezone:'UTC',read_only:true
  };
}
