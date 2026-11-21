import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const nav=readFileSync(new URL('../../android-staging/back-navigation.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../../app/index.html',import.meta.url),'utf8');

const classList=(...initial)=>{
  const active=new Set(initial);
  return {
    contains:item=>active.has(item),
    add:item=>active.add(item),
    remove:item=>active.delete(item)
  };
};

test('Android Back minimizes an open room rather than issuing Leave',()=>{
  let minimized=0,leaves=0;
  const rw={classList:classList('on')},rf={contentDocument:null};
  const document={
    getElementById:id=>({rw,rf}[id]||null),
    querySelector:()=>null
  };
  const window={minimizeRoom:()=>{minimized++;return true;},leaveRoom:()=>{leaves++;}};
  runInNewContext(nav,{window,document});
  assert.equal(window.sharikaHandleAndroidBack(),'handled');
  assert.equal(minimized,1);
  assert.equal(leaves,0);
});

test('Mini Room keeps the same iframe and restores the room without a new join',()=>{
  const iframe={srcdoc:'ACTIVE_ROOM',src:'original'};
  const elements={
    rw:{classList:classList('on')},
    mini:{classList:classList()},
    minib:{textContent:''},
    'mini-name':{textContent:''}
  };
  const prefix=html.indexOf('function minimizeRoom(){');
  const end=html.indexOf('window.minimizeRoom=minimizeRoom;',prefix);
  assert.ok(prefix>0&&end>prefix);
  const script=html.slice(prefix,end+'window.minimizeRoom=minimizeRoom;'.length);
  const context={window:{},cur:{id:'10000020',name:'My room',emoji:'🎙️'},$:id=>elements[id]};
  runInNewContext(script,context);
  assert.equal(context.window.minimizeRoom(),true);
  assert.equal(elements.rw.classList.contains('on'),false);
  assert.equal(elements.mini.classList.contains('on'),true);
  assert.equal(elements['mini-name'].textContent,'My room');
  assert.equal(iframe.srcdoc,'ACTIVE_ROOM');
  assert.equal(context.restoreRoom(),true);
  assert.equal(elements.rw.classList.contains('on'),true);
  assert.equal(elements.mini.classList.contains('on'),false);
  assert.match(html,/\$\("minix"\)\.onclick=function\(\)\{window\.leaveRoom\(\)\}/);
  assert.match(html,/\$\("minib"\)\.onclick=function\(\)\{if\(cur&&typeof window\.openRoom/);
});
