import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Extract the exact room iframe from the owner's original app. No copied or
// manually reimplemented seat layout can accidentally pass this test.
const dir=dirname(fileURLToPath(import.meta.url));
const source=readFileSync(resolve(dir,'../../../app/index.html'),'utf8');
const start=source.indexOf('var ROOM_HTML=');
if(start<0)throw Error('Original ROOM_HTML missing');
const quote=start+'var ROOM_HTML='.length;
if(source[quote]!=='"')throw Error('Expected JSON-encoded ROOM_HTML');
let end=quote+1;
for(;end<source.length;end++){
  if(source[end]==='\\'){end++;continue;}
  if(source[end]==='"')break;
}
let room=JSON.parse(source.slice(quote,end+1));
room=room.replace('</head>',
  '<link rel="stylesheet" href="./royal-room-ui.css">'+
  '<script>document.documentElement.classList.add("royal-premium","royal-room")</script>'+
  '<link rel="stylesheet" href="file:///android_asset/royal-premium.css">'+
  '<link rel="stylesheet" href="file:///android_asset/royal-winged-theme.css"></head>')
  .replace('</body>','<script src="./royal-room-ui.js"></script></body>');

// An HTML parser recognizes </script> even inside JavaScript string literals.
// Encode every opening bracket in the outer page's JSON string; the runtime
// recreates the exact inner markup when assigning iframe.srcdoc.
const serializedRoom=JSON.stringify(room).replace(/</g,'\\u003c');

const page=`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#08031d}
iframe{width:100%;height:100%;border:0;display:block}</style></head>
<body><iframe id="rf" title="Live room geometry QA"></iframe>
<script>window.ROOM_HTML=${serializedRoom};
window.openRoom=function(r){
  const w=JSON.stringify(JSON.stringify({name:r.name,emoji:r.emoji,
    theme:r.th,id:r.id,minor:false})).replace(/</g,'\\u003c');
  document.getElementById('rf').srcdoc=window.ROOM_HTML.replace('<head>',
    '<head><script>window.name='+w+'<\\/script>');
};<\/script>
<script src="./royal-premium.js"></script>
<script src="./room-qa.js"></script></body></html>`;
const dest=resolve(dir,'../build/generated/room-qa-page/index.html');
mkdirSync(dirname(dest),{recursive:true});
writeFileSync(dest,page);
if(!page.includes('royal-room-ui.js')||!page.includes('royal-winged-theme.css'))
  throw Error('Missing exact Royal room layers');
process.stdout.write('SHARIKA_QA_REAL_ROOM_TEMPLATE_GENERATED\n');
