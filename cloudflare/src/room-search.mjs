// Authenticated, read-only search across all rooms, including rooms beyond
// the country-prioritized home feed's first 100 cards.
export async function searchVerifiedRooms(db,rawQuery){
  const query=String(rawQuery??'').trim();
  if(query.length<2||query.length>60||/[\u0000-\u001f\u007f]/.test(query))return null;
  // Literal matches only: user input cannot become a SQL LIKE wildcard.
  const escaped=query.replace(/[\\%_]/g,match=>'\\'+match);
  const exact=/^[0-9]{1,10}$/.test(query)?query:'';
  const result=await db.prepare(
    'SELECT r.id,r.name,r.emoji,r.theme,r.seat_count,u.country AS owner_country '+
    'FROM sharika_rooms r JOIN sharika_users u ON u.auth_uid=r.owner_id '+
    "WHERE u.status='active' AND (r.id=? OR r.id LIKE ? ESCAPE '\\' "+
    "OR r.name LIKE ? ESCAPE '\\') "+
    'ORDER BY CASE WHEN r.id=? THEN 0 ELSE 1 END,r.created_at DESC LIMIT 30'
  ).bind(exact,'%'+escaped+'%','%'+escaped+'%',exact).all();
  return {query,rooms:result.results||[],read_only:true};
}
