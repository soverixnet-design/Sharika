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

async function getGoogleAccessToken(env, fetcher) {
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
      enabled: env.SHARIKA_PLAY_BILLING_ENABLED === 'true',
      products: PRODUCT_IDS.map(id => ({ id, coins: PLAY_COIN_PRODUCTS[id] })),
      prices_from_google_play: true
    }, 200, cors);
  }
  if (path !== '/api/v1/play-billing/claim' || request.method !== 'POST')
    return fail('play_billing_route_not_found', 404, cors);
  if (env.SHARIKA_PLAY_BILLING_ENABLED !== 'true')
    return fail('play_billing_not_configured', 503, cors);
  if (!env.PLAY_BILLING_SERVICE_ACCOUNT_JSON)
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
