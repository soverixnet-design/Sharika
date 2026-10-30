// Server-only Lucky Gift draws. Preserve the original Sharika odds (basis points).
// 0x 70.2%, 1x 15%, 2x 8%, 5x 4%, 10x 2.5%, 50x 0.3%.
// Only cryptographic randomness on the Worker may select outcomes.
// CASHOUT COMPLIANCE HOLD: Sharika coins have real-world redeemable value.
// A feature flag must not turn on chance-based cash payouts before the actual
// gambling licenses, store certification, verified adult identity and
// licensed-territory enforcement have been completed and independently reviewed.
// Removing this hold requires a separate reviewed source-code release.
export const CASHOUT_LUCKY_GIFTS_BLOCKED = true;

export function luckyGiftBenefits(priceCoins, quantity, recipientCount) {
  if (![priceCoins,quantity,recipientCount].every(Number.isSafeInteger) ||
      priceCoins<1 || quantity<1 || quantity>10 ||
      recipientCount<1 || recipientCount>20)
    throw new RangeError('invalid_lucky_gift_benefits');
  const perRecipientHundredths=priceCoins*quantity*5; // 5% diamonds
  const roomRewardHundredths=priceCoins*quantity*recipientCount; // 1% coins
  if (!Number.isSafeInteger(perRecipientHundredths) ||
      !Number.isSafeInteger(roomRewardHundredths))
    throw new RangeError('lucky_benefit_exceeds_safe_integer');
  return {recipient_hundredths:perRecipientHundredths,
    room_hundredths:roomRewardHundredths};
}

export const LUCKY_ODDS = Object.freeze([
  Object.freeze({ multiplier: 0, weight: 7020 }),
  Object.freeze({ multiplier: 1, weight: 1500 }),
  Object.freeze({ multiplier: 2, weight: 800 }),
  Object.freeze({ multiplier: 5, weight: 400 }),
  Object.freeze({ multiplier: 10, weight: 250 }),
  Object.freeze({ multiplier: 50, weight: 30 })
]);
const RANGE = 10000;
const UINT32_RANGE = 0x100000000;
const UNBIASED_CEILING = UINT32_RANGE - UINT32_RANGE % RANGE;

export function secureLuckyTicket() {
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); }
  while (value[0] >= UNBIASED_CEILING);
  return value[0] % RANGE;
}

export function drawLuckyGift(priceCoins, count, ticket = secureLuckyTicket) {
  if (!Number.isSafeInteger(priceCoins) || priceCoins < 1 ||
      !Number.isSafeInteger(count) || count < 1 || count > 200)
    throw new RangeError('invalid_lucky_gift_amount');
  let payout = 0, maxMultiplier = 0;
  const counts = Object.fromEntries(LUCKY_ODDS.map(x => [x.multiplier, 0]));
  for (let i = 0; i < count; i++) {
    const roll = ticket();
    if (!Number.isInteger(roll) || roll < 0 || roll >= RANGE)
      throw new RangeError('invalid_lucky_random_ticket');
    let boundary = 0, multiplier = 0;
    for (const item of LUCKY_ODDS) {
      boundary += item.weight;
      if (roll < boundary) { multiplier = item.multiplier; break; }
    }
    counts[multiplier]++;
    maxMultiplier = Math.max(maxMultiplier, multiplier);
    payout += multiplier * priceCoins;
    if (!Number.isSafeInteger(payout))
      throw new RangeError('lucky_payout_exceeds_safe_integer');
  }
  return { payout_coins: payout, max_multiplier: maxMultiplier, rolls: counts };
}
