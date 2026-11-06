// Staging abuse controls. Cloudflare counters are approximate per location;
// D1 transaction constraints/idempotency remain the source of financial truth.
export function sensitiveActionClass(method, path) {
  if (!['POST','PATCH','PUT','DELETE'].includes(method) ||
      typeof path !== 'string' || !path.startsWith('/api/v1/')) return null;
  // Voice negotiation / heartbeat must never be throttled like purchases.
  if (/^\/api\/v1\/rooms\/[0-9]{8}\/voice(?:\/|$)/.test(path)) return null;
  if (
    path === '/api/v1/billing/verify' ||
    path === '/api/v1/sellers/transfer' ||
    path === '/api/v1/invites/redeem' ||
    path === '/api/v1/invites/withdrawals' ||
    path === '/api/v1/invites/convert' ||
    /^\/api\/v1\/admin\/events\/[1-9]\d*\/award$/.test(path) ||
    /^\/api\/v1\/admin\/(?:sellers|recharge|wallet|coin|exchange-rate|family|invites|cosmetics\/grant)(?:\/|$)/.test(path) ||
    /^\/api\/v1\/rooms\/[0-9]{8}\/(?:gift|gifts|lucky-gift)(?:\/|$)/.test(path) ||
    /^\/api\/v1\/(?:games|original-games|greedy-wheel|greedy)\//.test(path) && /\/bets?(?:\/|$)/.test(path) ||
    /^\/api\/v1\/(?:exchange|diamonds)(?:\/|$)/.test(path) ||
    /^\/api\/v1\/family\/.*(?:gift|transfer|withdraw)/.test(path)
  ) return 'finance';
  return 'action';
}

export async function allowSensitiveAction({ env, uid, path, method }) {
  const category = sensitiveActionClass(method, path);
  if (!category) return true;
  const binding = category === 'finance'
    ? env.SHARIKA_FINANCE_RATE_LIMIT : env.SHARIKA_ACTION_RATE_LIMIT;
  // Never accept financial mutations in production if security binding absent.
  // Staging fallback keeps older unit fixtures (and rollbacks) functional.
  if (!binding) return env.SHARIKA_ENV !== 'production';
  const decision = await binding.limit({ key: uid + ':' + category });
  return decision?.success === true;
}
