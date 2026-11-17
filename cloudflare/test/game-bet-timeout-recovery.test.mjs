import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const file=name=>readFileSync(new URL(
  '../../android-staging/app/src/main/assets/original-games/'+name,import.meta.url),'utf8');
const greedy=file('greedy-classic-live.js');
const food=file('food-wheel-deluxe.html');
const cleopatra=file('cleopatra-slot.html');
const bridge=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');

function inlineJavascript(html,name){
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length>0, name+' must have an inline script');
  for(const script of scripts)new Script(script[1],{filename:name});
}
test('all original game client scripts remain parseable',()=>{
  new Script(greedy,{filename:'greedy-classic-live.js'});
  inlineJavascript(food,'food-wheel-deluxe.html');
  inlineJavascript(cleopatra,'cleopatra-slot.html');
});
test('Greedy uncertain bet retries only the original ID and unblocks after definitive non-debit',()=>{
  const start=greedy.indexOf('async function recoverUnknown()');
  const end=greedy.indexOf('async function bet(',start);
  assert.ok(start>=0&&end>start);
  const section=greedy.slice(start,end);
  assert.match(section,/await submit\(item\)/);
  assert.match(section,/betting_closed/);
  assert.match(section,/unconfirmed=null/);
  assert.doesNotMatch(section,/request_id:token\(\)/);
});
test('Food Wheel Deluxe never generates a second wager while first debit is uncertain',()=>{
  const start=food.indexOf('async function reconcileUnconfirmedBet()');
  const end=food.indexOf('async function myRoundStakes(',start);
  assert.ok(start>=0&&end>start,'reconciliation must precede food chip callbacks');
  const section=food.slice(start,end);
  assert.match(section,/const payload=unconfirmedBet/);
  assert.match(section,/call\('bet','POST',payload\)/);
  assert.match(section,/if\(unconfirmedBet\)return toast/);
  assert.match(section,/unconfirmedBet=payload/);
  assert.match(food,/setInterval\(reconcileUnconfirmedBet,4000\)/);
  assert.doesNotMatch(section,/coins\s*[-+]=/);
});
test('Cleopatra retry reuses requestId and locked wager after unknown result',()=>{
  assert.match(cleopatra,/let unconfirmedSpin=null/);
  assert.match(cleopatra,/const bet=HOST&&unconfirmedSpin\?unconfirmedSpin.bet:bets\[bi\]/);
  assert.match(cleopatra,/const id=unconfirmedSpin\?unconfirmedSpin.id:/);
  assert.match(cleopatra,/unconfirmedSpin=\{id,bet\}/);
  assert.match(cleopatra,/if\(!d.error\|\|rejectedSpin\(d.error\)\)unconfirmedSpin=null/);
});
test('only active authenticated game iframe can request a real bet',()=>{
  assert.match(bridge,/event.source!==current.element.contentWindow/);
  assert.match(bridge,/if\(data.action==='bet'\)reloadWallet\(\)\.catch/);
  assert.match(bridge,/currentGameFrame!==current/);
});
