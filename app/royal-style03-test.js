/* Sharika Style 03: only a QA fit preview for the authenticated test public ID.
   No coins, roles, catalog assignment, messaging or room permissions are changed.
   Final video endpoints remain empty until the actual four MP4 files are staged in R2. */
(function(){
'use strict';
var TARGET='10000003';
var ORIGIN='https://sharika-api-staging.soverixnet.workers.dev';
var MEDIA=Object.freeze({vip:'',entry:'',gift:'',medal:''});
function isAllowedMedia(url){
  if(typeof url!=='string'||!url)return false;
  try{var u=new URL(url);return u.origin===ORIGIN&&/^\/api\/v1\/media\/[a-f0-9-]{36}\.(mp4|webm)$/.test(u.pathname);}
  catch(_){return false;}
}
function userIsTest(){
  var profile=document.getElementById('v-me');
  if(!profile||!profile.classList.contains('on'))return false;
  var raw=typeof window.A==='object'?window.A?.id:null;
  var visible=profile.querySelector('#pid');
  return String(raw)===TARGET && !!visible && /10000003/.test(visible.textContent||'');
}
var layer=null;
function closePreview(){if(layer){layer.remove();layer=null;}}
function poster(cls,content){
  var box=document.createElement('div');box.className='sh-style03-media';
  var inner=document.createElement('div');inner.className='sh-style03-poster '+cls;
  if(content)inner.appendChild(content);box.appendChild(inner);return box;
}
function previewPhoto(){
  var box=document.createElement('div');box.className='sh-style03-seat-demo';
  var face=document.createElement('div');face.className='sh-style03-preview-photo';
  face.textContent='R';
  var ornament=document.createElement('img');ornament.src='./royal-style03-frame.svg';ornament.alt='';
  face.appendChild(ornament);
  var label=document.createElement('b');label.textContent='Royal Test';
  box.append(face,label);return box;
}
function createTile(title,mode,src){
  var tile=document.createElement('section');tile.className='sh-style03-tile';
  var h=document.createElement('h3');h.textContent=title;tile.appendChild(h);
  if(isAllowedMedia(src)){
    var holder=document.createElement('div');holder.className='sh-style03-media';
    var player=document.createElement('video');player.src=src;player.controls=true;
    player.loop=false;player.preload='metadata';player.playsInline=true;player.setAttribute('playsinline','');
    player.addEventListener('error',function(){holder.replaceChildren(poster('sh-style03-'+mode+'-poster'));});
    holder.appendChild(player);tile.appendChild(holder);
  }else if(mode==='vip'){
    var visual=poster('sh-style03-vip-poster',previewPhoto());tile.appendChild(visual);
  }else tile.appendChild(poster('sh-style03-'+mode+'-poster'));
  var p=document.createElement('p');
  p.textContent=mode==='vip'?'Avatar and seat alignment; frame stays outside the photo.':
    mode==='entry'?'Top-half of voice room. Do not replace mic or chat UI.':
    mode==='gift'?'Center-screen celebration. Play one video and its sound at a time.':
      'Small icon in user profile; original art remains distinct from SBF Nobel.';
  tile.appendChild(p);
  if(!isAllowedMedia(src)){
    var missing=document.createElement('div');missing.className='sh-style03-missing';
    missing.textContent='Final MP4 not uploaded yet';tile.appendChild(missing);
  }
  return tile;
}
function openPreview(){
  if(!userIsTest())return;
  closePreview();
  layer=document.createElement('div');layer.className='sh-style03-overlay';
  layer.setAttribute('role','dialog');layer.setAttribute('aria-modal','true');
  layer.setAttribute('aria-label','Royal Style 03 staging preview');
  var sheet=document.createElement('div');sheet.className='sh-style03-sheet';
  var heading=document.createElement('header');heading.className='sh-style03-heading';
  var text=document.createElement('div');
  var strong=document.createElement('strong');strong.textContent='Royal 3D Style 03';
  var small=document.createElement('small');small.textContent='TEST USER ID 10000003 · STAGING ONLY';
  text.append(strong,small);
  var x=document.createElement('button');x.type='button';x.className='sh-style03-close';
  x.textContent='×';x.setAttribute('aria-label','Close preview');x.onclick=closePreview;
  heading.append(text,x);sheet.appendChild(heading);
  var grid=document.createElement('div');grid.className='sh-style03-preview-grid';
  grid.append(createTile('VIP Frame + Seat','vip',MEDIA.vip),
              createTile('Entry FX','entry',MEDIA.entry),
              createTile('Luxury Gift FX','gift',MEDIA.gift),
              createTile('Manager Medal','medal',MEDIA.medal));
  sheet.appendChild(grid);
  var note=document.createElement('p');note.className='sh-style03-note';
  note.textContent='Fit-only QA. Original sound-enabled video files are not yet hosted in Sharika staging. No wallet, gifts or other accounts are altered.';
  sheet.appendChild(note);
  layer.appendChild(sheet);
  layer.addEventListener('click',function(event){if(event.target===layer)closePreview();});
  document.body.appendChild(layer);x.focus();
}
function updateProfile(){
  var profile=document.getElementById('v-me');if(!profile)return;
  var allowed=userIsTest();
  var avatar=profile.querySelector('.mav');
  var button=profile.querySelector('.sh-style03-trigger');
  if(!allowed){if(avatar){avatar.classList.remove('sh-style03-test-avatar');avatar.querySelector('.sh-style03-royal-frame')?.remove();}
    button?.remove();closePreview();return;}
  if(!avatar)return;
  avatar.classList.add('sh-style03-test-avatar');
  if(!avatar.querySelector('.sh-style03-royal-frame')){
    var image=document.createElement('img');image.className='sh-style03-royal-frame';
    image.src='./royal-style03-frame.svg';image.alt='';image.setAttribute('aria-hidden','true');
    avatar.appendChild(image);
  }
  if(!button){
    button=document.createElement('button');button.className='sh-style03-trigger';
    button.type='button';button.textContent='✦ Preview Royal Frame, Entry & Gift';
    button.onclick=openPreview;
    var badge=profile.querySelector('.profile-svip-badge')||avatar;
    badge.parentElement?.insertBefore(button,badge.nextSibling);
  }
}
var queued=false;
function schedule(){if(queued)return;queued=true;requestAnimationFrame(function(){queued=false;updateProfile();});}
function boot(){
  var root=document.getElementById('v-me');if(!root)return;
  var mo=new MutationObserver(schedule);
  mo.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style']});
  var btns=document.querySelectorAll('.ni[data-v="me"]');
  btns.forEach(function(b){b.addEventListener('click',schedule);});
  schedule();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
})();
