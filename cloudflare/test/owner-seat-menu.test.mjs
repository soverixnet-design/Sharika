import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const start=adapter.indexOf('    const originalSeatSheet=frame.seatSheet;');
const end=adapter.indexOf('    const originalSeatEmoji=frame.seatEmoji;',start);
assert.ok(start>=0&&end>start,'verified room seat action bridge must exist');
const source=adapter.slice(start,end);

function menuFor({owner,seat,index=3}) {
  const events=[],nodes=[];
  function element(tag) {
    return {tag,children:[],textContent:'',className:'',id:'',onclick:null,
      append(...items){this.children.push(...items);},
      appendChild(item){this.children.push(item);return item;},
      setAttribute(){},focus(){},
      remove(){const i=nodes.indexOf(this);if(i>=0)nodes.splice(i,1);},
      querySelector(selector){return selector==='button'?
        this.children.find(item=>item.tag==='button'):null;}
    };
  }
  const doc={head:{appendChild(node){nodes.push(node);}},
    body:{appendChild(node){nodes.push(node);}},
    getElementById(id){return nodes.find(node=>node.id===id)||null;},
    createElement:element,createTextNode:text=>({text})};
  const frame={seats:Array.from({length:9},(_,i)=>({empty:1,i})),
    document:doc,$:()=>null,
    act(action,seatNo){events.push([action,seatNo]);}};
  frame.seats[index]=seat;
  const uid='verified-owner-uid',room={owner_id:uid};
  const session={user:{id:owner?uid:'verified-guest-uid'}};
  let originalCalled=false;
  frame.seatSheet=()=>{originalCalled=true;return true;};
  new Function('frame','room','session',source)(frame,room,session);
  frame.seatSheet(index);
  const overlay=nodes.find(node=>node.id==='sh-seat-action-overlay');
  const buttons=overlay?.children[0]?.children[1]?.children||[];
  return {events,buttons,overlay,nodes,originalCalled,
    labels:buttons.map(b=>b.textContent)};
}

test('owner sees Take Mic, Lock seat, Lock all, Cancel and can lock',()=>{
  const x=menuFor({owner:true,seat:{empty:1,i:3}});
  assert.equal(x.originalCalled,false);
  assert.deepEqual(x.labels,['Sit here','Lock seat','Lock all','Cancel']);
  x.buttons[1].onclick();
  assert.deepEqual(x.events,[['lock',3]]);
  assert.equal(x.nodes.includes(x.overlay),false);
});
test('owner can take mic or lock all available seats',()=>{
  const x=menuFor({owner:true,index:4,seat:{empty:1,i:4}});
  x.buttons[0].onclick();
  assert.deepEqual(x.events,[['take',4]]);
  const y=menuFor({owner:true,index:4,seat:{empty:1,i:4}});
  y.buttons[2].onclick();
  assert.deepEqual(y.events,[['lock_all',4]]);
});
test('locked seat allows owner unlock and unlock all, but no guest lock',()=>{
  const x=menuFor({owner:true,seat:{lock:1,i:3}});
  assert.deepEqual(x.labels,['Unlock seat','Unlock all','Cancel']);
  x.buttons[1].onclick();
  assert.deepEqual(x.events,[['unlock_all',3]]);
  const y=menuFor({owner:false,seat:{lock:1,i:3}});
  assert.deepEqual(y.labels,['Cancel']);
});
test('guest takes an open mic; owner can explicitly sit on the throne',()=>{
  const x=menuFor({owner:false,seat:{empty:1,i:3}});
  assert.deepEqual(x.labels,['Take Mic','Cancel']);
  x.buttons[0].onclick();
  assert.deepEqual(x.events,[['take',3]]);
  const y=menuFor({owner:true,index:0,seat:{empty:1,i:0}});
  assert.deepEqual(y.labels,['Sit on throne','Cancel']);
  y.buttons[0].onclick();
  assert.deepEqual(y.events,[['take',0]]);
  const blocked=menuFor({owner:false,index:0,seat:{empty:1,i:0}});
  assert.deepEqual(blocked.labels,['Cancel']);
});

function tapEmptySeatAs({owner}) {
  const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const start=adapter.indexOf('    // Owner taps are management actions');
  const end=adapter.indexOf('    // The room template\'s audience menu',start);
  assert.ok(start>=0&&end>start,'owner/guest seat click interception must exist');
  const events=[];
  const button={dataset:{i:'3'}};
  const grid={contains(value){return value===button;}};
  const frame={
    document:{
      addEventListener(name,callback,capture){assert.equal(name,'click');assert.equal(capture,true);this.onSeatClick=callback;},
      querySelector(selector){return selector==='#grid'?grid:null;}
    },
    seatSheet(index){events.push(['menu',index]);},
    toast(message){events.push(['toast',message]);}
  };
  const uid='verified-owner-uid';
  const room={id:'10000001',owner_id:uid,seat_count:14};
  const session={user:{id:owner?uid:'verified-guest-uid'}};
  let prevented=false,stopped=false;
  new Function('frame','room','session','moveSelfToSeat','errText',
    adapter.slice(start,end))(frame,room,session,
      seat=>{events.push(['move',seat]);return Promise.resolve();},String);
  frame.document.onSeatClick({
    target:{closest(selector){assert.equal(selector,'.seat.empty[data-i]');return button;}},
    preventDefault(){prevented=true;},
    stopImmediatePropagation(){stopped=true;}
  });
  assert.equal(prevented,true);
  assert.equal(stopped,true);
  return events;
}

test('empty seat tap opens owner management sheet without automatically seating owner',()=>{
  assert.deepEqual(tapEmptySeatAs({owner:true}),[['menu',3]]);
});

test('empty seat tap lets a regular guest join directly without owner controls',()=>{
  assert.deepEqual(tapEmptySeatAs({owner:false}),[['move',3]]);
});
