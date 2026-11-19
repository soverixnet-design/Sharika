import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const assets=new URL('../../android-staging/app/src/main/assets/original-games/',import.meta.url);
const cases=[
  {name:'Cleopatra',file:new URL('cleopatra-slot.html',assets),start:'function manualSpin()',end:'async function spin(',
    setup:"let spinning=true,HOST=true,fs=0,bets=[1000,10000],bi=0;const window={__sharikaGameReady:true};",
    tap:'manualSpin()',change:'bi=1',amount:'bet'},
  {name:'Royal Ace',file:new URL('royal-ace-deluxe.html',assets),start:'function manualSpin()',end:'spin=async function',
    setup:'let ready=true,busy=true,waiting=true,freeRemaining=0,activeBets=[1000,10000],bi=0;const $=()=>({});',
    tap:'manualSpin()',change:'bi=1',amount:'amount'},
  {name:'Royal Slots',file:new URL('../web/royal-slots.html',import.meta.url),start:'function manualSpin()',end:'async function play(',
    setup:'const S={busy:true,bi:0,fs:0},BETS=[1000,10000];',
    tap:'manualSpin()',change:'S.bi=1',amount:'bet'}
];
for(const item of cases)test(item.name+' records manual inputs during an existing spin',()=>{
  const html=readFileSync(item.file,'utf8'),a=html.indexOf(item.start),b=html.indexOf(item.end,a);
  assert.ok(a>=0&&b>a);
  const script=item.setup+'const spinTaps=[];function toast(){};'+html.slice(a,b)+
    'for(let i=0;i<1000;i++){if(i===500){'+item.change+';}'+item.tap+';} spinTaps;';
  const queue=runInNewContext(script,{});
  assert.equal(queue.length,1000);
  queue.forEach((entry,i)=>{assert.equal(entry[item.amount],i<500?1000:10000);assert.equal(entry.free,false);});
});

test('a lost Cleopatra spin reply reuses its original round ID',async()=>{
 const html=readFileSync(cases[0].file,'utf8');
 const code=html.slice(html.indexOf('async function getResult(bet)'),html.indexOf("addEventListener('message'",html.indexOf('async function getResult(bet)')));
 const requests=[],pend={},expected={balance:9000,win:0};
 const result=await runInNewContext(code+';getResult(1000)',{HOST:true,crypto,pend,setTimeout,clearTimeout,
  post(message){requests.push(message);queueMicrotask(()=>{const callback=pend[message.id];delete pend[message.id];
    callback(requests.length===1?{error:'network_unavailable'}:expected);});}
 });
 assert.equal(result,expected);
 assert.equal(requests.length,2);assert.equal(requests[0].id,requests[1].id);
});
