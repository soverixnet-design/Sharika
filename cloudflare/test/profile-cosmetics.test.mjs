import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {handleRequest} from '../src/index.mjs';

globalThis.crypto ??= webcrypto;
const project='sharika-cosmetic-test';
const pair=await crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'
},true,['sign','verify']);
const jwk={...(await crypto.subtle.exportKey('jwk',pair.publicKey)),
  kid:'cosmetics-test',alg:'RS256',use:'sig'};
const base64=value=>Buffer.from(typeof value==='string'?value:
  JSON.stringify(value)).toString('base64url');
async function token(){
  const now=Math.floor(Date.now()/1000);
  const head=base64({alg:'RS256',kid:'cosmetics-test',typ:'JWT'});
  const body=base64({aud:project,iss:'https://securetoken.google.com/'+project,
    sub:'member',email_verified:true,iat:now-60,auth_time:now-60,exp:now+3600});
  const signed=head+'.'+body;
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    pair.privateKey,new TextEncoder().encode(signed));
  return signed+'.'+Buffer.from(signature).toString('base64url');
}
function cosmeticsDb(){
  const current={auth_uid:'firebase:'+project+':member',
    public_no:10000001,name:'Member',country:'BD',birthdate:'2000-01-01',
    minor:0,status:'active',coins:42,diamonds:0,xp:0,wealth_level:1,charm_level:1,
    pic:null,cover:null,bio:'',frame_style:'',entry_style:'',medal_style:'',name_tag_style:''};
  const mutations=[];
  const db={current,mutations,prepare(sql){
    return {values:[],bind(...values){this.values=values;return this;},
      async first(){
        if(sql.startsWith('SELECT * FROM sharika_users WHERE auth_uid'))
          return {...current};
        if(sql.startsWith('SELECT * FROM sharika_users WHERE public_no'))
          return {...current};
        return null;
      },
      async run(){
        assert.match(sql,/^UPDATE sharika_users SET /);
        mutations.push(sql);
        const assignment=sql.slice('UPDATE sharika_users SET '.length)
          .split(',updated_at=')[0].split(',').map(item=>item.split('=')[0]);
        assignment.forEach((key,i)=>{current[key]=this.values[i];});
        return {success:true};
      }
    };
  }};
  return db;
}
test('original Sovera cosmetics persist on verified profiles without wallet changes',async()=>{
  const prior=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,headers:new Headers({'cache-control':'max-age=300'}),
    json:async()=>({keys:[jwk]})});
  try{
    const db=cosmeticsDb();
    const headers={Authorization:'Bearer '+await token(),'Content-Type':'application/json'};
    const run=(method,path,body)=>handleRequest(new Request(
      'https://sharika.example/api/v1'+path,{
        method,headers,...(body?{body:JSON.stringify(body)}:{})
      }),{DB:db,FIREBASE_PROJECT_ID:project});
    let response=await run('PATCH','/me',{
      frame_style:'royal-gold',entry_style:'phoenix-queen',
      medal_style:'gold',name_tag_style:'legend'
    });
    assert.equal(response.status,200);
    const updated=await response.json();
    assert.equal(updated.frame_style,'royal-gold');
    assert.equal(updated.entry_style,'phoenix-queen');
    assert.equal(updated.medal_style,'gold');
    assert.equal(updated.name_tag_style,'legend');
    assert.equal(updated.coins,42);
    assert.equal(db.mutations.length,1);
    response=await run('GET','/users/10000001');
    const publicView=await response.json();
    assert.equal(publicView.frame_style,'royal-gold');
    assert.equal(publicView.entry_style,'phoenix-queen');
    assert.equal(publicView.medal_style,'gold');
    assert.equal(publicView.name_tag_style,'legend');
    assert.equal(publicView.coins,undefined);
    response=await run('PATCH','/me',{frame_style:'https://untrusted.example/frame'});
    assert.equal(response.status,400);
    assert.equal(db.mutations.length,1);
    response=await run('PATCH','/me',{entry_style:'../../script.js'});
    assert.equal(response.status,400);
    assert.equal(db.mutations.length,1);
    response=await run('PATCH','/me',{medal_style:'manager'});
    assert.equal(response.status,400);
    assert.equal(db.mutations.length,1);
    response=await run('PATCH','/me',{name_tag_style:'../../../admin'});
    assert.equal(response.status,400);
    assert.equal(db.mutations.length,1);
    response=await run('PATCH','/me',{coins:5000,frame_style:'vip7'});
    assert.equal(response.status,403);
    assert.equal(db.mutations.length,1);
    response=await run('PATCH','/me',{frame_style:'',entry_style:'',medal_style:'',name_tag_style:''});
    assert.equal(response.status,200);
    assert.equal(db.current.frame_style,'');
    assert.equal(db.current.entry_style,'');
    assert.equal(db.current.medal_style,'');
    assert.equal(db.current.name_tag_style,'');
    assert.equal(db.current.coins,42);
  }finally{globalThis.fetch=prior;}
});


