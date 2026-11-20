import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname,normalize,sep} from 'node:path';
import site from '../src/index.mjs';

const base=join(dirname(fileURLToPath(import.meta.url)),'../dist');
const origin='https://sharika-games-web-staging.soverixnet.workers.dev';
const privateOrigin='https://sharika-private-center-staging.soverixnet.workers.dev';
const mime=path=>path.endsWith('.html')?'text/html':path.endsWith('.js')?'text/javascript':'application/octet-stream';
const env={ASSETS:{fetch:async req=>{
 const url=new URL(req.url),path=normalize(join(base,url.pathname));
 if(!path.startsWith(base+sep))return new Response('',{status:404});
 try{return new Response(readFileSync(path),{headers:{'content-type':mime(path)}})}
 catch{return new Response('missing asset',{status:404})}
}}};

test('all public catalog entries map to built and nonempty hosted HTML files',async()=>{
 const catalog=await (await site.fetch(new Request(origin+'/api/catalog'),env)).json();
 assert.ok(catalog.games.length>=11,'all eleven defined current game cards are available');
 assert.equal(new Set(catalog.games.map(g=>g.id)).size,catalog.games.length,'unique game IDs');
 for(const game of catalog.games){
   const path=new URL(game.asset,origin).pathname;
   assert.match(path,/^\/games\/[a-z0-9/_-]+\.html$|^\/games\/[a-z0-9/_-]+\/index\.html$/);
   assert.ok(statSync(join(base,path)).size>100,'bundled game missing or empty: '+game.id);
   const response=await site.fetch(new Request(origin+game.asset),env);
   assert.equal(response.status,200,'game HTTP route: '+game.id);
   assert.match(response.headers.get('content-security-policy')||'',/frame-ancestors/);
   assert.ok((response.headers.get('content-security-policy')||'').includes(privateOrigin),
     'our private Android game host may embed this game: '+game.id);
   assert.equal(response.headers.has('x-frame-options'),false,
     'SAMEORIGIN would block private center iframe: '+game.id);
   assert.ok((await response.text()).includes('<'),game.id+' is HTML');
 }
});

test('main Game Center keeps iframe strict and does not expose native bridge to game page',()=>{
 const markup=readFileSync(join(base,'index.html'),'utf8');
 const javascript=readFileSync(join(base,'app.js'),'utf8');
 const privateWorker=readFileSync(new URL('../src/private-index.mjs',import.meta.url),'utf8');
 const full=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaGameCenterActivity.java',import.meta.url),'utf8');
 const room=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaRoomGameDialog.java',import.meta.url),'utf8');
 assert.match(markup,/sandbox="allow-scripts allow-modals"/);
 assert.doesNotMatch(markup,/allow-same-origin|allow-top-navigation/);
 assert.ok(javascript.includes('GAME_ASSET_ORIGIN+game.asset'));
 assert.ok(javascript.includes("e.origin!=='null'"));
 assert.ok(javascript.includes('e.source!==frame.contentWindow'));
 assert.ok(privateWorker.includes('frame-src \'self\' "+originalOrigin'));
 for(const java of [full,room]){
   assert.match(java,/GAME_ASSET_ORIGIN/);
   assert.match(java,/isForMainFrame\(\)/);
   assert.match(java,/return !SITE_ORIGIN\.equals\(origin\)/);
 }
 assert.match(full,/Collections\.singleton\(SITE_ORIGIN\)/);
 assert.match(room,/Collections\.singleton\(SITE_ORIGIN\)/);
});

test('public practice must not request private member manifest to unlock game cards',()=>{
 const javascript=readFileSync(join(base,'app.js'),'utf8');
 assert.match(javascript,/if\(privateHost\)\{/);
 assert.match(javascript,/fetch\('\/api\/center\/manifest'/);
 assert.match(javascript,/if\(!bridge\)\{/);
 assert.match(javascript,/displayCards\(games,new Set\(games\.map\(g=>g\.id\)\)\)/);
 assert.match(javascript,/await call\('GET','\/api\/v1\/center\/manifest'\)/);
 assert.match(javascript,/games=games\.filter\(x=>visible\.has\(x\.id\)\)/);
});
