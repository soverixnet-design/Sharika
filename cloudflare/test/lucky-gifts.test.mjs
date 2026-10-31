import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { drawLuckyGift, luckyGiftBenefits, LUCKY_ODDS } from '../src/lucky-gifts.mjs';

test('Lucky Gift odds exactly match original Sharika 10000-ticket table', () => {
  assert.equal(LUCKY_ODDS.reduce((a, x) => a + x.weight, 0), 10000);
  const boundaries = [
    [0, 0], [7019, 0], [7020, 1], [8519, 1],
    [8520, 2], [9319, 2], [9320, 5], [9719, 5],
    [9720, 10], [9969, 10], [9970, 50], [9999, 50]
  ];
  for (const [ticket, multiplier] of boundaries) {
    const result = drawLuckyGift(100, 1, () => ticket);
    assert.equal(result.max_multiplier, multiplier);
    assert.equal(result.payout_coins, 100 * multiplier);
    assert.equal(result.rolls[multiplier], 1);
  }
});
test('Lucky Gift payout aggregation uses one server draw per item and recipient', () => {
  const sequence = [0, 7020, 8520, 9320, 9720, 9970];
  let i = 0;
  const result = drawLuckyGift(10, sequence.length, () => sequence[i++]);
  assert.equal(i, sequence.length);
  assert.deepEqual(result.rolls, { 0:1, 1:1, 2:1, 5:1, 10:1, 50:1 });
  assert.equal(result.payout_coins, 680);
  assert.equal(result.max_multiplier, 50);
});
test('Lucky Gift rejects unsafe or client-shaped draws', () => {
  for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => drawLuckyGift(amount, 1, () => 0), RangeError);
  for (const count of [0, -1, 201, 1.2])
    assert.throws(() => drawLuckyGift(1, count, () => 0), RangeError);
  for (const roll of [-1, 10000, NaN, '0'])
    assert.throws(() => drawLuckyGift(1, 1, () => roll), RangeError);
  assert.throws(() => drawLuckyGift(Number.MAX_SAFE_INTEGER, 2, () => 9999), RangeError);
});

test('Lucky Gift pays recipient 5% diamonds and room 1% from the same spend', () => {
  const gift = luckyGiftBenefits(10000, 1, 1);
  assert.equal(gift.recipient_hundredths / 100, 500);
  assert.equal(gift.room_hundredths / 100, 100);
  const all = luckyGiftBenefits(100, 2, 3);
  assert.equal(all.recipient_hundredths / 100, 10);
  assert.equal(all.room_hundredths / 100, 6);
});
test('small Lucky Gifts preserve fractional reward entitlements', () => {
  const gift = luckyGiftBenefits(5, 1, 1);
  assert.equal(gift.recipient_hundredths, 25);
  assert.equal(gift.room_hundredths, 5);
  assert.equal((gift.recipient_hundredths * 4) / 100, 1);
  assert.equal((gift.room_hundredths * 20) / 100, 1);
  for (const args of [[0,1,1],[10,0,1],[10,1,0],[10,11,1],
    [10,1,21],[1.5,1,1],[Number.MAX_SAFE_INTEGER,10,20]])
    assert.throws(() => luckyGiftBenefits(...args), RangeError);
});

test('Lucky Gift stays visibly gated until an approved adult server catalogue is enabled',()=>{
  const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  const config=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
  assert.match(adapter,/if\(data\.lucky_enabled!==true\)/);
  assert.match(adapter,/locked\.disabled=true/);
  assert.match(adapter,/Lucky Gifts are not active on this staging server yet/);
  assert.match(adapter,/data\.lucky_enabled===true && Array\.isArray\(data\.lucky_odds\)/);
  assert.match(adapter,/api\('POST','\/rooms\/'\+room\.id\+'\/gifts'/);
  assert.match(worker,/nonRedeemableLuckyEconomy\(env\)/);
  assert.match(config,/"SHARIKA_LUCKY_GIFTS_ENABLED": "false"/);
});