test('verified profile photos follow the same public ID into room avatars and messages',()=>{
  const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.match(worker,/u\.public_no,u\.name,u\.pic,u\.wealth_level/);
  assert.match(worker,/pic: x\.pic/);
  assert.match(adapter,/function verifiedAvatarUrl\(value\)/);
  assert.match(adapter,/pic:verifiedAvatarUrl\(owner\.pic\)/);
  assert.match(adapter,/pic:verifiedAvatarUrl\(user\.pic\)/);
  assert.match(adapter,/paintVerifiedAvatar\(el\.querySelector\('\.face'\),seat\.pic,doc\)/);
  assert.match(adapter,/decorateRoomPeople\(frame\)/);
  assert.match(adapter,/decorateGiftRecipients\(frame\)/);
  assert.match(adapter,/roomAvatarForPublicId\(frame,item\.sender_id\)/);
  assert.match(adapter,/inboxPhotos=new Map/);
  assert.match(adapter,/roomFrame\.render\?\.\(\)/);
});

test('room polling keeps the newest seat count and ignores responses after leaving',async()=>{
  const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const start=adapter.indexOf('  async function syncFrame(room,frame) {');
  const end=adapter.indexOf('  async function attachFrame(room) {');
  assert.ok(start>=0&&end>start,'room synchronization must be available');
  const syncSource=adapter.slice(start,end);
  const pending=[];
  const room={id:'10000001',owner_id:'owner-uid',seat_count:12};
  const frame={
    seats:[{empty:1}],S:{frame:'grad'},U:[],renders:[],
    render(){this.renders.push(this.seats.length);}
  };
  const state={cur:{id:room.id}};
  const iframe={contentWindow:frame};
  const sync=new Function('api','session','window','document','sfuState',
    'voiceRoomId','voiceRoom','balance','verifiedAvatarUrl',
    'decorateRoomPeople','decorateRoomChat','connectVoice','playSoveraEntry',
    syncSource+';return syncFrame;')(
      (method,path)=>{
        if(path.endsWith('/members'))
          return new Promise(resolve=>pending.push(resolve));
        return Promise.resolve({name:'Room owner'});
      },
      {user:{id:'owner-uid'}},state,{getElementById:()=>iframe},
      null,null,null,{coins:1,xp:2},()=>null,()=>{},()=>{},async()=>{},()=>{}
    );
  const older=sync(room,frame);
  const newer=sync(room,frame);
  assert.equal(pending.length,2);
  pending[1]({seat_count:4,members:[],locked_seats:[]});
  await newer;
  assert.equal(room.seat_count,4);
  assert.deepEqual(frame.renders,[5]);
  pending[0]({seat_count:12,members:[],locked_seats:[]});
  await older;
  assert.equal(room.seat_count,4,'stale response must not restore old count');
  assert.deepEqual(frame.renders,[5],'stale response must not re-render old seats');
  const leaving=sync(room,frame);
  state.cur={id:'10000002'};
  pending[2]({seat_count:17,members:[],locked_seats:[]});
  await leaving;
  assert.equal(room.seat_count,4,'completed request cannot edit an exited room');
  assert.deepEqual(frame.renders,[5]);
});

test('cosmetics and profile uploads do not accumulate effects or cross accounts',()=>{
  const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  assert.match(adapter,/querySelectorAll\('\.sh-sovera-frame,\.sh-sovera-seat-medal'\)/);
  assert.match(adapter,/avatar\.classList\.toggle\('sh-has-sovera-frame',!!item\)/);
  assert.match(adapter,/const accountId=session\.user\.id/);
  assert.match(adapter,/saved\?\.public_id!==publicId/);
  assert.match(adapter,/document\.getElementById\('rf'\)\?\.contentWindow!==frame/);
});

