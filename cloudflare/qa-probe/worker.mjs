// Originless, data-free endpoint for checking the Cloudflare Access QA gate.
// This Worker must never bind Production D1, R2, secrets, or Voice DO.

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <title>Sharika — QA Access Check</title>
  <style>
    :root{color-scheme:dark}*{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;
      background:radial-gradient(circle at 50% 0%,#3d3021,#12131b 65%);
      color:#f9f1df;font-family:system-ui,-apple-system,sans-serif;padding:24px}
    main{max-width:520px;width:100%;border:1px solid #9b793d;
      border-radius:22px;background:#181923;padding:32px;text-align:center}
    h1{color:#e6be70;margin:10px 0 12px}p{line-height:1.6;color:#dad3c6}
    .seal{font-size:40px}.muted{font-size:14px;color:#a9a3a2}
  </style>
</head>
<body><main>
  <div class="seal" aria-hidden="true">🔒</div>
  <h1>Sharika QA Access</h1>
  <p>The protected test page is reachable. This confirms the browser completed the Cloudflare Access gateway flow.</p>
  <p class="muted">This is a connection test only. The Production API, coin wallets, rooms, databases, and payouts remain disabled.</p>
</main></body>
</html>`;

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

async function handleFetch(request) {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD", "cache-control": "no-store" } });
  }
  if (url.pathname !== "/") {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  return new Response(request.method === "HEAD" ? null : PAGE, { status: 200, headers: HEADERS });
}

// The small QA Worker is uploaded using the classic application/javascript
// script API. No bindings, credentials, data, or external requests are used.
addEventListener("fetch", (event) => {
  event.respondWith(handleFetch(event.request));
});
