import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import site from '../src/index.mjs';
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
test('public catalog exposes only static pages and no wallet API',async()=>{
 const fetch=async r=>new Response('<h1>test</h1>',{headers:{'content-type':'text/html'}});
 const env={ASSETS:{fetch}};
 const health=await site.fetch(new Request('https://test.invalid/health'),env);
 const h=await health.json();assert.equal(h.environment,'staging');
 const c=await site.fetch(new Request('https://test.invalid/api/catalog'),env);
 assert.equal(c.status,200);
 const {games,requires_sharika_app}=await c.json();
 assert.equal(requires_sharika_app,true);
 assert.ok(games.length>=9);
 for(const game of games){assert.ok(game.asset.startsWith('/games/'));assert.ok(game.id)}
 const denied=await site.fetch(new Request('https://test.invalid/api/spin',{method:'POST'}),env);
 assert.equal(denied.status,405);
});
test('hosted origin contains no Firebase token or wide native bridge',()=>{
 const js=read('web/app.js'),practice=read('web/practice.js');
 assert.match(js,/createSharikaPractice/);
 assert.match(js,/cards\/superace\.svg/);
 assert.match(js,/cards\/cleopatra\.jpg/);
 assert.match(js,/cards\/fruit-machine\.jpg/);
 assert.match(practice,/practice_only:true/);
 assert.doesNotMatch(practice,/fetch\(|SharikaNative|Authorization|Bearer |localStorage\./);
 const builder=read('scripts/build.mjs');
 for(const file of ['royal-ace-card.svg','game-cards/cleopatra-gold.jpg',
    'game-cards/fruit-machine.jpg','food-wheel-original-card.png',
    'jackpot-fruit-original-card.png'])
   assert.ok(builder.includes(file),'Original art must be copied: '+file);
 assert.match(js,/SharikaGameBridge/);
 assert.doesNotMatch(js,/SharikaNative|Bearer |localStorage\.setItem\(['"](?:coin|wallet|sa_bal)/);
 assert.match(js,/e.origin!=='null'/);
 assert.match(js,/version===gameVersion/);
 const markup=read('web/index.html');
 assert.match(markup,/sandbox="allow-scripts allow-modals"/);
 assert.doesNotMatch(markup,/allow-same-origin/);
 assert.match(js,/pending\.delete\(id\)/);
 assert.match(js,/requestId:m.id/);
 const wrangler=JSON.parse(read('wrangler.jsonc'));
 assert.equal(wrangler.name,'sharika-games-web-staging');
 assert.equal(wrangler.workers_dev,true);
 assert.ok(!('d1_databases' in wrangler),'public site must not have main wallet database binding');
});

test('Greedy Food Wheel preserves original video ratio and verified event sounds',()=>{
 const original=read('../android-staging/app/src/main/assets/original-games/greedy-classic.html');
 const live=read('../android-staging/app/src/main/assets/original-games/greedy-classic-live.js');
 const backend=read('../cloudflare/src/greedy-classic.mjs');
 assert.ok(original.includes('aspect-ratio:1080/1617'));
 assert.ok(live.includes("id='sharika-original-video-fit'"));
 assert.ok(live.includes('aspect-ratio:1080 / 1617!important'));
 assert.ok(live.includes('height:auto!important'));
 assert.ok(!live.includes('aspect-ratio:auto!important'));
 assert.ok(live.includes('justify-content:space-between!important'));
 assert.ok(live.includes("FoodSound.play('tick',i)"));
 assert.ok(live.includes("FoodSound.play(earned>0?'win':'result')"));
 assert.ok(live.includes("S.mute||document.visibilityState"));
 assert.ok(backend.includes('const CHIPS=[100,1000,10000,50000]'));
});

test('Greedy Food Wheel browser practice accepts real wheel item IDs, no fake ranking',async()=>{
 const vm=await import('node:vm');
 const {webcrypto}=await import('node:crypto');
 const FakeDate=class extends Date{
  constructor(...a){super(...(a.length?a:[1000]));}
  static now(){return 1000;}
 };
 const sandbox={window:{},crypto:webcrypto,Date:FakeDate,Uint32Array,Map,Array,Math};
 vm.runInNewContext(read('web/practice.js'),sandbox);
 const game=sandbox.window.createSharikaPractice('greedy-classic');
 const get=()=>game.request('GET','/api/v1/original-games/greedy-classic/state');
 const initial=await get();
 assert.equal(initial.config.chips.join(','),'100,1000,10000,50000');
 const round=initial.state.round;
 for(const [itemId,amount,index] of [['grape',100,4],['watermelon',1000,7]]){
  const receipt=await game.request('POST','/api/v1/original-games/greedy-classic/bet',
   {round,itemId,amount,request_id:'demo-test-'+itemId});
  assert.equal(receipt.practice_only,true);
  assert.equal(receipt.myBets[index],amount);
 }
 const state=await get();
 assert.equal(state.myBets[4],100);
 assert.equal(state.myBets[7],1000);
 assert.equal((await game.request('GET','/api/v1/original-games/greedy-classic/rankings')).rankings.length,0);
});


test('Food Wheel has one top marquee and a separate verified Top 3 results panel',()=>{
 const live=read('../android-staging/app/src/main/assets/original-games/greedy-classic-live.js');
 const app=read('web/app.js');
 const style=read('web/style.css');
 const backend=read('../cloudflare/src/greedy-classic.mjs');
 const native=read('../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaGameCenterActivity.java');
 const markup=read('web/index.html');
 assert.doesNotThrow(()=>new Function(live));
 assert.ok(live.includes("ownStakeOnCard.style.display='none'"));
 assert.ok(live.includes("request('rankings')"));
 assert.ok(live.includes("leaderCoins.textContent=compactCoins(coins)"));
 assert.ok(!live.includes('greedy-verified-win-banner'));
 assert.ok(!live.includes('displayVerifiedWinner('));
 assert.ok(!live.includes("leaderId.textContent='ID: '+id"));
 assert.ok(!live.includes('DAILY TOP 1'));
 assert.ok(live.includes("(r.top||[]).slice(0,3)"));
 assert.ok(live.includes("Verified Round Top 3"));
 assert.ok(live.includes("pendingFoodTaps.push"));
 assert.ok(live.includes("cell.textContent=value>0?compactCoins(value)"));
 assert.ok(style.includes('sharikaVerifiedWinnerTravel 10s'));
 assert.ok(markup.includes('winner-game-icon'));
 assert.ok(app.includes('setInterval(pollGlobalFoodWinners,6500)'));
 assert.ok(app.includes('winnerQueue.push'));
 assert.ok(app.includes("if(inRoom||!bridge||!winner"));
 assert.ok(app.includes("if(inRoom||!bridge||globalWinnerBusy"));
 const activity=read('../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java');
 assert.ok(activity.includes('root,() -> false'));

 assert.ok(app.includes('10000'));
 assert.ok(backend.includes("gameId:'greedy-classic'"));
 assert.ok(native.includes('/api/v1/original-games/greedy-classic/winners'));
});
