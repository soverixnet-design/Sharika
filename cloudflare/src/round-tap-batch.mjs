// Every accepted tap still goes through the game's wallet and ledger triggers.
export async function settleTapBatch({db,uid,game,body,currentRound,ensure,validAmount,maxPick,items,reply,fail,cors}){
  const {round_no:round,taps}=body;
  const vector=game==='food-deluxe';
  const validPick=t=>vector?Array.isArray(t.pick)&&t.pick.length===8&&
    t.pick.every(n=>Number.isSafeInteger(n)&&n>=0)&&
    t.pick.reduce((sum,n)=>sum+n,0)===t.amount:
    Number.isInteger(t.pick)&&t.pick>=0&&t.pick<=maxPick;
  const choice=t=>vector?JSON.stringify(t.pick):items?items[t.pick]:t.pick;
  if(!Number.isSafeInteger(round)||round<0||!Array.isArray(taps)||!taps.length||taps.length>24||
     taps.some(t=>!t||typeof t.request_id!=='string'||!/^[A-Za-z0-9:_-]{12,80}$/.test(t.request_id)||
       !validPick(t)||!validAmount(t.amount))||
     new Set(taps.map(t=>t.request_id)).size!==taps.length)return fail('invalid_bet',400,cors);
  const prefixes={'sovera-gaddy':'sharika_gaddy','greedy-wheel':'sharika_greedy',
    'greedy-classic':'sharika_greedy_classic','fruit-royale':'sharika_fruit_royale','food-deluxe':'sharika_food_deluxe'};
  const prefix=prefixes[game]||'sharika_original_game';
  const shared=prefix==='sharika_original_game';
  const pickColumn=vector?'stakes_json':items?'item_id':'pick_index';
  const amountColumn=vector?'total':'amount';
  const bets=prefix+'_bets',rounds=prefix+'_rounds';
  const target=round===currentRound?await ensure():null;
  const now="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
  const statements=[];
  if(target){
    const insert=db.prepare('INSERT INTO '+bets+' ('+(shared?'game,':'')+
      'round_id,round_no,user_uid,'+pickColumn+','+amountColumn+',request_id) SELECT '+(shared?'?,':'')+
      '?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM '+rounds+' WHERE id=? AND starts_ms<='+now+' AND bet_closes_ms>'+now+
      ") AND EXISTS (SELECT 1 FROM sharika_users WHERE auth_uid=? AND status='active' AND minor=0 AND coins>=?)"+
      ' AND NOT EXISTS (SELECT 1 FROM '+bets+' WHERE user_uid=? AND request_id=?)');
    for(const t of taps)statements.push(insert.bind(...(shared?[game]:[]),target.id,round,uid,choice(t),t.amount,t.request_id,
      target.id,uid,t.amount,uid,t.request_id));
  }
  if(items)statements.push(db.prepare('SELECT item_id,SUM(amount) AS stake FROM '+bets+
    ' WHERE user_uid=? AND round_no=? GROUP BY item_id').bind(uid,round));
  statements.push(db.prepare('SELECT id,round_no,'+pickColumn+' AS chosen,'+amountColumn+' AS amount,request_id'+(shared?',game':'')+
    ' FROM '+bets+' WHERE user_uid=? AND request_id IN (SELECT value FROM json_each(?))')
    .bind(uid,JSON.stringify(taps.map(t=>t.request_id))));
  statements.push(db.prepare('SELECT coins, '+now+' AS stamp FROM sharika_users WHERE auth_uid=?').bind(uid));
  const results=await db.batch(statements);
  const rows=new Map(results.at(-2).results.map(r=>[r.request_id,r]));
  const wallet=results.at(-1).results[0];
  const receipts=taps.map(t=>{
    const r=rows.get(t.request_id);
    const error=r?(r.round_no!==round||r.chosen!==choice(t)||r.amount!==t.amount||(shared&&r.game!==game)?
      'idempotency_conflict':null):(!target||wallet.stamp>=target.bet_closes_ms?'betting_closed':'insufficient_coins');
    return error?{request_id:t.request_id,error}:{request_id:t.request_id,bet_id:r.id};
  });
  const summary=items?{myBets:items.map(id=>results.at(-3).results.find(r=>r.item_id===id)?.stake||0)}:{};
  return reply({coins:wallet.coins,round_no:round,receipts,...summary},200,cors);
}
