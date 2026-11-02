import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const start=adapter.indexOf('    frame.seatSheet=function(index){');
const end=adapter.indexOf('    const originalSeatEmoji=frame.seatEmoji;',start);
assert.ok(start>=0&&end>start,'verified room seat action bridge must exist');
const seatMenuSource=adapter.slice(start,end);

function menuFor({owner,seat,index=3}){
  const actions={children:[],replaceChildren(){this.children=[];},
    appendChild(button){this.children.push(button);}};
  const sheet={querySelector(selector){
    return selector==='.acts'?actions:null;
  }};
  let sheetMarkup='';
  Object.defineProperty(sheet,'innerHTML',{
    get(){return sheetMarkup;},
    set(value){sheetMarkup=value;actions.children=[];}
  });
  const events=[];
  const frame={seats:Array.from({length:9},(_,i)=>({empty:1,i})),
    $:name=>name==='sheet'?sheet:null,
    document:{
      createElement(){return {children:[],append(...items){this.children.push(...items);}};},
      createTextNode:text=>({text})
    },
    act(action,seatNo){events.push([action,seatNo]);}
  };
  frame.seats[index]=seat;
  const uid='verified-owner-uid';
  const room={owner_id:uid};
  const session={user:{id:owner?uid:'verified-guest-uid'}};
  const originalSeatSheet=()=>{
    // Original static HTML menu has demo callbacks; the verified bridge must
    // explicitly replace them to prevent fake local locks.
    actions.children=[{onclick(){events.push(['fake',index]);}}];
    return true;
  };
  new Function('frame','room','session','originalSeatSheet',seatMenuSource)(
    frame,room,session,originalSeatSheet
  );
  frame.seatSheet(index);
  return {actions:actions.children,events,sheet};
}

test('room owner may lock a free mic seat using verified server action',()=>{
  const view=menuFor({owner:true,seat:{empty:1,i:3}});
  assert.equal(view.actions.length,2);
  view.actions[0].onclick();
  assert.deepEqual(view.events,[['lock',3]]);
  view.actions[1].onclick();
  assert.deepEqual(view.events[1],['invite',3]);
});

test('room owner may unlock a locked seat; listeners cannot alter seat locks',()=>{
  const ownerView=menuFor({owner:true,seat:{lock:1,i:3}});
  assert.equal(ownerView.actions.length,1);
  ownerView.actions[0].onclick();
  assert.deepEqual(ownerView.events,[['unlock',3]]);
  const guestView=menuFor({owner:false,seat:{lock:1,i:3}});
  assert.equal(guestView.actions.length,0);
  assert.match(guestView.sheet.innerHTML,/Seat locked/);
  assert.equal(guestView.events.length,0);
});

test('open guest mic seat is takeable and the moved owner throne is decorative',()=>{
  const guest=menuFor({owner:false,seat:{empty:1,i:3}});
  assert.equal(guest.actions.length,1);
  guest.actions[0].onclick();
  assert.deepEqual(guest.events,[['take',3]]);
  const throne=menuFor({owner:true,index:0,
    seat:{empty:1,i:0,owner_throne:true,owner_mic_seat_no:3}});
  assert.equal(throne.events.length,0);
  assert.match(throne.sheet.innerHTML,/Owner is speaking from mic seat 3/);
});
