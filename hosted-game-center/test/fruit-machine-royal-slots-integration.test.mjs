import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../..');
const read=name=>readFileSync(resolve(root,name),'utf8');
const wheel=read('android-staging/app/src/main/assets/original-games/food-wheel-deluxe.html');
const worker=read('cloudflare/src/food-wheel-deluxe.mjs');
const app=read('hosted-game-center/web/app.js');
const html=read('hosted-game-center/web/index.html');
const style=read('hosted-game-center/web/style.css');
const build=read('hosted-game-center/scripts/build.mjs');
const center=read('hosted-game-center/src/index.mjs');

test('Royal Slots stays enabled in the catalog and keeps its original hosted bridge',()=>{
 assert.match(center,/id:'royal-slots'/);
 assert.match(app,/if\(game\.id==='royal-slots'\)/);
 assert.match(build,/royal-slots-bridge\.js/);
 assert.match(build,/win-celebration\.js/);
});

test('Fruit Machine has no cumulative client round limit while remaining coin and clock bounded',()=>{
 assert.match(wheel,/const GAME='food-deluxe'/);
 assert.match(wheel,/inFlightFoodTotal/);
 assert.match(wheel,/const portion=Math\.min\(amount,allowance\)/);
 assert.doesNotMatch(wheel,/total\+queued>100000000/);
 assert.match(wheel,/round!==queuedFoodRound/);
 assert.match(worker,/MAX_STAKE=100000000/);
});

test('Food Wheel uses only avatar previews and verified ranking details on tap',()=>{
 assert.match(wheel,/T\.rankAvatars/);
 assert.match(wheel,/preview\.addEventListener\('click',rank\)/);
 assert.doesNotMatch(wheel,/T\.t5/);
 assert.match(worker,/SELECT u\.public_no,u\.name,u\.pic,SUM\(b\.payout\)/);
 assert.match(wheel,/w\.public_id/);
});

test('one ten-second top winner ticker with avatar and game icon remains',()=>{
 assert.match(html,/id="winner-game-icon"/);
 assert.match(html,/id="winner-avatar"/);
 assert.match(app,/winnerQueue\.push/);
 assert.match(app,/if\(inRoom\|\|!bridge/);
 assert.match(app,/},10000\)/);
 assert.match(style,/sharikaVerifiedWinnerTravel 10s/);
 assert.doesNotMatch(wheel,/T\.winnerAvatar/);
});

test('Royal Slots and Fruit Machine cards and room-fit build step are both preserved',()=>{
 assert.match(app,/'food-deluxe':'\/cards\/fruit-machine\.jpg'/);
 assert.match(app,/'food-deluxe':'Fruit Machine'/);
 assert.match(build,/'fruit-machine-user\.webp':'@web\/fruit-machine-user\.webp'/);
 assert.match(build,/food_room_fit_source_changed/);
 assert.match(build,/2100:2352/);
 assert.match(build,/royal-slots-voice\.js/);
});
