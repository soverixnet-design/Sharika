// Read-only, verified admin operational pages. No demo data or state mutations.
const financeRoles=new Set(['super','finance']);
const roomRoles=new Set(['super','support']);

export async function handleOperationalRead({request,env,actor,operation,cors,reply,fail}){
  if(!['feature-health','theme-usage','game-monitor'].includes(operation))return null;
  if(request.method!=='GET')return fail('method_not_allowed',405,cors);
  if(operation==='feature-health'){
    return reply({
      environment:'staging',server_time:new Date().toISOString(),
      d1_bound:!!env.DB,voice_rooms_bound:!!env.VOICE_ROOMS,
      lucky_gifts_enabled:String(env.SHARIKA_LUCKY_GIFTS_ENABLED)==='true',
      cash_redeemable_coins:false,
      connected_pages:['users','rooms','sellers','support','recharges','ledger',
        'gifts','cosmetics','premium','bonds','rankings','events','banners','special_ids'],
      protected_settings_read_only:true
    },200,cors);
  }
  if(operation==='theme-usage'){
    if(!roomRoles.has(actor.role))return fail('admin_permission_denied',403,cors);
    const result=await env.DB.prepare(
      'SELECT theme,COUNT(*) AS rooms FROM sharika_rooms GROUP BY theme ORDER BY rooms DESC'
    ).all();
    return reply({themes:result.results||[],source:'verified_saved_rooms',
      admin_theme_upload_supported:false,read_only:true},200,cors);
  }
  if(!financeRoles.has(actor.role))return fail('admin_permission_denied',403,cors);
  const bets=await env.DB.prepare(
    "SELECT 'classic' AS source,game,COUNT(*) AS bets,"+
    "SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END) AS settled,"+
    "SUM(CASE WHEN status='settled' AND payout>0 THEN 1 ELSE 0 END) AS winning_bets "+
    "FROM sharika_game_bets GROUP BY game UNION ALL "+
    "SELECT 'original',game,COUNT(*),"+
    "SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END),"+
    "SUM(CASE WHEN status='settled' AND payout>0 THEN 1 ELSE 0 END) "+
    "FROM sharika_original_game_bets GROUP BY game"
  ).all();
  const wins=await env.DB.prepare(
    "SELECT * FROM (SELECT 'classic' AS source,b.game,b.round_no,u.public_no,"+
    "b.payout,b.settled_at FROM sharika_game_bets b "+
    "JOIN sharika_users u ON u.auth_uid=b.user_uid "+
    "WHERE b.status='settled' AND b.payout>0 UNION ALL "+
    "SELECT 'original',b.game,b.round_no,u.public_no,b.payout,b.settled_at "+
    "FROM sharika_original_game_bets b "+
    "JOIN sharika_users u ON u.auth_uid=b.user_uid "+
    "WHERE b.status='settled' AND b.payout>0) ORDER BY settled_at DESC LIMIT 30"
  ).all();
  return reply({games:(bets.results||[]).map(x=>({
    source:x.source,game:x.game,bets:Number(x.bets)||0,
    settled:Number(x.settled)||0,winning_bets:Number(x.winning_bets)||0
  })),wins:(wins.results||[]).map(x=>({
    source:x.source,game:x.game,round_no:x.round_no,
    public_id:String(x.public_no).padStart(8,'0'),
    payout_coins:Number(x.payout)||0,settled_at:x.settled_at
  })),source:'settled_wallet_bets',read_only:true},200,cors);
}
