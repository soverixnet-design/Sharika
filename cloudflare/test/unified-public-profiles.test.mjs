import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {syncGlobalPublicProfile,findGlobalPublicProfile} from '../src/unified-public-profiles.mjs';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE sharika_public_id_registry(public_no INTEGER PRIMARY KEY,auth_uid TEXT UNIQUE,origin TEXT);
 INSERT INTO sharika_public_id_registry VALUES
 (10000025,'karim','play_virtual'),(10000026,'rafiq','staging'),(10000027,'blocked','staging');`);
 sql.exec(readFileSync(new URL('../migrations/0107_global_public_profiles.sql',import.meta.url),'utf8'));
 return {sql,db:{prepare(q){
   const s=sql.prepare(q);let args=[];
   return {bind(...v){args=v;return this},async first(){return s.get(...args)||null},async run(){return s.run(...args)}};
 }}};
}
const profile=(no,uid,name,updated_at='2026-11-20 20:00:00')=>({
 public_no:no,auth_uid:uid,name,country:'BD',pic:null,cover:null,status:'active',
 wealth_level:2,charm_level:3,frame_style:'gold',entry_style:'',
 medal_style:'',name_tag_style:'',updated_at
});

test('Karim in Play and Rafiq in staging find each other under permanent IDs',async()=>{
 const {db,sql}=fixture();
 await syncGlobalPublicProfile(db,profile(10000025,'karim','Karim'),'play_virtual');
 await syncGlobalPublicProfile(db,profile(10000026,'rafiq','Rafiq'),'staging');
 assert.equal((await findGlobalPublicProfile(db,'10000025')).name,'Karim');
 assert.equal((await findGlobalPublicProfile(db,'10000026')).name,'Rafiq');
 assert.equal((await findGlobalPublicProfile(db,'10000026')).frame_style,'gold');
 assert.equal(await findGlobalPublicProfile(db,'not-a-number'),null);
 sql.close();
});

test('Firebase UID registry mismatch cannot steal an existing ID',async()=>{
 const {db,sql}=fixture();
 await assert.rejects(syncGlobalPublicProfile(db,profile(10000025,'wrong','Fake'),'staging'),
   /directory_identity_mismatch/);
 assert.equal(await findGlobalPublicProfile(db,'10000025'),null);
 sql.close();
});

test('newer cross-environment profile wins, stale or same-time non-primary cannot overwrite',async()=>{
 const {db,sql}=fixture();
 await syncGlobalPublicProfile(db,profile(10000025,'karim','Play Old','2026-11-19 10:00:00'),'play_virtual');
 await syncGlobalPublicProfile(db,profile(10000025,'karim','Stage New','2026-11-20 11:00:00'),'staging');
 await syncGlobalPublicProfile(db,profile(10000025,'karim','Play Too Old','2026-11-19 10:00:00'),'play_virtual');
 assert.equal((await findGlobalPublicProfile(db,'10000025')).name,'Stage New');
 await syncGlobalPublicProfile(db,profile(10000025,'karim','Play Tie','2026-11-20 11:00:00'),'play_virtual');
 assert.equal((await findGlobalPublicProfile(db,'10000025')).name,'Play Tie');
 sql.close();
});

test('blocked profiles are never returned, no private wallets or birthdates are mirrored',async()=>{
 const {db,sql}=fixture();
 const blocked={...profile(10000027,'blocked','Hidden'),status:'blocked',coins:999999,birthdate:'2000-01-01'};
 await syncGlobalPublicProfile(db,blocked,'staging');
 assert.equal(await findGlobalPublicProfile(db,'10000027'),null);
 const columns=sql.prepare('PRAGMA table_info(sharika_global_public_profiles)').all().map(x=>x.name);
 assert.ok(!columns.includes('coins')&&!columns.includes('birthdate')&&!columns.includes('diamonds'));
 sql.close();
});
