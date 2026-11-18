import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const sheet=read('android-staging/app/src/main/java/com/soverixnet/sharika/SharikaRoomGameDialog.java');
const activity=read('android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java');
const secure=read('android-staging/app/src/main/java/com/soverixnet/sharika/SharikaGameCenterActivity.java');
const js=read('hosted-game-center/web/app.js');
const css=read('hosted-game-center/web/style.css');
const worker=read('hosted-game-center/src/index.mjs');
const markup=read('hosted-game-center/web/index.html');

test('room games stay in the SAME Activity with 65%-height native sheet',()=>{
 assert.match(activity,/case "openHostedGameCenter":/);
 assert.match(activity,/data\.optBoolean\("insideRoom",false\)/);
 assert.match(activity,/roomGameDialog=SharikaRoomGameDialog\.show\(this\)/);
 assert.match(sheet,/new Dialog\(host\)/);
 assert.match(sheet,/heightPixels\*\.65f/);
 assert.match(sheet,/Gravity\.BOTTOM/);
 assert.match(sheet,/room.*WebView|voice-room WebView/i);
 assert.doesNotMatch(sheet,/startActivity\(/);
 assert.match(activity,/roomGameDialog\.dismiss\(\)/);
});

test('room native WebView retains authenticated session and iframe isolation',()=>{
 assert.match(sheet,/WEB_MESSAGE_LISTENER/);
 assert.match(sheet,/!isMainFrame/);
 assert.match(sheet,/SITE_ORIGIN\.equals\(sourceOrigin\.toString\(\)\)/);
 assert.match(sheet,/allowedGameRoute\(method,path\)/);
 assert.match(sheet,/getIdToken\(false\)/);
 assert.match(sheet,/setRequestProperty\("Authorization","Bearer "\+token\)/);
 assert.match(sheet,/setAllowFileAccess\(false\)/);
 assert.match(sheet,/setAllowUniversalAccessFromFileURLs\(false\)/);
 assert.doesNotMatch(sheet,/addJavascriptInterface|SharikaNative"/);
 assert.match(sheet,/getResponseCode\(\)/);
 assert.match(secure,/GET".equals\(method\) && "\/api\/v1\/me"/);
 assert.match(markup,/sandbox="allow-scripts allow-modals"/);
 assert.doesNotMatch(markup,/allow-same-origin/);
});

test('royal game cards use compact four-icon row without image cropping',()=>{
 assert.match(css,/room-mode \.games\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(css,/\.room-mode \.tile \.art\{aspect-ratio:1/);
 assert.match(css,/\.room-mode \.tile \.art img\{object-fit:contain/);
 assert.match(css,/\.room-mode #player\{height:calc\(100dvh - 12px\)/);
 assert.match(css,/\.room-mode \.tile b\{font-size:10px/);
 assert.match(js,/view'\)==='room'/);
 assert.match(js,/mode='\+\(inRoom\?'room':'full'\)/);
 assert.match(js,/#sharika-room/);
});

test('only the authenticated profile can populate player identity and payout winners',()=>{
 assert.match(js,/call\('GET','\/api\/v1\/me'\)/);
 assert.match(js,/verifiedProfile=p/);
 assert.match(js,/displayProfile\(\$\('game-profile'\),p\)/);
 assert.match(js,/showSoloSpinWinner\(game,result,m\.id\)/);
 assert.match(js,/receipt\.requestId!==requestId/);
 assert.match(js,/showServerWinners\(game,result\)/);
 assert.match(js,/safeAvatar\(winner\.pic\|\|winner\.avatar/);
 assert.match(js,/!bridge\|\|!winner/);
 assert.match(js,/seenWinners\.has\(key\)/);
 assert.match(markup,/id="verified-winner"/);
 assert.match(markup,/id="game-profile"/);
 assert.doesNotMatch(markup,/Authorization|Bearer |firebaseToken/);
 assert.match(worker,/profileImages=/);
 assert.doesNotMatch(worker,/d1_databases|durable_objects|SHARIKA_FIREBASE_SECRET/);
});

test('new site does not deploy new SuperAce RTP or touch player ledger',()=>{
 assert.doesNotMatch(sheet,/api\/superace\/buy-bonus|coins=coins-|ALTER TABLE/);
 assert.doesNotMatch(js,/localStorage\.setItem\(["'](?:coins|wallet|winnings)/);
 assert.doesNotMatch(worker,/INSERT INTO|UPDATE sharika_users|sharika_wallet_ledger/);
});

test('game views are clean: transparent icon cards, no duplicate chrome, 65% native room',()=>{
 assert.match(sheet,/heightPixels\\*\\.65f/);
 assert.match(sheet,/window\\.setDimAmount\\(0f\\)/);
 assert.match(sheet,/container\\.setBackgroundColor\\(Color\\.TRANSPARENT\\)/);
 assert.match(css,/body\\.is-playing header\\{display:none!important\\}/);
 assert.match(css,/body\\.is-playing #game-profile\\{display:none!important\\}/);
 assert.match(css,/border:0!important;border-radius:0!important;background:transparent!important/);
 assert.match(js,/document\\.body\\.classList\\.add\\('is-playing'\\)/);
 assert.match(js,/document\\.body\\.classList\\.remove\\('is-playing'\\)/);
});
