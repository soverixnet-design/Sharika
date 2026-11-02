import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectPremiumTier,publicSvipSelect} from '../src/premium.mjs';

const now=Date.UTC(2026,10,2);
const tiers=[{tier:'vip',rank:1,daily_bonus_coins:100,min_wealth_level:10,min_gift_coins:10000},
  {tier:'svip',rank:2,daily_bonus_coins:300,min_wealth_level:25,min_gift_coins:100000},
  {tier:'noble',rank:3,daily_bonus_coins:1000,min_wealth_level:50,min_gift_coins:1000000}];
const off={auto_enabled:false,auto_by_level:false,auto_by_gifts:false};
const base={policy:off,tiers,wealthLevel:1,giftCoins:0,nowMs:now};

test('all eight verified admin levels survive selection, but never after expiry',()=>{
  for(let level=1;level<=8;level++){
    const manual={tier:'svip',source:'admin',svip_level:level,expires_at_ms:now+86400000};
    const granted=selectPremiumTier({...base,manual});
    assert.equal(granted.tier,'svip');
    assert.equal(granted.svip_level,level);
    assert.ok(granted.active_benefits.includes('room_entry_banner'));
    assert.ok(granted.active_benefits.includes('premium_frame'));
    const expired=selectPremiumTier({...base,manual,nowMs:now+86400000});
    assert.equal(expired.tier,'none');
    assert.equal(expired.svip_level,0);
  }
});

test('legacy purchased SVIP and automatic qualification use level one',()=>{
  const manual={tier:'svip',source:'purchase',expires_at_ms:now+86400000};
  assert.equal(selectPremiumTier({...base,manual}).svip_level,1);
  const automatic=selectPremiumTier({...base,manual:null,wealthLevel:25,
    policy:{auto_enabled:true,auto_by_level:true,auto_by_gifts:false}});
  assert.equal(automatic.tier,'svip');
  assert.equal(automatic.svip_level,1);
  const noble=selectPremiumTier({...base,manual,wealthLevel:50,
    policy:{auto_enabled:true,auto_by_level:true,auto_by_gifts:false}});
  assert.equal(noble.tier,'noble');
  assert.equal(noble.svip_level,0);
});

test('public appearance reads verified premium rules and respects noble priority',()=>{
  const sql=publicSvipSelect('u');
  assert.match(sql,/svip_level$/);
  assert.match(sql,/sharika_premium_memberships/);
  assert.match(sql,/sharika_premium_policy/);
  assert.match(sql,/auto_by_gifts/);
  assert.match(sql,/t\.tier='noble'/);
  assert.throws(()=>publicSvipSelect('u; DROP TABLE users'));
});

test('migration preserves old memberships and bounds the eight levels',()=>{
  const schema=readFileSync(new URL('../migrations/0040_svip_eight_royal_levels.sql',import.meta.url),'utf8');
  assert.match(schema,/ALTER TABLE sharika_premium_memberships/);
  assert.match(schema,/DEFAULT 1 CHECK\(svip_level BETWEEN 1 AND 8\)/);
  assert.doesNotMatch(schema,/DELETE FROM|DROP TABLE|UPDATE sharika_users/);
});

test('staging app uses real animated level assets in both profile and room',()=>{
  const client=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.match(client,/sharika-premium\/svip-/);
  assert.match(client,/function showSvipRoyalSheet/);
  assert.match(client,/function playSvipRoomEntry/);
  assert.match(client,/sh-svip-seat-badge/);
  assert.match(client,/PROFILE.*VOICE ROOM SEAT/s);
  assert.match(worker,/svipAppearance\(x,equipped\.get\(x\.user_id\)/);
  assert.match(worker,/publicSvipSelect\('u'\)/);
  assert.match(worker,/svip-entry-/);
});
