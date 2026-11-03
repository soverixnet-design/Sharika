import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const back=readFileSync(new URL('../../android-staging/back-navigation.js',import.meta.url),'utf8');

function fakeDocument(){
  const nodes=new Map();
  const createElement=tag=>{
    const classes=new Set();
    return {
      tag,id:'',children:[],textContent:'',
      classList:{
        add(value){classes.add(value);},
        remove(value){classes.delete(value);},
        contains(value){return classes.has(value);}
      },
      setAttribute(){},
      append(...children){
        this.children.push(...children);
        for(const item of children)if(item.id)nodes.set(item.id,item);
      },
      appendChild(child){this.append(child);}
    };
  };
  const doc={
    createElement,
    getElementById:id=>nodes.get(id)||null,
    head:createElement('head'),
    body:createElement('body'),
    defaultView:{}
  };
  return doc;
}

test('room mini-game portal is reusable, compact, closable, and preserves room DOM',()=>{
  const start=adapter.indexOf('  function ensureRoomGamePortal(doc){');
  const end=adapter.indexOf('  function showGameCard(',start);
  assert.ok(start>=0&&end>start,'portal is defined next to the game adapter');
  const ensurePortal=new Function(adapter.slice(start,end)+'return ensureRoomGamePortal;')();
  const doc=fakeDocument();
  let cleanups=0;
  doc.defaultView.__sharikaOriginalGameCleanup=()=>{cleanups++;};
  const a=ensurePortal(doc);
  const b=ensurePortal(doc);
  assert.equal(a.overlay,b.overlay,'reopening must reuse the same root overlay');
  assert.equal(a.sheet,b.sheet);
  const sheetCss=doc.getElementById('sh-room-game-style').textContent;
  assert.match(sheetCss,/height:min\(84dvh,720px\)/);
  assert.match(sheetCss,/align-items:flex-end/,
    'room mini games should sit above the bottom dock, not cover the middle seats');
  assert.match(sheetCss,/env\(safe-area-inset-bottom,0px\)/,
    'game sheet must remain above the Android gesture area');
  assert.match(doc.getElementById('sh-room-game-style').textContent,/#sh-room-game-host|#sh-original-host/);
  a.overlay.classList.add('on');
  doc.getElementById('sh-room-game-close').onclick();
  assert.equal(cleanups,1,'closing must stop game polling and frame');
  assert.equal(a.overlay.classList.contains('on'),false,'room remains beneath modal');
});

test('room games use the verified top-level game bridge and do not replace voice room',()=>{
  assert.match(adapter,/roomGameButton\.onclick=\(\)=>showGameCard\(document,true,toast\)/);
  assert.match(adapter,/const games=iframe\.contentWindow\?\.document\?\.getElementById\('bGame'\)/);
  assert.match(adapter,/games\.onclick=\(\)=>showGameCard\(document,true,toast\)/);
  assert.match(adapter,/const portal=insideRoom\?ensureRoomGamePortal\(doc\):null/);
  assert.match(adapter,/if\(!insideRoom\)overlay\.classList\.add\('sh-original-fullscreen'\)/);
  assert.doesNotMatch(adapter,/showGameCard\(frame\.document,true/);
  assert.match(adapter,/event\.source!==current\.element\.contentWindow/);
  assert.match(adapter,/\/original-games\/'\+current\.item\.id/);
  assert.match(adapter,/\/greedy-wheel\/'\+data\.action/);
  assert.match(adapter,/window\.__sharikaRoomGameClose\?\.\(\)/);
});

test('Android Back returns to catalog then closes mini-game before minimizing room',()=>{
  const mini=back.indexOf("dismissSheet(document, 'sh-room-game-overlay', 'sh-room-game-sheet')");
  const ordinary=back.indexOf("dismissSheet(document, 'shb', 'sh')");
  const room=back.indexOf("var room = get('rw')");
  assert.ok(mini>=0&&ordinary>mini&&room>ordinary);
  assert.match(back,/overlayId === 'sh-room-game-overlay'/);
  assert.match(back,/#sh-original-back/);
  new Function(back);
  new Function(adapter);
});

test('in-room game removes the extra catalog header without removing bet API',()=>{
  assert.match(adapter,/\(insideRoom\?'':'<button id="sh-original-back"/);
  assert.match(adapter,/gameFrame\.src=item\.page\+\(insideRoom&&item\.id!=='greedy-wheel'\?'#sharika-room':''\)/);
  assert.match(adapter,/data\.action==='bet'\?'POST':'GET'/);
  assert.match(adapter,/target\.postMessage\(\{type:'sharika:original-response'/);
  assert.match(adapter,/showGameCard\(document,false,toast\)/,
    'outside-room catalog and full-screen games must remain available');
});

test('remaining original games and Fruit Royale have compact room UI and authenticated bets',()=>{
  const originals=['night-food-wheel.html','sovera-food-wheel.html'];
  for(const name of originals){
    const html=readFileSync(new URL('../../android-staging/app/src/main/assets/original-games/'+name,import.meta.url),'utf8');
    assert.match(html,/location\.hash==='#sharika-room'/,name);
    assert.match(html,/style id="sharika-room-mini-css"/,name);
    assert.match(html,/html\.sharika-room-mini/,name);
    assert.match(html,/GameBridge\.bet\(/,name+' still places authenticated wagers');
  }
  const base=new URL('../../android-staging/app/src/main/assets/fruit-royale/',import.meta.url);
  const game=readFileSync(new URL('game.js',base),'utf8');
  const config=readFileSync(new URL('config.js',base),'utf8');
  const adapterSource=readFileSync(new URL('adapter.live.js',base),'utf8');
  assert.match(config,/compact:location\.hash==='#sharika-room'/);
  assert.match(game,/cfg\.compact/);
  assert.match(game,/api\.placeBet\(requested\)/);
  assert.match(adapterSource,/game:GAME/);
  assert.match(adapter,/page:'file:\/\/\/android_asset\/fruit-royale\/index\.html'/);
  assert.match(adapter,/if\(!insideRoom\)overlay\.classList\.add/);
});
