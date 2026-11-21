import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../web/royal-slots-bridge.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const parentOrigin='https://sharika-private-center-staging.soverixnet.workers.dev';

function boot(mode='production'){
 const sent=[],listeners={},nodes=[],timers=new Map();
 let nextTimer=0;
 const parent={postMessage(payload,target){sent.push({payload,target})}};
 const game={init(cfg){this.config=cfg},on(){},setJackpot(value){this.jackpot=value}};
 const document={
  readyState:'complete',
  body:{appendChild(node){nodes.push(node)}},
  createElement(tag){
   return {tag,style:{},hidden:false,events:{},children:[],textContent:'',
    setAttribute(){},append(...items){this.children.push(...items)},
    addEventListener(type,fn){this.events[type]=fn}};
  }
 };
 const window={parent,SharikaGame:game,addEventListener(type,fn){listeners[type]=fn}};
 runInNewContext(source,{window,parent,document,location:{search:'?mode='+mode},
  URLSearchParams,Map,Number,Array,Error,String,RegExp,
  setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,delay});return id},
  clearTimeout(id){timers.delete(id)}});
 const message=data=>listeners.message?.({source:parent,origin:parentOrigin,data});
 return {sent,game,document,nodes,timers,message,cover:nodes[0],listeners,parent};
}
function init(ctx){
 ctx.message({source:'sharika-royal-slots-server',type:'init',balance:100000,
  freeSpins:0,lockedBet:0,jackpot:200000,
  profile:{public_id:'10000003',name:'Test Player',pic:''}});
 return ctx.game.config?.host;
}
const receipt=(id,bet=1000,freeSpin=false)=>({
 requestId:id,bet,freeSpin,settled:true,virtual_coins_only:true,
 balance:99000,totalWin:0,jackpot:200000,jackpotWin:0,
 freeSpinsAwarded:0,freeSpinsLeft:0,lines:[],
 grid:Array.from({length:5},()=>[1,2,3])
});

test('demo has no native wager relay or connection-blocking overlay',()=>{
 const ctx=boot('demo');
 assert.equal(ctx.nodes.length,0);assert.equal(ctx.sent.length,0);
});
test('authenticated production starts behind overlay and removes it after verified init',()=>{
 const ctx=boot();
 assert.match(ctx.cover.style.cssText,/display:flex/);
 assert.equal(ctx.sent.at(-1).payload.type,'ready');
 assert.equal(ctx.sent.at(-1).target,parentOrigin,'native parent must receive handshake');
 const host=init(ctx);
 assert.equal(ctx.game.config.mode,'production');
 assert.equal(typeof host.placeBet,'function');
 assert.equal(ctx.cover.style.display,'none');
 assert.equal(ctx.game.config.profile.id,'10000003');
});

test('production message rejects the public-games origin, even when coming from the parent window',()=>{
 const ctx=boot(),data={source:'sharika-royal-slots-server',type:'init',balance:100000,
  freeSpins:0,lockedBet:1000,jackpot:100000,profile:{public_id:'10000003',name:'Alice'}};
 ctx.listeners.message({source:ctx.parent,origin:'https://sharika-games-web-staging.soverixnet.workers.dev',data});
 assert.equal(ctx.game.config,undefined);
 init(ctx);
 assert.equal(ctx.game.config.mode,'production');
});

test('lost initial handshake becomes a retryable error without inventing a wallet balance',()=>{
 const ctx=boot();
 const watchdog=[...ctx.timers.values()].find(t=>t.delay===14000);
 assert.ok(watchdog,'missing connection watchdog');
 watchdog.fn();
 assert.match(ctx.cover.children[0].textContent,/timed out/i);
 assert.equal(ctx.cover.children[1].hidden,false);
 ctx.cover.children[1].events.click();
 assert.equal(ctx.sent.at(-1).payload.type,'ready');
 assert.equal(ctx.sent.at(-1).target,parentOrigin);
 const host=init(ctx);
 assert.equal(typeof host.placeBet,'function');
 assert.equal(ctx.cover.style.display,'none');
});

test('paid bet completes via one server settlement; startRound does not debit twice',async()=>{
 const ctx=boot(),host=init(ctx),id='R1763561234567-1';
 const accepted=host.placeBet({roundId:id,bet:1000});
 const messages=ctx.sent.filter(s=>s.payload.type==='spin');
 assert.equal(messages.length,1);
 assert.equal(messages[0].payload.id,id);
 const data=receipt(id);
 ctx.message({source:'sharika-royal-slots-server',type:'spinResult',id,result:data});
 assert.equal((await accepted).accepted,true);
 const settled=await host.startRound({roundId:id,bet:1000,freeSpin:false});
 assert.deepEqual(Array.from(settled.grid[0]),[1,2,3]);
 assert.equal(ctx.sent.filter(s=>s.payload.type==='spin').length,1);
});
test('free spins require server settlement but no separate paid bet',async()=>{
 const ctx=boot(),host=init(ctx),id='R1763561234567-2';
 const result=host.startRound({roundId:id,bet:1000,freeSpin:true});
 assert.equal(ctx.sent.at(-1).payload.freeSpin,true);
 ctx.message({source:'sharika-royal-slots-server',type:'spinResult',id,result:receipt(id,1000,true)});
 assert.equal((await result).freeSpin,true);
});
test('invalid server lines are rejected instead of hanging winner animation',async()=>{
 const ctx=boot(),host=init(ctx),id='R1763561234567-3';
 const attempt=host.placeBet({roundId:id,bet:1000});
 const broken=receipt(id);broken.lines={forEach:'not a function'};
 ctx.message({source:'sharika-royal-slots-server',type:'spinResult',id,result:broken});
 await assert.rejects(attempt,/Invalid server response/);
 assert.equal(ctx.cover.style.display,'flex');
 assert.equal(ctx.cover.children[1].hidden,false);
});
test('state errors show a retry control instead of leaving active spins unlocked',()=>{
 const ctx=boot();
 ctx.message({source:'sharika-royal-slots-server',type:'initError',error:'game_network_unavailable'});
 assert.match(ctx.cover.children[0].textContent,/game_network_unavailable/);
 assert.equal(ctx.cover.children[1].hidden,false);
 ctx.cover.children[1].events.click();
 assert.equal(ctx.sent.at(-1).payload.type,'ready');
});
test('unknown-commit retries retain the original requestId and only retry network errors',()=>{
 assert.match(app,/const payload=\{bet:m.bet,requestId:m.id,freeSpin:m.freeSpin\}/);
 assert.match(app,/const attempt=\(\)=>call\('POST','\/api\/v1\/royal-slots\/spin',payload\)/);
 assert.match(app,/uncertain=\/timed out/);
 assert.match(app,/result=await attempt\(\)/);
 assert.match(app,/type:'initError'/);
});
