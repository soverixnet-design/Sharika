// One public identity across all Sharika environments. This binding must
// point to the SAME D1 database for staging and isolated Play Workers.
// Profiles, balances, roles, gifts, and rooms remain in their own databases.

const MIN_PUBLIC_NO = 10000001;
const MAX_PUBLIC_NO = 99999999;
const MAX_CONTENTION_RETRIES = 12;

export function normalizedPublicNo(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < MIN_PUBLIC_NO || n > MAX_PUBLIC_NO)
    throw new Error('invalid_global_public_id');
  return n;
}

/**
 * Reserve the same globally unique, monotonic public number for a Firebase UID.
 * The single INSERT statement is atomic; UNIQUE constraints resolve races.
 * A failed local profile insert may leave a reserved ID, but retrying the
 * same UID reuses it. Never reassign or recycle an ID to close sequence gaps.
 */
export async function reserveGlobalPublicNo(identityDb, uid, origin) {
  if (!identityDb?.prepare) throw new Error('global_id_registry_unavailable');
  if (typeof uid !== 'string' || !uid || uid.length > 180)
    throw new Error('invalid_global_identity');
  if (origin !== 'staging' && origin !== 'play_virtual')
    throw new Error('invalid_global_id_origin');

  const find = () => identityDb.prepare(
    'SELECT public_no FROM sharika_public_id_registry WHERE auth_uid=?'
  ).bind(uid).first();

  for (let attempt = 0; attempt < MAX_CONTENTION_RETRIES; attempt++) {
    const known = await find();
    if (known) return normalizedPublicNo(known.public_no);
    // The next number is selected and inserted within ONE SQLite statement.
    // A concurrent request either gets the next free number or is ignored;
    // the loser retries instead of assigning a duplicate public number.
    await identityDb.prepare(`
      INSERT OR IGNORE INTO sharika_public_id_registry(public_no, auth_uid, origin)
      SELECT candidate.n, ?, ?
      FROM (
        WITH RECURSIVE next_no(n) AS (
          SELECT COALESCE(MAX(public_no),10000000)+1
          FROM sharika_public_id_registry
          UNION ALL
          SELECT n+1 FROM next_no
          WHERE n < 99999999 AND EXISTS (
            SELECT 1 FROM sharika_special_ids
            WHERE special_id=CAST(n AS TEXT)
          )
        ) SELECT n FROM next_no ORDER BY n DESC LIMIT 1
      ) candidate
      WHERE candidate.n <= 99999999
    `).bind(uid, origin).run();
    const created = await find();
    if (created) return normalizedPublicNo(created.public_no);
  }
  throw new Error('global_id_allocation_contended');
}

// Pure planning: no Cloudflare writes or credentials. Prefer oldest Firebase
// identity's existing staging number; assign fresh IDs to Play-only UIDs in
// their original creation order (ties resolved by Play's existing number).
export function planPlayPublicIds(stagingRows, playRows) {
  const byUid = new Map();
  const taken = new Map();
  for (const user of stagingRows) {
    const publicNo = normalizedPublicNo(user.public_no);
    if (byUid.has(user.auth_uid) || taken.has(publicNo))
      throw new Error('staging_identity_registry_collision');
    byUid.set(user.auth_uid, publicNo);
    taken.set(publicNo, user.auth_uid);
  }
  const seenPlay = new Set();
  const sorted = [...playRows].sort((a,b) =>
    String(a.created_at||'').localeCompare(String(b.created_at||'')) ||
    Number(a.public_no)-Number(b.public_no));
  let next = [...taken.keys()].reduce((max,id)=>Math.max(max,id),10000000);
  const mapping = [];
  for (const user of sorted) {
    const oldId = normalizedPublicNo(user.public_no);
    if (!user.auth_uid || seenPlay.has(user.auth_uid))
      throw new Error('duplicate_play_firebase_uid');
    seenPlay.add(user.auth_uid);
    let canonicalId = byUid.get(user.auth_uid);
    if (!canonicalId) {
      while (taken.has(++next));
      canonicalId = normalizedPublicNo(next);
      taken.set(canonicalId, user.auth_uid);
      byUid.set(user.auth_uid, canonicalId);
    }
    mapping.push({old_play_id:oldId,canonical_id:canonicalId,
      shared_staging_identity:stagingRows.some(s=>s.auth_uid===user.auth_uid)});
  }
  return mapping;
}
