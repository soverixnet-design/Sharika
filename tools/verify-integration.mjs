// Static integration checks for Sharika. Never executes app/backend code.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';

const pairs = [
  ['app/index.html', 'app/connection.js'],
  ['admin/index.html', 'admin/connection.js'],
];

for (const [htmlPath, bridgePath] of pairs) {
  const html = readFileSync(htmlPath, 'utf8');
  const bridge = readFileSync(bridgePath, 'utf8');
  assert.ok(html.length > 20_000, htmlPath + ' is unexpectedly short');
  assert.ok(bridge.length > 100, bridgePath + ' is unexpectedly short');
  new Script(bridge, { filename: bridgePath }); // Parse the entire adapter without executing it.
  const sources = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1]);
  assert.equal(sources.filter((s) => s === './connection.js').length, 1,
    htmlPath + ' must load the integration bridge exactly once');
  assert.ok(html.lastIndexOf('./connection.js') > html.lastIndexOf('<script'),
    htmlPath + ' must load its bridge after original inline scripts');
  assert.doesNotMatch(bridge, /sb_secret_|SUPABASE_SERVICE_ROLE_KEY|SHARIKA_LIVEKIT_API_SECRET/,
    bridgePath + ' appears to contain a server-side secret identifier');
  console.log('PASS: ' + htmlPath + ' keeps a separate, final connection bridge');
}

const api = readFileSync('backend/sharika-api/index.ts', 'utf8');
assert.match(api, /Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/,
  'The Edge Function should read its server credential from the environment');
assert.doesNotMatch(api, /sb_secret_[A-Za-z0-9]+/,
  'Never commit a literal server API key');
const workflow = readFileSync('.github/workflows/sharika-server-sync.yml', 'utf8');
assert.match(workflow, /SHARIKA_AUTO_DEPLOY == 'enabled'/,
  'Automatic synchronization must remain opt-in');
assert.match(workflow, /StrictHostKeyChecking=yes/,
  'SSH host checking must remain enforced');
assert.match(workflow, /\[ "\$DEPLOY_USER" = "root" \]/,
  'Root deployment must be rejected');
console.log('PASS: Edge secret boundaries and safe deploy defaults');

const admin = readFileSync('admin/connection.js', 'utf8');
assert.match(admin, /field\.onkeydown\s*=\s*event\s*=>/,
  'Enter-key handling must override the legacy demo login');
assert.match(admin, /if\s*\(!session\s*\|\|\s*!activeRole\)\s*\{\s*window\.login\(\);\s*return;/,
  'Admin shell must reject sessions without a server-verified admin role');
assert.match(admin, /api\('GET','\/admin\/status'\)/,
  'Admin role must be verified by the server');
assert.match(admin, /localStorage\.removeItem\('aa'\)/,
  'Legacy local demo login must be cleared');
console.log('PASS: demo sign-in cannot bypass the connected admin gate');
const adminHtml = readFileSync('admin/index.html', 'utf8');
assert.doesNotMatch(adminHtml, /value="admin@akira\.app"|value="admin123"|value="123456"/,
  'Original admin HTML must not embed demo credentials');
assert.doesNotMatch(adminHtml, /ME=st\(1,"aa"\);if\(ME\)shell\(\)/,
  'Legacy localStorage login must not open the admin shell');
assert.match(adminHtml, /Secure admin sign-in is unavailable until the server connection loads/,
  'Admin sign-in must fail closed if the connection script is missing');
console.log('PASS: admin HTML fails closed without its backend bridge');

const roomHtml = readFileSync('app/index.html', 'utf8');
const appBridge = readFileSync('app/connection.js', 'utf8');
assert.ok(roomHtml.includes('setInterval(function(){var o=others();'),
  'Original room demo timer fixture has changed');
assert.ok(appBridge.includes('setInterval\\(function\\(\\)\\{var o=others\\(\\);'),
  'Bridge must suppress the 9-second fake chat timer');
console.log('PASS: connected rooms suppress template-generated chat messages');

assert.match(api, /parts\[2\] === 'leave' && parts\.length === 3 && req\.method === 'POST'/,
  'Server must support authenticated room departure');
assert.match(api, /requestDb\('sharika_room_members', 'DELETE'/,
  'Leaving members must release their persisted room presence');
assert.match(appBridge, /jsonFetch\(BASE \+ '\/functions\/v1\/sharika-api\/rooms\/'[\s\S]*?'\/leave'/,
  'Leaving a room must notify the backend');
console.log('PASS: room departure releases membership without deleting owner rooms');

