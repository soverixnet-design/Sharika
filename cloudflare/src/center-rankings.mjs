// Verified Sharika Private Center role and CP rankings.
// Only settled, server-created gift/earnings ledgers. Never calculate from
// client coins, unverified events, status toggles, or projected role targets.
const KINDS=new Set(['cp','bd','agency','host']);
const PERIODS=new Set(['daily','weekly','monthly']);
const pad=id=>String(id).padStart(8,'0');
export function centerRankPeriod(period,now=new Date()){
 if(!PERIODS.has(period))return null;
 const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
 if(period==='weekly')start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
 if(period==='monthly')start.setUTCDate(1);
 const end=new Date(start.getTime());
 if(period==='daily')end.setUTCDate(end.getUTCDate()+1);
 if(period==='weekly')end.setUTCDate(end.getUTCDate()+7);
 if(period==='monthly')end.setUTCMonth(end.getUTCMonth()+1);
 return {start,end,stamp:d=>d.toISOString().slice(0,19).replace('T',' ')};
}
export async function readCenterRankings(db,period,kind,now=new Date()){
 if(!KINDS.has(kind))return null;
 const window=centerRankPeriod(period,now);
 if(!window)return null;
 const {start,end,stamp}=window;
 if(kind==='cp'){
  const result=await db.prepare(
   'SELECT b.id AS bond_id,ua.public_no AS a_id,ua.name AS a_name,ua.pic AS a_pic,'+
   'ub.public_no AS b_id,ub.name AS b_name,ub.pic AS b_pic,'+
   'SUM(e.value_coins) AS total FROM sharika_bond_gift_events e '+
   "JOIN sharika_bonds b ON b.id=e.bond_id AND b.type='cp' "+
   "JOIN sharika_users ua ON ua.auth_uid=b.uid_a AND ua.status='active' "+
   "JOIN sharika_users ub ON ub.auth_uid=b.uid_b AND ub.status='active' "+
   "WHERE e.type='cp' AND e.created_at_ms>=? AND e.created_at_ms<? "+
   'AND b.created_at_ms<? AND (b.ended_at_ms IS NULL OR b.ended_at_ms>=?) '+
   'GROUP BY b.id ORDER BY total DESC,b.id ASC LIMIT 50'
  ).bind(start.getTime(),end.getTime(),end.getTime(),start.getTime()).all();
  return {period,kind,start_at:start.toISOString(),end_at:end.toISOString(),
   unit:'coins',read_only:true,source:'settled_cp_gifts',
   leaders:(result.results||[]).map((row,i)=>({
    rank:i+1,bond_id:Number(row.bond_id),
    name:String(row.a_name||'Member')+' ♡ '+String(row.b_name||'Member'),
    display_id:pad(row.a_id)+' · '+pad(row.b_id),
    pic:row.a_pic||null,partner_pic:row.b_pic||null,total:Number(row.total)||0
   }))};
 }
 const kindInDb=kind==='host'?'host_salary':kind;
 const result=await db.prepare(
  'SELECT u.public_no,u.name,u.pic,COUNT(a.id) AS gift_count,'+
  'ROUND(SUM(a.amount_units)/10000.0,4) AS total '+
  'FROM sharika_agency_earnings a JOIN sharika_users u '+
  "ON u.auth_uid=a.beneficiary_uid AND u.status='active' "+
  'WHERE a.kind=? AND a.created_at>=? AND a.created_at<? '+
  'GROUP BY a.beneficiary_uid ORDER BY total DESC,u.public_no ASC LIMIT 50'
 ).bind(kindInDb,stamp(start),stamp(end)).all();
 return {period,kind,start_at:start.toISOString(),end_at:end.toISOString(),
  unit:'salary coins',read_only:true,source:'settled_agency_salary_ledger',
  leaders:(result.results||[]).map((row,i)=>({
   rank:i+1,public_id:pad(row.public_no),display_id:pad(row.public_no),
   name:row.name,pic:row.pic||null,gift_count:Number(row.gift_count)||0,
   total:Number(row.total)||0
  }))};
}
