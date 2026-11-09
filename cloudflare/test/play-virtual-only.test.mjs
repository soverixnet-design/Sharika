import test from 'node:test';
import assert from 'node:assert/strict';
import {playVirtualOnly,playVirtualRouteBlocked,playVirtualConfigured} from '../src/play-virtual-only.mjs';
import {handleRequest} from '../src/index.mjs';

const play={SHARIKA_PLAY_VIRTUAL_ONLY:'true',SHARIKA_PLAY_ISOLATED_DATA:'true',
  SHARIKA_COINS_CASH_REDEEMABLE:'false'};

test('virtual-only deployment requires explicit isolated and nonredeemable data',()=>{
  assert.equal(playVirtualOnly(play),true);
  assert.equal(playVirtualConfigured(play),true);
  assert.equal(playVirtualConfigured({...play,SHARIKA_PLAY_ISOLATED_DATA:'false'}),false);
  assert.equal(playVirtualConfigured({...play,SHARIKA_COINS_CASH_REDEEMABLE:'true'}),false);
  assert.equal(playVirtualConfigured({}),false);
});

test('cash, salary, seller, referral, admin, games and prizes are all denied',()=>{
  for(const path of ['/api/v1/admin/operations','/api/v1/agency/me',
    '/api/v1/agency/salary/exchange','/api/v1/agency/salary/transfer',
    '/api/v1/family/crystal/transfer','/api/v1/invites','/api/v1/invites/redeem',
    '/api/v1/invites/withdrawals','/api/v1/sellers/me','/api/v1/sellers/transfer',
    '/api/v1/games/food-wheel/bet','/api/v1/original-games/sovera-food/state',
    '/api/v1/greedy-wheel/bet','/api/v1/game-catalog',
    '/api/v1/lucky-box/open','/api/v1/events','/api/v1/role-applications',
    '/api/v1/celebrations','/invite/10000001'])
    assert.equal(playVirtualRouteBlocked(path),true,path);
  for(const kind of ['games','recharge','lucky'])
    assert.equal(playVirtualRouteBlocked('/api/v1/rankings','?period=daily&kind='+kind),true);
});

test('virtual social rooms, gifts, wallet exchange, support and Play purchases remain',()=>{
  for(const path of ['/api/v1/me','/api/v1/rooms','/api/v1/rooms/10000001/chat',
    '/api/v1/rooms/10000001/gifts','/api/v1/gifts','/api/v1/wallet/exchange',
    '/api/v1/play-billing/catalog','/api/v1/play-billing/claim',
    '/api/v1/support/messages','/api/v1/account-deletion'])
    assert.equal(playVirtualRouteBlocked(path),false,path);
  assert.equal(playVirtualRouteBlocked('/api/v1/rankings','?kind=rich'),false);
});

test('Worker rejects disabled routes before any database or identity work',async()=>{
  const url='https://play.example/api/v1/agency/salary/transfer';
  const res=await handleRequest(new Request(url,{method:'POST'}),play,{});
  assert.equal(res.status,403);
  assert.deepEqual(await res.json(),{error:'play_virtual_only_feature_unavailable'});
  const misconfigured=await handleRequest(new Request(url),
    {...play,SHARIKA_PLAY_ISOLATED_DATA:'false'},{});
  assert.equal(misconfigured.status,503);
  assert.deepEqual(await misconfigured.json(),{error:'play_virtual_only_not_configured'});
  const disabledFlag=await handleRequest(new Request(url),
    {...play,SHARIKA_PLAY_VIRTUAL_ONLY:'false'},{});
  assert.equal(disabledFlag.status,503);
});
