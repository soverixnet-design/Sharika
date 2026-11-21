import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleCountryAdmin} from '../src/admin-countries.mjs';

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE sharika_users(auth_uid TEXT PRIMARY KEY,status TEXT NOT NULL,country TEXT NOT NULL);
    CREATE TABLE sharika_rooms(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL);
    INSERT INTO sharika_users VALUES ('bd-owner','active','BD'),('bd-guest','active','BD'),('in-owner','active','IN');
    INSERT INTO sharika_rooms VALUES ('10000020','bd-owner'),('10000021','in-owner');
  `);
  sqlite.exec(readFileSync(new URL('../migrations/0107_country_management.sql',import.meta.url),'utf8'));
  const db={
    prepare(sql){
      const statement=sqlite.prepare(sql);
      return {
        async all(){return {results:statement.all()};},
        bind(...values){
          return {
            async first(){return statement.get(...values)||null;},
            async run(){return {meta:{changes:statement.run(...values).changes}};},
            async all(){return {results:statement.all(...values)};}
          };
        }
      };
    }
  };
  const call=async (method,operation,body,role='super')=>{
    const request=new Request('https://example.test/api/v1/admin/'+operation,{
      method,...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const res=await handleCountryAdmin({
      request,db,uid:'super-uid',role,operation,
      reply:(value,status)=>Response.json(value,{status}),
      fail:(error,status)=>Response.json({error},{status})
    });
    return {status:res.status,data:await res.json()};
  };
  return {sqlite,call};
}

test('country dashboard returns D1-confirmed country counts, not demo or online numbers',async()=>{
  const {sqlite,call}=fixture();
  const result=await call('GET','countries');
  assert.equal(result.status,200);
  assert.equal(result.data.source,'verified_d1');
  assert.deepEqual(result.data.countries.map(r=>[r.country_code,r.user_count,r.room_count]),
    [['BD',2,1],['IN',1,1]]);
  sqlite.close();
});

test('only Super Admin can view and edit country controls',async()=>{
  const {sqlite,call}=fixture();
  assert.equal((await call('GET','countries',undefined,'support')).status,403);
  assert.equal((await call('PUT','countries/BD',{notice:'Hello',pinned_room_id:'',expected_revision:0},'finance')).status,403);
  sqlite.close();
});

test('country settings pin only a room owned in that country and keep audit history',async()=>{
  const {sqlite,call}=fixture();
  const saved=await call('PUT','countries/BD',{
    pinned_room_id:'10000020',notice:'Welcome to Bangladesh',expected_revision:0
  });
  assert.equal(saved.status,200);
  assert.equal(saved.data.revision,1);
  assert.equal(sqlite.prepare('SELECT actor_uid FROM sharika_country_settings_audit').get().actor_uid,'super-uid');
  const refreshed=await call('GET','countries');
  assert.equal(refreshed.data.countries[0].pinned_room_id,'10000020');
  assert.equal(refreshed.data.countries[0].notice,'Welcome to Bangladesh');

  const stale=await call('PUT','countries/BD',{
    pinned_room_id:'',notice:'Another notice',expected_revision:0
  });
  assert.equal(stale.status,409);
  const foreign=await call('PUT','countries/BD',{
    pinned_room_id:'10000021',notice:'Wrong room',expected_revision:1
  });
  assert.equal(foreign.status,409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_country_settings_audit').get().n,1);
  sqlite.close();
});

test('country API validates country codes and rejects invalid pin and long notice',async()=>{
  const {sqlite,call}=fixture();
  assert.equal((await call('PUT','countries/BD',{pinned_room_id:'1',notice:'x',expected_revision:0})).status,400);
  assert.equal((await call('PUT','countries/BD',{pinned_room_id:'',notice:'x'.repeat(281),expected_revision:0})).status,400);
  assert.equal((await call('PUT','countries/BAN',{pinned_room_id:'',notice:'x',expected_revision:0})).status,404);
  assert.equal((await call('POST','countries/BD',{})).status,405);
  sqlite.close();
});
