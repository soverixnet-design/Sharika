import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const base=new URL('../../',import.meta.url);
const staging=readFileSync(new URL('android-staging/staging-connection.js',base),'utf8');
const app=readFileSync(new URL('app/index.html',base),'utf8');
const food=readFileSync(new URL(
  'android-staging/app/src/main/assets/original-games/sovera-food-wheel.html',base),'utf8');

test('invite cash form stays hidden until eligible Withdraw is clicked',()=>{
  assert.match(staging,/id=\\?"sh-invite-open-withdraw\\?"/);
  assert.match(staging,/id=\\?"sh-invite-withdraw-form\\?"[^\n]*hidden/);
  assert.match(staging,/if\(open\.disabled\)return/);
  assert.match(staging,/form\.hidden=!reveal/);
  assert.match(staging,/root\.querySelector\('#sh-invite-withdraw-cancel'\)|form\.querySelector\('#sh-invite-withdraw-cancel'\)/);
  assert.match(staging,/withdrawable>=minimumWithdrawal/);
  assert.match(staging,/withdrawal_options_cents/);
  assert.match(staging,/amount_cents:amount,request_id:nextWalletRequestId/);
});

test('royal invite page uses owner art and verified coin/dollar values',()=>{
  assert.match(staging,/sh-invite-royal-banner/);
  assert.match(staging,/main-profile-bg\.jpg/);
  assert.match(staging,/signup_inviter_reward/);
  assert.match(staging,/signup_invitee_reward/);
  assert.match(staging,/cash\.available_cents/);
  assert.match(staging,/invite_usd_cents_per_verified_user/);
});

test('mobile game fills the screen rather than clipping the bet chips',()=>{
  assert.match(staging,/#shb\.sh-original-fullscreen,#bg\.sh-original-fullscreen/);
  assert.match(staging,/backdrop-filter:none!important/);
  assert.match(staging,/#sh-original-host\{flex:1!important;min-height:0!important/);
  assert.match(staging,/overlay\.classList\.add\('sh-original-fullscreen'\)/);
  assert.match(staging,/hiddenObserver\.disconnect\(\)/);
});

test('game polling keeps existing chip controls and profile wallet nodes',()=>{
  assert.match(food,/if\(container\.children\.length!==CH\.length\)/);
  assert.match(food,/button\.classList\.toggle\('on',Number\(button\.dataset\.c\)===chip\)/);
  assert.match(food,/if\(lastResult!==prev\.round_no\)/);
  assert.match(app,/A game balance poll must not replace the entire visible profile DOM/);
  assert.match(app,/portrait\.addEventListener\("error"/);
});
