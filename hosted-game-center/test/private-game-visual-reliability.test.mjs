// Staging-only regression checks. No live wallet actions or demo balance changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync,existsSync} from 'node:fs';
const read=relative=>readFileSync(new URL(relative,import.meta.url),'utf8');

test('all four child game bridges wait for parent verification instead of early timeout',()=>{
 const paths=[
  '../../android-staging/app/src/main/assets/greedy-wheel/sharika-bridge.js',
  '../../android-staging/app/src/main/assets/original-games/sovera-gaddy-live.js',
  '../../android-staging/app/src/main/assets/original-games/greedy-classic-live.js',
  '../../android-staging/app/src/main/assets/fruit-royale/adapter.live.js'
 ];
 for(const path of paths){
  const source=read(path);
  assert.match(source,/},24000\);/,'premature child timeout in '+path);
  assert.doesNotMatch(source, /},(?:8000|9000|12000)\);/,'old child timeout remains in '+path);
 }
 const parent=read('../web/app.js');
 assert.match(parent,/Game server timed out\. Check the wallet before trying again\./);
 assert.match(parent,/},19000\);/,'the authenticated top-level bridge owns timeout reporting');
});

test('private authenticated game shell does not load public fake-wallet practice code',()=>{
 const privateWorker=read('../src/private-index.mjs');
 assert.ok(privateWorker.includes("if(path==='/practice.js')return json("));
 assert.ok(privateWorker.includes(".replace('<script src=\"/practice.js\" defer></script>','')"));
 assert.ok(privateWorker.includes('Signed-in Sharika app required for verified virtual-coin games.'));
 assert.ok(privateWorker.includes('LIVE GAME · SHARIKA APP REQUIRED'));
 const publicHtml=read('../web/index.html');
 assert.ok(publicHtml.includes('<script src="/practice.js" defer></script>'),
  'public practice remains intentionally independent of the real wallet');
});

test('game cards have explicit last-resort bundled artwork on HTTP image failures',()=>{
 const app=read('../web/app.js');
 assert.match(app,/picture\.onerror=\(\)=>/);
 assert.match(app,/image\.onerror=\(\)=>/);
 assert.match(app,/image\.src='\/cards\/food-wheel\.png'/);
 assert.match(app,/picture\.src='\/cards\/food-wheel\.png'/);
 const build=read('../scripts/build.mjs');
 const source='../../android-staging/app/src/main/assets/';
 const fileRefs=[
  'royal-ace-card.svg',
  'game-cards/cleopatra-gold.jpg',
  'game-cards/fruit-machine.jpg',
  'game-cards/hot-food.jpg',
  'food-wheel-original-card.png',
  'jackpot-fruit-original-card.png'
 ];
 for(const file of fileRefs){
  assert.ok(build.includes(file),'game artwork not bundled: '+file);
  const url=new URL(source+file,import.meta.url);
  assert.ok(existsSync(url),'missing original artwork: '+file);
  assert.ok(statSync(url).size>100,'empty original artwork: '+file);
 }
});

test('staging game manifest includes eleven distinct playable pages, not the unhosted legacy food-wheel',()=>{
 const site=read('../src/index.mjs');
 const ids=[...site.matchAll(/\{id:'([^']+)',name:/g)].map(match=>match[1]);
 assert.equal(ids.length,11);
 assert.equal(new Set(ids).size,11);
 assert.ok(!ids.includes('food-wheel'));
 assert.ok(ids.includes('sovera-gaddy'));
 assert.ok(ids.includes('greedy-classic'));
 assert.ok(ids.includes('royal-slots'));
});
