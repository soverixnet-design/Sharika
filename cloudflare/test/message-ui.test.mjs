import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

// Execute the real staging message UI functions against a deterministic DOM/API.
// No real account, network call, wallet, or staging data is touched.
const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');

test('stale private responses never overwrite support, and new messages keep scroll position',async()=>{
  const start=ui.indexOf('  let supportPoll=null;');
  const end=ui.indexOf('  window.renderMsg=async function(){',start);
  assert.ok(start>=0 && end>start);
  const children=[];
  const container={
    scrollTop:0,scrollHeight:100,clientHeight:200,
    get textContent(){return this._text||'';},
    set textContent(value){this._text=value;children.length=0;},
    appendChild(element){children.push(element);this.scrollHeight+=50;}
  };
  const thread={
    classList:{
      on:false,
      add(name){if(name==='on')this.on=true;},
      remove(name){if(name==='on')this.on=false;},
      contains(name){return name==='on'&&this.on;}
    }
  };
  const send={disabled:false},input={value:'old unsent draft'};
  const elements={
    th:thread,tb:container,ts:send,ti:input,thn:{textContent:''}
  };
  const waiting=[];
  let intervalCount=0;
  const context=createContext({
    document:{
      getElementById(id){return elements[id]||null;},
      createElement(){return {className:'',textContent:'',disabled:false};}
    },
    window:{showAuth(){},renderMsg(){}},
    session:{user:{id:'test'}},
    api(method,path){return new Promise((resolve,reject)=>waiting.push({method,path,resolve,reject}));},
    errText(error){return String(error);},
    toast(){},
    setInterval(){intervalCount++;return intervalCount;},
    clearInterval(){}
  });
  runInContext(ui.slice(start,end),context);
  function take(path){
    const i=waiting.findIndex(entry=>entry.path===path);
    assert.ok(i>=0,'expected pending '+path);
    return waiting.splice(i,1)[0];
  }

  // Private request A starts, then user switches to support before A completes.
  const old=runInContext("openPrivateThread('12345678','Alice')",context);
  assert.equal(input.value,'');
  const current=runInContext('openSupportThread()',context);
  take('/support/messages').resolve({messages:[{sender_role:'admin',body:'Support answer'}]});
  await current;
  assert.equal(children.length,1);
  assert.equal(children[0].textContent,'Support answer');
  take('/messages/12345678').resolve({messages:[{from_me:false,body:'Stale private'}]});
  take('/users/12345678/follow').resolve({following:true,mutual:true});
  await old;
  assert.equal(children.length,1);
  assert.equal(children[0].textContent,'Support answer');
  assert.equal(intervalCount,1,'late private load must not replace the active support poll');

  // While reading an older message, a poll must not jump the chat to bottom.
  container.scrollHeight=1200;container.clientHeight=250;container.scrollTop=150;
  const reading=runInContext('loadSupportMessages()',context);
  take('/support/messages').resolve({messages:[{sender_role:'admin',body:'New while reading'}]});
  await reading;
  assert.equal(container.scrollTop,150);
  assert.equal(children[0].textContent,'New while reading');

  // Two same-thread polls can finish in reverse order. Only the newer wins.
  const early=runInContext('loadSupportMessages()',context);
  const first=take('/support/messages');
  const late=runInContext('loadSupportMessages()',context);
  const second=take('/support/messages');
  second.resolve({messages:[{sender_role:'admin',body:'Newest response'}]});
  await late;
  first.resolve({messages:[{sender_role:'admin',body:'Older response'}]});
  await early;
  assert.equal(children[0].textContent,'Newest response');

  // Near the bottom, keep following new messages automatically.
  container.scrollHeight=950;container.clientHeight=250;container.scrollTop=700;
  const bottom=runInContext('loadSupportMessages()',context);
  take('/support/messages').resolve({messages:[{sender_role:'admin',body:'Latest'}]});
  await bottom;
  assert.equal(container.scrollTop,container.scrollHeight);
});

test('message sends and closing a thread guard drafts against late completions',()=>{
  assert.match(ui,/const targetId=activePrivateId,epoch=messageThreadEpoch/);
  assert.match(ui,/if\(messageThreadCurrent\(epoch,targetId\)\)/);
  assert.match(ui,/if\(messageThreadCurrent\(epoch,null\)\)/);
  assert.match(ui,/\+\+messageThreadEpoch;\s*document\.getElementById\('th'\)\?\.classList\.remove\('on'\)/);
  assert.match(ui,/clearMessageDraft\(\)/);
});
