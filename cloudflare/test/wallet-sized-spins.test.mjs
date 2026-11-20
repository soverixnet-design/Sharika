import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {handleRoyalSlots} from '../src/royal-slots.mjs';
import {handleRoyalAce} from '../src/royal-ace.mjs';
import {handleCleopatra} from '../src/cleopatra.mjs';

for (const [name,handle] of Object.entries({'royal-slots':handleRoyalSlots,'royal-ace':handleRoyalAce,cleopatra:handleCleopatra})) {
  test(name+' accepts the full wallet and replays the same receipt', async () => {
    const sql=new DatabaseSync(':memory:');
    const migrations=new URL('../migrations/',import.meta.url);
    for(const file of readdirSync(migrations).filter(f=>f.endsWith('.sql')).sort())
      sql.exec(readFileSync(new URL(file,migrations),'utf8'));
    const coins=100000003;
    sql.prepare("INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) VALUES(10000001,'qa','QA','1990-01-01',0,?)").run(coins);
    sql.prepare('UPDATE sharika_game_catalog SET enabled=1 WHERE id=?').run(name);
    sql.exec('UPDATE sharika_'+name.replace('-','_')+'_settings SET enabled=1 WHERE id=1');
    const db={prepare(query){
      const stmt=sql.prepare(query);
      const bind=(...args)=>({first:()=>stmt.get(...args),run:()=>stmt.run(...args)});
      return {...bind(),bind};
    }};
    const send=(bet,requestId)=>handle({action:'spin',uid:'qa',db,
      request:new Request('https://qa.invalid',{method:'POST',body:JSON.stringify({bet,requestId,buy:false,freeSpin:false})}),
      reply:data=>data,fail:error=>({error}),cors:{}});
    assert.equal((await send(coins+1,'wallet-above-test')).error,'not_enough_balance');
    const receipt=await send(coins,'wallet-exact-test');
    assert.equal(receipt.requestId,'wallet-exact-test',JSON.stringify(receipt));
    assert.equal(receipt.balance,receipt.win ?? receipt.totalWin);
    assert.equal(sql.prepare("SELECT coins FROM sharika_users WHERE auth_uid='qa'").get().coins,receipt.balance);
    assert.deepEqual(await send(coins,'wallet-exact-test'),receipt);
    sql.close();
  });
}
