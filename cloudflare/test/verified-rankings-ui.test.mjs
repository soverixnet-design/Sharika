import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const android=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const admin=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');

test('original Android ranking tabs read verified API activity without adding a new screen',()=>{
  for(const [tab,kind] of [[1,'sending'],[5,'game'],[6,'recharge']]){
    assert.match(android,new RegExp(String(tab)+':\\{kind:\''+kind+'\''));
  }
  assert.match(android,/['"]\/rankings\/verified\?period=['"]/);
  assert.match(android,/kind==='game'\?'&metric=wins'/);
  assert.match(android,/leader\.display_id\|\|leader\.public_id/);
  assert.match(android,/\^\[0-9\]\{1,10\}\$/);
  assert.match(android,/\bkind==='game'\?'🏆 '/);
  assert.match(android,/sharika-royal-ranking/);
});

test('existing web Admin rankings display sending, recharge, game and TOP 1–7 policy controls',()=>{
  assert.match(admin,/sending:'Verified Sending'/);
  assert.match(admin,/game:'Verified Game Wins'/);
  assert.match(admin,/API\+'\/api\/v1\/rankings\/verified\?'/);
  assert.match(admin,/Automatic Ranking Targets & Rewards/);
  assert.match(admin,/sovera-gaddy','Sovera Gaddy/);
  assert.match(admin,/ranking-rewards\/settle/);
});
