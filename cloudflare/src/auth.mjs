// Firebase Authentication is a separate no-cost identity provider.
// The Worker accepts *only* verified Firebase ID tokens; never trusts client UID claims.
// This module does not use Supabase or any privileged Firebase service account.
const KEYS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let keyCache = { until: 0, keys: [] };

function decodeJson(part) {
  const binary = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
}
function bytes(part) {
  const binary = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function currentKeys(fetcher, now) {
  if (keyCache.until > now && keyCache.keys.length) return keyCache.keys;
  const result = await fetcher(KEYS_URL);
  if (!result.ok) throw new Error('identity_provider_unavailable');
  const data = await result.json();
  if (!Array.isArray(data.keys)) throw new Error('identity_provider_unavailable');
  const maxAge = Number(result.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 300);
  keyCache = { keys: data.keys, until: now + Math.min(Math.max(maxAge, 60), 3600) * 1000 };
  return data.keys;
}

export async function verifyFirebaseToken(headerValue, projectId, fetcher = fetch, timestamp = Date.now()) {
  if (!/^[a-z][a-z0-9-]{3,60}$/.test(projectId || '')) throw new Error('identity_not_configured');
  if (!headerValue?.startsWith('Bearer ')) return null;
  const jwt = headerValue.slice(7).trim();
  if (jwt.length > 8192) return null;
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const [header, payload] = parts.slice(0, 2).map(decodeJson);
    const now = Math.floor(timestamp / 1000);
    if (header.alg !== 'RS256' || !header.kid || header.typ && header.typ !== 'JWT') return null;
    if (payload.aud !== projectId || payload.iss !== 'https://securetoken.google.com/' + projectId ||
        typeof payload.sub !== 'string' || payload.sub.length < 1 || payload.sub.length > 128 ||
        !Number.isInteger(payload.exp) || payload.exp <= now ||
        !Number.isInteger(payload.iat) || payload.iat > now ||
        !Number.isInteger(payload.auth_time) || payload.auth_time > now) return null;
    const key = (await currentKeys(fetcher, timestamp)).find(k => k.kid === header.kid && k.kty === 'RSA' && k.alg === 'RS256');
    if (!key) return null;
    const imported = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', imported, bytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!valid) return null;
    return { uid: 'firebase:' + projectId + ':' + payload.sub, email: payload.email || '', verified: payload.email_verified === true };
  } catch (error) {
    if (error.message === 'identity_provider_unavailable') throw error;
    return null;
  }
}
