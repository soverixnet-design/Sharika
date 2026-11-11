const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = __dirname;
const script = readFileSync(join(root, 'staging-connection.js'), 'utf8');
const nativeSource = readFileSync(
  join(root, 'app/src/main/java/com/soverixnet/sharika/SharikaActivity.java'), 'utf8'
);

function installReset(value, native) {
  const start = script.indexOf("    const reset = document.getElementById('af');");
  const end = script.indexOf("    for (const id of ['wgs','ag'])", start);
  assert.ok(start > 0 && end > start, 'reset hook is present in themed auth render');
  const elements = {
    af: { disabled: false },
    aid: { value },
    ae: { textContent: '' },
  };
  const document = { getElementById: id => elements[id] || null };
  new Function('document', 'native', script.slice(start, end))(document, native);
  return elements;
}

test('Forgot password sends only a valid email through the native reset action', async () => {
  const calls = [];
  const elements = installReset('member@example.com', async (action, payload) => {
    calls.push({ action, payload });
  });
  await elements.af.onclick();
  assert.deepEqual(calls, [{ action: 'passwordReset', payload: { email: 'member@example.com' } }]);
  assert.match(elements.ae.textContent, /If this email has a password account/);
  assert.equal(elements.af.disabled, false);
});

test('Forgot password rejects invalid email before contacting Firebase', async () => {
  let called = false;
  const elements = installReset('not-an-email', async () => { called = true; });
  await elements.af.onclick();
  assert.equal(called, false);
  assert.match(elements.ae.textContent, /Enter your email/);
});

test('Forgot password failure does not expose Firebase account existence', async () => {
  const elements = installReset('member@example.com', async () => {
    throw new Error('user-not-found');
  });
  await elements.af.onclick();
  assert.match(elements.ae.textContent, /temporarily unavailable/);
  assert.doesNotMatch(elements.ae.textContent, /user-not-found/);
  assert.equal(elements.af.disabled, false);
});

test('Native bridge validates emails and sends the reset email with Firebase', () => {
  assert.match(nativeSource, /case "passwordReset": passwordReset\(id, data\); break;/);
  assert.match(nativeSource, /auth\.sendPasswordResetEmail\(email\)/);
  assert.match(nativeSource, /password_reset_unavailable_try_later/);
});
