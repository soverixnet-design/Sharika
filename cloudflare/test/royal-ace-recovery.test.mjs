import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';

// Execute the shipped bridge, with a controlled parent and clock. This verifies
// financial UI transitions; it does not claim browser rendering or device audio.
const html=readFileSync(new URL('../../android-staging/app/src/main/assets/original-games/royal-ace-deluxe.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('/* Sharika verified bridge.'),html.lastIndexOf('</script>'));
function fixture({delay=100,freeSpins=0,invalid=false,lost=false}={}){
  const nodes=new Map(),timers=new Map(),requests=[];
  let now=0,serial=0,listener,context;
  const node=()=>({style:{},disabled:false,checked:false,textContent:'',children:[],
    classList:{add(){},remove(){},toggle(){}},appendChild(x){this.children.push(x);},
    querySelector(){return {};},querySelectorAll(){return [];}});
  const $=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const send=data=>listener({source:parent,data:{source:'sharika-royal-ace-server',...data}});
  const later=(fn,ms=0)=>{const key=++serial;timers.set(key,{fn,at:now+ms});return key;};
  const parent={postMessage(d){
    if(d.type==='ready')later(()=>send({type:'init',balance:1000000,maxWin:12345,
      bets:[1000],lockedBet:freeSpins?1000:0,freeSpins}),0);
    if(d.type!=='spin')return;
    requests.push(d);
    later(()=>{
      if(lost)return send({type:'spinResult',id:d.id,error:'network unavailable'});
      send({type:'spinResult',id:d.id,requestId:d.id,settled:!invalid,bet:d.bet,
        mode:d.buy?'bonus_buy':'paid',win:0,balance:999000,freeSpins:0,bonusSpins:0,
        steps:[{grid:Array.from({length:5},()=>Array.from({length:4},()=>({s:0,g:false}))),marks:[]}]});
    },delay);
  }};
  context=vm.createContext({$,parent,crypto:webcrypto,URLSearchParams,
    location:{search:'?mode=room'},localStorage:{getItem(){return null;},setItem(){}},
    document:{body:node(),createElement:node},
    window:{installStakePicker(){},addEventListener(type,fn){if(type==='message')listener=fn;}},
    setTimeout:later,clearTimeout:key=>timers.delete(key),IM:{logo:''},
    spin(){},busy:false,auto:false,bal:0,bet:1000,bi:0,free:false,G:[],H:[],MSG:['Ready'],mute:false,
    upd(){},render(){},setCombo(){},fmt:n=>n.toLocaleString('en-US'),SFX:{spin(){},win(){},scatter(){}},
    toast(){},msg:async()=>{},bigWin:async()=>{},sleep:async()=>{},confirm:()=>true});
  vm.runInContext(source,context);
  async function until(predicate){
    for(let count=0;count<120;count++){
      for(let i=0;i<15;i++)await Promise.resolve();
      if(predicate())return;
      const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];
      assert.ok(next,'No remaining timer before expected transition');
      timers.delete(next[0]);now=next[1].at;next[1].fn();
    }
    assert.fail('UI transition did not complete');
  }
  return {$,context,requests,until,setLost:value=>{lost=value;},setInvalid:value=>{invalid=value;}};
}

test('a 12-second confirmed response stays one spin, after the former 11-second timeout',async()=>{
  const f=fixture({delay:12000});
  await f.until(()=>f.$('royal-loading').style.display==='none');
  f.$('sp').onclick();
  await f.until(()=>f.requests.length>0&&!f.context.busy);
  assert.equal(f.requests.length,1);
  assert.equal(f.context.bal,999000);
  assert.equal(f.$('sp').disabled,false);
});

test('explicit recovery reuses original request ID and stake after uncertain results',async()=>{
  const f=fixture({lost:true});
  await f.until(()=>f.$('royal-loading').style.display==='none');
  f.$('sp').onclick();
  await f.until(()=>f.requests.length===3&&!f.context.busy);
  assert.equal(new Set(f.requests.map(r=>r.id)).size,1);
  assert.equal(f.context.bal,1000000,'No invented local refund/debit');
  f.setLost(false);f.$('royal-try-again').onclick();
  await f.until(()=>f.requests.length===4&&!f.context.busy);
  assert.equal(new Set(f.requests.map(r=>r.id)).size,1);
  assert.ok(f.requests.every(r=>r.bet===1000&&r.buy===false));
  assert.equal(f.context.bal,999000);
  assert.equal(f.$('sp').disabled,false);
});

test('unsettled receipt cannot update coins; recovery retains its original ID',async()=>{
  const f=fixture({invalid:true});
  await f.until(()=>f.$('royal-loading').style.display==='none');
  f.$('sp').onclick();
  await f.until(()=>f.requests.length===1&&!f.context.busy);
  assert.equal(f.context.bal,1000000);
  assert.equal(f.$('sp').disabled,true);
  f.setInvalid(false);f.$('royal-try-again').onclick();
  await f.until(()=>f.requests.length===2&&!f.context.busy);
  assert.equal(f.requests[0].id,f.requests[1].id);
  assert.equal(f.context.bal,999000);
});

test('free spins disable bonus purchase and the rules show the server cap',async()=>{
  const f=fixture({freeSpins:1});
  await f.until(()=>f.$('royal-loading').style.display==='none');
  assert.equal(f.$('bb').disabled,true);
  f.$('bb').onclick();
  assert.equal(f.requests.length,0);
  f.$('inf').onclick();
  assert.match(f.$('bx').children.at(-1).textContent,/Server payout cap: 12,345/);
  assert.match(f.$('bx').children.at(-1).textContent,/not a win probability/);
});
