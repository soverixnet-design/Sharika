import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../../app/royal-room-ui.js',import.meta.url),'utf8');

test('identical verified room polls keep avatar DOM and latest profile action',async()=>{
  const start=source.indexOf('  function renderPremiumHeader(){');
  const end=source.indexOf('  window.SharikaRoomPremium=',start);
  assert.ok(start>=0&&end>start);
  let repaints=0,clicked=[];
  const faces={dataset:{},children:[],
    replaceChildren(){repaints++;this.children=[];},
    appendChild(node){this.children.push(node);}};
  const nodes={'sh-room-masthead':{},'sh-room-faces':faces};
  const createElement=()=>({children:[],dataset:{},
    appendChild(node){this.children.push(node);},
    setAttribute(){}});
  const member={publicId:'10000001',displayId:'10000001',pic:'avatar.jpg',
    name:'Shakil',role:'member'};
  const premiumState={room:{roomId:'10000009',members:[member],
    openProfile:person=>clicked.push('old:'+person.publicId)}};
  const context={
    premiumState,app:{querySelector:selector=>selector==='.top'?{}:null},
    document:{getElementById:id=>nodes[id]||null,createElement},
    canShow:()=>true,vipAvatar:person=>({avatar:person.pic}),byId:()=>null,
    showMembers:()=>{},refreshSmallRanking:async()=>{},loadAnnouncement:async()=>{},
    window:{toast:()=>{}},Promise,JSON
  };
  const runHeader=runInNewContext(source.slice(start,end)+
    '\nthis.runHeader=renderPremiumHeader;',context);
  runHeader();
  assert.equal(repaints,1);
  const firstFace=faces.children[0];
  premiumState.room={roomId:'10000009',members:[{...member}],
    openProfile:person=>clicked.push('current:'+person.publicId)};
  runHeader();
  assert.equal(repaints,1,'do not recreate avatars for the same verified list');
  assert.equal(faces.children[0],firstFace);
  firstFace.onclick();
  await Promise.resolve();
  assert.deepEqual(clicked,['current:10000001'],
    'click handler must resolve the latest authenticated room view');
  premiumState.room={...premiumState.room,members:[{...member,name:'Updated name'}]};
  runHeader();
  assert.equal(repaints,2,'repaint when the server changes a member');
});

test('visible member IDs have a stable seat label, separate from the name',()=>{
  const css=readFileSync(new URL('../../app/royal-room-ui.css',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  assert.match(css,/\.seat \.sh-verified-seat-id\s*\{[^}]*min-height:13px/);
  assert.match(ui,/id\.textContent='ID '\+visibleSeatId/);
});

test('old Worker empty roster cannot erase a verified seat during a coordinator outage',async()=>{
  const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const start=ui.indexOf('  async function syncFrameOnce(room,frame) {');
  const end=ui.indexOf('    const ownerMember=',start);
  assert.ok(start>=0&&end>start);
  const originalSeat={public_id:'10000001',i:1};
  const frame={seats:[originalSeat],__sharikaRoomRenderSignature:'verified',
    __sharikaOwnerFetchedAt:Date.now(),render:()=>assert.fail('must not repaint')};
  const room={id:'10000009',owner_id:'owner'};
  let heartbeats=0;
  const sync=runInNewContext(ui.slice(start,end)+
    '\n}\nthis.syncFrameOnce=syncFrameOnce;',{
    window:{cur:room},session:{user:{id:'firebase-user'}},
    api:async()=>({members:[]}),heartbeatPresence:()=>{heartbeats++;},
    Date,Error,Array
  });
  await assert.rejects(sync(room,frame),/room_presence_temporarily_unavailable/);
  assert.equal(frame.seats[0],originalSeat);
  assert.equal(heartbeats,1,'refresh verified presence before the next poll');
});
