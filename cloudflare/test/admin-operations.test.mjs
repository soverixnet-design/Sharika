import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleOperationalRead} from '../src/admin-operations.mjs';

const db={
  prepare(sql){
    return {async all(){
      if(sql.includes('FROM sharika_rooms GROUP BY theme'))
        return {results:[{theme:'mid',rooms:2}]};
      if(sql.includes('winning_bets'))
        return {results:[{source:'original',game:'sovera-food',bets:51,settled:51,winning_bets:10}]};
      if(sql.includes('ORDER BY settled_at DESC LIMIT 30'))
        return {results:[{source:'original',game:'sovera-food',round_no:3,
          public_no:10000001,payout:250,settled_at:'2026-11-01 00:00:00'}]};
      throw Error('Unexpected SQL');
    }};
  }
};
async function execute(operation,role='super',method='GET'){
  const request=new Request('https://example.test/api/v1/admin/'+operation,{method});
  const response=await handleOperationalRead({request,env:{DB:db,VOICE_ROOMS:{},
    SHARIKA_LUCKY_GIFTS_ENABLED:'false'},actor:{role},operation,cors:{},
    reply:(body,status)=>Response.json(body,{status}),
    fail:(error,status)=>Response.json({error},{status})});
  return {status:response.status,body:await response.json()};
}

test('feature health reports protected settings without live secret values',async()=>{
  const result=await execute('feature-health','support');
  assert.equal(result.status,200);
  assert.equal(result.body.lucky_gifts_enabled,false);
  assert.equal(result.body.cash_redeemable_coins,false);
  assert.equal(result.body.protected_settings_read_only,true);
  assert.equal(JSON.stringify(result.body).includes('TOKEN'),false);
});
test('room theme usage comes from saved D1 rooms',async()=>{
  const result=await execute('theme-usage','support');
  assert.equal(result.status,200);
  assert.deepEqual(result.body.themes,[{theme:'mid',rooms:2}]);
  assert.equal(result.body.admin_theme_upload_supported,false);
});
test('games and winning IDs show only verified settled rows',async()=>{
  const result=await execute('game-monitor','finance');
  assert.equal(result.status,200);
  assert.equal(result.body.games[0].bets,51);
  assert.equal(result.body.wins[0].public_id,'10000001');
  assert.equal(result.body.wins[0].payout_coins,250);
});
test('ordinary support cannot inspect financial gameplay history',async()=>{
  const result=await execute('game-monitor','support');
  assert.equal(result.status,403);
  assert.equal(result.body.error,'admin_permission_denied');
});
test('operational pages cannot write state',async()=>{
  const result=await execute('feature-health','super','POST');
  assert.equal(result.status,405);
});
test('old demo pages are replaced by active or honest verified menu handlers',()=>{
  const ui=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');
  for(const page of ['levels','promo','themes','rr','games','winb','lucky','config','flags']){
    assert.match(ui,new RegExp('P\\.'+page+'\\s*='));
  }
  assert.match(ui,/live_presence_tracked/);
  const admin=readFileSync(new URL('../src/admin.mjs',import.meta.url),'utf8');
  assert.match(admin,/presenceRoomCounts/);
});
