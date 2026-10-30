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
};

function serve(body, contentType) {
  return new Response(body, { status: 200,
    headers: { ...SAFE_HEADERS, 'content-type': contentType } });
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
