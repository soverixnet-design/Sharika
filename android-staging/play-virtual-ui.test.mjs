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
    window:{},
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
  assert.doesNotMatch(styles[0].textContent,/#qg/);
  onReady();
  assert.equal(title.nodeValue,'Coins');
  assert.equal(menu.nodeValue,'Coins');
  assert.equal(wallet.nodeValue,'Wallet');
  assert.equal(qr.title,'Get virtual coins');
  assert.equal(heading.textContent,'Gifts · friends · community updates · official notices');
  assert.equal(userMessage.nodeValue,'I want to ask about my wallet');
});

test('Play Wallet opens the verified server balance and transactions without recharge',async()=>{
  const listeners=new Map();
  const panel={isConnected:true,children:[],textContent:'',
    append(...nodes){this.children.push(...nodes);},
    replaceChildren(...nodes){this.children=[...nodes];}};
  const element=tag=>({tag,textContent:'',style:{},children:[],
    append(...nodes){this.children.push(...nodes);},
    replaceChildren(...nodes){this.children=[...nodes];}});
  const calls=[];
  const window={SharikaServer:{connected:()=>true,api:async(method,path)=>{
    calls.push([method,path]);
    return {coins:12345,diamonds:67,ledger:[{currency:'coins',delta:100,
      reason:'daily_check_in',created_at:'2026-11-10'}]};
  }},openSheet:markup=>{calls.push(['openSheet',markup]);}};
  const document={documentElement:{classList:{add(){}}},head:{appendChild(){}},
    createElement:element,addEventListener:(name,fn)=>listeners.set(name,fn),
    getElementById:id=>id==='sh-play-wallet'?panel:null};
  runInNewContext(script,{window,document});
  const event={target:{closest:selector=>selector.includes('[data-sh-profile-action')?{}:null},
    preventDefault(){calls.push('preventDefault');},
    stopImmediatePropagation(){calls.push('stopImmediatePropagation');}};
  listeners.get('click')(event);
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(calls.some(c=>Array.isArray(c)&&c[0]==='GET'&&c[1]==='/wallet'));
  assert.ok(calls.some(c=>Array.isArray(c)&&c[0]==='openSheet'));
  assert.ok(calls.includes('preventDefault'));
  assert.ok(calls.includes('stopImmediatePropagation'));
  assert.equal(panel.children[0].children[0].children[1].textContent,'12,345');
  assert.equal(panel.children[0].children[1].children[1].textContent,'67');
  assert.equal(panel.children[3].children[0].children[0].textContent,'daily_check_in');
  assert.deepEqual(calls.filter(c=>Array.isArray(c)&&c[0]!=='openSheet'),[['GET','/wallet']]);
});

test('Play Games shows four casual activities including Gaddy, never calls bet or wallet APIs',()=>{
  const listeners=new Map();
  const elements=[];
  const element=tag=>{
    const node={tag,textContent:'',style:{},children:[],onclick:null,
      classList:{remove(){},add(){}},
      append(...nodes){this.children.push(...nodes);},
      replaceChildren(...nodes){this.children=[...nodes];}};
    elements.push(node);return node;
  };
  const sheet=element('sheet');
  const overlay=element('overlay');
  let visible=false;
  overlay.classList={add:()=>{visible=true;},remove:()=>{visible=false;}};
  const doc={documentElement:{classList:{add(){}}},head:{appendChild(){}},
    createElement:element,addEventListener:(name,fn)=>listeners.set(name,fn),
    defaultView:{},getElementById:id=>id==='sh'?sheet:id==='shb'?overlay:null};
  const window={};
  runInNewContext(script,{document:doc,window,setTimeout});
  window.sharikaOpenPlayCasualGames(doc,null);
  assert.equal(visible,true);
  assert.deepEqual(sheet.children[2].children.slice(0,4).map(node=>node.textContent),
    ['🍔 Sovera Gaddy Game','💎 Royal Memory Match','⚡ Quick Tap Challenge','🧠 Brain Quiz']);
  sheet.children[2].children[0].onclick();
  assert.match(sheet.children[2].children[0].textContent,/Gaddy Kitchen Rush/);
  const gaddyChoices=sheet.children[2].children[3];
  gaddyChoices.children[0].onclick();
  assert.match(sheet.children[2].children[2].textContent,/Order 2\/10/);
  sheet.children[2].children[4].onclick();
  sheet.children[2].children[2].onclick();
  const crown=sheet.children[2].children[1];
  for(let i=0;i<15;i++)crown.onclick();
  assert.match(sheet.children[2].children[0].textContent,/Completed in/);
  assert.doesNotMatch(script,/api\('POST','\/(?:original-games|wallet\/exchange|greedy-wheel)/);
});
