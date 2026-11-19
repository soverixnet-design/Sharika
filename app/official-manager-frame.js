/* Candidate integration for authenticated Sharika Official Manager users. 
 * Do not expose privileged role using localStorage, A.frameImg, or self-selected user input.
 */
(function(root){
'use strict';
var FRAME_ID='official-manager-royal-gold-v1';
function render(target,opts){
 if(!target||!opts)throw new Error('target and opts required');
 if(opts.serverVerifiedRole!=='official_manager'){target.replaceChildren();return false;}
 var mode=['seat','profile','shop'].indexOf(opts.mode)>=0?opts.mode:'profile';
 var shell=document.createElement('div');
 shell.className='sharika-role-frame sharika-role-frame--'+mode;
 shell.dataset.frameId=FRAME_ID;
 var photo=document.createElement('img');
 photo.className='sharika-role-frame__photo';
 photo.alt='';photo.decoding='async';photo.referrerPolicy='no-referrer';
 if(opts.photoUrl)photo.src=String(opts.photoUrl);
 var art=document.createElement('img');
 art.className='sharika-role-frame__motion';
 art.alt='Verified Official Manager royal frame';art.decoding='async';
 var base=opts.assetBase||'./';
 art.src=base+(opts.reduceMotion?'official-manager-static.webp':'official-manager-animated.webp');
 art.onerror=function(){if(!art.src.endsWith('official-manager-static.webp'))art.src=base+'official-manager-static.webp'};
 var name=document.createElement('span');
 name.className='sharika-role-frame__name';
 name.textContent=String(opts.displayName||'');
 shell.append(photo,art,name);target.replaceChildren(shell);
 return true;
}
root.SharikaOfficialManagerFrame=Object.freeze({id:FRAME_ID,render:render});
})(window);