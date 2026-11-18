import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const read=(path)=>readFileSync(resolve(root,path),'utf8');

test('the parent bridge waits for native Firebase + Cloudflare network timeouts',()=>{
 const js=read('web/app.js');
 assert.match(js,/Game server timed out\. Check the wallet before trying again\.\s*'\)\);\s*\},30000\);/);
 assert.match(js,/m\.action==='bet'\?'POST':'GET'/);
 assert.match(js,/call\(method,'\/api\/v1\/original-games\/'/);
});

test('hosted food wheels do not fail before the parent bridge response',()=>{
 const files=[
  ['games/original-games/greedy-classic-live.js',/reject\(Error\('Server timeout'\)\)\},34000\);/],
  ['games/original-games/food-wheel-deluxe.html',/reject\(Error\('Server timeout'\)\)\},34000\);/],
  ['games/original-games/sovera-food-wheel.html',/reject\(Error\('server_timeout'\)\);\s*\},34000\);/],
  ['games/original-games/night-food-wheel.html',/reject\(Error\('server_timeout'\)\);\s*\},34000\);/]
 ];
 for(const [path,expected] of files){
  assert.match(read('dist/'+path),expected,path);
 }
});

test('idempotent bet request identifiers stay in place',()=>{
 assert.match(read('dist/games/original-games/food-wheel-deluxe.html'),/request_id:requestId\(\)/);
 assert.match(read('dist/games/original-games/greedy-classic-live.js'),/request_id:token\(\)/);
});
