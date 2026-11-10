// Verified Google Play one-time consumable coin purchases.
// This module deliberately refuses all grants until a production service
// account and the Play Console product catalog have been configured.
const PACKAGE = 'com.soverixnet.sharika';
const MAX_BALANCE = 1_000_000_000_000;
export const PLAY_COIN_PRODUCTS = Object.freeze({
  sharika_coins_500k: 500_000,
  sharika_coins_2500k: 2_500_000,
  sharika_coins_5000k: 5_000_000
});
const PRODUCT_IDS = Object.keys(PLAY_COIN_PRODUCTS);
const TOKEN = /^[A-Za-z0-9._~-]{20,4096}$/;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const STS_URL = 'https://sts.googleapis.com/v1/token';
const WIF_IDENTITY_PATH = '/internal/google-wif/subject-token';
const WIF_PROVIDER = /^\/\/iam\.googleapis\.com\/projects\/[0-9]+\/locations\/global\/workloadIdentityPools\/[A-Za-z0-9_-]+\/providers\/[A-Za-z0-9_-]+$/;
const SERVICE_ACCOUNT_EMAIL = /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/;
const PLAY_API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/';

function b64url(data) {
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function sha256Hex(data) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function signServiceAccountToken(serviceAccount, now) {
  const keyBase64 = String(serviceAccount.private_key || '')
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  if (!/^[A-Za-z0-9+/=]{400,}$/.test(keyBase64) ||
      !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(serviceAccount.client_email || ''))
    throw new Error('play_service_account_not_configured');
  const der = Uint8Array.from(atob(keyBase64), ch => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3300
  }));
  const signed = new TextEncoder().encode(header + '.' + payload);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, signed));
  return header + '.' + payload + '.' + b64url(signature);
}

async function fetchWithTimeout(fetcher, url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try { return await fetcher(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function isWifConfigured(env) {
  if (!WIF_PROVIDER.test(env.PLAY_BILLING_WIF_PROVIDER_AUDIENCE || '') ||
      !SERVICE_ACCOUNT_EMAIL.test(env.PLAY_BILLING_WIF_SERVICE_ACCOUNT_EMAIL || '') ||
      !env.PLAY_BILLING_WIF_ACCESS_CLIENT_ID || !env.PLAY_BILLING_WIF_ACCESS_CLIENT_SECRET ||
      !/^[a-z0-9]{20,}\.access$/.test(env.PLAY_BILLING_WIF_ACCESS_CLIENT_ID) ||
      !/^[a-f0-9]{64}$/.test(env.PLAY_BILLING_WIF_ACCESS_AUDIENCE || '') ||
      !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.PLAY_BILLING_WIF_ACCESS_ISSUER || ''))
    return false;
  try {
    const url = new URL(env.PLAY_BILLING_WIF_IDENTITY_URL);
    return url.protocol === 'https:' && url.hostname.endsWith('.sharika.app') &&
      url.pathname === WIF_IDENTITY_PATH && !url.port && !url.username &&
      !url.password && !url.search && !url.hash;
  } catch (_) { return false; }
}

function isPlayBillingConfigured(env) {
  return env.PLAY_BILLING_AUTH_MODE === 'wif_access' ? isWifConfigured(env) :
    !env.PLAY_BILLING_AUTH_MODE && !!env.PLAY_BILLING_SERVICE_ACCOUNT_JSON;
}

function readAccessAssertion(jwt, env) {
  if (typeof jwt !== 'string' || jwt.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt))
    throw new Error('play_wif_invalid_assertion');
  let claims;
  try {
    const payload = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    claims = JSON.parse(atob(payload));
  } catch (_) { throw new Error('play_wif_invalid_assertion'); }
  // This is a preflight check, not cryptographic verification: Google STS
  // independently validates the Cloudflare Access signature and trust policy.
  if (claims.iss !== env.PLAY_BILLING_WIF_ACCESS_ISSUER ||
      !(claims.aud === env.PLAY_BILLING_WIF_ACCESS_AUDIENCE ||
        (Array.isArray(claims.aud) &&
          claims.aud.includes(env.PLAY_BILLING_WIF_ACCESS_AUDIENCE))) ||
      claims.common_name !== env.PLAY_BILLING_WIF_ACCESS_CLIENT_ID ||
      claims.type !== 'app' || !Number.isFinite(claims.exp) ||
      claims.exp <= Math.floor(Date.now() / 1000) + 60)
    throw new Error('play_wif_invalid_assertion');
  return jwt;
}

async function getWifAccessToken(env, fetcher) {
  if (!isWifConfigured(env)) throw new Error('play_wif_not_configured');
  // The separate identity endpoint MUST be behind Cloudflare Access with a
  // Service Auth policy limited to this one token. It returns the Access JWT
  // injected by Cloudflare to its origin, never a self-signed Google key.
  const identityResponse = await fetchWithTimeout(fetcher, env.PLAY_BILLING_WIF_IDENTITY_URL, {
    // Cloudflare Workers only supports "follow" or "manual"; manual responses
    // remain fail-closed because any 3xx status is rejected below.
    method: 'GET', redirect: 'manual',
    headers: {
      'CF-Access-Client-Id': env.PLAY_BILLING_WIF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': env.PLAY_BILLING_WIF_ACCESS_CLIENT_SECRET,
      accept: 'application/json'
    }
  });
  if (!identityResponse.ok) throw new Error('play_wif_identity_unavailable');
  const identity = await identityResponse.json();
  const subjectToken = readAccessAssertion(identity?.subject_token, env);
  const stsResponse = await fetchWithTimeout(fetcher, STS_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      audience: env.PLAY_BILLING_WIF_PROVIDER_AUDIENCE,
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt', subjectToken
    })
  });
  if (!stsResponse.ok) throw new Error('play_wif_sts_unavailable');
  const sts = await stsResponse.json();
  if (!sts.access_token || sts.token_type?.toLowerCase() !== 'bearer')
    throw new Error('play_wif_sts_invalid_response');
  const account = encodeURIComponent(env.PLAY_BILLING_WIF_SERVICE_ACCOUNT_EMAIL);
  const impersonateResponse = await fetchWithTimeout(fetcher,
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateAccessToken`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${sts.access_token}` },
      body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/androidpublisher'],
        lifetime: '3600s' })
    });
  if (!impersonateResponse.ok) throw new Error('play_wif_impersonation_unavailable');
  const impersonated = await impersonateResponse.json();
  if (typeof impersonated.accessToken !== 'string' || !impersonated.accessToken)
    throw new Error('play_wif_impersonation_invalid_response');
  return impersonated.accessToken;
}

