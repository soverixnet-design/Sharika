// Separate Cloudflare Access-protected origin for Google Workload Identity Federation.
// Never attach this Worker to a public workers.dev hostname. Its only purpose is
// to return an Access-signed assertion to its authorized billing service token.
const TOKEN_PATH = '/internal/google-wif/subject-token';
let cachedKeys, cachedUntil = 0;

function fromBase64Url(value) {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function configured(env) {
  return /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.PLAY_BILLING_WIF_ACCESS_ISSUER || '') &&
    /^[a-f0-9]{64}$/.test(env.PLAY_BILLING_WIF_ACCESS_AUDIENCE || '') &&
    /^[a-z0-9]{20,}\.access$/.test(env.PLAY_BILLING_WIF_ACCESS_CLIENT_ID || '') &&
    /^([a-z0-9-]+\.)+sharika\.app$/.test(env.PLAY_BILLING_WIF_IDENTITY_HOST || '');
}

async function getKeys(env, fetcher) {
  const now = Date.now();
  if (cachedKeys && cachedUntil > now && cachedKeys.issuer === env.PLAY_BILLING_WIF_ACCESS_ISSUER)
    return cachedKeys.keys;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let response;
  try {
    response = await fetcher(`${env.PLAY_BILLING_WIF_ACCESS_ISSUER}/cdn-cgi/access/certs`,
      { redirect: 'error', signal: controller.signal });
  } finally { clearTimeout(timeout); }
  if (!response.ok) throw new Error('access_jwks_unavailable');
  const data = await response.json();
  if (!Array.isArray(data?.keys) || !data.keys.length)
    throw new Error('access_jwks_invalid');
  cachedKeys = { issuer: env.PLAY_BILLING_WIF_ACCESS_ISSUER, keys: data.keys };
  cachedUntil = Date.now() + 5 * 60 * 1000;
  return data.keys;
}

export async function verifyAccessAssertion(jwt, env, fetcher = fetch) {
  if (typeof jwt !== 'string' || jwt.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt)) return false;
  let header, claims;
  try {
    const [h, p] = jwt.split('.');
    header = JSON.parse(new TextDecoder().decode(fromBase64Url(h)));
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(p)));
  } catch (_) { return false; }
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' ||
      claims.iss !== env.PLAY_BILLING_WIF_ACCESS_ISSUER ||
      claims.type !== 'app' ||
      !Array.isArray(claims.aud) ||
      !claims.aud.includes(env.PLAY_BILLING_WIF_ACCESS_AUDIENCE) ||
      claims.common_name !== env.PLAY_BILLING_WIF_ACCESS_CLIENT_ID ||
      !Number.isFinite(claims.exp) || claims.exp < now + 60 ||
      (claims.nbf != null && (!Number.isFinite(claims.nbf) || claims.nbf > now + 60)) ||
      !Number.isFinite(claims.iat) || claims.iat > now + 60) return false;
  const key = (await getKeys(env, fetcher)).find(jwk =>
    jwk.kid === header.kid && jwk.kty === 'RSA' && jwk.n && jwk.e);
  if (!key) return false;
  try {
    const verifier = await crypto.subtle.importKey('jwk',
      { kty: 'RSA', n: key.n, e: key.e, ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', verifier,
      fromBase64Url(jwt.split('.')[2]),
      new TextEncoder().encode(jwt.slice(0, jwt.lastIndexOf('.'))));
  } catch (_) { return false; }
}

export async function handlePlayBillingIdentity(request, env, fetcher = fetch) {
  const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  if (!configured(env)) return new Response('Not configured', { status: 503 });
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.hostname !== env.PLAY_BILLING_WIF_IDENTITY_HOST ||
      url.pathname !== TOKEN_PATH || url.search || url.hash) return notFound();
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  try {
    if (!await verifyAccessAssertion(assertion, env, fetcher))
      return new Response('Forbidden', { status: 403, headers: { 'cache-control': 'no-store' } });
  } catch (_) {
    return new Response('Identity unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  return Response.json({ subject_token: assertion },
    { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

export default {
  fetch(request, env) { return handlePlayBillingIdentity(request, env); }
};
