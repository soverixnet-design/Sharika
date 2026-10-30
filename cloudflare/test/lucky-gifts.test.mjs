import test from 'node:test';
import assert from 'node:assert/strict';
import { drawLuckyGift, LUCKY_ODDS } from '../src/lucky-gifts.mjs';

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
