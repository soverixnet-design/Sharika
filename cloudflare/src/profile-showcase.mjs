// Public, read-only Sharika ID collections. No client-owned sample identities,
// fabricated supporters, gift counters or profile entitlements.
const sections=new Set(['friends','followers','following','supporters','medal','vehicle','headwear','gift','impression']);
const cosmeticKinds={medal:'medal_style',vehicle:'entry_style',headwear:'frame_style',impression:'name_tag_style'};
const special="(SELECT s.special_id FROM sharika_special_ids s WHERE s.auth_uid=u.auth_uid "+
  "AND (s.expires_at IS NULL OR s.expires_at>datetime('now')) LIMIT 1)";
const identities=`u.public_no,u.name,u.pic,${special} AS special_id`;
const giftUnion=`SELECT e.sender_uid,e.recipient_uid,e.gift_id AS gift_id,e.quantity AS quantity,
  e.quantity*e.price_coins AS coins,'room' AS origin
  FROM sharika_gift_events e
  UNION ALL
  SELECT e.sender_uid,e.recipient_uid,e.gift_id AS gift_id,1 AS quantity,
    e.value_coins AS coins,'bond' AS origin
  FROM sharika_bond_gift_events e`;
const LIMIT=21;

export async function readPublicShowcase(db,authUid,section,offset=0){
  if(!sections.has(section)||!Number.isInteger(offset)||offset<0||offset>10000)return null;
  let sql,bindings;
  if(section==='friends'){
    sql=`SELECT ${identities} FROM sharika_bonds b
      JOIN sharika_users u ON u.auth_uid=CASE WHEN b.uid_a=? THEN b.uid_b ELSE b.uid_a END
      WHERE b.type='friendship' AND b.ended_at_ms IS NULL
      AND (b.uid_a=? OR b.uid_b=?) AND u.status='active'
      ORDER BY b.created_at_ms DESC,u.public_no ASC LIMIT ? OFFSET ?`;
    bindings=[authUid,authUid,authUid,LIMIT,offset];
  }else if(section==='followers'||section==='following'){
    const side=section==='followers'?'f.follower_uid':'f.followed_uid';
    const owner=section==='followers'?'f.followed_uid':'f.follower_uid';
    sql=`SELECT ${identities} FROM sharika_follows f JOIN sharika_users u
      ON u.auth_uid=${side} WHERE ${owner}=? AND u.status='active'
      ORDER BY f.created_at DESC,u.public_no ASC LIMIT ? OFFSET ?`;
    bindings=[authUid,LIMIT,offset];
  }else if(section==='supporters'){
    sql=`SELECT ${identities},SUM(g.coins) AS coins, SUM(g.quantity) AS quantity
      FROM (${giftUnion}) g JOIN sharika_users u ON u.auth_uid=g.sender_uid
      WHERE g.recipient_uid=? AND u.status='active'
      GROUP BY g.sender_uid ORDER BY coins DESC,u.public_no ASC LIMIT ? OFFSET ?`;
    bindings=[authUid,LIMIT,offset];
  }else if(section==='gift'){
    sql=`SELECT g.origin,g.gift_id,COALESCE(r.name,b.name,'Gift') AS name,
      COALESCE(r.emoji,b.emoji,'🎁') AS emoji,
      COALESCE(r.image_url,'') AS image_url,
      SUM(g.quantity) AS quantity,SUM(g.coins) AS coins
      FROM (${giftUnion}) g
      LEFT JOIN sharika_gifts r ON g.origin='room' AND r.id=g.gift_id
      LEFT JOIN sharika_bond_gifts b ON g.origin='bond' AND b.id=g.gift_id
      WHERE g.recipient_uid=? GROUP BY g.origin,g.gift_id
      ORDER BY coins DESC,g.origin ASC,g.gift_id ASC LIMIT ? OFFSET ?`;
    bindings=[authUid,LIMIT,offset];
  }else{
    sql=`SELECT c.id,c.kind,c.name,c.art_key,c.image_url,c.animation_url,
      i.source,i.acquired_at,i.expires_at_ms,
      CASE WHEN i.expires_at_ms IS NOT NULL AND i.expires_at_ms<=? THEN 1 ELSE 0 END AS expired
      FROM sharika_cosmetic_inventory i JOIN sharika_cosmetics_catalog c ON c.id=i.item_id
      WHERE i.auth_uid=? AND c.kind=? ORDER BY expired ASC,i.acquired_at DESC,c.name ASC
      LIMIT ? OFFSET ?`;
    bindings=[Date.now(),authUid,cosmeticKinds[section],LIMIT,offset];
  }
  const result=await db.prepare(sql).bind(...bindings).all();
  const rows=result.results||[];
  const items=rows.slice(0,20).map(row=>row.public_no==null?row:{
    ...row,id:String(row.public_no).padStart(8,'0'),
    display_id:row.special_id||String(row.public_no).padStart(8,'0'),
    public_no:undefined,special_id:undefined
  });
  return {section,items,offset,has_more:rows.length>20,read_only:true};
}
