import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import {settleTapBatch} from '../src/round-tap-batch.mjs';

test('1,000 taps preserve picks, chip amounts and wallet debits across a lost response',async()=>{
  const sql=new DatabaseSync(':memory:');
  for(const name of ['0001_initial','0046_admin_game_catalog','0058_sovera_gaddy_game']){
    sql.exec(readFileSync(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8'));
  }
  sql.exec("INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) VALUES(10000001,'qa','QA','1995-01-01',0,275000)");
  const now=Date.now(),round=17;
  sql.prepare('INSERT INTO sharika_gaddy_rounds(id,round_no,starts_ms,bet_closes_ms,closes_ms,seed_hex,commit_sha256,weights_json,multipliers_json) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('r',round,now-2000,now+15000,now+20000,'a'.repeat(64),'b'.repeat(64),'[]','[]');
  const db={
    prepare:query=>({bind:(...args)=>({query,args})}),
    batch(statements){
      sql.exec('BEGIN');
      try{
        const result=statements.map(({query,args})=>({results:sql.prepare(query).all(...args)}));
        sql.exec('COMMIT');return result;
      }catch(error){sql.exec('ROLLBACK');throw error;}
    }
  };
  const handle=body=>settleTapBatch({db,uid:'qa',game:'sovera-gaddy',body,currentRound:round,
    ensure:()=>({id:'r',bet_closes_ms:now+15000}),validAmount:n=>[50,500].includes(n),maxPick:7,
    reply:value=>value,fail:code=>{throw Error(code);}});
  const window={};
  runInNewContext(readFileSync(new URL('../../android-staging/app/src/main/assets/original-games/rapid-bets.js',import.meta.url),'utf8'),
    {window,crypto,setTimeout});
  let packets=0,first;
  const enqueue=window.createRoundTapQueue({openRound:n=>n===round,send:async body=>{
    packets++;
    const result=await handle(body);
    if(packets===1){first=body;throw Error('network timeout');}
    return result;
  }});
  const jobs=Array.from({length:1000},(_,i)=>enqueue(round,i%8,i%2?500:50,275000));
  await assert.rejects(enqueue(round,0,50,275000),/insufficient_coins/);
  const receipts=await Promise.all(jobs);
  assert.equal(new Set(receipts.map(r=>r.bet_id)).size,1000);
  assert.equal(packets,43);
  const rows=sql.prepare('SELECT pick_index,amount FROM sharika_gaddy_bets ORDER BY id').all();
  rows.forEach((r,i)=>{assert.equal(r.pick_index,i%8);assert.equal(r.amount,i%2?500:50);});
  assert.equal(sql.prepare('SELECT coins FROM sharika_users').get().coins,0);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM sharika_wallet_ledger').get().n,1000);
  assert.equal((await handle({round_no:round,taps:[{...first.taps[0],pick:2}]})).receipts[0].error,'idempotency_conflict');
  assert.equal((await handle({round_no:round,taps:[{...first.taps[0],request_id:'no-funds-request-1'}]})).receipts[0].error,'insufficient_coins');
  const late=await handle({round_no:round+1,taps:[{...first.taps[0],request_id:'late-tap-request-1'}]});
  assert.equal(late.receipts[0].error,'betting_closed');
  sql.close();
});
