import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script=readFileSync(new URL('./play-virtual-ui.js',import.meta.url),'utf8');
const gradle=readFileSync(new URL('./app/build.gradle',import.meta.url),'utf8');

test('closed-loop Play visuals are packaged only for the isolated origin',()=>{
  assert.match(gradle,/playVirtualPresentation = productionApiOrigin ==/);
  assert.match(gradle,/sharika-api-play-virtual\.soverixnet\.workers\.dev/);
  assert.match(gradle,/if \(playVirtualPresentation\) from\(rootProject\.file\('play-virtual-ui\.js'\)\)/);
  assert.match(gradle,/id="sharika-play-virtual-ui" src="\.\/play-virtual-ui\.js"/);
});

test('Play presentation hides incompatible UI and relabels navigation without touching chat',()=>{
  const textNode=(nodeValue)=>({nodeValue});
  const title=textNode('Recharge');
  const menu=textNode('Recharge');
  const wallet=textNode('Wallet');
  const userMessage=textNode('I want to ask about my wallet');
  const elements={
    '#qr small,.top-recharge small':[{nodes:[title]}],
    '#v-me button[data-m="recharge"]':[{nodes:[menu]}],
    '#v-me button[data-sh-profile-action="wallet"]':[{nodes:[wallet]}],
    '#v-me .profile-balance-link':[],
  };
  const heading={textContent:'Receipts · recharge · shop · Family · BD · official notices'};
  const qr={title:'Recharge your coins'};
  const styles=[];
  let onReady;
  const context={
    document:{documentElement:{classList:{add:()=>{}}},head:{appendChild:style=>styles.push(style)},
      createElement:()=>({id:'',textContent:''}),
      createTreeWalker:target=>{let i=0;return {nextNode:()=>target.nodes[i++]||null};},
      addEventListener:(name,cb)=>{if(name==='DOMContentLoaded')onReady=cb;},
      querySelectorAll:selector=>elements[selector]||[],
      getElementById:id=>id==='qr'?qr:null,
      querySelector:selector=>selector==='.sh-notify-head p'?heading:null},
    NodeFilter:{SHOW_TEXT:4},MutationObserver:class{observe(){}},queueMicrotask:fn=>fn()
  };
  runInNewContext(script,context);
  assert.equal(styles.length,1);
  assert.match(styles[0].textContent,/#sharika-recharge-seller-wallet/);
  assert.match(styles[0].textContent,/#sh-bd-entry/);
  assert.match(styles[0].textContent,/#rt button:nth-child\(7\)/);
  onReady();
  assert.equal(title.nodeValue,'Coins');
  assert.equal(menu.nodeValue,'Coins');
  assert.equal(wallet.nodeValue,'Coins');
  assert.equal(qr.title,'Get virtual coins');
  assert.equal(heading.textContent,'Gifts · friends · community updates · official notices');
  assert.equal(userMessage.nodeValue,'I want to ask about my wallet');
});
