// Sharika staging admin frontend: original design, real Firebase + D1 admin data.
// This is a separate Worker. It forwards ONLY /api/v1/admin/ requests to the
// existing API through a private service binding, without changing voice routes.
import html from './admin-index.html';
import connector from './admin-connection.txt';

const SAFE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

// The owner's unchanged admin design contains one large inline script.
// Hash its exact bytes at runtime so CSP can reject injected inline scripts
// without breaking Google/Firebase sign-in or rewriting the original HTML.
const inlineAdminScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
let scriptHashPromise;
async function contentSecurityPolicy() {
  if (!inlineAdminScript) throw new Error('admin_inline_script_missing');
  if (!scriptHashPromise) {
    scriptHashPromise = crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(inlineAdminScript)).then(bytes =>
      btoa(String.fromCharCode(...new Uint8Array(bytes))));
  }
  const hash = await scriptHashPromise;
  return [
    "default-src 'none'",
    "script-src 'self' 'sha256-" + hash + "' https://accounts.google.com https://www.gstatic.com https://apis.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "media-src 'self' data: blob: https:",
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://accounts.google.com https://www.gstatic.com https://sharika-voice-chat-app.firebaseapp.com",
    "frame-src https://accounts.google.com https://sharika-voice-chat-app.firebaseapp.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
  ].join('; ');
}

async function serve(body, contentType) {
  const headers = { ...SAFE_HEADERS, 'content-type': contentType };
  if (contentType.startsWith('text/html'))
    headers['content-security-policy'] = await contentSecurityPolicy();
  return new Response(body, { status: 200, headers });
}
function fail(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status, headers: { ...SAFE_HEADERS, 'content-type': 'application/json; charset=utf-8' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === 'GET' && path === '/') {
      return Response.redirect(new URL('/admin/', url), 302);
    }
    if (request.method === 'GET' && (path === '/admin' || path === '/admin/')) {
      return serve(html, 'text/html; charset=utf-8');
    }
    if (request.method === 'GET' && path === '/admin/connection.js') {
      return serve(connector, 'application/javascript; charset=utf-8');
    }
    if (request.method === 'GET' && path === '/health') {
      return serve(JSON.stringify({ ok: true, service: 'sharika-admin-staging',
        api_service_configured: !!env.SHARIKA_API }), 'application/json; charset=utf-8');
    }
    if (path.startsWith('/api/v1/admin/')) {
      // The user's Firebase bearer token is checked again by the API/D1 Worker.
      const authorization = request.headers.get('authorization') || '';
      if (!/^Bearer\s+\S+$/.test(authorization)) return fail('not_authenticated', 401);
      if (!env.SHARIKA_API) return fail('admin_api_unavailable', 503);
      const target = new URL(path + url.search, 'https://sharika-api-staging.soverixnet.workers.dev');
      const upstream = new Request(target, request);
      // Internal service binding call is not a browser CORS request.
      upstream.headers.delete('origin');
      upstream.headers.delete('referer');
      upstream.headers.delete('cookie');
      return env.SHARIKA_API.fetch(upstream);
    }
    return fail('not_found', 404);
  }
};
