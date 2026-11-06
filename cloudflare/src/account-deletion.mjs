// Public account deletion request, including for users who uninstalled Sharika.
// Submitting a request never deletes an account or alters a wallet. Staff must
// verify ownership and apply the documented data-retention policy separately.
const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};
const PUBLIC_ID = /^[0-9]{1,10}$/;
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,95}\.[^\s@<>]{2,24}$/;
const FORM_LIMIT = 2300;

function page(message = '', success = false) {
  const feedback = message ? `<p role="status" class="${success ? 'ok' : 'error'}">${message}</p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Delete your Sharika account</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:22px;display:grid;place-items:center;background:radial-gradient(circle at top,#433021,#160e23 75%);color:#f7e6c6;font-family:system-ui,-apple-system,sans-serif}.card{width:min(100%,480px);padding:24px;border:1px solid #dcb26c;border-radius:24px;background:#1d1428;box-shadow:0 20px 55px #090511}h1{font-size:26px;margin:7px 0 13px}p{line-height:1.55}.muted{color:#d8c6db;font-size:14px}.brand{color:#e3b864;font-weight:750;letter-spacing:1px}label{display:block;margin:15px 0 5px;font-weight:650}input,textarea{display:block;width:100%;margin-top:6px;padding:12px;border:1px solid #bd9c5e;border-radius:11px;font:inherit;color:#1e1623;background:#fff}textarea{resize:vertical}button{width:100%;margin-top:22px;padding:14px;border:0;border-radius:14px;background:linear-gradient(110deg,#ffe5a0,#cb902c);font-weight:850;color:#231528;cursor:pointer}.check{font-weight:400;display:flex;align-items:start;gap:10px}.check input{width:20px;margin:2px 0 0}.hp{position:absolute;left:-9999px}.ok{padding:12px;background:#164e40;border-radius:10px}.error{padding:12px;background:#742e3a;border-radius:10px}</style></head><body><main class="card"><div class="brand">SHARIKA · ACCOUNT SUPPORT</div><h1>Request account and data deletion</h1><p class="muted">You can make this request even if you have uninstalled the Sharika app. A support agent will verify account ownership before deleting your account and associated data. Certain transaction records may be retained when required for security, fraud prevention or legal compliance.</p>${feedback}<form method="post" action="/account-deletion" accept-charset="UTF-8"><label>Sharika user ID<input name="public_id" required inputmode="numeric" pattern="[0-9]{1,10}" maxlength="10" autocomplete="off" placeholder="Your visible Sharika ID"></label><label>Contact email<input name="contact_email" required type="email" maxlength="180" autocomplete="email" placeholder="Email where support can reach you"></label><label>Optional details<textarea name="reason" maxlength="400" rows="3" placeholder="Any information that helps verify your account"></textarea></label><label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><label class="check"><input type="checkbox" name="confirm" value="yes" required><span>I request deletion of my Sharika account and associated personal data.</span></label><button type="submit">Submit deletion request</button></form><p class="muted">This form sends a request for review; it does not delete your account immediately. Do not include passwords, recovery codes, payment card details or other secrets.</p></main></body></html>`;
}

async function bodyWithinLimit(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > FORM_LIMIT) return null;
  if (!request.body?.getReader) {
    const raw = await request.text();
    return new TextEncoder().encode(raw).length <= FORM_LIMIT ? raw : null;
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let received = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      received += part.value?.byteLength || 0;
      if (received > FORM_LIMIT) {
        await reader.cancel();
        return null;
      }
      raw += decoder.decode(part.value, { stream: true });
    }
    return raw + decoder.decode();
  } finally { reader.releaseLock(); }
}

function html(content, status = 200, method = 'GET') {
  return new Response(method === 'HEAD' ? null : content, { status, headers: HTML_HEADERS });
}

export async function handlePublicAccountDeletion(request, env, path) {
  if (path !== '/account-deletion') return null;
  if (request.method === 'GET' || request.method === 'HEAD')
    return html(page(), 200, request.method);
  if (request.method !== 'POST')
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD, POST' } });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    return html(page('Please submit the form from the Sharika website.'), 403);
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/x-www-form-urlencoded'))
    return html(page('Please submit the form from the Sharika website.'), 415);
  if (!env.DB) return html(page('The request service is temporarily unavailable.'), 503);
  try {
    const limiter = env.SHARIKA_ACTION_RATE_LIMIT;
    if (!limiter && env.SHARIKA_ENV === 'production')
      return html(page('The request service is temporarily unavailable.'), 503);
    if (limiter) {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const decision = await limiter.limit({ key: 'account-deletion:' + ip });
      if (!decision?.success)
        return html(page('Too many requests. Please try again later.'), 429);
    }
    const raw = await bodyWithinLimit(request);
    if (raw === null) return html(page('Request too large.'), 413);
    const form = new URLSearchParams(raw);
    const id = (form.get('public_id') || '').trim();
    const email = (form.get('contact_email') || '').trim().toLowerCase();
    const reason = (form.get('reason') || '').trim();
    if (form.get('website')) return html(page('Your request was received.' ,true));
    if (!PUBLIC_ID.test(id) || !EMAIL.test(email) || reason.length > 400 || form.get('confirm') !== 'yes')
      return html(page('Please enter a valid user ID, email and confirmation.'), 400);
    const duplicate = await env.DB.prepare(
      "SELECT id FROM sharika_account_deletion_requests WHERE public_id=? AND contact_email=? AND created_at>=datetime('now','-1 day') LIMIT 1"
    ).bind(id, email).first();
    if (!duplicate) await env.DB.prepare(
      'INSERT INTO sharika_account_deletion_requests(public_id,contact_email,reason) VALUES(?,?,?)'
    ).bind(id, email, reason).run();
    return html(page('Request received. Sharika Support will review it and contact you by email after verifying ownership.', true));
  } catch (error) {
    console.error('account_deletion_request_unavailable', error?.message || 'unknown');
    return html(page('The request service is temporarily unavailable.'), 503);
  }
}

export async function handleAdminAccountDeletion({ request, env, uid, path, cors, reply, fail }) {
  if (path !== '/api/v1/admin/account-deletion-requests') return null;
  if (request.method !== 'GET') return fail('method_not_allowed', 405, cors);
  if (!env.DB) return fail('database_unavailable', 503, cors);
  const access = await env.DB.prepare(
    'SELECT role FROM sharika_admin_roles WHERE auth_uid=?'
  ).bind(uid).first();
  if (!['super', 'support'].includes(access?.role))
    return fail('admin_permission_denied', 403, cors);
  const rows = (await env.DB.prepare(
    'SELECT id,public_id,contact_email,reason,status,created_at FROM sharika_account_deletion_requests ORDER BY id DESC LIMIT 100'
  ).all()).results || [];
  return reply({ requests: rows }, 200, cors);
}
