import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const source=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');

test('admin staging connector parses as JavaScript without changing original template',()=>{
  assert.doesNotThrow(()=>new Script(source,{filename:'admin/connection.js'}));
  assert.match(source,/const originalShell = window\.shell/);
  assert.match(source,/originalShell\(\)/);
});

test('ranking UI exposes verified recharge, room, rich and charm kinds',()=>{
  assert.match(source,/const kinds=\{[^\n]*rich:[^\n]*charm:[^\n]*room:[^\n]*recharge:'Top Recharge'/);
  assert.match(source,/api\('GET','rankings\?kind='\+kind\+'&period='\+period\)/);
  assert.match(source,/kind==='recharge'\?'Approved recharge coins':'Gift coins'/);
  assert.match(source,/No approved recharges recorded for this period/);
  assert.doesNotMatch(source,/window\.D\.users=\[\{.*demo/);
});

test('moderation panel renders signed-in reports and opens the real Support Inbox',()=>{
  assert.match(source,/P\.mod=async function\(\)/);
  assert.match(source,/api\('GET','reports'\)/);
  assert.match(source,/reports\.length/);
  assert.match(source,/details\.textContent=String\(report\.body\|\|'\'\)/);
  assert.match(source,/window\.V='support';window\.shell\(\)/);
});

test('gift audit panel displays real backend settlements, including fractional room and diamond accrual',()=>{
  assert.match(source,/id="gift-settlement-list"/);
  assert.match(source,/api\('GET','gift-settlements'\)/);
  assert.match(source,/room_reward_hundredths/);
  assert.match(source,/recipient_diamond_hundredths/);
  assert.match(source,/lucky_payout_coins/);
  assert.match(source,/Only Super Admin and Finance roles can view wallet settlements/);
});

test('staff accounts use Firebase verification and exact permission-scoped UI controls',()=>{
  assert.match(source,/api\('POST','staff',/);
  assert.match(source,/api\('PATCH','staff\/'\+id,/);
  assert.match(source,/new_staff_id_token:created\.idToken/);
  assert.match(source,/requestType:'VERIFY_EMAIL'/);
  assert.match(source,/window\.NAV=role==='staff'/);
  assert.match(source,/password\.length<12/);
  assert.match(source,/api\('POST','recharge-user',/);
  assert.match(source,/pendingAdminCredit\?\.fingerprint===fingerprint/);
  assert.match(source,/staff permissions/);
});

test('premium admin panel offers independent purchasing, grant and automatic gift/level policies',()=>{
  assert.match(source,/\['premium','👑','VIP \/ SVIP \/ Noble'\]/);
  assert.match(source,/P\.premium=async function\(\)/);
  for(const key of ['purchase_enabled','admin_grant_enabled','auto_enabled',
    'auto_by_level','auto_by_gifts'])assert.ok(source.includes(key),key);
  for(const key of ['min_wealth_level','min_gift_coins','price_coins','duration_days',
    'daily_bonus_coins'])assert.ok(source.includes(key),key);
  assert.match(source,/api\('PATCH','premium',\{policy,tiers\}\)/);
  assert.match(source,/api\('GET','premium\?public_id='\+id\)/);
  assert.match(source,/api\('POST','premium\/grant',\{public_id:id,tier,duration_days:days,/);
  assert.match(source,/svip_level:svipLevel/);
  assert.match(source,/sh-premium-grant-level/);
  assert.match(source,/role==='super'\?/);
});
