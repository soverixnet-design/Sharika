import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
const root='android-staging/app/src/main/assets/sharika-premium';
const code=readFileSync('android-staging/staging-connection.js','utf8');
const frames=['official-manager-royal-gold-v1','bd-admin-blue-diamond-v1','official-host-rose-gold-v1'];
for(const id of frames){
  const asset=join(root,id+'.svg');
  assert(existsSync(asset),'missing '+asset);
  const svg=readFileSync(asset,'utf8');
  assert(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'invalid svg namespace '+id);
  assert(svg.includes('repeatCount="indefinite"'), 'no animation '+id);
  assert(svg.includes('r="310" fill="none"'),'opaque portrait center '+id);
  assert(code.includes("id:'"+id+"'"), 'not in frame catalog '+id);
  assert(code.includes("'frame_style:"+id+"'"), 'not in official guard '+id);
}
const gifts=['cp-royal-rose.svg','cp-diamond-heart.svg','cp-eternal-promise.svg'];
for(const asset of gifts){
  assert(existsSync(join(root,asset)),'missing CP art '+asset);
  assert(code.includes(asset),'not in CP UI '+asset);
}
const gift=readFileSync(join(root,'sura-gift-icon.png'));
assert(gift.length>1000,'empty gift icon');
assert(gift.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'not a PNG');
assert(code.includes('sh-bond-gift-icon'),'CP icon presentation missing');
console.log('PASS: 3 guarded role frames, 3 CP gift SVGs, original Sura generic gift icon');
