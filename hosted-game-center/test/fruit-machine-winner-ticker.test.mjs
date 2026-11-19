import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../..');
const read=relative=>readFileSync(resolve(root,relative),'utf8');
const game=read('android-staging/app/src/main/assets/original-games/food-wheel-deluxe.html');
const html=read('hosted-game-center/web/index.html');
const js=read('hosted-game-center/web/app.js');
const css=read('hosted-game-center/web/style.css');
const api=read('cloudflare/src/food-wheel-deluxe.mjs');

test('rapid Food Wheel taps have no cumulative round wager limit',()=>{
 assert.doesNotMatch(game,/total\+queued>100000000/);
 assert.match(game,/inFlightFoodTotal/);
 assert.match(game,/const portion=Math\.min\(amount,allowance\)/);
 assert.match(game,/await place\(stakes,count\)/);
 assert.match(game,/round!==queuedFoodRound/);
 assert.match(game,/request_id:requestId\(\)/);
 assert.match(api,/MAX_STAKE=100000000/); // safety cap on an individual D1 insert
});

test('ranking preview shows only real player portraits; detail is on click',()=>{
 assert.match(game,/T\.rankAvatars/);
 assert.match(game,/preview\.addEventListener\('click',rank\)/);
 assert.match(game,/w\.public_id/);
 assert.doesNotMatch(game,/T\.t5|T\.winnerAvatar|top5',410/);
 assert.match(api,/SELECT u\.public_no,u\.name,u\.pic,SUM\(b\.payout\)/);
});

test('one slim verified ticker includes avatar, game icon, win and 10s motion',()=>{
 assert.match(html,/id="winner-avatar"/);
 assert.match(html,/id="winner-game-icon"/);
 assert.match(html,/id="winner-amount"/);
 assert.match(js,/gameIcon\.src=gameArt/);
 assert.match(js,/},10000\)/);
 assert.match(css,/@keyframes sharikaWinnerTravel/);
 assert.match(css,/animation:sharikaWinnerTravel 10s/);
 assert.doesNotMatch(game,/modal\('<div class="box res"><div class="ban">'\+\(payout/);
});

test('Food Wheel card uses the supplied-style Fruit Machine image',()=>{
 assert.match(js,/'food-deluxe':'\/cards\/fruit-machine-user\.webp'/);
 assert.match(js,/'food-deluxe':'Fruit Machine'/);
});
