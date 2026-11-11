const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'app/royal-motion-system.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const gradle = fs.readFileSync(path.join(__dirname, 'app/build.gradle'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, 'royal-premium.js'), 'utf8');

test('royal motion is included in the website and Android package', () => {
  assert.match(html, /id="sharika-royal-motion-style"[^>]+royal-motion-system\.css/);
  assert.match(gradle, /from\(rootProject\.file\('\.\.\/app\/royal-motion-system\.css'\)\)/);
  assert.match(loader, /var MOTION_URL = 'file:\/\/\/android_asset\/royal-motion-system\.css'/);
  assert.match(loader, /ensureSheet\(doc,'sharika-royal-motion-style',MOTION_URL\)/);
  assert.match(loader, /'<link id="sharika-royal-motion-style"/);
});

test('royal motion covers the five primary surfaces and has a reduced-motion mode', () => {
  for (const selector of ['#v-home', '#v-me', '#v-rank', '.shw-hero', '.sh-royal-room']) {
    assert.ok(css.includes(selector), `missing motion treatment for ${selector}`);
  }
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.seat\.talk \.ring/);
  // Transforms on the room seat/grid would reintroduce the user's seat shaking issue.
  assert.doesNotMatch(css, /\.sh-royal-room \.grid\s*\{[^}]*animation\s*:/);
  assert.doesNotMatch(css, /\.sh-royal-room \.seat\s*\{[^}]*transform\s*:/);
});

test('CSS blocks are balanced', () => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  for (const c of withoutComments) {
    if (c === '{') depth++;
    if (c === '}') depth--;
    assert.ok(depth >= 0, 'unexpected closing brace');
  }
  assert.equal(depth, 0);
});
