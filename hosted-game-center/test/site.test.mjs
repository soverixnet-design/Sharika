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

test('Greedy Food Wheel preserves video aspect ratio, without stretching red lower panel',()=>{
 const original=read('../android-staging/app/src/main/assets/original-games/greedy-classic.html');
 const live=read('../android-staging/app/src/main/assets/original-games/greedy-classic-live.js');
 const backend=read('../cloudflare/src/greedy-classic.mjs');
 assert.match(original,/aspect-ratio:1080\\/1617/);
 assert.match(live,/id='sharika-original-video-fit'/);
 assert.match(live,/aspect-ratio:1080 \\/ 1617!important/);
 assert.match(live,/height:auto!important/);
 assert.doesNotMatch(live,/aspect-ratio:auto!important/);
 assert.match(live,/justify-content:space-between!important/);
 assert.match(live,/FoodSound\\.play\\('tick',i\\)/);
 assert.match(live,/FoodSound\\.play\\(earned>0\\?'win':'result'\\)/);
 assert.match(live,/S\\.mute\\|\\|document\\.visibilityState/);
 assert.match(backend,/const CHIPS=\\[100,1000,10000,50000\\]/);
});