test('room creation and seat settings reload even during an in-flight room poll',async()=>{
  const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const start=adapter.indexOf('  let roomsRequestNo=0;');
  const end=adapter.indexOf('  // Android\'s system picker',start);
  assert.ok(start>=0&&end>start);
  const pending=[];
  const view={
    CFG:{rooms:[]},A:{myRoom:null},renders:0,
    renderRooms(){this.renders++;}
  };
  const reloadRooms=new Function('api','session','window','COLORS','toast','errText',
    adapter.slice(start,end)+';return reloadRooms;')(
      ()=>new Promise(resolve=>pending.push(resolve)),
      {user:{id:'owner-uid'}},view,['#000,#fff'],()=>{},String
    );
  const previous=reloadRooms();
  const saved=reloadRooms();
  assert.equal(pending.length,2,'a save must not skip its refresh');
  const room=seat_count=>({
    id:'10000001',owner_id:'owner-uid',name:'My room',seat_count,
    online_count:1,theme:'mid'
  });
  pending[1]({rooms:[room(4)]});
  await saved;
  assert.equal(view.A.myRoom.seat_count,4);
  pending[0]({rooms:[room(12)]});
  await previous;
  assert.equal(view.A.myRoom.seat_count,4);
  assert.equal(view.renders,1,'stale response cannot redraw room cards');
});

test('Android startup hides legacy demo screens until Firebase session restoration',()=>{
  const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const start=adapter.indexOf('  function startVerifiedStartup(){');
  const end=adapter.indexOf('  const ACCOUNT_KEY',start);
  assert.ok(start>0&&end>start);
  const classes=new Set();
  const root={classList:{
    add(value){classes.add(value);},
    remove(value){classes.delete(value);}
  }};
  const inserted=[];
  const stageDocument={
    head:{appendChild(item){inserted.push(item);}},
    createElement(){return {id:'',textContent:''};},
    getElementById(id){return id==='app'?root:null;}
  };
  const originalPodium=()=>{throw new Error('legacy demo top 3 must not appear');};
  const stageWindow={showWeekly:originalPodium};
  const finish=new Function('document','window',
    adapter.slice(start,end)+';return finishVerifiedStartup;')(
      stageDocument,stageWindow
    );
  assert.ok(classes.has('sharika-startup-verifying'));
  assert.equal(inserted.length,1);
  assert.match(inserted[0].textContent,/\.views/);
  assert.match(inserted[0].textContent,/\.auth/);
  assert.match(inserted[0].textContent,/\.nav/);
  let finishedSplash=false;
  stageWindow.showWeekly(()=>{finishedSplash=true;});
  assert.equal(finishedSplash,true,'original splash must still finish');
  assert.notEqual(stageWindow.showWeekly,originalPodium);
  assert.match(adapter,/\}finally\{[\s\S]*?finishVerifiedStartup\(\)/);
  finish();
  assert.ok(!classes.has('sharika-startup-verifying'));
});

test('room user and room reports go to authenticated Support Inbox, not demo state',()=>{
  const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  assert.match(adapter,/function openVerifiedReport\(kind,targetId,targetName\)/);
  assert.match(adapter,/openVerifiedReport\('user',verifiedId/);
  assert.match(adapter,/openVerifiedReport\('room',room\.id,room\.name\)/);
  assert.match(adapter,/api\('POST','\/support\/messages',\{/);
  assert.match(adapter,/request_id:'report:'/);
  assert.match(adapter,/Report sent to verified support/);
});

test('avatar slots clear stale photos when the next verified user has no uploaded image',()=>{
  const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const start=adapter.indexOf('  function paintVerifiedAvatar(node,value,doc){');
  const end=adapter.indexOf('  function roomAvatarForPublicId(frame,id){',start);
  assert.ok(start>0&&end>start,'verified avatar painter exists');
  const paint=new Function('verifiedAvatarUrl',
    adapter.slice(start,end)+';return paintVerifiedAvatar;')(
      value=>value==='trusted-photo'?'trusted-photo':null
    );
  let removed=0;
  const oldImage={dataset:{source:'previous-user-photo'},remove(){removed++;}};
  const slot={querySelector(){return oldImage;}};
  assert.equal(paint(slot,null,{}),false);
  assert.equal(removed,1,'a seat assigned to a user without a photo cannot display the prior occupant');
});
