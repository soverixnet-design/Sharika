import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('./staging-connection.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/official-notice.css',import.meta.url),'utf8');
const gradle=readFileSync(new URL('./app/build.gradle',import.meta.url),'utf8');
const back=readFileSync(new URL('./back-navigation.js',import.meta.url),'utf8');
const begin=source.indexOf('  // Official Notice is a read-only conversation-style view');
const end=source.indexOf('  // Real Notifications inbox.',begin);
assert.ok(begin>0 && end>begin,'official notice code must be found');
const note=source.slice(begin,end);

test('official notice screen matches screenshot hierarchy and Android safe areas',()=>{
  for(const selector of [
    '.sh-official-page','.sh-official-top','.sh-official-date',
    '.sh-official-row','.sh-official-avatar','.sh-official-bubble',
    '.sh-official-menu','.sh-official-load-more'
  ])assert.ok(css.includes(selector),selector);
  assert.match(css,/background:#f6f6f6;color:#222/);
  assert.match(css,/background:#fff;border-bottom:1px solid #eee/);
  assert.match(css,/grid-template-columns:43px minmax\(0,1fr\)/);
  assert.match(css,/border-radius:19px;background:#fff/);
  assert.match(css,/env\(safe-area-inset-bottom,0px\)/);
  assert.doesNotMatch(css,/\.chatrow\s*[,{]/);
});

test('official messages come from verified notifications, never from fake chat history',()=>{
  assert.match(note,/api\('GET',cursor\?'\/notifications\/history\/'\+cursor:'\/notifications'\)/);
  assert.match(note,/if\(!\['official','system'\]\.includes\(item\.kind\)/);
  assert.match(note,/heading\.textContent=title/);
  assert.match(note,/message\.textContent=body/);
  assert.match(note,/mark\.src='\.\/sharika_logo\.jpg'/);
  assert.match(note,/api\('PATCH','\/notifications\/'\+item\.id\+'\/read',\{\}\)/);
  assert.doesNotMatch(note,/\/notifications\/read-all/); // only per-ID official notices
  assert.doesNotMatch(note,/Hello, I am the official customer service/);
  assert.match(source,/id="verified-official-notices"/);
  assert.match(source,/id="sh-notify-official"/);
});

test('new stylesheet and existing Firebase adapter are packaged in Android APK',()=>{
  assert.match(gradle,/sharika-official-notice-style/);
  assert.match(gradle,/from\(rootProject\.file\('\.\.\/app\/official-notice\.css'\)\)/);
  assert.match(gradle,/from\(rootProject\.file\('staging-connection\.js'\)\)/);
  assert.match(back,/var official = document\.querySelector\('\.sh-official-page\.on'\)/);
  assert.ok(back.indexOf("var official = document.querySelector")<
    back.indexOf("var notifications = document.querySelector"),'Android back must close notice first');
});

function makeLoader(responder){
  const a=source.indexOf('  async function loadOfficialNotices(reset=false){');
  const b=source.indexOf('  function showOfficialNotice(){',a);
  assert.ok(a>0&&b>a,'loader found');
  const feed={innerHTML:'',textContent:'',querySelector:()=>null};
  const panel={classList:{contains:()=>true},querySelector:()=>feed};
  const context={
    session:{user:{id:'1'}},officialNoticeLoading:false,officialNoticeEpoch:1,
    officialNoticeRequest:0,officialNoticeCursor:null,officialNoticeItems:[],
    ensureOfficialNoticePanel:()=>panel,paintOfficialNotices:()=>{context.painted++;},
    errText:e=>String(e.message||e),api:responder,painted:0
  };
  runInNewContext(source.slice(a,b),context);
  return context;
}

test('paginates past non-official items without showing gifts as notices',async()=>{
  const paths=[];
  const context=makeLoader(async(method,path)=>{
    paths.push(path);
    if(paths.length===1)return {
      notifications:[{id:9,kind:'gift',title:'Gift',body:'Fake'}],next_before:9
    };
    return {notifications:[
      {id:8,kind:'official',title:'Welcome',body:'Official text'},
      {id:7,kind:'system',title:'Account change',body:'System text'},
      {id:6,kind:'reward',title:'Coins',body:'Not a notice'}
    ],next_before:null};
  });
  await context.loadOfficialNotices(true);
  assert.deepEqual(paths,['/notifications','/notifications/history/9']);
  assert.deepEqual(Array.from(context.officialNoticeItems,x=>x.id),[8,7]);
  assert.equal(context.officialNoticeCursor,null);
  assert.equal(context.painted,1);
});

test('rapid reopening discards stale response without wiping latest notices',async()=>{
  const resolve=[];
  const context=makeLoader(async()=>new Promise(done=>resolve.push(done)));
  const first=context.loadOfficialNotices(true);
  const second=context.loadOfficialNotices(true);
  assert.equal(resolve.length,2);
  resolve[1]({notifications:[{id:22,kind:'official',body:'New'}],next_before:null});
  await second;
  resolve[0]({notifications:[{id:10,kind:'official',body:'Old'}],next_before:null});
  await first;
  assert.deepEqual(Array.from(context.officialNoticeItems,x=>x.id),[22]);
  assert.equal(context.officialNoticeLoading,false);
  assert.equal(context.painted,1);
});
