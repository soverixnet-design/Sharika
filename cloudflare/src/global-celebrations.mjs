// Single authenticated D1 feed for all rooms and the home screen. No client
// may publish announcements: only immutable settled transactions can insert.
const MAX_RECENT=24;
const MAX_AGE_SECONDS=55;

export async function readGlobalCelebrations(db){
  const [result,settings]=await Promise.all([
    db.prepare(
      'SELECT c.id,c.kind,c.game,c.quantity,c.amount_coins,c.created_at,'+
      'sender.public_no AS sender_no,sender.name AS sender_name,sender.pic AS sender_pic,'+
      'recipient.public_no AS recipient_no,recipient.name AS recipient_name,'+
      'recipient.pic AS recipient_pic,g.name AS gift_name,g.emoji AS gift_emoji,'+
      'g.animation_url AS animation_url,g.audio_url AS audio_url '+
      'FROM sharika_global_celebrations c '+
      'JOIN sharika_users sender ON sender.auth_uid=c.sender_uid '+
      'LEFT JOIN sharika_users recipient ON recipient.auth_uid=c.recipient_uid '+
      'LEFT JOIN sharika_gifts g ON g.id=c.gift_id '+
      "WHERE c.created_at>=datetime('now','-"+MAX_AGE_SECONDS+" seconds') "+
      'ORDER BY c.id DESC LIMIT ?'
    ).bind(MAX_RECENT).all(),
    db.prepare('SELECT gift_threshold_coins,win_threshold_coins '+
      'FROM sharika_celebration_settings WHERE id=1').first()
  ]);
  const events=(result.results||[]).reverse().map(row=>({
    id:Number(row.id),kind:row.kind,created_at:row.created_at,
    sender_id:String(row.sender_no).padStart(8,'0'),
    sender_name:row.sender_name,sender_pic:row.sender_pic||'',
    recipient_id:row.recipient_no==null?'':String(row.recipient_no).padStart(8,'0'),
    recipient_name:row.recipient_name||'',recipient_pic:row.recipient_pic||'',
    gift_name:row.gift_name||'',gift_emoji:row.gift_emoji||'',
    animation_url:row.animation_url||'',audio_url:row.audio_url||'',
    quantity:Number(row.quantity)||1,amount_coins:Number(row.amount_coins),
    game:row.game||''
  }));
  return {events,latest_id:events.at(-1)?.id||0,
    policy:{gift_threshold_coins:Number(settings?.gift_threshold_coins)||1000000,
      win_threshold_coins:Number(settings?.win_threshold_coins)||10000000}};
}
