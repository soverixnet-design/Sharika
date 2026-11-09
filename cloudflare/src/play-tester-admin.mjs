// Read-only comparison of isolated Play closed-test profiles with their
// original staging identities. Never reconcile by public ID: each D1 database
// allocates those IDs independently, so a matching number can mean a different
// Firebase account. No wallets, roles or profiles are copied or modified.

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });
const publicId = number => String(number).padStart(8, '0');

export async function readPlayTesters(request, env) {
  if (request.method !== 'GET') return response({ error: 'method_not_allowed' }, 405);
  const bearer = request.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/.test(bearer))
    return response({ error: 'not_authenticated' }, 401);
  if (!env.SHARIKA_API || !env.PLAY_DB || !env.STAGING_DB)
    return response({ error: 'play_testers_unavailable' }, 503);

  // The old staging API validates the Firebase JWT and D1 role on every
  // request. Reuse that verified result; never trust a client-supplied role or
  // a Play numeric ID (which may belong to an unrelated tester).
  let check;
  try {
    check = await env.SHARIKA_API.fetch(new Request(
      'https://sharika-api-staging.soverixnet.workers.dev/api/v1/admin/status',
      { method: 'GET', headers: { authorization: bearer } }
    ));
    if (check.status === 401 || check.status === 403)
      return response({ error: 'admin_forbidden' }, 403);
    if (!check.ok) return response({ error: 'admin_verification_unavailable' }, 503);
    const staff = await check.json();
    if (staff.role !== 'super') return response({ error: 'super_admin_required' }, 403);
  } catch (_) {
    return response({ error: 'admin_verification_unavailable' }, 503);
  }

  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some(key => key !== 'q'))
    return response({ error: 'invalid_query' }, 400);
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length > 80) return response({ error: 'invalid_query' }, 400);
  try {
    let query = env.PLAY_DB.prepare(
      'SELECT auth_uid,public_no,name,country,status,created_at FROM sharika_users ' +
      (q ? 'WHERE lower(name) LIKE ? OR CAST(public_no AS TEXT) LIKE ? ' : '') +
      'ORDER BY created_at DESC, public_no DESC LIMIT 100'
    );
    if (q) query = query.bind('%' + q.toLowerCase() + '%', '%' + q + '%');
    const play = (await query.all()).results || [];

    // Compare immutable Firebase identities, not overlapping public numbers.
    // All private UIDs stay within this Worker and are never sent to the UI.
    const uids = [...new Set(play.map(user => user.auth_uid).filter(Boolean))];
    const previous = new Map();
    if (uids.length) {
      const slots = uids.map(() => '?').join(',');
      const sql = 'SELECT auth_uid,public_no FROM sharika_users WHERE auth_uid IN (' + slots + ')';
      const old = (await env.STAGING_DB.prepare(sql).bind(...uids).all()).results || [];
      for (const person of old) previous.set(person.auth_uid, publicId(person.public_no));
    }
    return response({
      users: play.map(person => ({
        public_id: publicId(person.public_no),
        previous_staging_id: previous.get(person.auth_uid) || null,
        name: person.name, country: person.country, status: person.status,
        created_at: person.created_at
      })),
      environment: 'play_virtual', read_only: true, limited_to: 100,
      identity_match: 'firebase_uid'
    });
  } catch (_) {
    return response({ error: 'play_testers_unavailable' }, 503);
  }
}
