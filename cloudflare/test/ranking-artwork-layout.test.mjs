import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../../app/royal-ranking-v2.css',import.meta.url),'utf8');
const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');

test('reward champion avatars contain their own frame and medal overlays',()=>{
  assert.match(css,/\.sh-rw-winner \.sh-royal-avatar\s*\{[^}]*position:relative;/,
    'without a positioned avatar wrapper, an absolute frame fills the reward screen');
  assert.match(css,/#sh-rank-reward-center \.sh-rw-winner \.sh-royal-avatar>\.sh-sovera-frame\.fxr\s*\{[^}]*width:125%!important;[^}]*height:125%!important;/);
  assert.match(css,/#sh-rank-reward-center \.sh-rw-winner \.sh-royal-medal\s*\{[^}]*position:absolute;[^}]*width:23px;height:23px;/,
    'unscoped medal images can render at their natural, oversized dimensions');
});

test('ranking podium and list frames cannot cover names or user IDs',()=>{
  assert.match(css,/#rb \.sh-royal-podium-card \.sh-royal-avatar>\.sh-sovera-frame\.fxr\s*\{[^}]*width:125%!important;/);
  assert.match(css,/#rb \.rr\.sh-royal-row \.sh-royal-avatar>\.sh-sovera-frame\.fxr\s*\{[^}]*width:118%!important;/);
});

test('reward display does not misrepresent disabled admin policies as live prizes',()=>{
  assert.match(ui,/const active=!!preview\.policy\?\.enabled;/);
  assert.match(ui,/detail\.textContent=active\?prize\.detail:'Not active';/);
});

test('ranking artwork updates trigger a fresh staging Android APK',()=>{
  const workflow=readFileSync(new URL(
    '../../.github/workflows/sharika-android-staging-apk.yml',import.meta.url),'utf8');
  assert.match(workflow,/      - 'app\/royal-ranking-v2\.css'/);
});
