import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
test('Royal Slots is hosted with original images and pre-recorded audio',()=>{
 const catalog=read('src/index.mjs');
 const builder=read('scripts/build.mjs');
 const html=read('web/royal-slots.html');
 assert.match(catalog,/id:'royal-slots'.*asset:'\/games\/royal-slots\/index.html'/);
 assert.match(builder,/royal-slots-bridge\.js/);
 assert.match(builder,/royal-slots-card\.svg/);
 assert.match(html,/Royal Slots/);
 assert.match(html,/SOUND_ASSETS/);
 assert.match(html,/Big winner!/);
 assert.match(html,/Super winner!/);
 assert.match(html,/Mega winner!/);
 assert.match(html,/Jackpot!/);
});
test('Royal Slots iframe only talks to trusted game-center origin and never owns coins',()=>{
 const client=read('web/royal-slots-bridge.js');
 const main=read('web/app.js');
 const native=read('../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaGameCenterActivity.java');
 const backend=read('../cloudflare/src/index.mjs');
 assert.match(client,/event\.source!==parent\|\|event\.origin!==PARENT/);
 assert.match(client,/if\(!ready\)return Promise\.reject/);
 assert.match(client,/mode:'production',host,profile/);
 assert.doesNotMatch(client,/fetch\(|Authorization|Bearer |localStorage\./);
 assert.match(main,/game\.id==='royal-slots'/);
 assert.match(main,/\/api\/v1\/royal-slots\/spin/);
 assert.match(main,/\/api\/v1\/royal-slots\/state/);
 assert.match(backend,/handleRoyalSlots/);
 assert.match(backend,/gameAcceptsBets\(env\.DB,'royal-slots'\)/);
 assert.match(native,/\(royal-ace\|cleopatra\|royal-slots\)/);
});

test('Premium Royal Slots celebration is visual-only and embedded in the hosted game',()=>{
 const builder=read('scripts/build.mjs'),js=read('web/win-celebration.js'),css=read('web/win-celebration.css');
 assert.match(builder,/SharikaWinCelebration.*show/);
 assert.match(builder,/win-celebration\.css/);
 assert.match(builder,/win-celebration\.js/);
 assert.match(js,/BIG WINNER/);assert.match(js,/SUPER WINNER/);assert.match(js,/MEGA WINNER/);assert.match(js,/JACKPOT!/);
 assert.match(js,/reduced-motion/);
 assert.doesNotMatch(js,/\bfetch\s*\(|\bpostMessage\s*\(|Authorization|bearer\b/i);
 assert.match(css,/#sharika-win-celebration/);
});