async function getGoogleAccessToken(env, fetcher) {
  if (env.PLAY_BILLING_AUTH_MODE === 'wif_access')
    return getWifAccessToken(env, fetcher);
  if (env.PLAY_BILLING_AUTH_MODE) throw new Error('play_auth_mode_invalid');
  if (!env.PLAY_BILLING_SERVICE_ACCOUNT_JSON)
    throw new Error('play_service_account_not_configured');
  let serviceAccount;
  try { serviceAccount = JSON.parse(env.PLAY_BILLING_SERVICE_ACCOUNT_JSON); }
  catch (_) { throw new Error('play_service_account_not_configured'); }
  const assertion = await signServiceAccountToken(serviceAccount, Math.floor(Date.now() / 1000));
  const response = await fetchWithTimeout(fetcher, TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!response.ok) throw new Error('play_oauth_unavailable');
  const body = await response.json();
  if (!body.access_token || body.token_type?.toLowerCase() !== 'bearer')
    throw new Error('play_oauth_invalid_response');
  return body.access_token;
}

export async function verifyGooglePurchase({ env, uid, productId, purchaseToken, fetcher = fetch }) {
  if (!Object.hasOwn(PLAY_COIN_PRODUCTS, productId) || !TOKEN.test(purchaseToken))
    throw new Error('invalid_play_purchase');
  const accessToken = await getGoogleAccessToken(env, fetcher);
  const encodedToken = encodeURIComponent(purchaseToken);
  const path = `${PLAY_API}${PACKAGE}/purchases/products/${productId}/tokens/${encodedToken}`;
  const response = await fetchWithTimeout(fetcher, path, {
    method: 'GET', headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error('play_purchase_not_verified');
  const receipt = await response.json();
  const expectedUser = await sha256Hex(uid);
  if (receipt.purchaseState !== 0 || receipt.productId !== productId ||
      receipt.obfuscatedExternalAccountId !== expectedUser ||
      (receipt.quantity != null && receipt.quantity !== 1) ||
      receipt.consumptionState !== 0 || !receipt.orderId)
    throw new Error('play_purchase_not_verified');
  return { accessToken, orderId: receipt.orderId };
}

async function consumeGooglePurchase(fetcher, accessToken, productId, purchaseToken) {
  const path = `${PLAY_API}${PACKAGE}/purchases/products/${productId}/tokens/${encodeURIComponent(purchaseToken)}:consume`;
  // Android Publisher's products.consume endpoint is a POST, not a client-side
  // BillingClient.consumeAsync call. The backend remains the authority.
  const response = await fetchWithTimeout(fetcher, path, {
    method: 'POST', headers: { authorization: `Bearer ${accessToken}` }
  });
  return response.ok;
}

function safeReply(reply, data, status, cors) { return reply(data, status, cors); }

export async function handlePlayBillingApp({
  request, env, uid, path, cors, reply, fail, readBody, fetcher = fetch
}) {
  if (!path.startsWith('/api/v1/play-billing/')) return null;
  if (path === '/api/v1/play-billing/catalog' && request.method === 'GET') {
    return safeReply(reply, {
      enabled: env.SHARIKA_PLAY_BILLING_ENABLED === 'true' && isPlayBillingConfigured(env),
      products: PRODUCT_IDS.map(id => ({ id, coins: PLAY_COIN_PRODUCTS[id] })),
      prices_from_google_play: true
    }, 200, cors);
  }
  if (path !== '/api/v1/play-billing/claim' || request.method !== 'POST')
    return fail('play_billing_route_not_found', 404, cors);
  if (env.SHARIKA_PLAY_BILLING_ENABLED !== 'true')
    return fail('play_billing_not_configured', 503, cors);
  if (!isPlayBillingConfigured(env))
    return fail('play_billing_not_configured', 503, cors);

  let body;
  try { body = await readBody(request); }
  catch (_) { return fail('invalid_body', 400, cors); }
  const productId = body?.product_id, purchaseToken = body?.purchase_token;
  if (typeof productId !== 'string' || typeof purchaseToken !== 'string' ||
      !Object.hasOwn(PLAY_COIN_PRODUCTS, productId) || !TOKEN.test(purchaseToken))
    return fail('invalid_play_purchase', 400, cors);
  const tokenHash = await sha256Hex(purchaseToken);
  const prior = await env.DB.prepare(
    'SELECT user_uid,product_id,coins,consumed_at FROM sharika_google_play_purchases WHERE token_hash=?'
  ).bind(tokenHash).first();
  if (prior) {
    if (prior.user_uid !== uid || prior.product_id !== productId)
      return fail('play_purchase_already_claimed', 409, cors);
    // Network failure after committing coins must not strand an unconsumed
    // Google Play token. Retrying is safe: the ledger already guarantees no
    // second coin grant, and an already-consumed token is harmless.
    let consumptionPending = !prior.consumed_at;
    if (consumptionPending) {
      try {
        const accessToken = await getGoogleAccessToken(env, fetcher);
        if (await consumeGooglePurchase(fetcher, accessToken, productId, purchaseToken)) {
          await env.DB.prepare(
            "UPDATE sharika_google_play_purchases SET consumed_at=datetime('now') WHERE token_hash=?"
          ).bind(tokenHash).run();
          consumptionPending = false;
        }
      } catch (error) { console.error('play_billing_consume_retry_required', error?.message || 'unknown'); }
    }
    return safeReply(reply, { credited: true, duplicate: true, coins: prior.coins,
      consumption_pending: consumptionPending }, 200, cors);
  }

  let receipt;
  try { receipt = await verifyGooglePurchase({ env, uid, productId, purchaseToken, fetcher }); }
  catch (error) {
    if (error.message === 'invalid_play_purchase' || error.message === 'play_purchase_not_verified')
      return fail('play_purchase_not_verified', 409, cors);
    console.error('play_billing_verification_unavailable', error?.message || 'unknown');
    return fail('play_verification_unavailable', 503, cors);
  }
  const coins = PLAY_COIN_PRODUCTS[productId];
  const user = await env.DB.prepare(
    'SELECT coins,status FROM sharika_users WHERE auth_uid=?'
  ).bind(uid).first();
  if (!user || user.status !== 'active') return fail('profile_unavailable', 403, cors);
  if (Number(user.coins) > MAX_BALANCE - coins)
    return fail('recipient_balance_limit', 409, cors);
  try {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO sharika_google_play_purchases(token_hash,user_uid,product_id,coins,order_id) VALUES(?,?,?,?,?)'
      ).bind(tokenHash, uid, productId, coins, receipt.orderId),
      env.DB.prepare(
        "UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins<=? THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?"
      ).bind(MAX_BALANCE - coins, coins, uid),
      env.DB.prepare(
        "INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'google_play_recharge',?)"
      ).bind(uid, coins, uid, 'google-play:' + tokenHash)
    ]);
  } catch (error) {
    const repeated = await env.DB.prepare(
      'SELECT user_uid,product_id,coins,consumed_at FROM sharika_google_play_purchases WHERE token_hash=?'
    ).bind(tokenHash).first();
    if (repeated?.user_uid === uid && repeated?.product_id === productId)
      return safeReply(reply, { credited: true, duplicate: true, coins: repeated.coins }, 200, cors);
    console.error('play_billing_ledger_unavailable', error?.message || 'unknown');
    return fail('play_purchase_commit_failed', 503, cors);
  }

  let consumed = false;
  try { consumed = await consumeGooglePurchase(fetcher, receipt.accessToken, productId, purchaseToken); }
  catch (error) { console.error('play_billing_consume_retry_required', error?.message || 'unknown'); }
  if (consumed) {
    try {
      await env.DB.prepare(
        "UPDATE sharika_google_play_purchases SET consumed_at=datetime('now') WHERE token_hash=?"
      ).bind(tokenHash).run();
    } catch (error) { console.error('play_billing_consumed_status_unavailable', error?.message || 'unknown'); }
  }
  return safeReply(reply, { credited: true, duplicate: false, coins,
    consumption_pending: !consumed }, 201, cors);
}
