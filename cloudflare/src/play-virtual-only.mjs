// A separate Play Worker must use this mode with its OWN D1 database.
// This gate is deliberately server-side: an Android flag or request header
// cannot prove which app a Firebase user is running.
export const playVirtualOnly = env => env?.SHARIKA_PLAY_VIRTUAL_ONLY === 'true';

const restricted = /^\/api\/v1\/(?:admin|agency|family|invites|sellers|games|original-games|greedy-wheel|fruit-royale|game-catalog|lucky-box|events|role-applications)(?:\/|$)/;
const restrictedRankings = new Set(['games','recharge','lucky']);

export function playVirtualRouteBlocked(path, search = '') {
  if (restricted.test(path)) return true;
  if (path === '/api/v1/celebrations') return true;
  if (path === '/invite' || path.startsWith('/invite/')) return true;
  if (path === '/api/v1/rankings' || path === '/api/v1/rankings/rewards') {
    const params = new URLSearchParams(search);
    return restrictedRankings.has(params.get('kind'));
  }
  return false;
}

// Missing or contradictory environment variables must never silently
// re-enable cash-related features in a would-be virtual-only deployment.
export function playVirtualConfigured(env) {
  return playVirtualOnly(env) && env.SHARIKA_COINS_CASH_REDEEMABLE === 'false' &&
    env.SHARIKA_PLAY_ISOLATED_DATA === 'true';
}
