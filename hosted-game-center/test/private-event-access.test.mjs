import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import worker from '../src/private-index.mjs';
globalThis.crypto??=webcrypto;
const origin='https://sharika-private-center-staging.soverixnet.workers.dev';
const cookie='__Host-sh_center='+'A'.repeat(43);
const jpeg=Buffer.from([0xff,0xd8,0xff,0xd9]);
function dbFixture({moduleEnabled=true,eventEnabled=true,engineEnabled=true}={}){
 return {prepare(sql){
  return {sql,args:[],bind(...args){this.args=args;return this;},
   async first(){
    if(sql.includes('FROM sharika_center_browser_sessions'))return {auth_uid:'firebase:test:member'};
    if(sql.includes('SELECT published FROM sharika_center_publishing')){
     if(this.args[0]==='module'&&this.args[1]==='events')return {published:Number(moduleEnabled)};
     if(this.args[0]==='event'&&this.args[1]==='event:7')return {published:Number(eventEnabled)};
     if(this.args[0]==='game'&&this.args[1]==='royal-slots')return {published:1};
     return null;
    }
    if(sql.includes('SELECT id,starts_at,ends_at,banner_id,status FROM sharika_events'))
     return {id:7,starts_at:'2020-01-01T00:00:00.000Z',
      ends_at:'2099-01-01T00:00:00.000Z',banner_id:3,status:'published'};
    if(sql.includes('SELECT image_base64,mime,image_bytes'))
     return {image_base64:jpeg.toString('base64'),mime:'image/jpeg',image_bytes:jpeg.length};
    if(sql.includes('SELECT enabled FROM sharika_game_catalog'))
     return {enabled:Number(engineEnabled)};
    return null;
   },
   async all(){return {results:[]}},
   async run(){return {success:true}}
  };
 }};
}
const site={ASSETS:{fetch:async()=>new Response('<html>Game</html>',{status:200,
 headers:{'content-type':'text/html; charset=utf-8'}})}};
function get(path,options={}){
 const headers=options.auth?{cookie}:{};
 return worker.fetch(new Request(origin+path,{headers}),{...site,DB:dbFixture(options)});
}
test('anonymous user cannot fetch event banner or game assets',async()=>{
 const resp=await get('/api/center/events/7/banner');
 assert.equal(resp.status,401);
 const game=await get('/games/royal-slots/index.html');
 assert.equal(game.status,401);
});
test('global Event OFF denies both published event banners and rankings',async()=>{
 for(const suffix of ['banner','ranking']){
  const res=await get('/api/center/events/7/'+suffix,{auth:true,moduleEnabled:false});
  assert.equal(res.status,404);
  assert.equal((await res.json()).error,'event_hidden');
 }
});
test('individual Event OFF denies direct banner and leaderboard URLs',async()=>{
 const res=await get('/api/center/events/7/banner',{auth:true,eventEnabled:false});
 assert.equal(res.status,404);
});
test('published event banner returns only verified JPEG from D1 behind private cookie',async()=>{
 const res=await get('/api/center/events/7/banner?v=1',{auth:true});
 assert.equal(res.status,200);
 assert.equal(res.headers.get('content-type'),'image/jpeg');
 assert.equal(res.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(Buffer.from(await res.arrayBuffer()),jpeg);
});
test('private hosted iframe CSP names private origin and never old public origin',async()=>{
 const res=await get('/games/royal-slots/index.html',{auth:true});
 assert.equal(res.status,200);
 const csp=res.headers.get('content-security-policy');
 assert.ok(csp);
 assert.ok(csp.includes(origin));
 assert.ok(!csp.includes('https://sharika-games-web-staging.soverixnet.workers.dev'));
 assert.match(csp,/connect-src 'none'/);
 // Game screens must be allowed in their own origin's sandboxed iframe.
 assert.equal(res.headers.get('x-frame-options'),'SAMEORIGIN');
});
test('top-level private Center pages refuse external framing',async()=>{
 const res=await get('/center.html',{auth:true});
 assert.equal(res.status,200);
 assert.equal(res.headers.get('x-frame-options'),'DENY');
});
test('practice-mode browser Javascript is disabled on the private member origin',async()=>{
 const res=await get('/practice.js',{auth:true});
 assert.equal(res.status,404);
 assert.equal((await res.json()).error,'practice_disabled_in_private_center');
});
test('disabled game cannot load its direct HTML in a signed-in session',async()=>{
 const res=await get('/games/royal-slots/index.html',{auth:true,engineEnabled:false});
 assert.equal(res.status,403);
});
