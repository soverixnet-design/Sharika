// Public, read-only invite landing page. All attribution and coins are verified
// by the authenticated /me or /invites/redeem D1 transaction, not by this link.
export const INVITE_LINK_BASE='https://sharika-api-staging.soverixnet.workers.dev/invite/';
const PLAY_DETAILS='https://play.google.com/store/apps/details?id=com.soverixnet.sharika';
const STAGING_APK='https://github.com/soverixnet-design/Sharika/releases/download/sharika-preplay-family-qa-staging-f05f7d24/Sharika-PrePlay-Family-Room-QA-Staging.apk';
const HEADERS={
  'content-type':'text/html; charset=utf-8',
  'cache-control':'public, max-age=300',
  'x-content-type-options':'nosniff',
  'x-frame-options':'DENY',
  'referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; navigate-to https: sharika:"
};
export function handleInviteLanding(request,path){
  const match=/^\/invite\/([0-9]{8})$/.exec(path);
  if(!match)return null;
  if(request.method!=='GET'&&request.method!=='HEAD')
    return new Response('Method not allowed',{status:405,headers:{allow:'GET, HEAD','cache-control':'no-store'}});
  const code=match[1];
  const direct='sharika://invite/'+code;
  // Google Play carries this exact referral across installation. The Android
  // client reads it through the official Play Install Referrer API on first run.
  const play=PLAY_DETAILS+'&referrer='+encodeURIComponent('sharika_invite='+code);
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Join Sharika — Invitation</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at top,#6a3f16,#1e0e2c 66%,#0d071c);color:#ffe9a6;font-family:system-ui,-apple-system,sans-serif;padding:22px}.card{width:min(100%,430px);text-align:center;background:#180d28;border:2px solid #dba745;border-radius:28px;box-shadow:0 18px 60px #05020a;padding:30px 22px}h1{margin:8px 0;font-size:30px}p{line-height:1.55;color:#efdfcc}.gold{color:#fbe8a7;font-weight:800;letter-spacing:2px}.btn{display:block;padding:15px;margin-top:13px;border-radius:14px;text-decoration:none;font-weight:850;background:linear-gradient(110deg,#ffe69b,#c18a22);color:#25122a}.secondary{background:#413052;color:#fff;border:1px solid #d8b46c}.small{font-size:13px;color:#d2c3d0}</style></head><body><main class="card"><div class="gold">✦ SHARIKA ROYAL INVITATION ✦</div><h1>Join Sharika</h1><p>Your friend invited you. Open Sharika and create your account — your inviter is linked automatically, without typing a code.</p><a class="btn" href="${direct}">Open Sharika App</a><a class="btn secondary" href="${play}">Install with Google Play</a><a class="btn secondary" href="${STAGING_APK}">Download Test APK</a><p class="small">If you install the test APK directly, tap this invitation link again before signing up. Google Play installations receive the invitation through Play Install Referrer. Rewards require an eligible new account and server verification.</p></main></body></html>`;
  return new Response(request.method==='HEAD'?null:html,{status:200,headers:HEADERS});
}
