# SharikaAPI v1 — frontend adapter contract

All methods return Promises except subscribe. Load the adapter before game.js.
No endpoint URLs, authentication scheme, production credentials or server payout rules are assumed.
Numbers are integer credits within Number.MAX_SAFE_INTEGER. Times are epoch milliseconds.
Eight distinct fruits are required by this wheel layout. Treat all displayed values as server-owned.

## connect() -> State
Call initially, after accepted bets, on visibility resume, and to reconcile transport reconnects.
It must be repeatable; do not open a duplicate transport on every call.
Return a fresh snapshot, including accepted bets for the current round.

```json
{
  "serverNow": 1700000000000,
  "balance": 500000,
  "jackpot": 21817399,
  "round": {"id":"round-123","status":"open","closesAt":1700000020000},
  "bets": [],
  "fruits": [
    {"id":"lemon","name":"Lemon","emoji":"🍋","multiplier":5},
    {"id":"strawberry","name":"Strawberry","emoji":"🍓","multiplier":5},
    {"id":"kiwi","name":"Kiwi","emoji":"🥝","multiplier":5},
    {"id":"cherry","name":"Cherry","emoji":"🍒","multiplier":40},
    {"id":"plum","name":"Plum","emoji":"🫐","multiplier":40},
    {"id":"watermelon","name":"Melon","emoji":"🍉","multiplier":20},
    {"id":"mango","name":"Mango","emoji":"🥭","multiplier":10},
    {"id":"apple","name":"Apple","emoji":"🍎","multiplier":10}
  ],
  "user":{"id":"authenticated-id","name":"Actual profile name"},
  "limits":{"minBet":1,"maxBet":10000000}
}
```
Example multipliers are illustrative, not a live rule approval.
round.status: open | settling | settled. Frontend timer estimates remaining time;
server must reject late bets regardless of client time. Adapter may adjust serverNow for measured latency.

## placeBet(request) -> Receipt
Request: {requestId, roundId, fruitId, amount}.
Receipt: {id, requestId, roundId, fruitId, amount, acceptedAt, balance}.
Never derive authenticated identity from unverified browser data.
requestId identifies the same operation on retries. Reject conflicting reuse at server.
Return the original acceptance on duplicate calls. Do not debit twice.
When rejecting with a known final non-acceptance, throw an Error with definitive=true.
For timeout or unknown acceptance, do NOT set definitive; UI keeps request for exact retry.
UI serializes requests but that is NOT backend concurrency protection.
After acceptance UI calls connect() to get authoritative snapshot.
Accepted receipt followed by snapshot failure is NOT an instruction to debit again.

## subscribe(handler) -> unsubscribe function
Adapter pushes:
- {type:'state', state: State}
- {type:'connection', message:'Reconnecting…'}
- {type:'result', result: Result}

Result example:
```json
{
 "roundId":"round-123",
 "fruitIds":["lemon","kiwi"],
 "bonus":"fruit+1",
 "multiplier":1,
 "jackpotAward":0,
 "totalBet":1000,
 "payout":5000,
 "balance":504000,
 "jackpot":21817399,
 "settledAt":1700000021000
}
```
Result is personalized (totalBet/payout/balance belong to this authenticated user).
bonus: none | fruit+1 | fruit+2 | x2 | x3 | jackpot. No fruit+3 support.
fruitIds is ordered and allows duplicate draws. UI highlights distinct tiles and writes all draws in result text.
For +1 send two fruitIds; +2 send three. Others normally one.
Server must perform all payout calculation. Frontend does not recompute real payouts.
Send result only once settlement is durable, with total credited payout (including any jackpot).
Do not send combined bonus types with this v1 contract without extending UI.
Deliver result before subsequent round state; allow at least 1.6 seconds for reveal animation.
If a late older-round result arrives, UI refreshes history/state rather than animating the wrong round.
On reconnect fetch missed settlements from backend; this UI alone does not implement a durable event cursor.

## getHistory({limit}) -> HistoryRow[]
Newest first, current authenticated user only.
Each row: {roundId,settledAt,totalBet,payout,profitLoss,bonus}.
profitLoss = payout - totalBet; no mock opponents. Backend owns pagination/access control.

## getRankings({period,metric,limit}) -> RankingRow[]
period: daily | weekly | monthly.
metric: totalWin | totalBet | profitLoss | winCount.
Rows sorted by chosen metric and server tie-breaker, at most 20 displayed.
Each row:
{userId,name,avatarUrl,totalWin,totalBet,profitLoss,winCount}
Use real user profiles. avatarUrl optional; HTTPS only for remote avatars in this frontend.
Values and period boundaries are server-defined. Displayed position follows response order.

## disconnect()
Release game subscriptions/timers. Must NOT disconnect voice chat.

## Host utilities
window.SharikaGame.setCompact(true|false)
window.SharikaGame.refresh() -> Promise
config.onLayoutChange({compact}) optional callback for host embedding.
No native bridge, wallet modification method, token storage or voice SDK is bundled.
