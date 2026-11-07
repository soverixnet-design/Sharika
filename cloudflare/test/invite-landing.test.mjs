import test from 'node:test';
import assert from 'node:assert/strict';
import {handleInviteLanding,INVITE_LINK_BASE} from '../src/invite-link.mjs';

test('public HTTPS invitation contains a directly openable app link and Play deferred referrer',async()=>{
  assert.equal(INVITE_LINK_BASE,'https://sharika-api-staging.soverixnet.workers.dev/invite/');
  const r=handleInviteLanding(new Request(INVITE_LINK_BASE+'10000001'),'/invite/10000001');
  assert.equal(r.status,200);
  assert.match(r.headers.get('content-type'),/text\/html/);
  assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const html=await r.text();
  assert.match(html,/sharika:\/\/invite\/10000001/);
  assert.match(html,/referrer=sharika_invite%3D10000001/);
  assert.match(html,/without typing a code/);
  assert.match(html,/tap this invitation link again/);
  assert.doesNotMatch(html,/Firebase|access_token|authorization:/i);
});
test('landing is read-only and refuses arbitrary codes or dangerous methods',async()=>{
  assert.equal(handleInviteLanding(new Request(INVITE_LINK_BASE+'bogus'),'/invite/bogus'),null);
  assert.equal(handleInviteLanding(new Request(INVITE_LINK_BASE+'10000001/extra'),'/invite/10000001/extra'),null);
  const r=handleInviteLanding(new Request(INVITE_LINK_BASE+'10000001',{method:'POST'}),'/invite/10000001');
  assert.equal(r.status,405);
  assert.equal(r.headers.get('allow'),'GET, HEAD');
  const head=handleInviteLanding(new Request(INVITE_LINK_BASE+'10000001',{method:'HEAD'}),'/invite/10000001');
  assert.equal(head.status,200);
  assert.equal(await head.text(),'');
});
