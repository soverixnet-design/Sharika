// Google Sheets mirror of immutable Sharika staging ledgers.
// Never puts a service-account key in a client or a Google Sheet.
const DOC_ID=/^[A-Za-z0-9_-]{20,100}$/;
const rows=v=>v?.results||[];
const pid=n=>String(n).padStart(8,'0');
const day=()=>new Date().toISOString().slice(0,10);
const enc=x=>btoa(String.fromCharCode(...new TextEncoder().encode(x)))
  .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
async function googleToken(env){
  const pem=env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g,'\n');
  const der=Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')),
    c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('pkcs8',der,
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const now=Math.floor(Date.now()/1000);
  const header=enc(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const payload=enc(JSON.stringify({iss:env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL,
    scope:'https://www.googleapis.com/auth/spreadsheets',
    aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+1800}));
  const unsigned=header+'.'+payload;
  const signature=b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,
    new TextEncoder().encode(unsigned)));
  const body=new URLSearchParams({
    grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion:unsigned+'.'+signature
  });
  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:body.toString(),signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw Error('google_token_http_'+response.status);
  const json=await response.json();
  if(!json.access_token)throw Error('google_access_token_missing');
  return json.access_token;
}
function range(name,columns,values){
  if(values.length>999)throw Error('sheet_capacity_exceeded_'+name);
  const blank=Array.from({length:columns},()=>null);
  const grid=values.map(row=>row.slice(0,columns));
  // Clear only the old data area, leaving verified headings and formatting.
  while(grid.length<999)grid.push(blank);
  return {range:"'"+name.replace(/'/g,"''")+"'!A2:"+
    String.fromCharCode(64+columns)+'1000',majorDimension:'ROWS',values:grid};
}
async function page(db,query){
  const data=rows(await db.prepare(query).all());
  if(data.length>999)throw Error('sheet_capacity_exceeded');
  return data;
}
export function sheetsConfigured(env){
  return !!(DOC_ID.test(String(env.SHARIKA_FAMILY_SHEET_ID||''))&&
    env.GOOGLE_SHEETS_PRIVATE_KEY&&env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL);
}
export async function sheetSyncStatus(db,env){
  const row=await db.prepare(
    "SELECT last_synced_day,last_synced_at,record_count FROM sharika_family_sheet_sync WHERE key='standard'"
  ).first();
  return {configured:sheetsConfigured(env),spreadsheet_id:env.SHARIKA_FAMILY_SHEET_ID||null,
    last_synced_day:row?.last_synced_day||null,last_synced_at:row?.last_synced_at||null,
    record_count:Number(row?.record_count)||0};
}
export async function syncFamilyGoogleSheet(env){
  if(!sheetsConfigured(env))return {synced:false,reason:'google_sheets_credentials_required'};
  const db=env.DB;
  const gift=await page(db,
    'SELECT e.id AS event_id,e.transaction_id,e.created_at,e.room_id,e.gift_id,e.quantity,'+
    'e.price_coins,su.public_no AS sender_no,f.id AS family_id,f.owner_uid,f.bd_uid,'+
    'ou.public_no AS owner_no,bu.public_no AS bd_no,'+
    "MAX(CASE WHEN l.kind='bd' THEN l.rate_bps ELSE 0 END) AS bd_bps,"+
    "SUM(CASE WHEN l.kind='bd' THEN l.crystal_units ELSE 0 END) AS bd_units,"+
    "SUM(CASE WHEN l.kind='family_owner' THEN l.crystal_units ELSE 0 END) AS owner_units "+
    'FROM sharika_family_crystal_ledger l JOIN sharika_gift_events e ON e.id=l.gift_event_id '+
    'JOIN sharika_families f ON f.id=l.family_id '+
    'JOIN sharika_users su ON su.auth_uid=e.sender_uid '+
    'JOIN sharika_users ou ON ou.auth_uid=f.owner_uid '+
    'JOIN sharika_users bu ON bu.auth_uid=f.bd_uid '+
    "WHERE e.created_at>=datetime('now','-31 days') "+
    'GROUP BY e.id ORDER BY e.id DESC LIMIT 1000');
  const comm=await page(db,
    'SELECT l.id,e.transaction_id,l.created_at,bu.public_no AS bd_no,l.family_id,'+
    'e.quantity*e.price_coins AS gift_coins,l.rate_bps,l.crystal_units '+
    'FROM sharika_family_crystal_ledger l JOIN sharika_gift_events e ON e.id=l.gift_event_id '+
    'JOIN sharika_users bu ON bu.auth_uid=l.beneficiary_uid '+
    "WHERE l.kind='bd' AND l.created_at>=datetime('now','-31 days') "+
    'ORDER BY l.id DESC LIMIT 1000');
  const grants=await page(db,
    'SELECT g.id,g.created_at,bu.public_no AS bd_no,ou.public_no AS owner_no,'+
    'g.family_id,f.name,f.status FROM sharika_family_grants g '+
    'JOIN sharika_families f ON f.id=g.family_id '+
    'JOIN sharika_users bu ON bu.auth_uid=g.bd_uid '+
    'JOIN sharika_users ou ON ou.auth_uid=g.owner_uid '+
    'ORDER BY g.id DESC LIMIT 1000');
  const ledger=await page(db,
    'SELECT l.id,l.created_at,u.public_no AS beneficiary_no,l.kind,l.gift_event_id,'+
    'l.crystal_units,l.rate_bps, '+
    'SUM(l.crystal_units) OVER(PARTITION BY l.beneficiary_uid ORDER BY l.id) AS balance_units '+
    'FROM sharika_family_crystal_ledger l JOIN sharika_users u ON u.auth_uid=l.beneficiary_uid '+
    'ORDER BY l.id DESC LIMIT 1000');
  const transfers=await page(db,
    'SELECT t.id,t.created_at,su.public_no AS sender_no,bu.public_no AS seller_no,'+
    't.crystal_units,t.coins_to_seller,t.status,t.resolved_at '+
    'FROM sharika_family_crystal_transfers t '+
    'JOIN sharika_users su ON su.auth_uid=t.sender_uid '+
    'JOIN sharika_users bu ON bu.auth_uid=t.seller_uid '+
    'ORDER BY t.id DESC LIMIT 1000');
  const overview=await page(db,
    'SELECT f.id AS family_id,f.name,bu.public_no AS bd_no,'+
    'COALESCE(SUM(CASE WHEN l.kind=\'bd\' THEN l.crystal_units ELSE 0 END),0) AS bd_units,'+
    'COALESCE(SUM(CASE WHEN l.kind=\'family_owner\' THEN l.crystal_units ELSE 0 END),0) AS owner_units,'+
    'COUNT(DISTINCT l.gift_event_id) AS n,'+
    'COALESCE((SELECT SUM(e.quantity*e.price_coins) FROM sharika_gift_events e '+
    'WHERE e.id IN (SELECT gift_event_id FROM sharika_family_crystal_ledger '+
    'WHERE family_id=f.id AND created_at>=datetime(\'now\',\'-31 days\'))),0) AS gift_coins '+
    'FROM sharika_families f JOIN sharika_users bu ON bu.auth_uid=f.bd_uid '+
    "LEFT JOIN sharika_family_crystal_ledger l ON l.family_id=f.id AND l.created_at>=datetime('now','-31 days') "+
    'GROUP BY f.id ORDER BY f.id DESC LIMIT 1000');
  const d=day(),generated=new Date().toISOString();
  const ranges=[
    range('Gift Ledger',14,gift.reverse().map(x=>[
      x.transaction_id,x.created_at,x.room_id,pid(x.sender_no),x.family_id,
      x.gift_id,x.quantity,x.quantity*x.price_coins,pid(x.bd_no),x.bd_bps/100,
      x.bd_units/10000,pid(x.owner_no),x.owner_units/10000,'recorded'])),
    range('BD Commissions',9,comm.reverse().map(x=>[
      x.id,x.transaction_id,x.created_at,pid(x.bd_no),x.family_id,
      x.gift_coins,x.rate_bps/100,x.crystal_units/10000,'recorded'])),
    range('Family Grants',8,grants.reverse().map(x=>[
      x.id,x.created_at,pid(x.bd_no),pid(x.owner_no),x.family_id,x.name,x.status,'granted'])),
    range('Crystal Ledger',9,ledger.reverse().map(x=>[
      x.id,x.created_at,pid(x.beneficiary_no),x.kind,x.gift_event_id,
      x.crystal_units/10000,x.balance_units/10000,x.rate_bps/100,'recorded'])),
    range('Seller Transfers',9,transfers.reverse().map(x=>[
      x.id,x.created_at,pid(x.sender_no),pid(x.seller_no),x.crystal_units/10000,
      null,x.coins_to_seller,x.status,x.resolved_at||''])),
    range('Overview',12,overview.reverse().map(x=>[
      'Trailing 31 days',new Date(Date.now()-31*86400000).toISOString().slice(0,10),d,
      x.family_id,x.name,pid(x.bd_no),x.gift_coins,x.bd_units/10000,
      x.owner_units/10000,'verified',generated,x.n]))
  ];
  const token=await googleToken(env);
  const response=await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+
    encodeURIComponent(env.SHARIKA_FAMILY_SHEET_ID)+'/values:batchUpdate',{
      method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:JSON.stringify({valueInputOption:'RAW',data:ranges}),
      signal:AbortSignal.timeout(20000)
    });
  if(!response.ok)throw Error('sheets_update_http_'+response.status);
  const result=await response.json();
  if(!result.totalUpdatedSheets||result.totalUpdatedSheets<6)
    throw Error('sheets_update_incomplete');
  const count=gift.length+comm.length+grants.length+ledger.length+transfers.length;
  await db.prepare(
    "INSERT INTO sharika_family_sheet_sync(key,last_synced_day,last_synced_at,record_count) "+
    "VALUES('standard',?,datetime('now'),?) ON CONFLICT(key) DO UPDATE SET "+
    "last_synced_day=excluded.last_synced_day,last_synced_at=datetime('now'),"+
    "record_count=excluded.record_count"
  ).bind(d,count).run();
  return {synced:true,day:d,record_count:count};
}
export async function syncFamilyGoogleSheetIfDue(env){
  if(!env.DB||!sheetsConfigured(env))return;
  const status=await sheetSyncStatus(env.DB,env);
  if(status.last_synced_day===day())return;
  await syncFamilyGoogleSheet(env);
}
