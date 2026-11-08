// Public production traffic requires an explicit reviewed source change.
// Dashboard variables alone cannot activate this Worker accidentally.
const RELEASE_REVIEW_APPROVED = false;
const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'retry-after': '3600',
  'x-content-type-options': 'nosniff',
};

export function missingProductionPrerequisites(env = {}) {
  const missing = [];
  if (env.SHARIKA_ENV !== 'production') missing.push('environment');
  if (env.SHARIKA_PUBLIC_API_ENABLED !== 'true') missing.push('activation_flag');
  if (typeof env.DB?.prepare !== 'function') missing.push('production_d1');
  if (typeof env.MEDIA_BUCKET?.get !== 'function') missing.push('production_r2');
  if (typeof env.VOICE_ROOMS?.getByName !== 'function') missing.push('voice_coordinator');
  if (typeof env.SHARIKA_ACTION_RATE_LIMIT?.limit !== 'function') missing.push('action_rate_limit');
  if (typeof env.SHARIKA_FINANCE_RATE_LIMIT?.limit !== 'function') missing.push('finance_rate_limit');
  if (!/^[a-z][a-z0-9-]{3,60}$/.test(env.FIREBASE_PROJECT_ID || ''))
    missing.push('firebase_project');
  if (!env.REALTIME_SFU_APP_ID || !env.REALTIME_SFU_APP_SECRET)
    missing.push('realtime_sfu_credentials');
  if (env.SHARIKA_COINS_CASH_REDEEMABLE !== 'false') missing.push('cash_redemption_policy');
  if (env.SHARIKA_PLAY_BILLING_ENABLED !== 'false') missing.push('billing_policy');
  if (env.SHARIKA_AUTOMATIC_RANKING_REWARDS_ENABLED !== 'false')
    missing.push('reward_policy');
  if (env.SHARIKA_PRODUCTION_CLIENT_LINKS_REVIEWED !== 'true')
    missing.push('client_and_invite_urls');
  return missing;
}

export function createProductionFetch(appHandler) {
  return async (request, env, ctx) => {
    if (!RELEASE_REVIEW_APPROVED || missingProductionPrerequisites(env).length)
      return new Response(JSON.stringify({ error: 'production_not_ready' }), {
        status: 503, headers: HEADERS,
      });
    return appHandler(request, env, ctx);
  };
}
