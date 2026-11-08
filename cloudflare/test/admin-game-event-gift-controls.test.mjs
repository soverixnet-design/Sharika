import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readGameCatalog,gameAcceptsBets,handleGameCatalogAdmin} from '../src/game-catalog.mjs';
import {handleAdminOperation} from '../src/admin.mjs';

const reply=(value,status=200)=>Response.json(value,{status});
const fail=(error,status)=>Response.json({error},{status});
function fixture(){
  const changes=[],catalog=new Map([
    ['sovera-food',1],['sovera-gaddy',1],['night-food',1],['jackpot-fruit',0],['fruit-royale',1],
    ['greedy-wheel',1],['food-wheel',1]
  ]);
  const db={
    prepare(sql){
      const stmt={sql,args:[],
        bind(...args){this.args=args;return this;},
        async first(){
          if(sql.includes('FROM sharika_game_catalog WHERE id=?'))
            return catalog.has(this.args[0])?{enabled:catalog.get(this.args[0])}:null;
          if(sql.includes('FROM sharika_admin_roles a'))return {role:'super',public_no:10000001};
          if(sql.startsWith('SELECT * FROM sharika_gifts'))
            return {id:2,name:'Rose',emoji:'🌹',active:1,price_coins:5,tab:0};
          return null;
        },
        async all(){
          if(sql.includes('FROM sharika_game_catalog'))
            return {results:[...catalog].map(([id,enabled])=>({id,enabled}))};
          return {results:[]};
        }
      };return stmt;
    },
    async batch(statements){
      for(const row of statements){
        changes.push({sql:row.sql,args:row.args});
        if(row.sql.startsWith('UPDATE sharika_game_catalog'))
          catalog.set(row.args[1],row.args[0]);
      }
      return statements.map(()=>({meta:{changes:1}}));
    }
  };
  return {db,changes,catalog};
}
async function call(f,role,method,body){
  const request=new Request('https://api.example.test/api/v1/admin/game-catalog',{
    method,body:body===undefined?undefined:JSON.stringify(body)
  });
  const response=await handleGameCatalogAdmin({
    request,db:f.db,uid:'admin_uid',role,reply,fail,cors:{}
  });
  return {status:response.status,data:await response.json()};
}
test('Fruit Royale replaces the old playable Jackpot while history switch stays visible',async()=>{
  const f=fixture();
  const games=await readGameCatalog(f.db);
  assert.equal(games.length,7);
  assert.equal(games.filter(game=>game.enabled).length,6);
  assert.equal(games.find(game=>game.id==='jackpot-fruit').enabled,false);
  assert.equal(games.find(game=>game.id==='fruit-royale').enabled,true);
});
test('only Super Admin can change game availability',async()=>{
  const f=fixture();
  assert.equal((await call(f,'finance','GET')).status,200);
  assert.equal((await call(f,'finance','PATCH',{id:'night-food',enabled:false})).status,403);
  assert.equal((await call(f,'support','GET')).status,403);
  assert.equal(f.changes.length,0);
});
test('disabled games reject new bets while other games stay available',async()=>{
  const f=fixture();
  const saved=await call(f,'super','PATCH',{id:'night-food',enabled:false});
  assert.equal(saved.status,200);
  assert.equal(saved.data.audited,true);
  assert.equal(await gameAcceptsBets(f.db,'night-food'),false);
  assert.equal(await gameAcceptsBets(f.db,'sovera-food'),true);
  assert.equal(f.changes[1].args[1],'game_catalog_toggle');
  assert.equal((await readGameCatalog(f.db)).find(g=>g.id==='night-food').enabled,false);
});
test('unknown game and malformed value cannot change the DB',async()=>{
  const f=fixture();
  assert.equal((await call(f,'super','PATCH',{id:'untrusted-html',enabled:true})).status,400);
  assert.equal((await call(f,'super','PATCH',{id:'night-food',enabled:'false'})).status,400);
  assert.equal(f.changes.length,0);
});
test('gift image links reject script URLs and accept HTTPS library images',async()=>{
  const f=fixture();
  async function post(body){
    const request=new Request('https://api.example.test/api/v1/admin/gifts',{
      method:'POST',body:JSON.stringify(body)
    });
    const result=await handleAdminOperation({
      request,env:{DB:f.db},uid:'admin_uid',path:'/api/v1/admin/gifts',
      cors:{},reply,fail
    });
    return {status:result.status,data:await result.json()};
  }
  const base={name:'Animation Gift',emoji:'🎁',price_coins:50,tab:1};
  assert.equal((await post({...base,image_url:'javascript:alert(1)'})).status,400);
  assert.equal((await post({...base,image_url:'https://cdn.example.com/gift.webp'})).status,201);
  assert.ok(f.changes.some(c=>c.sql.includes('image_url,animation_url')));
});
test('events are banner-only and room games still call real authenticated endpoints',()=>{
  const js=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');
  assert.doesNotMatch(js,/sharika-room-events/);
  assert.match(js,/window\.showSharikaEvent=async function/);
  assert.ok(js.includes("api('GET','/events/'+id+'/ranking')"));
  assert.match(js,/api\('GET','\/game-catalog'\)/);
  assert.match(ui,/api\('PATCH','game-catalog'/);
  assert.match(ui,/data-gift-save/);
  assert.match(ui,/api\('PATCH','gifts\//);
});
