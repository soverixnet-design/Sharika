import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const assetBase=new URL('../../android-staging/app/src/main/assets/',import.meta.url);
const gameAssets=[
  'original-games/sovera-food-wheel.html',
  'original-games/night-food-wheel.html',
  'original-games/jackpot-fruit.html',
  'original-games/sovera-gaddy-game.html',
  'original-games/sovera-gaddy-live.js',
  'original-games/cleopatra-slot.html',
  'original-games/food-wheel-deluxe.html',
  'fruit-royale/index.html',
  'fruit-royale/game.js',
  'fruit-royale/adapter.live.js',
  'greedy-wheel/index.html',
  'greedy-wheel/game.js',
  'greedy-wheel/sharika-bridge.js'
];

for(const filename of gameAssets){
  test('game UI has no Bengali text: '+filename,()=>{
    const text=readFileSync(new URL(filename,assetBase),'utf8');
    assert.doesNotMatch(text,/[\u0980-\u09FF]/,'all game labels, popups, loading and errors must be English');
    if(filename.endsWith('.html'))
      assert.match(text,/<html\b[^>]*\blang="en"/i,'game page must declare English language');
  });
}

test('Food Wheel Deluxe displays original eight food images with English food names and help',()=>{
  const text=readFileSync(new URL('original-games/food-wheel-deluxe.html',assetBase),'utf8');
  assert.match(text,/const NAMES=\['Strawberry','Burger','Shrimp','Puffer Fish','Banana','Orange','Cherry','Steak'\]/);
  assert.match(text,/Select a coin chip/);
  assert.match(text,/Tap any food to place your bet/);
  assert.match(text,/sharika:original-request/);
  assert.ok(text.length>750000,'original embedded images must remain bundled');
});

test('Greedy Wheel cannot switch to Bengali via URL or SDK',()=>{
  const text=readFileSync(new URL('greedy-wheel/game.js',assetBase),'utf8');
  assert.match(text,/lang:\s*'en',\s*\/\/ English-only game UI/);
  assert.doesNotMatch(text,/\bbn:\s*\{/);
  assert.match(text,/helpTitle:\s*'How to play'/);
  assert.match(text,/name:\s*\{\s*en:\s*'Shrimp'/);
});

test('in-room portal only renders catalog game labels, not a Bengali overlay',()=>{
  const bridge=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const start=bridge.indexOf('const originalGameCards=[');
  const end=bridge.indexOf('const gamesShortcut=',start);
  assert.ok(start>=0&&end>start);
  assert.doesNotMatch(bridge.slice(start,end),/[\u0980-\u09FF]/);
  assert.match(bridge.slice(start,end),/id:'cleopatra'/);
  assert.match(bridge.slice(start,end),/id:'food-deluxe'/);
});
