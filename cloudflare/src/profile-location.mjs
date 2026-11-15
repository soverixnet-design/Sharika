const PRICE_LIMIT = 1_000_000_000;
const COUNTRY_CODE = /^[A-Z]{2}$/;
const CHANGE_ID = /^location:[A-Za-z0-9:_-]{6,110}$/;
const validPrice = coins => Number.isSafeInteger(coins) && coins >= 0 && coins <= PRICE_LIMIT;
const countryPrice = "CASE WHEN TRIM(COALESCE(u.country,''))='' THEN 0 ELSE s.coins END";

async function quote(db, uid) {
  return db.prepare(
    "SELECT COALESCE(u.country,'') AS country,u.coins," + countryPrice + " AS change_price " +
    "FROM sharika_users u JOIN sharika_location_price s ON s.id=1 WHERE u.auth_uid=? AND u.status='active'"
  ).bind(uid).first();
}

export async function handleLocation({request,db,uid,readBody,reply,fail,cors}) {
  if (request.method === 'GET') {
    const current = await quote(db, uid);
    return current ? reply(current,200,cors) : fail('profile_not_found',404,cors);
  }
  if (request.method !== 'PUT') return fail('method_not_allowed',405,cors);
  const body = await readBody(request);
  const country = body.country;
  const requestId = body.request_id;
  if (typeof country !== 'string' || !COUNTRY_CODE.test(country) ||
      typeof requestId !== 'string' || !CHANGE_ID.test(requestId) ||
      typeof body.expected_country !== 'string' || body.expected_country.length > 16 ||
      !validPrice(body.expected_coins))
    return fail('invalid_location_change',400,cors);

  // The price, balance, and last confirmed country are checked in the same
  // statement that creates the receipt. The trigger moves the balance and
  // updates the profile within that transaction.
  const result = await db.prepare(
    "INSERT INTO sharika_location_changes(auth_uid,request_id,old_country,country,coins) " +
    "SELECT u.auth_uid,?,COALESCE(u.country,''),?,"+countryPrice+" " +
    "FROM sharika_users u JOIN sharika_location_price s ON s.id=1 " +
    "WHERE u.auth_uid=? AND u.status='active' AND COALESCE(u.country,'')=? " +
    "AND UPPER(TRIM(COALESCE(u.country,'')))<>? AND ("+countryPrice+")=? AND u.coins>=("+countryPrice+") " +
    "ON CONFLICT(auth_uid,request_id) DO NOTHING"
  ).bind(requestId,country,uid,body.expected_country,country,body.expected_coins).run();
  const saved = await db.prepare(
    'SELECT country,coins,old_country FROM sharika_location_changes WHERE auth_uid=? AND request_id=?'
  ).bind(uid,requestId).first();
  const current = await quote(db,uid);
  if (!current) return fail('profile_not_found',404,cors);
  if (saved) {
    if (saved.country !== country || saved.coins !== body.expected_coins || saved.old_country !== body.expected_country)
      return fail('location_request_conflict',409,cors);
    return reply({...current,charged_coins:saved.coins,duplicate:!result.meta.changes},200,cors);
  }
  if (current.country.trim().toUpperCase() === country)
    return reply({...current,charged_coins:0,unchanged:true},200,cors);
  if (current.country !== body.expected_country || current.change_price !== body.expected_coins)
    return fail('location_quote_changed',409,cors);
  if (current.coins < current.change_price) return fail('insufficient_coins',409,cors);
  return fail('location_quote_changed',409,cors);
}

export async function handleAdminLocation({request,db,uid,role,reply,fail,cors}) {
  if (role !== 'super') return fail('admin_permission_denied',403,cors);
  if (request.method === 'GET') {
    const price = await db.prepare('SELECT coins FROM sharika_location_price WHERE id=1').first();
    return reply({coins:price.coins},200,cors);
  }
  if (!['PATCH','POST'].includes(request.method)) return fail('method_not_allowed',405,cors);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return fail('invalid_location_settings',400,cors);
    body = JSON.parse(raw);
  }
  catch { return fail('invalid_location_settings',400,cors); }
  if (!body || typeof body !== 'object') return fail('invalid_location_settings',400,cors);

  if (request.method === 'PATCH') {
    if (!validPrice(body.coins) || !validPrice(body.expected_coins))
      return fail('invalid_location_price',400,cors);
    const [,updated] = await db.batch([
      db.prepare('INSERT INTO sharika_location_price_audit(actor_uid,previous_coins,next_coins) '+
        'SELECT ?,coins,? FROM sharika_location_price WHERE id=1 AND coins=? AND coins<>?')
        .bind(uid,body.coins,body.expected_coins,body.coins),
      db.prepare('UPDATE sharika_location_price SET coins=? WHERE id=1 AND coins=?')
        .bind(body.coins,body.expected_coins)
    ]);
    if (!updated.meta.changes)
      return fail('location_price_changed',409,cors);
    return reply({coins:body.coins},200,cors);
  }

  const publicId = body.target_public_id;
  const country = body.country;
  if (typeof publicId !== 'string' || !/^[0-9]{8}$/.test(publicId) ||
      typeof country !== 'string' || !COUNTRY_CODE.test(country))
    return fail('invalid_location_target',400,cors);
  const target = await db.prepare("SELECT auth_uid FROM sharika_users WHERE public_no=? AND status='active'")
    .bind(Number(publicId)).first();
  if (!target) return fail('profile_not_found',404,cors);
  const saved = await db.prepare(
    'INSERT INTO sharika_location_changes(auth_uid,request_id,actor_uid,old_country,country,coins) '+
    "SELECT auth_uid,?,?,COALESCE(country,''),?,0 FROM sharika_users "+
    "WHERE auth_uid=? AND status='active' AND UPPER(TRIM(COALESCE(country,'')))<>?"
  ).bind('admin-location:'+crypto.randomUUID(),uid,country,target.auth_uid,country).run();
  return reply({country,changed:!!saved.meta.changes},200,cors);
}
