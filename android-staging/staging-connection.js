/* Sharika Android-only staging adapter.
 * Preserves the original supplied HTML/CSS/room art. No Supabase endpoint,
 * service-role key, demo identity, fake payouts, or plaintext token in JS.
 * Requires native SharikaActivity, which verifies Firebase authentication
 * and sends allowlisted requests exclusively to the new Cloudflare Worker.
 */
(function () {
  'use strict';
  // This override is loaded only by the Android staging shell. Keep the
  // original HTML design unchanged while allowing it to fill phone screens.
  function fitAndroidViewport(doc, roomFrame) {
    if (!doc || !doc.head || doc.getElementById('sharika-android-viewport')) return;
    const style = doc.createElement('style');
    style.id = 'sharika-android-viewport';
    style.textContent = [
      'html,body{width:100%!important;max-width:none!important;margin:0!important}',
      '.app{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important}',
      roomFrame ? '' : [
        'html{padding-top:0!important;padding-bottom:0!important}',
        '#v-home,#v-rank,#v-msg{padding-top:calc(10px + env(safe-area-inset-top,0px))!important}',
        '.auth .aw{padding-top:calc(28px + env(safe-area-inset-top,0px))!important}'
      ].join('')
    ].join('');
    doc.head.appendChild(style);
    // Staging-only depth effects: no changes to the owner's original layout,
    // routes, seat hit targets, labels, or accessibility semantics.
    const depth=doc.createElement('style');
    depth.id='sharika-subtle-icon-depth';
    depth.textContent=roomFrame ? [
      '.top .ib,.top .room,#bOwn,.dock .rb,.dock .mic,.dock .inp #emo,.dock .inp #imgBtn,.stats .pill{',
      'box-shadow:inset 0 2px 2px #fff6,inset 0 -5px 8px #070319b3,0 6px 12px #03010b99!important;',
      'filter:drop-shadow(0 2px 2px #0007);transition:filter .15s ease,box-shadow .15s ease}',
      '.dock .e3,.top .room .rav,.top .ib svg,.dock .mic{',
      'filter:drop-shadow(0 3px 2px #05020da8);text-shadow:0 2px 1px #0008,0 -1px 2px #fff6}',
      '.dock button:active,.top .ib:active{filter:brightness(1.12) drop-shadow(0 1px 2px #0009)}',
      '@media(prefers-reduced-motion:reduce){.top .ib,.top .room,.dock .rb,.dock .mic{transition:none!important}}'
    ].join('') : [
      '.nav .ni span,.qa button span,.hd .logo,.nav .plus,#minib,.acts .act span{',
      'display:inline-block;filter:drop-shadow(0 3px 2px #04020da8);',
      'text-shadow:0 2px 1px #0009,0 -1px 2px #fff7}',
      '.qa button,.nav .ni,.nav .plus,.hd .logo,#minib,.tabs button{',
      'box-shadow:inset 0 2px 2px #fff5,inset 0 -4px 7px #05011399,0 5px 10px #03010b80;',
      'transition:filter .15s ease,box-shadow .15s ease}',
      '.qa button:active,.nav button:active,.tabs button:active{filter:brightness(1.12)}',
      '#grid .card .bg{box-shadow:inset 0 2px 3px #fff4,inset 0 -8px 15px #05021199}',
      '#sh-original-grid>button:active{transform:translateY(2px) scale(.98)}',
      '@media(prefers-reduced-motion:reduce){.qa button,.nav button,.tabs button{transition:none!important}}'
    ].join('');
    doc.head.appendChild(depth);
  }
  fitAndroidViewport(document, false);
  // The original HTML eagerly renders demo rooms and a fake weekly podium
  // before the native Firebase session check completes. Keep only the
  // original branded splash visible until the verified state is known.
  function startVerifiedStartup(){
    const style=document.createElement('style');
    style.id='sharika-verified-startup-style';
    style.textContent=[
      '#app.sharika-startup-verifying .views,',
      '#app.sharika-startup-verifying .nav,',
      '#app.sharika-startup-verifying .auth,',
      '#app.sharika-startup-verifying #mini{visibility:hidden!important}',
      '#app.sharika-startup-verifying::after{',
      'content:"Opening Sharika…";position:absolute;inset:0;z-index:94;',
      'display:grid;place-items:center;background:linear-gradient(180deg,#1a0b45,#05030f);',
      'color:#e9dbff;font-size:16px;font-weight:700;pointer-events:none}'
    ].join('');
    document.head.appendChild(style);
    document.getElementById('app')?.classList.add('sharika-startup-verifying');
  }
  function finishVerifiedStartup(){
    document.getElementById('app')?.classList.remove('sharika-startup-verifying');
  }
  startVerifiedStartup();
  // The old splash timer invokes a simulated Top 3 ranking. The verified
  // ranking screen has its own server API and remains fully available.
  window.showWeekly=function(done){if(typeof done==='function')done();};
  document.getElementById('wk')?.remove();
  const ACCOUNT_KEY = 'vr_accts_v1';
  const META_KEY = 'sharika_staging_registration_v1';
  const COLORS = ['#9b4dff,#4c1d95','#ff3dc8,#9d174d','#0ea5e9,#075985','#10b981,#065f46'];
  const calls = new Map();
  let seq = 0, session = null, profile = null;
  let balance = { coins: 0, dia: 0, xp: 0 };
  let framePoll = null, giftPoll = null, chatPoll = null, invitePoll = null, entryPoll = null,
    reactionPoll = null;
  let voiceRoom = null, voiceRoomId = null, voiceSdkPromise = null;
  let voiceBackend = null;

  function errText(error) { return String(error && error.message || error || 'Connection unavailable'); }
  function toast(message) { if (window.toast) window.toast(message); }
  function native(action, payload) {
    if (!window.SharikaNative || typeof window.SharikaNative.call !== 'function')
      return Promise.reject(new Error('Android native bridge unavailable'));
    return new Promise((resolve, reject) => {
      const id = String(++seq);
      const timeoutMs = action === 'pickProfilePhoto' ? 180000 :
        action === 'api' && payload?.method === 'PUT' && payload?.path === '/api/v1/me/avatar'
          ? 90000 : 25000;
      const timer = setTimeout(() => { calls.delete(id); reject(new Error('Request timed out')); }, timeoutMs);
      calls.set(id, { resolve, reject, timer });
      try { window.SharikaNative.call(id, action, JSON.stringify(payload || {})); }
      catch (error) { clearTimeout(timer); calls.delete(id); reject(error); }
    });
  }
  window.SharikaNativeReply = function (id, response) {
    const pending = calls.get(id);
    if (!pending) return;
    calls.delete(id);
    clearTimeout(pending.timer);
    try {
      const message = JSON.parse(response);
      if (message.ok) pending.resolve(message.data || {});
      else pending.reject(new Error(message.error || 'unknown_error'));
    } catch (error) { pending.reject(error); }
  };
  async function api(method, path, body) {
    return native('api', { method, path: '/api/v1' + path, body });
  }


  // Original Sovera effects: packed locally into the isolated Android APK
  // from a pinned source commit, never fetched from a random URL or user input.
  const SOVERA_FRAMES = [
    {id:'phoenix-fire',name:'Phoenix Fire',art:'phoenix.png'},
    {id:'ice-wings',name:'Ice Wings',art:'ice.png'},
    {id:'royal-dragon',name:'Royal Dragon',art:'dragon.png'},
    {id:'vip7',name:'Sovera VIP7',art:'vip7.webp'},
    {id:'royal-gold',name:'Royal Gold',art:'royal-gold.webp'},
    {id:'violet-love',name:'Violet Love',art:'violet-love.webp'},
    {id:'ice-admin',name:'Ice Admin',art:'ice-admin.webp'},
    {id:'golden-dragon',name:'Golden Dragon',art:'dragon-gold.webp'},
    {id:'ice-dragon',name:'Ice Dragon',art:'ice-dragon.webp'},
    {id:'violet-phoenix',name:'Violet Phoenix',art:'violet-phoenix.webp'},
    {id:'castle-flag',name:'Castle Flag',art:'royal-gold.webp'},
    {id:'lion-queen',name:'Lion Queen',art:'phoenix.png'},
    {id:'phoenix-queen',name:'Phoenix Queen',art:'phoenix.png'},
    {id:'tiger-queen',name:'Tiger Queen',art:'royal-gold.webp'}
  ];
  const SOVERA_ENTRIES = [
    {id:'phoenix',name:'Phoenix arrival',art:'phoenix-entry.webp',still:'phoenix-entry.webp',ms:3200},
    {id:'dragon-queen',name:'Dragon Queen',art:'dragon-queen-entry.webp',still:'dragon-queen-entry.webp',ms:5000},
    {id:'ice-king',name:'Ice King',art:'ice-king-entry.webp',still:'ice-king-still.webp',ms:9000},
    {id:'castle-flag',name:'Castle Flag',art:'castle-entry.webp',still:'castle-entry.webp',ms:7000},
    {id:'lion-queen',name:'Lion Queen',art:'lion-queen-entry.webp',still:'lion-queen-still.webp',ms:10600},
    {id:'phoenix-queen',name:'Phoenix Queen',art:'phoenix-queen-entry.webp',still:'phoenix-queen-still.webp',ms:13800},
    {id:'tiger-queen',name:'Tiger Queen',art:'tiger-queen-entry.webp',still:'tiger-queen-still.webp',ms:12000}
  ];
  const SOVERA_MEDALS=[
    {id:'bronze',name:'Bronze medal',art:'bronze.webp',group:'medals'},
    {id:'silver',name:'Silver medal',art:'silver.webp',group:'medals'},
    {id:'gold',name:'Gold medal',art:'gold.webp',group:'medals'},
    {id:'top-host',name:'Top Host decorative art',art:'top-host-medal.webp'}
  ];
  const SOVERA_TAGS=[
    {id:'legend',name:'Sovera Legend decorative nameplate',art:'legend-tag.webp'}
  ];
  function medalArt(key){return SOVERA_MEDALS.find(m=>m.id===key);}
  function nameTagArt(key){return SOVERA_TAGS.find(m=>m.id===key);}
  function cosmeticMedia(item){return item?.group==='medals'?
    './sovera-medals/'+item.art:effectPath(item.art);}
  function frameArt(key){return SOVERA_FRAMES.find(f=>f.id===key);}
  function entryArt(key){return SOVERA_ENTRIES.find(f=>f.id===key);}
  function effectPath(file){return './sovera-effects/'+file;}
  function cosmeticCss(doc){
    if(!doc || doc.getElementById('sh-sovera-cosmetics'))return;
    const style=doc.createElement('style');
    style.id='sh-sovera-cosmetics';
    style.textContent=[
      '.sh-sovera-frame.fxr{position:absolute!important;top:50%!important;left:50%!important;',
      'right:auto!important;bottom:auto!important;',
      'width:142%!important;height:142%!important;transform:translate(-50%,-50%)!important;',
      'z-index:9!important;border:0!important;border-radius:0!important;',
      'background-size:contain!important;background-position:center!important;',
      'background-repeat:no-repeat!important;-webkit-mask:none!important;mask:none!important;',
      'pointer-events:none!important;animation:none!important}',
      '.sh-sovera-frame::after{content:none!important}',
      '.seat .av.sh-has-sovera-frame{margin-bottom:9px}',
      '.host .av.sh-has-sovera-frame{margin-bottom:17px}',
      '#v-me .mav{position:relative;overflow:visible!important;animation:none!important;',
      'transform:none!important;margin-bottom:25px!important}',
      '#v-me .mav>div{animation:none!important;transform:none!important}',
      '#v-me .mav>.sh-sovera-frame{width:138%!important;height:138%!important}',
      '.pavw{overflow:visible!important;margin-bottom:22px!important}',
      '.pavw>.sh-sovera-frame{width:142%!important;height:142%!important}',
      '@keyframes shSoGlow{50%{filter:brightness(1.18) drop-shadow(0 0 6px #ffe6a055)}}',
      '.sh-sovera-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:14px 0}',
      '.sh-sovera-item{min-width:0;display:flex;flex-direction:column;align-items:center;gap:8px;',
      'border:1px solid #6b61ad;background:#211747;border-radius:14px;color:#fff;padding:12px 8px;',
      'min-height:160px;overflow:hidden;',
      'font-size:11px;font-weight:700}',
      '.sh-sovera-item[aria-pressed="true"]{border:2px solid #ffdb70;background:#423068}',
      '.sh-sovera-item img{object-fit:contain;width:72px;height:72px;max-width:100%}',
      '.sh-sovera-preview{position:relative;width:96px;height:96px;border-radius:50%;',
      'display:grid;place-items:center;background:linear-gradient(135deg,#8149c8,#26104a);',
      'font-size:36px;margin:16px 0 10px}',
      '.sh-sovera-preview .sh-sovera-frame.fxr{width:137%!important;height:137%!important}',
      '.sh-sovera-id-effects{display:flex;justify-content:center;align-items:center;gap:8px;margin:6px auto 12px}',
      '.sh-sovera-id-effects img{max-width:45%;height:48px;object-fit:contain}',
      '.sh-sovera-seat-medal{position:absolute;z-index:15;right:-18%;bottom:-25%;width:29px;height:29px;object-fit:contain;pointer-events:none}',
      '.sh-sovera-seat-tag{position:absolute;z-index:18;left:50%;top:100%;width:104px;height:29px;transform:translateX(-50%);object-fit:contain;pointer-events:none}',
      '.sh-sovera-user-tag{display:inline-block;width:74px;height:25px;object-fit:contain;margin-left:4px;vertical-align:middle}',
      '.sh-sovera-entry-cover{position:fixed;inset:0;z-index:2147483600;',
      'pointer-events:none;display:block;overflow:hidden;background:#16082f}',
      '.sh-sovera-entry-cover img{position:absolute;inset:0;width:100%;height:100%;',
      'max-width:none;max-height:none;object-fit:cover;object-position:center top;',
      'opacity:0;filter:drop-shadow(0 0 12px #e6c6ff80)}',
      '.sh-sovera-entry-cover.ready img{opacity:1}',
      '.sh-sovera-entry-cover button{position:absolute;top:calc(12px + env(safe-area-inset-top,0px));right:18px;',
      'pointer-events:auto;border:1px solid #fff7;color:white;border-radius:50%;',
      'background:#25134a;font-size:22px;width:40px;height:40px}',
      '@media(prefers-reduced-motion:reduce){.sh-sovera-frame.fxr{animation:none!important}}'
    ].join('');
    doc.head.appendChild(style);
  }
  function frameTag(key){
    const item=frameArt(key);
    if(!item)return '';
    // Only pinned package filenames are used; never interpolate user URLs.
    return '<i class="fxr sh-sovera-frame" aria-hidden="true" '+
      'style="background-image:url('+effectPath(item.art)+')"></i>';
  }
  function playSoveraEntry(doc,key){
    const choice=entryArt(key);
    if(!doc||!choice)return;
    cosmeticCss(doc);
    doc.querySelector('.sh-sovera-entry-cover')?.remove();
    const cover=doc.createElement('div');
    cover.className='sh-sovera-entry-cover';
    const img=doc.createElement('img');
    img.alt=choice.name+' entry animation';
    // Begin the display timer after image bytes load. Large animated WebP
    // files used to expire on slow phones before the first frame appeared.
    let started=false;
    img.addEventListener('load',()=>{
      if(started||!cover.isConnected)return;
      started=true;
      cover.classList.add('ready');
      doc.defaultView?.setTimeout(()=>cover.remove(),choice.ms);
    },{once:true});
    img.addEventListener('error',()=>cover.remove(),{once:true});
    const close=doc.createElement('button');
    close.type='button';close.textContent='×';close.setAttribute('aria-label','Close entry animation');
    close.onclick=()=>cover.remove();
    cover.append(img,close);
    doc.body.appendChild(cover);
    img.src=effectPath(doc.defaultView?.matchMedia?.('(prefers-reduced-motion:reduce)')?.matches
      ?choice.still:choice.art);
    // Bound the network wait without truncating a successfully loaded effect.
    const timeout=doc.defaultView?.setTimeout(()=>{
      if(!started)cover.remove();
    },20000);
    img.addEventListener('load',()=>doc.defaultView?.clearTimeout(timeout),{once:true});
    img.addEventListener('error',()=>doc.defaultView?.clearTimeout(timeout),{once:true});
  }
  // Avatar URLs come only from the authenticated Sharika profile API. Never
  // render arbitrary user-supplied image URLs in verified room identities.
  function verifiedAvatarUrl(value){
    return typeof value==='string' &&
      /^https:\/\/sharika-api-staging\.soverixnet\.workers\.dev\/api\/v1\/users\/[0-9]{8}\/avatar\?v=[0-9]+$/.test(value)
      ?value:null;
  }
  function paintVerifiedAvatar(node,value,doc){
    const src=verifiedAvatarUrl(value);
    if(!node||!doc)return false;
    if(!src){
      // A recycled seat or message row must never retain another user's photo.
      node.querySelector('.sh-verified-avatar-image')?.remove();
      return false;
    }
    if(node.querySelector('.sh-verified-avatar-image')?.dataset.source===src)return true;
    node.querySelector('.sh-verified-avatar-image')?.remove();
    // Keep the original emoji underneath until the image has loaded.
    if(!node.classList.contains('face'))node.style.position='relative';
    node.style.overflow='hidden';
    const image=doc.createElement('img');
    image.className='sh-verified-avatar-image';
    image.dataset.source=src;
    image.alt='';
    image.setAttribute('aria-hidden','true');
    image.style.cssText='position:absolute;inset:0;width:100%;height:100%;'+
      'display:block;object-fit:cover;border-radius:inherit;z-index:2;'+
      'pointer-events:none;opacity:0';
    image.onload=()=>{image.style.opacity='1';};
    image.onerror=()=>image.remove();
    node.appendChild(image);
    image.src=src;
    return true;
  }
  function roomAvatarForPublicId(frame,id){
    const key=String(id||'');
    if(key===profile?.public_id)return verifiedAvatarUrl(profile?.pic);
    const member=(frame?.seats||[]).find(item=>item?.public_id===key)||
      (frame?.U||[]).find(item=>item?.id===key);
    return verifiedAvatarUrl(member?.pic);
  }
  // A gift is a relationship between two real people, not just an emoji
  // flying toward an anonymous seat. Small gifts appear above the chat dock;
  // only verified Luxury (catalog tab 1) gifts get a ten-second royal parade.
  const FEATURED_GIFT_TAB=1;
  function giftPresentationCss(doc){
    if(doc.getElementById('sh-gift-presentation-style'))return;
    const style=doc.createElement('style');
    style.id='sh-gift-presentation-style';
    style.textContent=[
      '.sh-gift-live{position:fixed;bottom:calc(92px + env(safe-area-inset-bottom,0px));',
      'left:12px;right:12px;max-width:480px;margin:auto;z-index:85;pointer-events:none;',
      'padding:10px 12px;border-radius:16px;background:linear-gradient(120deg,#2c184bdc,#140d36ed);',
      'border:1px solid #e7b767;color:#fff3d0;box-shadow:0 8px 25px #090419bd;',
      'font-size:12px;line-height:1.45;text-align:center;overflow-wrap:anywhere}',
      '.sh-gift-live strong{color:#ffe69d}',
      '.sh-gift-parade{position:fixed;z-index:90;top:calc(193px + env(safe-area-inset-top,0px));',
      'left:10px;width:calc(100% - 20px);max-width:540px;box-sizing:border-box;',
      'padding:9px 11px 12px;border-radius:23px;border:2px solid #ffe3a0;',
      'background:radial-gradient(ellipse at 50% 0%,#bd4cad88,transparent 72%),',
      'linear-gradient(135deg,#581d6e,#290f58 55%,#111b55);pointer-events:none;',
      'box-shadow:0 10px 28px #07041bd9,inset 0 2px 2px #ffffff66,0 0 20px #ffc86c87;',
      'color:#fff2d4;animation:shGiftParade 10s linear forwards}',
      '@keyframes shGiftParade{0%{transform:translateX(110vw);opacity:0}',
      '16%{transform:translateX(0);opacity:1}82%{transform:translateX(0);opacity:1}',
      '100%{transform:translateX(-110vw);opacity:0}}',
      '.sh-gift-parade-title{text-align:center;color:#ffdf87;font-size:12px;',
      'letter-spacing:1.1px;font-weight:900;text-shadow:0 2px 7px #110522}',
      '.sh-gift-parade-people{display:grid;grid-template-columns:minmax(0,1fr) 63px minmax(0,1fr);',
      'gap:4px;align-items:center;text-align:center;margin-top:6px}',
      '.sh-gift-person{min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px}',
      '.sh-gift-avatar{position:relative;display:grid;place-items:center;overflow:hidden;',
      'width:40px;height:40px;border-radius:50%;border:2px solid #ffe5a5;',
      'background:linear-gradient(135deg,#be55d9,#4832a2);font-size:23px}',
      '.sh-gift-person strong{display:block;width:100%;overflow:hidden;',
      'text-overflow:ellipsis;white-space:nowrap;font-size:12px}',
      '.sh-gift-person small{font-size:10px;color:#e5d0fc}',
      '.sh-gift-present{display:flex;flex-direction:column;align-items:center;',
      'justify-content:center;gap:2px;font-size:11px;color:#ffe7a7}',
      '.sh-gift-present b{font-size:25px;line-height:1.1}',
      '.sh-gift-parade-caption{text-align:center;font-size:11px;margin-top:7px;',
      'color:#fff5d8;font-weight:800;overflow-wrap:anywhere}',
      '@media(max-width:350px){.sh-gift-parade-people{grid-template-columns:minmax(0,1fr) 48px minmax(0,1fr)}',
      '.sh-gift-parade{padding:8px 7px}.sh-gift-avatar{width:35px;height:35px}}',
      '@media(prefers-reduced-motion:reduce){.sh-gift-parade{animation:none}}'
    ].join('');
    doc.head.appendChild(style);
  }
  function giftParticipant(doc,name,id,pic){
    const user=doc.createElement('span');user.className='sh-gift-person';
    const photo=doc.createElement('span');photo.className='sh-gift-avatar';
    photo.textContent='👤';paintVerifiedAvatar(photo,pic,doc);
    const label=doc.createElement('strong');label.textContent=String(name||'Member').slice(0,80);
    const number=doc.createElement('small');number.textContent='ID '+String(id||'');
    user.append(photo,label,number);return user;
  }
  function giftEventValue(event){
    return Math.max(0,(Number(event?.price_coins)||0)*(Number(event?.quantity)||0));
  }
  function giftEventText(event){
    return String(event?.sender_name||'Member')+' (ID '+event.sender_id+') sent '+
      String(event.emoji||'🎁')+' '+String(event.name||'Gift')+' ×'+
      String(event.quantity||1)+' to '+String(event.recipient_name||'Member')+
      ' (ID '+event.recipient_id+') · 🪙 '+giftEventValue(event).toLocaleString('en-US');
  }
  function queueGiftPresentation(frame,event,featured=false){
    const doc=frame?.document;
    if(!doc?.body)return;
    giftPresentationCss(doc);
    const queueKey=featured?'__shFeaturedGiftQueue':'__shGiftNoticeQueue';
    const busyKey=featured?'__shFeaturedGiftBusy':'__shGiftNoticeBusy';
    const queue=frame[queueKey]||(frame[queueKey]=[]);
    if(queue.length<12)queue.push(event);
    if(frame[busyKey])return;
    function next(){
      const item=queue.shift();
      if(!item){frame[busyKey]=false;return;}
      frame[busyKey]=true;
      const box=doc.createElement('aside');
      if(featured){
        box.className='sh-gift-parade';
        box.setAttribute('aria-label','Large gift celebration');
        const heading=doc.createElement('div');heading.className='sh-gift-parade-title';
        heading.textContent='👑 SHARIKA GIFT CONGRATULATIONS 👑';
        const people=doc.createElement('div');people.className='sh-gift-parade-people';
        const present=doc.createElement('div');present.className='sh-gift-present';
        const emoji=doc.createElement('b');emoji.textContent=String(item.emoji||'🎁');
        const amount=doc.createElement('span');amount.textContent='×'+String(item.quantity||1);
        present.append(emoji,amount);
        people.append(giftParticipant(doc,item.sender_name,item.sender_id,item.sender_pic),
          present,giftParticipant(doc,item.recipient_name,item.recipient_id,item.recipient_pic));
        const caption=doc.createElement('div');caption.className='sh-gift-parade-caption';
        caption.textContent=String(item.sender_name||'Member')+' gifted '+
          String(item.name||'Gift')+' to '+String(item.recipient_name||'Member')+
          ' · 🪙 '+giftEventValue(item).toLocaleString('en-US');
        box.append(heading,people,caption);
      }else{
        box.className='sh-gift-live';
        box.textContent='🎁 '+giftEventText(item);
        box.setAttribute('role','status');
      }
      doc.body.appendChild(box);
      frame.setTimeout(()=>{box.remove();next();},featured?10000:4700);
    }
    next();
  }
  function decorateRoomPeople(frame){
    const doc=frame?.document;
    for(const row of doc?.querySelectorAll('#ul .urow')||[]){
      const index=Number(row.dataset.i);
      if(!Number.isInteger(index)||index<0)continue;
      const item=row.dataset.t==='m'?frame.seats?.[index]:
        row.dataset.t==='a'?frame.U?.[index]:null;
      if(!item)continue;
      paintVerifiedAvatar(row.querySelector('.ua'),item.pic,doc);
      row.querySelector('.sh-sovera-user-tag')?.remove();
      const tag=nameTagArt(item.name_tag_style);
      if(tag){
        const img=doc.createElement('img');
        img.className='sh-sovera-user-tag';img.alt='Verified name tag';
        img.src=cosmeticMedia(tag);row.appendChild(img);
      }
    }
  }
  function decorateRoomChat(frame){
    const doc=frame?.document;
    for(const message of doc?.querySelectorAll('#chat .msg[data-sh-sender-id]')||[]){
      paintVerifiedAvatar(message.querySelector('.mav'),
        roomAvatarForPublicId(frame,message.dataset.shSenderId),doc);
    }
  }
  function decorateGiftRecipients(frame){
    for(const chip of frame?.document?.querySelectorAll('#sheet .chips .chip[data-r]')||[]){
      const i=Number(chip.dataset.r);
      if(!Number.isInteger(i)||i<0)continue;
      paintVerifiedAvatar(chip.querySelector('.c'),frame.seats?.[i]?.pic,frame.document);
    }
  }
  function decorateRoomSeats(frame){
    const doc=frame?.document;
    if(!doc)return;
    cosmeticCss(doc);
    for(const seat of frame.seats||[]){
      if(!seat||seat.empty||seat.lock)continue;
      const el=frame.seatEl?.(seat.i);
      const avatar=el?.querySelector('.av');
      if(!avatar)continue;
      // The user's stored profile photo follows the same public ID into
      // owner, guest and mic seats. Frames remain over the circular avatar.
      paintVerifiedAvatar(el.querySelector('.face'),seat.pic,doc);
      // Repeated server refreshes must not stack medals over one another.
      avatar.querySelectorAll('.sh-sovera-frame,.sh-sovera-seat-medal')
        .forEach(decoration=>decoration.remove());
      el.querySelectorAll('.sh-sovera-seat-tag').forEach(decoration=>decoration.remove());
      const item=frameArt(seat.frame_style);
      const medal=medalArt(seat.medal_style);
      const nameTag=nameTagArt(seat.name_tag_style);
      avatar.classList.toggle('sh-has-sovera-frame',!!item);
      if(!item&&!medal&&!nameTag)continue;
      avatar.style.position='relative';
      if(item){
        const decoration=doc.createElement('i');
        decoration.className='fxr sh-sovera-frame';
        decoration.setAttribute('aria-hidden','true');
        decoration.style.backgroundImage='url('+effectPath(item.art)+')';
        avatar.appendChild(decoration);
      }
      if(medal){
        const badge=doc.createElement('img');
        badge.className='sh-sovera-seat-medal';
        badge.alt='';
        badge.src=cosmeticMedia(medal);
        badge.setAttribute('aria-hidden','true');
        avatar.appendChild(badge);
      }
      if(nameTag){
        const plaque=doc.createElement('img');
        plaque.className='sh-sovera-seat-tag';
        plaque.alt='Verified nameplate';
        plaque.src=cosmeticMedia(nameTag);
        el.style.position='relative';
        el.appendChild(plaque);
      }
    }
  }
  function wireSoveraRoomFrames(frame){
    if(!frame||frame.__soveraRoomFrames)return;
    frame.__soveraRoomFrames=true;
    cosmeticCss(frame.document);
    const normal=frame.render;
    if(typeof normal==='function')frame.render=function(){
      normal.apply(this,arguments);
      decorateRoomSeats(frame);
      decorateRoomPeople(frame);
      decorateRoomChat(frame);
    };
    const normalUsers=frame.fillUsers;
    if(typeof normalUsers==='function')frame.fillUsers=function(){
      normalUsers.apply(this,arguments);
      decorateRoomPeople(frame);
    };
    const originalGiftSheet=frame.giftSheet;
    if(typeof originalGiftSheet==='function')frame.giftSheet=function(){
      originalGiftSheet.apply(this,arguments);
      decorateGiftRecipients(frame);
    };
  }
  let cosmeticCataloguePromise=null;
  async function loadVerifiedCosmetics(){
    if(cosmeticCataloguePromise)return cosmeticCataloguePromise;
    const work=(async()=>{
      const data=await api('GET','/cosmetics');
      const items=Array.isArray(data.items)?data.items:[];
      const lists={frame_style:SOVERA_FRAMES,entry_style:SOVERA_ENTRIES,
        medal_style:SOVERA_MEDALS,name_tag_style:SOVERA_TAGS};
      for(const item of items){
        const list=lists[item.kind];
        if(!list||typeof item.id!=='string')continue;
        const alias=item.id.slice(item.kind.length+1);
        if(list.some(x=>x.id===alias))continue;
        const art=list.find(x=>x.id===item.art_key);
        if(art)list.push({...art,id:alias,name:item.name});
      }
      return items;
    })();
    cosmeticCataloguePromise=work;
    try{return await work;}finally{cosmeticCataloguePromise=null;}
  }
  async function styleSelectionSheet(kind){
    if(!session){window.showAuth('welcome');return;}
    cosmeticCss(document);
    const isEntry=kind==='entry_style';
    const isMedal=kind==='medal_style';
    const isTag=kind==='name_tag_style';
    const title=isEntry?'✨ Original Sovera Entry':
      isMedal?'🏅 Original Sovera Medals':
      isTag?'🎖️ Original Sovera Name Tag':'🖼️ Original Sovera Avatar Frames';
    const catalog=isEntry?SOVERA_ENTRIES:isMedal?SOVERA_MEDALS:isTag?SOVERA_TAGS:SOVERA_FRAMES;
    window.openSheet('<h3>'+title+'</h3><div id="sh-sovera-tabs"></div>'+
      '<div id="sh-sovera-list" class="sh-sovera-grid"></div>'+
      '<p style="font-size:12px;color:#c9bbed">Coins are charged only when buying. Owned or Super Admin-granted items can be equipped free. Preview is not ownership.</p>');
    const node=document.getElementById('sh-sovera-list');
    if(!node)return;
    const tabs=document.getElementById('sh-sovera-tabs');
    tabs.style.cssText='display:flex;gap:5px;margin:10px 0;flex-wrap:wrap';
    for(const option of [
      ['frame_style','Frames'],['entry_style','Entry'],
      ['medal_style','Medal'],['name_tag_style','Name Tag']
    ]){
      const tab=document.createElement('button');
      tab.type='button';tab.className='act';tab.textContent=option[1];
      tab.style.cssText='flex:1;padding:8px 6px;min-width:60px;font-size:12px;border-radius:10px;'+
        (option[0]===kind?'background:#6a40b7;color:#fff':'background:#2c2357;color:#fff');
      tab.onclick=()=>styleSelectionSheet(option[0]);
      tabs.appendChild(tab);
    }
    const current=profile?.[kind]||'';
    let records;
    try{records=(await loadVerifiedCosmetics()).filter(x=>x.kind===kind);}
    catch(error){node.textContent='Cosmetic shop unavailable: '+errText(error);return;}
    if(!node.isConnected)return;
    const choices=[{id:'',name:'None',art:'',owned:true},...records.map(row=>{
      const key=row.id.slice(kind.length+1);
      const art=catalog.find(x=>x.id===key)||catalog.find(x=>x.id===row.art_key);
      return {...art,id:key,item_id:row.id,name:row.name,owned:row.owned,
        active:row.active,price_coins:row.price_coins};
    })];
    for(const item of choices){
      const button=document.createElement('button');
      button.className='sh-sovera-item';
      button.type='button';
      button.setAttribute('aria-pressed',String((current||'')===item.id));
      if(isEntry||isMedal||isTag){
        const img=document.createElement('img');
        if(item.art)img.src=cosmeticMedia({...item,art:item.still||item.art});
        else img.alt='No decorative effect';
        button.appendChild(img);
      }else{
        const preview=document.createElement('div');
        preview.className='sh-sovera-preview';
        preview.textContent='👤';
        if(item.art){
          const ring=document.createElement('i');
          ring.className='fxr sh-sovera-frame';
          ring.style.backgroundImage='url('+effectPath(item.art)+')';
          preview.appendChild(ring);
        }
        button.appendChild(preview);
      }
      const label=document.createElement('span');
      label.textContent=item.name;
      button.appendChild(label);
      const price=document.createElement('span');
      price.textContent=item.owned?'✓ Owned':item.active?
        '🪙 '+Number(item.price_coins).toLocaleString('en-US'):'Unavailable';
      button.appendChild(price);
      button.disabled=!!item.item_id&&!item.owned&&!item.active;
      if(isEntry&&item.id){
        const preview=document.createElement('button');
        preview.type='button';preview.className='act';preview.textContent='▶ Preview';
        preview.style.cssText='font-size:11px;padding:7px;border-radius:10px;color:white;background:#43337e';
        preview.onclick=e=>{e.preventDefault();e.stopPropagation();playSoveraEntry(document,item.id);};
        // Place preview separately so interactive controls are not nested.
        const group=document.createElement('div');
        group.append(button,preview);
        node.appendChild(group);
      }else node.appendChild(button);
      button.onclick=async()=>{
        if(button.disabled)return;
        if(item.item_id&&!item.owned&&!window.confirm(
          'Buy '+item.name+' for '+Number(item.price_coins).toLocaleString('en-US')+
          ' coins from your verified wallet?'))return;
        button.disabled=true;
        try{
          if(item.item_id&&!item.owned){
            await api('POST','/cosmetics/purchase',{
              item_id:item.item_id,
              request_id:'cosmetic:'+Date.now().toString(36)+':'+
                Math.random().toString(36).slice(2)
            });
          }
          await api('POST','/cosmetics/equip',{kind,item_id:item.item_id||''});
          const saved=await api('GET','/me');
          if((saved[kind]||'')!==item.id)throw new Error('Verified equip pending');
          profile=saved;
          if(window.A){
            window.A.frame=saved.frame_style||'';
            window.A.entry=saved.entry_style||'';
            window.A.cosmeticMedal=saved.medal_style||'';
            window.A.cosmeticTag=saved.name_tag_style||'';
            window.A.frameImg=null;
            window.saveA();
            window.renderMe();
          }
          window.closeSheet();
          toast((isEntry?'Entry':isMedal?'Medal':isTag?'Name tag':'Frame')+
            ' equipped from your verified inventory ✓');
        }catch(error){toast('Effect not saved: '+errText(error));button.disabled=false;}
      };
    }
  }
  cosmeticCss(document);
  // The old HTML creates random "Manager" badges locally. Never represent those
  // as real ranks in staging. Only verified server cosmetics are displayed.
  window.ownedMedals=function(){return [];};
  function renderVerifiedIdentity(){
    const anchor=document.querySelector('#v-me .mid');
    if(!anchor)return;
    // Tapping the public ID opens the separate rich ID detail profile,
    // never redirects back to the wallet/settings Main Profile.
    anchor.setAttribute('role','button');anchor.tabIndex=0;
    anchor.title='Open my detailed public profile';
    anchor.style.cursor='pointer';
    anchor.onclick=()=>{if(profile?.public_id)openVerifiedRankProfile(profile.public_id);};
    anchor.onkeydown=event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();anchor.click();}
    };
    document.getElementById('sh-sovera-own-identity')?.remove();
    const medal=medalArt(profile?.medal_style);
    const tag=nameTagArt(profile?.name_tag_style);
    if(!medal&&!tag)return;
    const strip=document.createElement('div');
    strip.id='sh-sovera-own-identity';strip.className='sh-sovera-id-effects';
    for(const item of [medal,tag]){
      if(!item)continue;
      const img=document.createElement('img');
      img.src=cosmeticMedia(item);
      img.alt=item.name+' (decoration only)';
      img.title=item.name+' · decorative';
      strip.appendChild(img);
    }
    anchor.insertAdjacentElement('afterend',strip);
  }
  // A verified seller has two distinct wallets: personal coins in the
  // original profile, plus this seller-stock entry beside their public ID.
  let sellerProfileRequest=0;
  async function renderSellerWalletProfileButton(){
    const requestNo=++sellerProfileRequest;
    const id=session?.user?.id;
    const anchor=document.querySelector('#v-me .mid');
    document.getElementById('sharika-seller-wallet-entry')?.remove();
    if(!id||!anchor)return;
    try{
      const data=await api('GET','/sellers/me');
      if(requestNo!==sellerProfileRequest||session?.user?.id!==id||!anchor.isConnected)return;
      const seller=data.seller;
      if(!seller?.active)return;
      const button=document.createElement('button');
      button.id='sharika-seller-wallet-entry';
      button.type='button';
      button.textContent='🪙 Recharge my ID · Seller stock '+
        Number(seller.available_coins||0).toLocaleString('en-US');
      button.style.cssText='display:block;margin:8px auto;padding:8px 14px;border:1px solid #f0be55;'+
        'border-radius:15px;background:#3b225b;color:#fff;font-weight:700;font-size:12px';
      button.onclick=()=>showVerifiedCoinSellers({walletOnly:true,
        targetId:profile?.public_id||''});
      (document.getElementById('sh-sovera-own-identity')||anchor).insertAdjacentElement('afterend',button);
    }catch(error){console.warn('Seller wallet profile unavailable:',errText(error));}
  }

  // Premium membership is independent of Wealth/Charm levels. Automatic
  // eligibility and daily credits are computed by the verified D1 Worker.
  let premiumProfileRequest=0;
  async function mountPremiumProfileEntry(){
    const anchor=document.querySelector('#v-me .mid');
    const requestNo=++premiumProfileRequest;
    document.getElementById('sharika-premium-profile-entry')?.remove();
    if(!anchor||!session)return;
    const button=document.createElement('button');
    button.type='button';button.id='sharika-premium-profile-entry';
    button.textContent='👑 VIP · SVIP · Noble';
    button.style.cssText='display:block;margin:8px auto;padding:9px 15px;border-radius:16px;'+
      'color:#ffedb1;background:linear-gradient(140deg,#5a2a91,#30215f);'+
      'border:1px solid #ffe49c;font-weight:800;font-size:13px;'+
      'box-shadow:inset 0 2px 0 #ffffff35,0 5px 10px #0005';
    button.onclick=showPremiumSheet;
    anchor.insertAdjacentElement('afterend',button);
    const who=session.user.id;
    try{
      const data=await api('GET','/premium');
      if(!button.isConnected||requestNo!==premiumProfileRequest||session?.user?.id!==who)return;
      const tier=String(data.status?.tier||'none').toUpperCase();
      button.textContent=tier==='NONE'?'👑 VIP · SVIP · Noble':
        '👑 '+tier+' · Premium benefits';
    }catch(error){
      console.warn('Premium status pending staging deployment:',errText(error));
    }
  }
  let pendingPremiumPurchase=null;
  async function showPremiumSheet(){
    if(!session){toast('Sign in to view premium membership');return;}
    window.openSheet('<h3>👑 VIP · SVIP · Noble</h3>'+
      '<div id="sh-premium-view">Loading verified premium status…</div>');
    const root=document.getElementById('sh-premium-view');
    if(!root)return;
    let data;
    try{data=await api('GET','/premium');}
    catch(error){root.textContent='Premium service not ready: '+errText(error);return;}
    if(!root.isConnected)return;
    const status=data.status||{},cfg=data.config||{},tiers=cfg.tiers||[];
    const labels={vip:'💎 VIP',svip:'✨ SVIP',noble:'👑 Noble'};
    const format=n=>Number(n||0).toLocaleString('en-US');
    const tierName=status.tier==='none'?'Standard':labels[status.tier]||'Standard';
    const remaining=status.expires_at_ms?
      ' · until '+new Date(status.expires_at_ms).toLocaleDateString('en-GB'):'';
    const autoInfo=cfg.policy?.auto_enabled?
      'Automatic qualification ON · '+
        (cfg.policy?.auto_by_level?'Wealth Level ':'')+
        (cfg.policy?.auto_by_gifts?'Gift total':''):
      'Automatic qualification OFF by Admin';
    root.innerHTML='<div style="padding:14px;border-radius:20px;border:1px solid #f8ce8a;'+
      'background:linear-gradient(145deg,#654398,#25215e)"><b>'+tierName+'</b>'+
      '<div class="lbl">Source: '+String(status.source||'none')+remaining+'</div>'+
      '<div class="lbl">Wealth Lv.'+format(status.wealth_level)+' · Gifts sent '+
      format(status.gift_coins)+' coins</div><small>'+autoInfo+'</small></div>'+
      '<div style="display:grid;gap:10px;margin-top:12px">'+tiers.map(item=>{
        const active=status.tier===item.tier;
        return '<div style="border:1px solid '+(active?'#f6d678':'#896cad')+';border-radius:18px;'+
          'background:linear-gradient(155deg,#493477,#211b4b);padding:12px">'+
          '<b>'+labels[item.tier]+'</b>'+(active?' <small>✓ Current</small>':'')+
          '<div class="lbl">Level '+format(item.min_wealth_level)+' or sent gifts '+
          format(item.min_gift_coins)+' · Daily '+format(item.daily_bonus_coins)+' coins</div>'+
          '<div class="lbl">'+format(item.price_coins)+' coins / '+item.duration_days+' days</div>'+
          (cfg.policy?.purchase_enabled&&Number(status.rank||0)<=item.rank?
            '<button class="send" type="button" data-sh-premium-buy="'+item.tier+'">'+
              (active?'Extend ':'Buy ')+item.tier.toUpperCase()+'</button>':'')+'</div>';
      }).join('')+'</div>'+
      '<div style="margin-top:13px;padding:12px;border-radius:16px;background:#231b4a">'+
        '<b>🎁 Premium Daily Coin Bonus</b><div class="lbl">'+
        (status.tier==='none'?'Qualify for a tier to claim daily coins.':
          format(status.daily_bonus_coins)+' coins per UTC day')+'</div>'+
        (status.rank>0&&status.daily_bonus_coins>0?
          '<button class="send" type="button" id="sh-premium-claim" '+
            (status.claimed_today?'disabled':'')+'>'+
            (status.claimed_today?'Claimed today ✓':'Claim premium coins')+'</button>':'')+
        '</div><p class="lbl" id="sh-premium-status" role="status"></p>';
    const note=root.querySelector('#sh-premium-status');
    root.querySelectorAll('[data-sh-premium-buy]').forEach(button=>{
      button.onclick=async()=>{
        const tier=button.dataset.shPremiumBuy;
        const item=tiers.find(x=>x.tier===tier);
        if(!item||!window.confirm('Buy '+tier.toUpperCase()+' for '+format(item.price_coins)+
          ' coins? Seller coins and game outcomes are separate.'))return;
        button.disabled=true;
        const requestId=pendingPremiumPurchase?.tier===tier?
          pendingPremiumPurchase.requestId:nextWalletRequestId('premium');
        pendingPremiumPurchase={tier,requestId};
        try{
          const result=await api('POST','/premium/purchase',{
            tier,request_id:requestId
          });
          pendingPremiumPurchase=null;
          note.textContent=(result.duplicate?'Already recorded. ':'Purchased ✓ ')+
            tier.toUpperCase();
          await refreshWalletAfterConfirmedTransaction();
          await showPremiumSheet();
          window.renderMe();
        }catch(error){note.textContent='Purchase not confirmed; check status: '+errText(error);}
        finally{if(button.isConnected)button.disabled=false;}
      };
    });
    const claim=root.querySelector('#sh-premium-claim');
    if(claim)claim.onclick=async()=>{
      if(claim.disabled)return;
      claim.disabled=true;
      try{
        const receipt=await api('POST','/premium/daily/claim',{});
        note.textContent=(receipt.duplicate?'Already claimed: ':'Received: ')+
          format(receipt.reward_coins)+' coins ✓';
        await refreshWalletAfterConfirmedTransaction();
        await showPremiumSheet();
      }catch(error){note.textContent='Bonus not claimed: '+errText(error);
        if(claim.isConnected)claim.disabled=false;}
    };
  }

  // Keep Sharika's existing profile layout; give its edit controls a
  // tactile 3D finish, and show the server-backed photo before saving text.
  const profileDepthStyle=document.createElement('style');
  profileDepthStyle.id='sharika-profile-edit-depth';
  profileDepthStyle.textContent=[
    '#v-me .edp,#v-me .pick{color:#fff!important;font-weight:800!important;',
    'background:linear-gradient(155deg,#c5abff 0%,#915aff 18%,#6535d0 68%,#47238c 100%)!important;',
    'border:1px solid #dccaff!important;border-radius:20px!important;',
    'box-shadow:inset 0 2px 1px #ffffff99,inset 0 -3px 3px #31106799,',
    '0 6px 0 #3c207e,0 12px 20px #3e197344!important;',
    'text-shadow:0 2px 3px #25105699;transition:transform .12s,box-shadow .12s}',
    '#v-me .edp:active,#v-me .pick:active{transform:translateY(4px);',
    'box-shadow:inset 0 2px 3px #2b1265,0 2px 0 #3c207e!important}',
    '#sh.sharika-profile-editor{background:linear-gradient(155deg,#413078,#241548 72%,#170c30);',
    'border-top:2px solid #a78bfa;box-shadow:0 -15px 40px #130b30b3;padding-top:17px}',
    '#sh.sharika-profile-editor h3{font-size:20px;color:#fff;margin:0 0 14px;',
    'text-shadow:0 2px 8px #1c0a4f}',
    '#sh.sharika-profile-editor .lbl{font-size:13px;color:#dfd2ff;font-weight:700}',
    '#sh.sharika-profile-editor .field{background:linear-gradient(#21133f,#302056);',
    'border:1px solid #8864ca;border-radius:17px;box-shadow:inset 0 3px 7px #0d072a80,',
    '0 2px 0 #ad82f944;padding:14px;color:#fff}',
    '#sh.sharika-profile-editor .field:focus{outline:2px solid #d6a8ff;outline-offset:1px}',
    '#sh.sharika-profile-editor .act{min-height:87px;border:1px solid #c4a4ff;',
    'border-radius:19px;color:#fff;font-weight:800;font-size:13px;',
    'background:linear-gradient(155deg,#ae83ff,#7142d3 48%,#472781);',
    'box-shadow:inset 0 2px 1px #ffffff88,0 5px 0 #321969,0 12px 17px #08041355}',
    '#sh.sharika-profile-editor .act:active{transform:translateY(4px);',
    'box-shadow:inset 0 2px 5px #220f4d,0 1px 0 #321969}',
    '#sh.sharika-profile-editor #es{font-size:17px;color:#fff;',
    'background:linear-gradient(155deg,#e0b8ff,#9c5aff 35%,#672fc3 80%);',
    'border:1px solid #dfbcff;box-shadow:inset 0 2px 1px #ffffffa0,',
    '0 6px 0 #3a1d78,0 12px 18px #0d052c80;margin:22px 0 12px}',
    '#sh.sharika-profile-editor #es:active{transform:translateY(4px);',
    'box-shadow:inset 0 2px 5px #331a6c,0 1px 0 #3a1d78}',
    '#sh.sharika-profile-editor button:disabled{opacity:.55}',
    '#sharika-photo-editor{display:flex;align-items:center;gap:15px;',
    'padding:12px;margin:8px 0 17px;border-radius:23px;',
    'background:linear-gradient(140deg,#6340a8,#31215b);',
    'border:1px solid #af94ec;box-shadow:inset 0 2px 0 #ffffff44,0 6px 13px #13092e70}',
    '#sharika-photo-preview{width:73px;height:73px;flex:none;border-radius:50%;',
    'background:linear-gradient(150deg,#b388ff,#fa7dce) center/cover;',
    'border:4px solid #ffe5a2;box-shadow:inset 0 3px 5px #29134466,',
    '0 5px 0 #835ca8,0 9px 13px #110a2580;display:grid;place-items:center;font-size:34px}',
    '#sharika-photo-copy{min-width:0;flex:1}',
    '#sharika-photo-copy b{display:block;font-size:14px;color:#fff}',
    '#sharika-photo-status{display:block;font-size:12px;margin-top:6px;',
    'color:#ddd0ff;line-height:1.4;word-break:break-word}',
    '#sharika-photo-status[data-state="success"]{color:#91ffd5}',
    '#sharika-photo-status[data-state="error"]{color:#ffc7ca}',
    '#sharika-photo-status[data-state="pending"]{color:#ffe08d}',
    '#sharika-profile-save-status{margin:2px 0 12px;color:#d9c8ff;font-size:12px;line-height:1.5;text-align:center}',
    '#sharika-profile-save-status[data-state="pending"]{color:#ffe08d}',
    '#sharika-profile-save-status[data-state="success"]{color:#9affd9}',
    '#sharika-profile-save-status[data-state="error"]{color:#ffc0c8}',
    '#sharika-photo-preview{cursor:pointer;transition:transform .18s ease,box-shadow .18s ease}',
    '#sharika-photo-preview:active{transform:scale(.95)}',
    '#sh.sharika-profile-editor #es:focus-visible,#sharika-photo-preview:focus-visible{outline:3px solid #ffd787;outline-offset:3px}'
  ].join('');
  document.head.appendChild(profileDepthStyle);
  function photoEditStatus(message,state='info'){
    const status=document.getElementById('sharika-photo-status');
    if(status){status.textContent=message;status.dataset.state=state;}
  }
  function applyProfileEditDepth(){
    const sheet=document.getElementById('sh');
    const editName=sheet?.querySelector('#en'),editBio=sheet?.querySelector('#eb');
    if(!editName||!editBio||sheet.querySelector('#sharika-photo-editor'))return;
    sheet.classList.add('sharika-profile-editor');
    editName.maxLength=80;
    editBio.maxLength=500;
    const block=document.createElement('div');
    block.id='sharika-photo-editor';
    const preview=document.createElement('button');
    preview.type='button';
    preview.title='Choose a new profile photo';
    preview.id='sharika-photo-preview';
    preview.setAttribute('aria-label','Choose your profile photo from gallery');
    const safe=verifiedAvatarUrl(profile?.pic);
    if(safe)preview.style.backgroundImage='url("'+safe+'")';
    else preview.textContent='👤';
    const copy=document.createElement('div');
    copy.id='sharika-photo-copy';
    const heading=document.createElement('b');
    heading.textContent='My profile photo';
    const status=document.createElement('span');
    status.id='sharika-photo-status';
    status.setAttribute('role','status');
    status.textContent='Tap Change photo to select from gallery';
    copy.append(heading,status);
    block.append(preview,copy);
    sheet.querySelector('.lbl')?.before(block);
    const photo=sheet.querySelector('#ep');
    if(photo)photo.innerHTML='<span>📷</span>Choose photo';
    const save=sheet.querySelector('#es');
    if(save){
      save.textContent='✓ Save changes';
      const saveStatus=document.createElement('div');
      saveStatus.id='sharika-profile-save-status';
      saveStatus.setAttribute('role','status');
      saveStatus.setAttribute('aria-live','polite');
      saveStatus.textContent='Changes are saved to your verified Sharika ID.';
      save.after(saveStatus);
    }
  }
  const originalOpenSheetForProfile=window.openSheet;
  if(typeof originalOpenSheetForProfile==='function')window.openSheet=function(){
    document.getElementById('sh')?.classList.remove('sharika-profile-editor');
    return originalOpenSheetForProfile.apply(this,arguments);
  };
  const originalEditSheetForProfile=window.editSheet;
  if(typeof originalEditSheetForProfile==='function')window.editSheet=function(){
    originalEditSheetForProfile.apply(this,arguments);
    applyProfileEditDepth();
  };

  let avatarUploadBusy=false;
  async function pickProfilePhoto(){
    if(!session||!profile){toast('Sign in to change your profile photo');return;}
    if(avatarUploadBusy){toast('Profile photo upload is already running');return;}
    avatarUploadBusy=true;
    const accountId=session.user.id;
    const publicId=profile.public_id;
    const previousPic=verifiedAvatarUrl(profile.pic);
    try{
      photoEditStatus('Opening Android gallery…','pending');
      toast('Opening your Android photo gallery…');
      // Use a native, single-image Android picker. It decodes HEIC/JPEG and
      // produces a bounded JPEG; no broad storage permission is needed.
      const picked=await native('pickProfilePhoto');
      if(session?.user?.id!==accountId)throw new Error('Account changed; please select the photo again');
      const image_data=picked?.image_data;
      if(typeof image_data!=='string'||!image_data.startsWith('data:image/jpeg;base64,'))
        throw new Error('Gallery did not return a usable photo');
      photoEditStatus('Saving image to your Sharika ID…','pending');
      toast('Uploading your profile photo…');
      let saved;
      try{
        saved=await api('PUT','/me/avatar',{image_data});
      }catch(error){
        // A mobile timeout can happen after the server committed the upload.
        // Reconcile the version before telling a user to retry an already saved photo.
        if(!/timed out|timeout|network|connection|unavailable|http[_ ]?5[0-9]{2}/i.test(errText(error)))
          throw error;
        const checked=await api('GET','/me').catch(()=>null);
        if(checked?.public_id!==publicId ||
          !verifiedAvatarUrl(checked.pic) || checked.pic===previousPic)
          throw error;
        saved=checked;
      }
      if(session?.user?.id!==accountId || saved?.public_id!==publicId)
        throw new Error('Profile changed before photo confirmation');
      if(!/^https:\/\/sharika-api-staging\.soverixnet\.workers\.dev\/api\/v1\/users\/[0-9]{8}\/avatar\?v=[0-9]+$/.test(saved.pic||''))
        throw new Error('Profile photo confirmation unavailable');
      // Confirm the assigned ID and new version from the server; a retryable
      // readback outage must not falsely negate a completed upload.
      let latest=saved,readbackConfirmed=false;
      try{
        const checked=await api('GET','/me');
        if(checked.public_id!==publicId||checked.pic!==saved.pic)
          throw new Error('photo_save_verification_mismatch');
        latest=checked;readbackConfirmed=true;
      }catch(error){
        console.warn('Photo saved, readback unavailable:',errText(error));
      }
      profile=latest;
      window.A.pic=latest.pic;
      try{window.saveA();window.renderMe();}
      catch(error){console.warn('Photo saved; local redraw deferred:',errText(error));}
      const preview=document.getElementById('sharika-photo-preview');
      if(preview){preview.style.backgroundImage='url("'+latest.pic+'")';preview.textContent='';}
      photoEditStatus(readbackConfirmed?'Photo saved to your ID ✓':
        'Photo uploaded; final server check pending','success');
      // Refresh this same verified ID inside an already open room immediately.
      const roomFrame=document.getElementById('rf')?.contentWindow;
      if(window.cur?.id&&roomFrame?.seats){
        for(const seat of roomFrame.seats)
          if(seat?.user_id===session.user.id)seat.pic=saved.pic;
        for(const member of roomFrame.U||[])
          if(member?.id===saved.public_id)member.pic=saved.pic;
        roomFrame.render?.();
        decorateRoomPeople(roomFrame);
        decorateRoomChat(roomFrame);
      }
      toast('Profile photo saved to your Sharika ID ✓');
    }catch(error){
      if(errText(error)==='profile_photo_cancelled'){
        photoEditStatus('No photo selected. Your old photo is unchanged.');
      }else{
        const detail=errText(error);
        const hint=detail==='avatar_rate_limited'?'Wait 20 seconds and retry.':detail;
        photoEditStatus('Not saved: '+hint,'error');
        toast('Profile photo not saved: '+hint);
      }
    }finally{avatarUploadBusy=false;}
  }
  // The original HTML photo picker writes only to localStorage. In staging
  // route every profile photo selection through the verified server wallet ID.
  document.addEventListener('click',event=>{
    if(event.target.closest?.('#v-me #pavb, #v-me .mav, #sh #ep, #sh #sharika-photo-preview')){
      event.preventDefault();event.stopImmediatePropagation();
      pickProfilePhoto();
    }
  },true);
  // Profile text edits only complete after a verified D1 response.
  document.addEventListener('click',async event=>{
    const save=event.target.closest?.('#sh #es');
    if(!save)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!session||!profile){toast('Sign in to edit your profile');return;}
    const name=document.getElementById('en')?.value?.trim()||'';
    const bio=document.getElementById('eb')?.value?.trim()||'';
    const status=document.getElementById('sharika-profile-save-status');
    const showStatus=(message,state)=>{
      if(status){status.textContent=message;status.dataset.state=state;}
    };
    if(!name||name.length>80||bio.length>500){
      showStatus('Check your name (1–80) and bio (up to 500 characters).','error');
      return;
    }
    if(save.disabled)return;
    const accountId=session.user.id,publicId=profile.public_id;
    save.disabled=true;
    showStatus('Saving your profile to Sharika…','pending');
    try{
      const saved=await api('PATCH','/me',{name,bio});
      if(session?.user?.id!==accountId||saved.public_id!==publicId)
        throw new Error('Profile identity changed; sign in again');
      profile=saved;
      window.A.name=saved.name;
      window.A.bio=saved.bio||'';
      try{window.saveA();window.renderMe();}
      catch(error){console.warn('Profile saved; display refresh deferred:',errText(error));}
      showStatus('Profile saved ✓','success');
      window.closeSheet();
      toast('Profile saved to your verified ID ✓');
    }catch(error){
      showStatus('Not saved: '+errText(error),'error');
      toast('Profile not saved: '+errText(error));
    }finally{if(save.isConnected)save.disabled=false;}
  },true);
  const priorRenderMe=window.renderMe;
  if(typeof priorRenderMe==='function')window.renderMe=function(){
    priorRenderMe.apply(this,arguments);
    renderVerifiedIdentity();
    renderSellerWalletProfileButton().catch(()=>{});
    mountPremiumProfileEntry().catch(()=>{});
  };
  // Both the old SVIP shortcut and the new profile badge open the one verified
  // membership screen. No localStorage coin minting or demo tier changes.
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-m="svip"]');
    if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    showPremiumSheet().catch(error=>toast(errText(error)));
  },true);
  window.frEl=function(){return frameTag(window.A?.frame||'');};
  window.frameSheet=function(){styleSelectionSheet('frame_style');};
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-m="entry"]');
    if(button){
      event.preventDefault();event.stopImmediatePropagation();
      styleSelectionSheet('entry_style');
    }
  },true);

  // Cloudflare Realtime SFU voice transport; room art and seat UI stay as-is.
  const SHARIKA_ICE_CONFIG={iceServers:[{urls:'stun:stun.cloudflare.com:3478'}]};
  let sfuState = null;
  // Android WebView may block a remote track's first autoplay attempt.
  // A later genuine room tap must retry playback synchronously in that gesture.
  function resumeRoomAudio() {
    if(sfuState && !sfuState.closed) {
      for(const audio of sfuState.audioElements) {
        if(audio.isConnected && audio.srcObject && audio.paused)
          audio.play().catch(()=>{});
      }
    }
    if(voiceRoom && voiceRoomId && typeof voiceRoom.startAudio==='function')
      voiceRoom.startAudio().catch(()=>{});
  }
  const roomAudioGestureDocs=new WeakSet();
  function bindRoomAudioGesture(doc) {
    if(!doc || roomAudioGestureDocs.has(doc))return;
    roomAudioGestureDocs.add(doc);
    doc.addEventListener('pointerdown',resumeRoomAudio,{capture:true,passive:true});
    doc.addEventListener('keydown',resumeRoomAudio,true);
  }
  bindRoomAudioGesture(document);
  const roomAudioFrame=document.getElementById('rf');
  if(roomAudioFrame) {
    roomAudioFrame.addEventListener('load',()=>{
      try{bindRoomAudioGesture(roomAudioFrame.contentDocument);}catch(_){}
    });
    try{bindRoomAudioGesture(roomAudioFrame.contentDocument);}catch(_){}
  }
  let voiceRecoveryRoom=null,voiceRecoveryAttempts=0;
  function recoverSfuPublication(state,reason) {
    if(state.closed||sfuState!==state||wantedVoiceRoom!==state.roomId||state.recoveryTimer)return;
    if(voiceRecoveryRoom!==state.roomId){voiceRecoveryRoom=state.roomId;voiceRecoveryAttempts=0;}
    if(voiceRecoveryAttempts>=3) {
      if(!state.recoveryExhausted){
        state.recoveryExhausted=true;
        document.getElementById('rf')?.contentWindow?.toast?.(
          'Microphone network disconnected. Tap the mic to retry.');
      }
      return;
    }
    const delay=[1200,3000,6000][voiceRecoveryAttempts++];
    console.warn('Sharika mic transport recovery:',reason);
    state.recoveryTimer=setTimeout(()=>{
      state.recoveryTimer=null;
      if(state.closed||sfuState!==state||wantedVoiceRoom!==state.roomId||
         state.publishPC?.connectionState==='connected')return;
      connectVoice(state.roomId).catch(error=>{
        document.getElementById('rf')?.contentWindow?.toast?.(
          'Microphone reconnect failed: '+errText(error));
      });
    },delay);
  }
  async function waitIce(peer) {
    if (peer.iceGatheringState === 'complete') return;
    await new Promise((resolve,reject) => {
      const timeout=setTimeout(()=>{cleanup();reject(new Error('Voice network timeout'));},12000);
      function changed(){ if(peer.iceGatheringState==='complete'){cleanup();resolve();} }
      function cleanup(){clearTimeout(timeout);peer.removeEventListener('icegatheringstatechange',changed);}
      peer.addEventListener('icegatheringstatechange',changed);
      changed();
    });
  }
  async function disconnectSfu() {
    const state=sfuState;
    if(!state)return;
    sfuState=null;
    state.closed=true;
    if(state.timer)clearInterval(state.timer);
    if(state.recoveryTimer)clearTimeout(state.recoveryTimer);
    for(const element of state.audioElements){element.pause();element.srcObject=null;element.remove();}
    if(state.media)for(const track of state.media.getTracks())track.stop();
    for(const pc of [state.publishPC,state.receivePC])if(pc)pc.close();
    if(state.sessionIds.length) {
      try {await api('POST','/rooms/'+state.roomId+'/voice/leave',{sessionIds:state.sessionIds});}
      catch (_) { /* stale sessions expire in the coordinator */ }
    }
  }
  function addAudioTrack(state,event) {
    if(state.closed)return;
    const audio=document.createElement('audio');
    audio.autoplay=true;
    audio.playsInline=true;
    audio.dataset.sharikaVoice='true';
    audio.srcObject=new MediaStream([event.track]);
    document.body.appendChild(audio);
    state.audioElements.add(audio);
    audio.play().catch(error=>{
      if(error?.name==='NotAllowedError' && !state.audioUnlockPrompted) {
        state.audioUnlockPrompted=true;
        document.getElementById('rf')?.contentWindow?.toast?.(
          'Tap anywhere in the room to hear other speakers.');
      }
    });
    event.track.addEventListener('ended',()=>{
      state.audioElements.delete(audio);audio.pause();audio.remove();
    },{once:true});
  }
  async function subscribeSfu(state) {
    if(state.closed || state.syncing)return;
    state.syncing=true;
    try {
      const data=await api('GET','/rooms/'+state.roomId+'/voice/publications');
      const upcoming=(data.publications||[]).filter(x=>x &&
        !state.subscribed.has(x.sessionId+':'+x.trackName));
      if(!upcoming.length)return;
      for(let cursor=0;cursor<upcoming.length;cursor+=8) {
        if(state.closed)return;
        const batch=upcoming.slice(cursor,cursor+8);
        const response=await api('POST','/rooms/'+state.roomId+'/voice/subscribe',{
          sessionId:state.subscribeId,
          publications:batch.map(x=>({sessionId:x.sessionId,trackName:x.trackName}))
        });
        // Map the SFU's receiving MIDs before setRemoteDescription fires "track".
        for(const track of response.tracks||[]) {
          state.remoteMids.set(String(track.mid),track.userId||'');
        }
        await state.receivePC.setRemoteDescription(response.sessionDescription);
        const answer=await state.receivePC.createAnswer();
        await state.receivePC.setLocalDescription(answer);
        await waitIce(state.receivePC);
        await api('PUT','/rooms/'+state.roomId+'/voice/renegotiate',{
          sessionId:state.subscribeId,sessionDescription:state.receivePC.localDescription
        });
        batch.forEach(x=>state.subscribed.add(x.sessionId+':'+x.trackName));
      }
    }catch(error) {
      console.warn('Sharika voice subscriptions:',errText(error));
    }finally {state.syncing=false;}
  }
  async function connectSfu(roomId,canPublish) {
    const state={
      roomId,closed:false,sessionIds:[],publishPC:null,receivePC:null,
      media:null,audioElements:new Set(),remoteMids:new Map(),
      subscribed:new Set(),subscribeId:null,timer:null,syncing:false,
      startedAt:Date.now(),disconnectedAt:0,recoveryTimer:null,recoveryExhausted:false
    };
    sfuState=state;
    try {
      if(canPublish) {
        state.media=await navigator.mediaDevices.getUserMedia({
          audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false
        });
        if(wantedVoiceRoom!==roomId)throw new Error('Voice room changed');
        state.publishPC=new RTCPeerConnection(SHARIKA_ICE_CONFIG);
        const local=state.media.getAudioTracks()[0];
        const transceiver=state.publishPC.addTransceiver(local,{direction:'sendonly'});
        const offer=await state.publishPC.createOffer();
        await state.publishPC.setLocalDescription(offer);
        await waitIce(state.publishPC);
        const published=await api('POST','/rooms/'+roomId+'/voice/session',{mode:'publish'});
        state.sessionIds.push(published.sessionId);
        const negotiation=await api('POST','/rooms/'+roomId+'/voice/publish',{
          sessionId:published.sessionId,
          sessionDescription:state.publishPC.localDescription,
          mid:transceiver.mid,trackName:'microphone'
        });
        await state.publishPC.setRemoteDescription(negotiation.sessionDescription);
        state.startedAt=Date.now();
        // A successful signaling response is not proof that the microphone
        // media path is connected. Monitor ICE and show/retry a broken uplink.
        const checkPublisher=()=>{
          if(state.closed||sfuState!==state)return;
          const status=state.publishPC.connectionState;
          if(status==='connected'){
            if(state.recoveryTimer){clearTimeout(state.recoveryTimer);state.recoveryTimer=null;}
            state.disconnectedAt=0;
            voiceRecoveryAttempts=0;
            markLocalMicrophone(local.readyState==='live'&&local.enabled);
          } else if(status==='disconnected'){
            if(!state.disconnectedAt)state.disconnectedAt=Date.now();
          } else if(status==='failed'){
            markLocalMicrophone(false);
            recoverSfuPublication(state,'publisher connection failed');
          }
        };
        state.publishPC.addEventListener('connectionstatechange',checkPublisher);
        state.publishPC.addEventListener('iceconnectionstatechange',checkPublisher);
        local.addEventListener('ended',()=>{
          if(!state.closed)recoverSfuPublication(state,'microphone track ended');
        },{once:true});
        checkPublisher();
      }
      if(wantedVoiceRoom!==roomId)throw new Error('Voice room changed');
      const joined=await api('POST','/rooms/'+roomId+'/voice/session',{mode:'subscribe'});
      state.subscribeId=joined.sessionId;
      state.sessionIds.push(joined.sessionId);
      state.receivePC=new RTCPeerConnection(SHARIKA_ICE_CONFIG);
      state.receivePC.ontrack=event=>addAudioTrack(state,event);
      await subscribeSfu(state);
      // Refresh both presence and publications; do not consume room resources
      // on a tight per-frame timer.
      state.timer=setInterval(()=>{
        if(state.closed)return;
        api('POST','/rooms/'+roomId+'/voice/heartbeat',{sessionIds:state.sessionIds}).catch(()=>{});
        subscribeSfu(state).catch(()=>{});
        if(state.publishPC){
          const pc=state.publishPC,connection=pc.connectionState;
          const broken=connection==='failed'||pc.iceConnectionState==='failed'||
            (connection==='disconnected'&&state.disconnectedAt&&Date.now()-state.disconnectedAt>12000)||
            (connection!=='connected'&&Date.now()-state.startedAt>30000)||
            state.media?.getAudioTracks()[0]?.readyState==='ended';
          if(broken){
            markLocalMicrophone(false);
            recoverSfuPublication(state,'publisher media path unavailable');
          }
        }
      },8000);
      return {publishing:canPublish};
    }catch(error){
      await disconnectSfu();
      throw error;
    }
  }

  async function voiceSdk() {
    if (window.LivekitClient) return window.LivekitClient;
    if (!voiceSdkPromise) {
      voiceSdkPromise = new Promise((resolve,reject)=>{
        const script = document.createElement('script');
        // The version is pinned; only fetched when a Sharika-scoped token is
        // available. Never load the live user's Supabase voice adapter.
        script.src='https://cdn.jsdelivr.net/npm/livekit-client@2.23.0/dist/livekit-client.umd.min.js';
        script.onload=()=>window.LivekitClient ?
          resolve(window.LivekitClient) : reject(new Error('LiveKit SDK unavailable'));
        script.onerror=()=>reject(new Error('LiveKit SDK could not load'));
        document.head.appendChild(script);
      });
    }
    return voiceSdkPromise;
  }
  async function disconnectVoice() {
    if(sfuState)await disconnectSfu();
    voiceBackend=null;
    if(!voiceRoom)return;
    const room=voiceRoom;
    voiceRoom=null;voiceRoomId=null;
    await room.disconnect();
  }
  // One connection transition at a time: seat/poll callbacks can fire together.
  // Switching rooms or leaving invalidates stale async connection attempts.
  let voiceOperation=Promise.resolve(),pendingVoice=null,wantedVoiceRoom=null;
  function releaseVoice() {
    wantedVoiceRoom=null;
    const task=voiceOperation.catch(()=>{}).then(()=>disconnectVoice());
    voiceOperation=task;
    return task;
  }
  async function connectVoice(roomId) {
    if(pendingVoice?.roomId===roomId)return pendingVoice.promise;
    wantedVoiceRoom=roomId;
    const task=voiceOperation.catch(()=>{}).then(async()=>{
      if(wantedVoiceRoom!==roomId)return {publishing:false,stale:true};
      const config=await api('GET','/rooms/'+roomId+'/voice/config');
      if(wantedVoiceRoom!==roomId)return {publishing:false,stale:true};
      await disconnectVoice();
      if(wantedVoiceRoom!==roomId)return {publishing:false,stale:true};
      if(config.provider==='cloudflare_sfu') {
        voiceBackend='cloudflare_sfu';
        return connectSfu(roomId,!!config.publish);
      }
      if(config.provider!=='livekit')throw new Error('Voice provider unavailable');
      // Keep the isolated LiveKit fallback only when explicitly configured.
      const info=await api('POST','/rooms/'+roomId+'/voice-token',{});
      const sdk=await voiceSdk();
      if(wantedVoiceRoom!==roomId)return {publishing:false,stale:true};
      voiceBackend='livekit';
      const room=new sdk.Room({
        audioCaptureDefaults:{echoCancellation:true,noiseSuppression:true}
      });
      room.on(sdk.RoomEvent.TrackSubscribed,(track)=>{
        if(track.kind===sdk.Track.Kind.Audio) {
          const element=track.attach();
          element.autoplay=true;
          element.dataset.sharikaVoice='true';
          document.body.appendChild(element);
        }
      });
      room.on(sdk.RoomEvent.TrackUnsubscribed,(track)=>{
        track.detach().forEach(node=>node.remove());
      });
      room.on(sdk.RoomEvent.ActiveSpeakersChanged,(speakers)=>{
        const frame=document.getElementById('rf')?.contentWindow;
        if(!frame || !frame.seats)return;
        const talking=new Set(speakers.map(p=>p.identity));
        for(const seat of frame.seats){
          if(seat && seat.user_id)seat.talk=talking.has('sharika:'+seat.user_id);
        }
        if(typeof frame.render==='function')frame.render();
      });
      try{await room.connect(info.url,info.token);}
      catch(error){await room.disconnect().catch(()=>{});throw error;}
      if(wantedVoiceRoom!==roomId) {
        await room.disconnect().catch(()=>{});
        return {publishing:false,stale:true};
      }
      voiceRoom=room;voiceRoomId=roomId;
      try{await room.startAudio();}catch(_){}
      if(info.publish)await room.localParticipant.setMicrophoneEnabled(true);
      return {publishing:!!info.publish};
    });
    voiceOperation=task;
    pendingVoice={roomId,promise:task};
    try {
      const result=await task;
      if(!result.stale && wantedVoiceRoom===roomId)markLocalMicrophone(!!result.publishing);
      return result;
    } finally {
      if(pendingVoice?.promise===task)pendingVoice=null;
    }
  }
  function markLocalMicrophone(enabled) {
    const frame=document.getElementById('rf')?.contentWindow;
    if(!frame||!Array.isArray(frame.seats))return;
    const localSeat=frame.seats.find(slot=>slot?.user_id===session?.user?.id);
    if(localSeat) {
      localSeat.muted=!enabled;
      if(typeof frame.render==='function')frame.render();
    }
    const mic=frame.$?.('mic');
    if(mic) {
      mic.textContent=enabled?'🎤':'🔇';
      mic.classList.toggle('off',!enabled);
    }
  }
  async function restartMicrophone(roomId) {
    if(!roomId)throw new Error('Join a voice room first');
    const config=await api('GET','/rooms/'+roomId+'/voice/config');
    if(!config.publish)throw new Error('Take an unlocked mic seat first');
    voiceRecoveryAttempts=0;
    const result=await connectVoice(roomId);
    if(!result.publishing)throw new Error('Microphone connection not ready; tap again');
    if(sfuState?.roomId===roomId){
      const track=sfuState.media?.getAudioTracks()[0];
      if(!track||track.readyState!=='live')throw new Error('Microphone capture unavailable');
      track.enabled=true;
    } else if(voiceRoomId===roomId&&voiceRoom){
      await voiceRoom.localParticipant.setMicrophoneEnabled(true);
    } else throw new Error('Microphone transport not available');
    markLocalMicrophone(true);
    return true;
  }
  async function toggleVoice() {
    if(sfuState) {
      const failed=sfuState.recoveryExhausted||
        ['failed','disconnected'].includes(sfuState.publishPC?.connectionState);
      const track=sfuState.media?.getAudioTracks()[0];
      // Permission may have been granted after the first room connection
      // attempt; the mic button must be able to establish a publisher then.
      if(failed||!track||track.readyState!=='live')
        return restartMicrophone(sfuState.roomId);
      track.enabled=!track.enabled;
      markLocalMicrophone(track.enabled);
      return track.enabled;
    }
    if(!voiceRoom || !voiceRoomId)
      return restartMicrophone(window.cur?.id||wantedVoiceRoom);
    const currently=voiceRoom.localParticipant.isMicrophoneEnabled;
    await voiceRoom.localParticipant.setMicrophoneEnabled(!currently);
    markLocalMicrophone(!currently);
    return !currently;
  }
  function cleanLocalFakeState() {
    try {
      localStorage.removeItem('vr_guest');
      localStorage.removeItem('sharika_supabase_session_v1');
      localStorage.removeItem('vr_state_v2');
      localStorage.removeItem('vr_sess');
      localStorage.removeItem('vr_app_v1');
      // An isolated staging build must never import the HTML demo accounts.
      localStorage.setItem(ACCOUNT_KEY, '[]');
    } catch (_) {}
    window.CFG.rooms = [];
    window.CFG.people = [];
    window.CFG.chats = [];
    window.CFG.wealth = [];
    window.renderRooms();
  }
  function remember(account, current) {
    profile = current;
    const key = String(account.email || current.user_id || '').toLowerCase();
    const local = {
      key,
      p: {
        id: current.public_id, name: current.name, pic: current.pic || null,
        country: current.country || '', dob: current.birthdate || '',
        minor: !!current.minor, cover: current.cover || null, bio: current.bio || '',
        frame: current.frame_style || '', entry: current.entry_style || '',
        cosmeticMedal: current.medal_style || '', cosmeticTag: current.name_tag_style || '',
        frameImg: null,
        myRoom: null, claim: { d:'', streak:0 }
      },
      state: { coins:current.coins || 0, dia:current.diamonds || 0, xp:current.xp || 0 }
    };
    balance = { ...local.state };
    session = { email: account.email, user: { id:current.user_id, email:account.email } };
    startPresence();
    refreshVerifiedBanners().catch(error=>console.warn('Banner refresh unavailable:',errText(error)));
    try {
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify([local]));
      localStorage.setItem('vr_state_v2', JSON.stringify(balance));
    } catch (_) {}
    return local;
  }
  function cachedSignup(email) {
    try {
      const record = JSON.parse(localStorage.getItem(META_KEY) || 'null');
      return record && record.email === email ? record : null;
    } catch (_) { return null; }
  }
  function birthdateFromUi(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use YYYY-MM-DD for your date of birth');
    return value;
  }
  function profileForm(account) {
    return new Promise((resolve, reject) => {
      const layer = document.createElement('div');
      layer.id = 'sharika-stage-profile-setup';
      layer.style.cssText = 'position:fixed;z-index:2147483646;inset:0;background:#0c0920f5;display:flex;align-items:center;justify-content:center;padding:22px;color:white;font-family:inherit';
      layer.innerHTML = '<form style="width:min(100%,410px);background:linear-gradient(160deg,#2d2158,#131530);border:1px solid #6754c0;border-radius:24px;padding:24px;box-shadow:0 15px 45px #0008">' +
        '<h2 style="margin:0 0 8px">Finish your Sharika profile</h2>' +
        '<p style="font-size:13px;opacity:.8">A real name and birth date are needed for the new staging account. Existing accounts are not imported.</p>' +
        '<label>Name<input name="name" maxlength="80" required style="box-sizing:border-box;width:100%;margin:8px 0 16px;padding:13px;border-radius:10px;background:#fff;color:#161121;border:0" value=""></label>' +
        '<label>Birth date<input name="birthdate" type="date" required style="box-sizing:border-box;width:100%;margin:8px 0 16px;padding:13px;border-radius:10px;background:#fff;color:#161121;border:0"></label>' +
        '<label>Country<input name="country" maxlength="16" placeholder="BD" style="box-sizing:border-box;width:100%;margin:8px 0 16px;padding:13px;border-radius:10px;background:#fff;color:#161121;border:0"></label>' +
        '<label>Invite code (optional)<input name="invite_code" maxlength="8" inputmode="numeric" placeholder="8-digit inviter ID" style="box-sizing:border-box;width:100%;margin:8px 0 16px;padding:13px;border-radius:10px;background:#fff;color:#161121;border:0"></label>' +
        '<div id="stage-profile-error" style="color:#ffb4b4;font-size:13px"></div>' +
        '<button type="submit" style="width:100%;padding:15px;border:0;border-radius:14px;background:#8e72f6;color:#fff;font-weight:700">Create staging profile</button>' +
        '<button type="button" id="stage-profile-cancel" style="width:100%;padding:13px;border:0;background:transparent;color:#ddd">Cancel</button></form>';
      document.body.appendChild(layer);
      const name = layer.querySelector('[name="name"]');
      name.value = account.displayName || '';
      layer.querySelector('[name="invite_code"]').value=cachedSignup(account.email)?.invite_code||'';
      let finished = false;
      function close() { if (finished) return; finished = true; layer.remove(); }
      layer.querySelector('#stage-profile-cancel').onclick = () => {
        close(); reject(new Error('Profile setup cancelled'));
      };
      layer.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector('[type=submit]');
        button.disabled = true;
        try {
          const data = {
            name:form.elements.name.value.trim(),
            birthdate:birthdateFromUi(form.elements.birthdate.value),
            country:form.elements.country.value.trim(),
            invite_code:form.elements.invite_code.value.trim()
          };
          const saved = await api('POST','/me',data);
          close(); resolve(saved);
        } catch (error) {
          layer.querySelector('#stage-profile-error').textContent = errText(error);
          button.disabled = false;
        }
      };
    });
  }
  async function ensureProfile(account, form) {
    try { return await api('GET', '/me'); }
    catch (error) {
      if (errText(error) !== 'profile_not_found') throw error;
      const cached = form || cachedSignup(account.email);
      if (cached && cached.name && cached.dob) {
        try{
          const saved = await api('POST','/me',{
            name:cached.name,birthdate:cached.dob,country:cached.country||'',
            invite_code:cached.invite_code||''
          });
          try{localStorage.removeItem(META_KEY);}catch(_){}
          return saved;
        }catch(error){
          if(!['invalid_invite_code','invite_code_not_found','cannot_invite_self'].includes(errText(error)))
            throw error;
          // A typed invite code can be corrected without making a fake account.
        }
      }
      return profileForm(account);
    }
  }
  async function authenticated(account, form) {
    if (!account.signedIn || !account.emailVerified)
      throw new Error('Check your email verification link, then sign in again');
    const current = await ensureProfile(account, form);
    const local = remember(account, current);
    await Promise.allSettled([reloadWallet(), reloadRooms()]);
    // The original UI's login function reconstructs A from this object;
    // carry the real room back so it does not hide the newly loaded own room.
    local.p.myRoom = window.A.myRoom || null;
    local.state = {...balance};
    try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify([local])); } catch (_) {}
    // Show the real new-member referral offer after the authenticated home loads.
    setTimeout(maybeShowNewUserInviteWelcome,2200);
    return local;
  }


  // Add one optional field to the original themed signup card; no layout redesign.
  function ensureInviteCodeInput(){
    const auth=document.getElementById('au');
    const terms=auth?.querySelector('.tc');
    if(!terms||auth.querySelector('#stage-invite-code'))return;
    terms.insertAdjacentHTML('beforebegin',
      '<div class="lbl">Invite code (optional)</div>'+
      '<input class="field" id="stage-invite-code" maxlength="8" inputmode="numeric" '+
      'placeholder="Inviter 8-digit Sharika ID" autocomplete="off">');
  }
  const inviteAuthRoot=document.getElementById('au');
  if(inviteAuthRoot){
    const inviteObserver=new MutationObserver(ensureInviteCodeInput);
    inviteObserver.observe(inviteAuthRoot,{childList:true});
    ensureInviteCodeInput();
  }

  window.API.signup = async function (form) {
    if (!form.key || !form.key.includes('@'))
      return { ok:false, msg:'Use an email address. Phone OTP is not enabled yet.' };
    if (String(form.pw || '').length < 12)
      return { ok:false, msg:'Use at least 12 characters for your password.' };
    try {
      const result = await native('emailSignUp', {email:form.key.trim(), password:form.pw});
      try {
        localStorage.setItem(META_KEY, JSON.stringify({
          email:form.key.trim(), name:form.name, dob:form.dob, country:form.country,
          invite_code:document.getElementById('stage-invite-code')?.value.trim()||''
        }));
      } catch (_) {}
      return { ok:false, msg:result.verificationSent ?
        'Account created. Verify your email, then log in.' :
        'Account created. Verification email could not be sent; try again later.' };
    } catch (error) { return { ok:false, msg:errText(error) }; }
  };
  window.API.login = async function (identity, password) {
    if (!identity.includes('@')) return {ok:false,msg:'Sign in using your email address'};
    try {
      const account = await native('emailSignIn',{email:identity.trim(),password});
      const local = await authenticated(account);
      return {ok:true,acct:local};
    } catch (error) { return {ok:false,msg:errText(error)}; }
  };
  async function googleLogin() {
    try {
      toast('Opening Google account picker…');
      const account = await native('googleSignIn');
      const local = await authenticated(account);
      window.enter(local,'Signed in to Sharika staging');
    } catch (error) { toast(errText(error)); }
  }

  // Keep original login imagery, forms, colors, and navigation.
  const previousAuthRender = window.authRender;
  window.authRender = function () {
    previousAuthRender();
    const google = document.getElementById('wg');
    if (google) google.onclick = googleLogin;
    for (const id of ['wgs','ag']) {
      const guest = document.getElementById(id);
      if (guest) {
        guest.disabled = true;
        guest.style.display = 'none';
      }
    }
    const notice = document.querySelector('#au .aw > .lbl:last-child');
    if (notice) notice.textContent = 'Accounts use real Firebase Authentication and isolated Cloudflare staging.';
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (['wgs','ag'].includes(button.id)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toast('Sign in to use Sharika');
    }
  }, true);

  window.RS = function () { return {...balance}; };
  window.addCoins = function () { toast('Coin changes require the verified server'); };
  window.addDia = function () { toast('Diamond changes require the verified server'); };
  // Authenticated users only: a backgrounded app disappears after 90 seconds.
  let presenceTimer=null;
  async function heartbeatPresence(roomId) {
    if(!session)return;
    try {
      await api('POST','/presence/heartbeat',{
        room_id:roomId===undefined?(window.cur?.id||null):roomId
      });
    }catch(error){console.warn('Sharika presence:',errText(error));}
  }
  function startPresence(){
    if(presenceTimer)clearInterval(presenceTimer);
    heartbeatPresence(null);
    presenceTimer=setInterval(()=>{
      heartbeatPresence();
      // Refresh real room-card counters without changing the original cards.
      if(!window.cur && document.visibilityState==='visible')reloadRooms().catch(()=>{});
    },25000);
  }
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState!=='visible'||!session)return;
    heartbeatPresence();
    const frame=document.getElementById('rf')?.contentWindow;
    if(window.cur?.id && frame?.seats)
      syncFrame(window.cur,frame).catch(()=>{});
  });
  async function reloadWallet() {
    const wallet = await api('GET','/wallet');
    balance = {coins:Number(wallet.coins)||0,dia:Number(wallet.diamonds)||0,xp:Number(wallet.xp)||0};
    localStorage.setItem('vr_state_v2',JSON.stringify(balance));
    window.refresh();
    return wallet;
  }
  async function refreshWalletAfterConfirmedTransaction(snapshot=null) {
    const accountId=session?.user?.id;
    try{await reloadWallet();return true;}
    catch(error){
      // Once D1 confirms a debit/credit, never claim it failed just because
      // a subsequent wallet read or local display refresh had an outage.
      if(session?.user?.id!==accountId)return false;
      if(snapshot&&Number.isSafeInteger(snapshot.coins)&&snapshot.coins>=0)
        balance.coins=snapshot.coins;
      if(snapshot&&Number.isSafeInteger(snapshot.diamonds)&&snapshot.diamonds>=0)
        balance.dia=snapshot.diamonds;
      if(snapshot&&Number.isSafeInteger(snapshot.xp)&&snapshot.xp>=0)
        balance.xp=snapshot.xp;
      try{localStorage.setItem('vr_state_v2',JSON.stringify(balance));window.refresh();}
      catch(e){console.warn('Wallet display refresh deferred:',errText(e));}
      console.warn('Confirmed transaction; wallet refresh delayed:',errText(error));
      return false;
    }
  }
  let roomsRequestNo=0;
  async function reloadRooms() {
    if (!session) return;
    // Room creation and settings saves must always request a fresh list.
    // An earlier background poll may finish later, but cannot undo it.
    const requestNo=++roomsRequestNo;
    const userId=session.user.id;
    try {
      const data = await api('GET','/rooms');
      if(requestNo!==roomsRequestNo || session?.user?.id!==userId)return;
      const rows = data.rooms || [];
      const own = rows.find(r => r.owner_id === userId);
      window.CFG.rooms = rows.filter(r => r.owner_id !== userId).map((r,i)=>({
        id:r.id,name:r.name,emoji:r.emoji || '🎙️',n:Number(r.online_count)||0,host:'Room owner',
        tag:'Voice Room',mics:[],c:COLORS[i%COLORS.length],
        th:r.theme || 'mid',owner_id:r.owner_id,seat_count:r.seat_count,
        seat_frame_style:r.seat_frame_style||'grad',cover_url:r.cover_url||null
      }));
      window.A.myRoom = own ? {
        id:own.id,name:own.name,emoji:own.emoji,th:own.theme,
        c:COLORS[0],owner_id:own.owner_id,seat_count:own.seat_count,
        seat_frame_style:own.seat_frame_style||'grad',
        n:Number(own.online_count)||0,cover_url:own.cover_url||null
      } : null;
      window.renderRooms();
    } catch (error) {
      if(requestNo===roomsRequestNo && session?.user?.id===userId)
        toast('Rooms unavailable: '+errText(error));
    }
  }
  // Android's system picker grants selected-image access; no blanket
  // gallery/storage permission or native device file path is exposed to JS.
  const COVER_ORIGIN='https://sharika-api-staging.soverixnet.workers.dev';
  function verifiedCoverUrl(value){
    return typeof value==='string' &&
      /^https:\/\/sharika-api-staging\.soverixnet\.workers\.dev\/api\/v1\/rooms\/[0-9]{8}\/cover\?v=[0-9]+$/.test(value)
      ?value:null;
  }
  function verifiedThemeUrl(value){
    return typeof value==='string' &&
      /^https:\/\/sharika-api-staging\.soverixnet\.workers\.dev\/api\/v1\/rooms\/[0-9]{8}\/(cover|theme-image)\?v=[0-9]+$/.test(value)
      ?value:null;
  }
  async function jpegRoomPreview(file,highDefinition=false){
    if(!file||!file.type.startsWith('image/')||file.size>15*1024*1024)
      throw new Error('Choose an image smaller than 15 MB');
    const blobUrl=URL.createObjectURL(file);
    const photo=new Image();
    try{
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Image loading timed out')),20000);
        photo.onload=()=>{clearTimeout(timeout);resolve();};
        photo.onerror=()=>{clearTimeout(timeout);reject(new Error('Image could not be opened'));};
        photo.src=blobUrl;
      });
      const sourceWidth=photo.naturalWidth,sourceHeight=photo.naturalHeight;
      if(!sourceWidth||!sourceHeight)throw new Error('Invalid image dimensions');
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      if(!ctx)throw new Error('Image editor is unavailable');
      const sides=highDefinition?[1920,1600,1440,1280,1080,900]:
        [900,720,600,480,360,280];
      const qualities=highDefinition?[.90,.82,.74,.64]:[.76,.60,.45];
      const maxLength=highDefinition?600023:120023;
      for(const side of sides){
        const scale=Math.min(1,side/Math.max(sourceWidth,sourceHeight));
        canvas.width=Math.max(1,Math.round(sourceWidth*scale));
        canvas.height=Math.max(1,Math.round(sourceHeight*scale));
        ctx.imageSmoothingEnabled=true;
        ctx.imageSmoothingQuality='high';
        ctx.fillStyle='#161029';ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(photo,0,0,canvas.width,canvas.height);
        for(const quality of qualities){
          const preview=canvas.toDataURL('image/jpeg',quality);
          if(preview.startsWith('data:image/jpeg;base64,')&&preview.length<=maxLength)
            return preview;
        }
      }
      throw new Error('Photo too large after resizing');
    }finally{URL.revokeObjectURL(blobUrl);}
  }
  let coverUploadBusy=false;
  function pickRoomCover(room,frame=null,useAsTheme=false){
    if(!session||room?.owner_id!==session.user.id){
      toast('Only the room owner can change its cover photo');return;
    }
    if(coverUploadBusy){toast('Room photo upload is already running');return;}
    const picker=document.createElement('input');
    picker.type='file';picker.accept='image/*';
    picker.style.cssText='position:fixed;opacity:0;left:-10000px;top:0';
    document.body.appendChild(picker);
    picker.addEventListener('cancel',()=>picker.remove(),{once:true});
    picker.onchange=async()=>{
      const file=picker.files?.[0];picker.remove();
      if(!file)return;
      coverUploadBusy=true;
      toast('Preparing your room photo…');
      try{
        // The full-room wallpaper needs far more detail than the small card.
        // Keep both assets separate, but retain the existing card-cover route.
        if(useAsTheme || room.th==='photo'){
          const hd_image_data=await jpegRoomPreview(file,true);
          await api('PUT','/rooms/'+room.id+'/theme-image',{image_data:hd_image_data});
        }
        const image_data=await jpegRoomPreview(file);
        const saved=await api('PUT','/rooms/'+room.id+'/cover',{image_data});
        room.cover_url=verifiedCoverUrl(saved.cover_url);
        if(frame?.S)frame.S.pic=room.cover_url;
        const preview=frame?.$?.('pbig');
        if(preview&&room.cover_url){
          preview.style.backgroundImage='url("'+room.cover_url+'")';
          preview.style.backgroundSize='cover';
          preview.textContent='';
        }
        if(useAsTheme){
          // Gallery artwork is a verified room image, never a device-local
          // data URL. Reuse its versioned room-cover asset for all guests.
          const result=await api('PATCH','/rooms/'+room.id,{theme:'photo'});
          if(result.room?.theme!=='photo')
            throw new Error('Shared room background was not confirmed');
          room.th='photo';
          if(frame?.S && window.cur?.id===room.id)
            await syncFrame(room,frame).catch(error=>
              console.warn('Theme saved; room refresh delayed:',errText(error)));
        }
        await reloadRooms().catch(error=>
          console.warn('Room photo saved; card refresh delayed:',errText(error)));
        if(useAsTheme && frame?.$?.('sheet')?.querySelector('h3')?.textContent?.includes('Room theme'))
          frame.themeSheet();
        toast(useAsTheme?'Room background saved for everyone ✓':
          'Room photo saved · visible on room cards ✓');
      }catch(error){toast((useAsTheme?'Room background':'Room photo')+
        ' not fully saved: '+errText(error));}
      finally{coverUploadBusy=false;}
    };
    picker.click();
  }
  function drawVerifiedRoomCards(){
    const rooms=[...(window.CFG.rooms||[]),window.A?.myRoom].filter(Boolean);
    for(const card of document.querySelectorAll('#grid .card[data-id]')){
      const room=rooms.find(r=>r.id===card.dataset.id);
      if(!room)continue;
      const image=verifiedCoverUrl(room.cover_url);
      if(image){
        const background=card.querySelector('.bg');
        if(background){
          background.style.backgroundImage='linear-gradient(180deg,transparent 35%,rgba(7,4,26,.55)),url("'+image+'")';
          background.style.backgroundSize='cover';
          background.style.backgroundPosition='center';
          const pattern=background.querySelector('.pat');
          if(pattern)pattern.style.opacity='0';
        }
        const emoji=card.querySelector('.emo');if(emoji)emoji.style.display='none';
      }
      if(room.owner_id===session?.user?.id&&!card.querySelector('.sh-room-cover-edit')){
        const button=document.createElement('button');
        button.type='button';button.className='sh-room-cover-edit';
        button.textContent='📷 Edit photo';
        button.setAttribute('aria-label','Add or change room cover photo');
        button.style.cssText='position:absolute;z-index:30;top:8px;right:8px;'+
          'border:1px solid #fff9;border-radius:12px;background:#140b35d9;'+
          'color:#fff;padding:7px 9px;font-size:12px;font-weight:700';
        button.onpointerdown=e=>e.stopPropagation();
        button.onclick=e=>{e.preventDefault();e.stopPropagation();pickRoomCover(room);};
        card.style.position='relative';card.appendChild(button);
      }
    }
  }
  // Original tab/search handlers call their lexical renderRooms binding rather
  // than window.renderRooms; observe only direct grid child changes too.
  const coverGrid=document.getElementById('grid');
  if(coverGrid)new MutationObserver(()=>drawVerifiedRoomCards())
    .observe(coverGrid,{childList:true});
  const originalRenderRoomsWithCards=window.renderRooms;
  window.renderRooms=function(...args){
    const result=originalRenderRoomsWithCards.apply(this,args);
    drawVerifiedRoomCards();
    return result;
  };
  function decorateBondSeatOverlay(frame,pairs){
    const doc=frame?.document;
    if(!doc?.body)return;
    doc.getElementById('sh-bond-seat-links')?.remove();
    const active=(pairs||[]).filter(pair=>
      (frame.seats||[]).some(s=>s?.public_id===pair.a_id)&&
      (frame.seats||[]).some(s=>s?.public_id===pair.b_id)).slice(0,9);
    if(!active.length)return;
    const NS='http://www.w3.org/2000/svg';
    const width=doc.documentElement.scrollWidth;
    const height=doc.documentElement.scrollHeight;
    const svg=doc.createElementNS(NS,'svg');svg.id='sh-bond-seat-links';
    svg.setAttribute('viewBox','0 0 '+width+' '+height);
    svg.setAttribute('aria-hidden','true');
    svg.style.cssText='position:absolute;top:0;left:0;width:'+width+'px;height:'+height+
      'px;z-index:6;pointer-events:none;overflow:visible;opacity:.95';
    for(const pair of active){
      const seatA=frame.seats.find(s=>s?.public_id===pair.a_id);
      const seatB=frame.seats.find(s=>s?.public_id===pair.b_id);
      const faceA=frame.seatEl?.(seatA.i)?.querySelector('.av');
      const faceB=frame.seatEl?.(seatB.i)?.querySelector('.av');
      if(!faceA||!faceB)continue;
      const a=faceA.getBoundingClientRect(),b=faceB.getBoundingClientRect();
      const x1=a.left+a.width/2+frame.scrollX,y1=a.top+a.height/2+frame.scrollY;
      const x2=b.left+b.width/2+frame.scrollX,y2=b.top+b.height/2+frame.scrollY;
      const midX=(x1+x2)/2,midY=(y1+y2)/2-24;
      const path=doc.createElementNS(NS,'path');
      path.setAttribute('d','M '+x1+' '+y1+' Q '+midX+' '+(midY-16)+' '+x2+' '+y2);
      path.setAttribute('stroke',pair.type==='cp'?'#ff9bc9':'#8edaff');
      path.setAttribute('stroke-width',pair.type==='cp'?'3':'2');
      path.setAttribute('stroke-dasharray',pair.type==='cp'?'':'5 5');
      path.setAttribute('fill','none');path.setAttribute('opacity','.72');
      path.style.filter='drop-shadow(0 0 5px '+(pair.type==='cp'?'#ff60b4':'#5ed7ff')+')';
      const icon=doc.createElementNS(NS,'text');
      icon.setAttribute('x',midX);icon.setAttribute('y',midY);
      icon.setAttribute('text-anchor','middle');icon.setAttribute('font-size','29');
      icon.style.filter='drop-shadow(0 3px 7px #10031d)';
      icon.textContent=pair.type==='cp'?'💞':'🤝';
      svg.append(path,icon);
    }
    doc.body.appendChild(svg);
  }
  async function syncFrame(room,frame) {
    if (!frame || !frame.seats || !window.cur || window.cur.id !== room.id) return;
    // Out-of-order room polls cannot restore stale seats or old cosmetics.
    const requestNo=(frame.__sharikaSeatSyncNo||0)+1;
    frame.__sharikaSeatSyncNo=requestNo;
    const userId=session?.user?.id;
    const [data,owner] = await Promise.all([
      api('GET','/rooms/'+room.id+'/members'),
      api('GET','/users/'+room.id)
    ]);
    if(frame.__sharikaSeatSyncNo!==requestNo ||
       !session || session.user.id!==userId || window.cur?.id!==room.id ||
       document.getElementById('rf')?.contentWindow!==frame)return;
    const self=(data.members||[]).find(m=>m.user_id===session?.user?.id);
    const eligible=room.owner_id===session?.user?.id||
      (!!self && self.seat_no!==null && !self.muted);
    if(sfuState?.roomId===room.id && !!sfuState.media!==!!eligible)
      connectVoice(room.id).catch(error=>frame.toast('Voice update: '+errText(error)));
    const localMic=sfuState?.roomId===room.id ?
      sfuState.media?.getAudioTracks()[0]?.enabled :
      voiceRoomId===room.id&&voiceRoom ?
        voiceRoom.localParticipant.isMicrophoneEnabled : undefined;
    // A room's seat limit belongs to the server, not iframe localStorage.
    // This also updates guests who remain in the room while its owner edits it.
    if(Number.isInteger(data.seat_count)&&data.seat_count>=4&&data.seat_count<=20)
      room.seat_count=data.seat_count;
    if(['grad','gold','neon','sq'].includes(data.seat_frame_style))
      room.seat_frame_style=data.seat_frame_style;
    const chosenSeatFrame=room.seat_frame_style||'grad';
    // Theme is authoritative in the shared room snapshot. Neither the
    // owner's phone nor a guest's stale localStorage may override it.
    const chosenTheme=['mid','gold','ocean','rose','forest','sunset','photo']
      .includes(data.theme)?data.theme:'mid';
    const sharedImage=chosenTheme==='photo'
      ?verifiedThemeUrl(data.theme_background_url):null;
    const palette=chosenTheme==='photo'?'mid':chosenTheme;
    const themeChanged=room.th!==chosenTheme||frame.S.theme!==palette||
      frame.S.bg!==sharedImage||frame.S.frame!==chosenSeatFrame;
    room.th=chosenTheme;
    frame.S.theme=palette;
    frame.S.bg=sharedImage;
    frame.S.frame=chosenSeatFrame;
    if(themeChanged&&typeof frame.applyTheme==='function')frame.applyTheme();
    const slots = Array.from({length: Math.max(2,Number(room.seat_count||12)+1)},
      (_,i)=>({empty:1,i}));
    slots[0]={n:owner.name,e:'👑',pic:verifiedAvatarUrl(owner.pic),i:0,
      user_id:room.owner_id,public_id:room.id,
      muted:room.owner_id===session?.user?.id&&localMic===false,talk:false,
      frame_style:owner.frame_style||'',entry_style:owner.entry_style||'',
      medal_style:owner.medal_style||'',name_tag_style:owner.name_tag_style||''};
    const audience=[];
    for(const member of data.members || []) {
      const user=member.sharika_users;
      if(!user || member.user_id===room.owner_id) continue;
      if(Number.isInteger(member.seat_no) && member.seat_no>0 && member.seat_no<slots.length)
        slots[member.seat_no]={
          n:user.name,e:'👤',pic:verifiedAvatarUrl(user.pic),i:member.seat_no,
          user_id:member.user_id,public_id:user.public_id,
          muted:!!member.muted||(member.user_id===session?.user?.id&&localMic===false),talk:false,
          frame_style:user.frame_style||'',entry_style:user.entry_style||'',
          medal_style:user.medal_style||'',name_tag_style:user.name_tag_style||''
        };
      else audience.push({n:user.name,e:'👤',id:user.public_id,
        pic:verifiedAvatarUrl(user.pic),lv:user.wealth_level,
        frame_style:user.frame_style||'',entry_style:user.entry_style||'',
        medal_style:user.medal_style||'',name_tag_style:user.name_tag_style||''});
    }
    for(const seatNo of data.locked_seats||[]) {
      if(Number.isInteger(seatNo)&&seatNo>0&&seatNo<slots.length&&slots[seatNo].empty)
        slots[seatNo]={lock:1,i:seatNo};
    }
    frame.seats=slots;
    frame.U=audience;
    frame.S.coins=balance.coins;
    frame.S.xp=balance.xp;
    frame.S.n=slots.length;
    frame.render();
    decorateRoomPeople(frame);
    decorateRoomChat(frame);
    if(typeof decorateBondSeatOverlay==='function')
      decorateBondSeatOverlay(frame,data.bond_pairs);
    // Arrival effects come from the coordinator's short, verified event
    // history, not the 15-second seat/member snapshot that misses guests.
    frame.__soveraSeenMembers=new Set((data.members||[]).map(m=>m.user_id));
  }
  // Profile identity always follows the authenticated room member ID. The
  // original HTML treated seat zero as "my profile" even in another's room.
  async function openVerifiedRoomMemberProfile(publicId,roomId,seatNo=null) {
    if(!session||!/^[0-9]{8}$/.test(String(publicId||''))||window.cur?.id!==roomId)
      throw new Error('Verified room profile unavailable');
    const member=await api('GET','/users/'+publicId);
    if(String(member.id)!==String(publicId)||window.cur?.id!==roomId)
      throw new Error('Room member identity changed');
    const frame=document.getElementById('rf')?.contentWindow;
    if(Number.isInteger(seatNo) && seatNo>=0 &&
       String(frame?.seats?.[seatNo]?.public_id||'')!==String(publicId))
      throw new Error('Seat occupant has changed');
    window.openProfile({id:String(member.id),n:String(member.name||'Member'),
      e:'👤',lv:Number(member.wealth_level)||1});
    const root=document.getElementById('pfc');
    if(!root)return;
    // The original non-owner profile model invents age, gifts, followers and
    // badges. Do not present those demo numbers as verified public records.
    paintVerifiedAvatar(root.querySelector('.pfh .pav3'),member.pic,document);
    decorateVerifiedPublicProfile(root,member);
    const meta=root.querySelector('.pfh .meta');
    if(meta){
      for(const item of [...meta.children].slice(1))item.remove();
      if(member.country){
        const country=document.createElement('span');
        country.textContent=String(member.country);
        meta.appendChild(country);
      }
    }
    const bio=root.querySelector('.pfh .bio');
    if(bio)bio.textContent='Verified Sharika member';
    const levels=root.querySelectorAll('.lvc .big3');
    if(levels[0])levels[0].textContent=Number(member.wealth_level)||1;
    if(levels[1])levels[1].textContent=Number(member.charm_level)||1;
    root.querySelectorAll('.lvc .lvb').forEach(el=>el.style.display='none');
    const fakeStats=root.querySelector('.st4');
    if(fakeStats)fakeStats.style.display='none';
    const fakeTabs=root.querySelector('.tabs');
    if(fakeTabs) {
      fakeTabs.style.display='none';
      let next=fakeTabs.nextElementSibling;
      while(next){next.style.display='none';next=next.nextElementSibling;}
    }
    const follow=root.querySelector('#pfol');
    if(follow){
      if(publicId===profile?.public_id)follow.style.display='none';
      else {
        follow.disabled=true;follow.textContent='Checking follow…';
        async function refreshFollow(){
          const status=await api('GET','/users/'+publicId+'/follow');
          if(!follow.isConnected)return;
          const following=!!status.following;
          follow.textContent=following?'✓ Following':'+ Follow';
          follow.disabled=false;
          follow.onclick=async()=>{
            follow.disabled=true;
            try{await api(following?'DELETE':'PUT','/users/'+publicId+'/follow');
              await refreshFollow();}
            catch(error){toast('Follow unavailable: '+errText(error));
              if(follow.isConnected)follow.disabled=false;}
          };
        }
        refreshFollow().catch(error=>{
          if(follow.isConnected)follow.textContent='Follow unavailable';
          console.warn('Member follow unavailable:',errText(error));
        });
      }
    }
    const message=root.querySelector('#pmsg');
    if(message)message.onclick=async()=>{
      if(publicId===profile?.public_id){toast('Choose another member');return;}
      message.disabled=true;
      try{
        document.getElementById('pfo')?.classList.remove('on');
        document.getElementById('rw')?.classList.remove('on');
        document.getElementById('mini')?.classList.add('on');
        window.go('msg');await window.renderMsg();
        await openPrivateThread(publicId,String(member.name||'Member'));
      }catch(error){toast('Message unavailable: '+errText(error));}
      finally{if(message.isConnected)message.disabled=false;}
    };
    const gift=root.querySelector('#pgift');
    if(gift)gift.onclick=async()=>{
      const currentFrame=document.getElementById('rf')?.contentWindow;
      if(window.cur?.id!==roomId||!currentFrame?.__sharikaOpenVerifiedGiftBox){
        toast('Join the member’s room to send a gift');return;
      }
      document.getElementById('pfo')?.classList.remove('on');
      await currentFrame.__sharikaOpenVerifiedGiftBox({
        id:publicId,name:String(member.name||'Member')
      });
    };
    const more=root.querySelector('#pmore');
    if(more)more.onclick=()=>{
      const currentFrame=document.getElementById('rf')?.contentWindow;
      document.getElementById('pfo')?.classList.remove('on');
      currentFrame?.__sharikaReportMember?.(publicId,String(member.name||'Member'));
    };
    mountBondDetails(root,String(publicId),member).catch(error=>
      console.warn('Bond ID profile:',errText(error)));
  }
  if(typeof window.addEventListener==='function')window.addEventListener('message',event=>{
    const frame=document.getElementById('rf')?.contentWindow;
    if(event.source!==frame||event.data?.t!=='profile')return;
    // Capture before the original handler's incorrect seat===0 self shortcut.
    event.stopImmediatePropagation();
    const roomId=window.cur?.id;
    const user=event.data?.u;
    const seat=Number.isInteger(user?.seat)&&user.seat>=0?user.seat:null;
    const id=seat!==null?frame?.seats?.[seat]?.public_id:
      (frame?.U||[]).some(u=>u?.id===user?.id)?user.id:null;
    if(!roomId||!/^[0-9]{8}$/.test(String(id||''))){
      toast('Verified room member unavailable');return;
    }
    openVerifiedRoomMemberProfile(id,roomId,seat).catch(error=>
      toast('Profile unavailable: '+errText(error)));
  },true);
  async function attachFrame(room) {
    const frame=document.getElementById('rf')?.contentWindow;
    if (frame && frame.document) fitAndroidViewport(frame.document, true);
    if(!frame || !frame.seats || !window.cur || window.cur.id!==room.id) return;
    // Add depth to the existing Sharika seat artwork without replacing its
    // markup, member avatars, frame effects, click controls or room layout.
    if(!frame.document.getElementById('sharika-seat-depth')){
      const seatStyle=frame.document.createElement('style');
      seatStyle.id='sharika-seat-depth';
      seatStyle.textContent=[
        // Gallery themes stay on the room's background layer. Seat buttons,
        // gift controls and message composer remain above and clickable.
        '.app.hasbg{background-position:center center!important;background-size:cover!important;background-repeat:no-repeat!important}',
        '.app.hasbg .blob{opacity:.08}',
        '.seat .av{transform-style:preserve-3d;transition:transform .18s ease,filter .18s ease}',
        '.seat:not(.empty):not(.lock) .av{filter:drop-shadow(0 8px 7px rgba(4,2,19,.42))}',
        '.seat .face{border:2px solid rgba(255,255,255,.38);box-shadow:inset 0 4px 6px rgba(255,255,255,.23),inset 0 -10px 16px rgba(10,3,39,.47),0 5px 0 rgba(8,4,27,.55),0 12px 19px rgba(0,0,0,.48)}',
        '.seat .ring{filter:drop-shadow(0 0 5px rgba(255,220,146,.45))}',
        '.seat.empty .face{background:linear-gradient(150deg,rgba(255,255,255,.19),rgba(32,17,75,.66))!important;box-shadow:inset 0 3px 5px rgba(255,255,255,.13),inset 0 -7px 12px rgba(8,4,34,.48),0 4px 0 rgba(8,4,27,.4)}',
        '.seat.lock .face{background:linear-gradient(145deg,rgba(63,49,114,.8),rgba(17,11,47,.9))!important;box-shadow:inset 0 3px 5px rgba(255,255,255,.12),0 5px 0 rgba(8,4,27,.48)}',
        '.seat.talk .av{filter:drop-shadow(0 0 12px rgba(72,255,183,.75))}',
        '.seat:active .av{transform:translateY(2px) scale(.96)}',
        '.seat:focus-visible .av{outline:2px solid #ffe08b;outline-offset:6px}',
        '.step button{background:linear-gradient(145deg,rgba(255,255,255,.27),rgba(75,44,152,.85));box-shadow:inset 0 2px 0 rgba(255,255,255,.32),0 4px 0 rgba(20,9,63,.6)}',
        '.fr button{background:linear-gradient(160deg,rgba(255,255,255,.19),rgba(51,31,109,.82));box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 3px 0 rgba(17,9,57,.5)}',
        '.fr button.sel{box-shadow:0 0 13px rgba(255,215,123,.38),inset 0 1px 0 rgba(255,255,255,.3)}',
        '@media (prefers-reduced-motion:reduce){.seat .av{transition:none}}'
      ].join('');
      frame.document.head.appendChild(seatStyle);
    }
    // Keep the original 3D theme tiles while explaining their shared scope.
    const originalThemeSheet=frame.themeSheet;
    if(typeof originalThemeSheet==='function'){
      frame.themeSheet=function(...args){
        const result=originalThemeSheet.apply(this,args);
        const gallery=frame.$('gal');
        if(gallery){
          const caption=gallery.querySelector('small');
          if(caption)caption.textContent=room.th==='photo'
            ?'Shared with everyone · also updates the room card photo'
            :'Choose a photo · all room members will see it';
          if(room.th==='photo'){
            gallery.style.background='linear-gradient(125deg,rgba(156,99,255,.25),rgba(41,22,83,.85))';
            gallery.style.border='1px solid rgba(233,207,255,.56)';
          }
          const note=frame.document.createElement('div');
          note.setAttribute('role','status');
          note.style.cssText='margin:8px 0 12px;padding:11px 12px;border-radius:13px;'+
            'border:1px solid rgba(203,179,255,.22);background:rgba(35,20,78,.58);'+
            'color:#d9cef8;font-size:12px;line-height:1.45';
          note.textContent='✓ Theme changes are saved to this room and shown to everyone.';
          gallery.after(note);
        }
        return result;
      };
    }
    frame.tick=function(){};
    frame.U=[];
    frame.G=[];
    frame.sendGift=function(){ frame.toast('Use the verified gift box Send button'); };
    // The original room list derived fake IDs from names. Use D1 public IDs.
    frame.sid=function(seat){
      const id=String(seat?.public_id||'');
      return /^[0-9]{8}$/.test(id)?id:'';
    };
    frame.others=function(){return (frame.seats||[]).filter(s=>s&&!s.empty&&!s.lock);};
    // Only the server may enable Lucky Gifts, and never for a minor.
    frame.__minor=profile?.minor!==false;
    frame.__luckyOff=true;
    let availableGiftIds=[];
    let giftBusy=false;
    let pendingGiftRequest=null;
    let lastGiftEventId=null;
    const shownGiftEvents=new Set();
    let lastChatId=0,chatPollInFlight=null,chatSendBusy=false;
    let pendingChatMessage=null;
    let lastEntryEventId=0,entryPollInFlight=null;
    let lastReactionId=0,reactionPollInFlight=null;
    // Load only the real gift catalog approved in D1 by the admin panel.
    // Keep the existing original Sharika gift box and its original artwork.
    // Report a verified member or room through the existing authenticated
    // Support Inbox. No fake moderator action and no wallet mutation.
    function openVerifiedReport(kind,targetId,targetName){
      if(!session || !/^[0-9]{8}$/.test(String(targetId||''))){
        frame.toast('Verified report target unavailable');return;
      }
      if(kind!=='user'&&kind!=='room')return;
      if(kind==='user'&&String(targetId)===profile?.public_id){
        frame.toast('You cannot report your own profile');return;
      }
      frame.open('<h3>🚩 Report to Sharika Support</h3>'+
        '<div id="sh-verified-report"></div>');
      const box=frame.$('sh-verified-report');
      if(!box)return;
      const label=frame.document.createElement('div');
      label.className='row';
      label.textContent=(kind==='user'?'User':'Room')+': '+
        String(targetName||'Unknown')+' · ID '+String(targetId);
      const reason=frame.document.createElement('textarea');
      reason.id='sh-verified-report-reason';
      reason.maxLength=500;
      reason.rows=4;
      reason.placeholder='Explain what happened (at least 10 characters)';
      reason.setAttribute('aria-label','Reason for report');
      reason.style.cssText='display:block;width:100%;padding:12px;margin:10px 0;'+
        'border:1px solid #9b82e5;border-radius:12px;background:#17102f;color:white';
      const submit=frame.document.createElement('button');
      submit.type='button';submit.className='send';
      submit.textContent='Send report to support';
      submit.style.cssText='width:100%;padding:12px;margin-top:7px';
      submit.onclick=async()=>{
        const why=reason.value.trim();
        if(why.length<10){frame.toast('Write at least 10 characters');return;}
        if(submit.disabled)return;
        submit.disabled=true;
        try{
          await api('POST','/support/messages',{
            body:'[Sharika report] '+kind+' ID '+String(targetId)+
              ' · '+String(targetName||'Unknown')+'\nReason: '+why,
            request_id:'report:'+Date.now().toString(36)+':'+
              Math.random().toString(36).slice(2)
          });
          frame.close();
          frame.toast('Report sent to verified support ✓');
        }catch(error){
          frame.toast('Report not sent: '+errText(error));
          if(submit.isConnected)submit.disabled=false;
        }
      };
      box.append(label,reason,submit);
    }
    frame.__sharikaReportMember=(id,name)=>openVerifiedReport('user',id,name);
    const giftButton=frame.$ && frame.$('bGift');
    const originalGiftOpen=giftButton && giftButton.onclick;
    let directGiftTarget=null;
    async function openVerifiedGiftBox(recipientOverride=null){
      directGiftTarget=recipientOverride;
      try{
        const data=await api('GET','/gifts');
        const gifts=(data.gifts||[]).filter(g=>g.tab===0||g.tab===1||
          (g.tab===2 && data.lucky_enabled===true && profile?.minor===false));
        if(!gifts.length){showBondGiftSheet(directGiftTarget,'cp');return;}
        const htmlSafe=text=>String(text??'').replace(/[&<>"']/g,
          c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const imageSafe=value=>{
          const url=String(value||'').trim();
          return url.startsWith('https://') && url.length<=1000 &&
            !Array.from(url).some(c=>c.charCodeAt(0)<=32 || ['"',"'",'<','>'].includes(c))
            ?htmlSafe(url):'';
        };
        availableGiftIds=gifts.map(g=>g.id);
        frame.__luckyOff=!gifts.some(g=>g.tab===2);
        frame.gtab=[0,1,2].find(tab=>gifts.some(g=>g.tab===tab))??0;
        frame.gsel=Math.max(0,gifts.findIndex(g=>g.tab===frame.gtab));
        frame.G=gifts.map(g=>[htmlSafe(g.emoji||'🎁'),Number(g.price_coins),
          htmlSafe(g.name),Number(g.tab),imageSafe(g.image_url)]);
        if(typeof originalGiftOpen==='function') {
          originalGiftOpen.call(giftButton);
          decorateGiftRecipients(frame);
          if(directGiftTarget) {
            // Replace the old seat-only recipient chips with the verified
            // selected person. Sending always uses this exact public ID.
            const selected=frame.document.createElement('div');
            selected.className='row';
            selected.textContent='🎁 Send to '+directGiftTarget.name+
              ' · ID '+directGiftTarget.id;
            const chips=frame.$('sheet')?.querySelector('.chips');
            if(chips)chips.replaceWith(selected);
            else frame.$('sheet')?.prepend(selected);
          }
          // CP/Friendship gifts are verified consent invitations and do not
          // pass through the ordinary room-gift sender or its local wallet.
          const bondTabs=frame.$('sheet')?.querySelector('.gtabs')||
            frame.document.getElementById('snd')?.parentElement;
          if(bondTabs){
            for(const choice of [{type:'cp',label:'💝 CP'},{type:'friendship',label:'🤝 Friends'}]){
              const button=frame.document.createElement('button');
              button.type='button';button.className='sh-bond-gift-tab';
              button.textContent=choice.label;
              button.style.cssText='padding:8px 10px;border:1px solid #ffdfb0;'+
                'border-radius:13px;color:#fff;background:linear-gradient(145deg,#a94da8,#44217b);'+
                'font-size:12px;font-weight:900;margin:3px';
              button.onclick=()=>{
                const selected=(frame.rec||[]).map(index=>frame.seats?.[Number(index)])
                  .find(seat=>seat?.public_id&&seat.public_id!==profile?.public_id);
                const person=directGiftTarget||
                  (selected?{id:selected.public_id,name:selected.n}:null);
                frame.close();showBondGiftSheet(person,choice.type);
              };
              bondTabs.appendChild(button);
            }
          }
          // Google Play requires chance-based virtual reward odds next to a
          // purchase. Preserve the original gift modal, insert text only.
          frame.document.getElementById('sharika-lucky-odds')?.remove();
          if(data.lucky_enabled!==true){
            // Keep the original Lucky tab visible as disabled, so members know
            // it was not forgotten. No client-side draw or fake coin reward.
            const tabs=frame.$('sheet')?.querySelector('.gtabs');
            if(tabs){
              const locked=frame.document.createElement('button');
              locked.type='button';
              locked.disabled=true;
              locked.setAttribute('aria-label','Lucky Gift unavailable');
              locked.textContent='🍀 Lucky';
              locked.title=profile?.minor?'Adults only':'Server approval required';
              locked.style.opacity='.45';
              tabs.appendChild(locked);
              const note=frame.document.createElement('div');
              note.id='sharika-lucky-status';
              note.style.cssText='font-size:11px;line-height:1.4;padding:5px;text-align:center;color:#e7d8ff';
              note.textContent=profile?.minor?
                'Lucky Gifts are for eligible adults only.':
                'Lucky Gifts are not active on this staging server yet; ordinary gifts remain available.';
              tabs.after(note);
            }
          }
          if(data.lucky_enabled===true && Array.isArray(data.lucky_odds)) {
            const send=frame.document.getElementById('snd');
            if(send?.parentElement) {
              const label=frame.document.createElement('div');
              label.id='sharika-lucky-odds';
              label.style.cssText='font-size:11px;line-height:1.4;padding:6px;color:#e7d8ff;text-align:center';
              label.textContent='Lucky Gift odds: '+data.lucky_odds.map(x=>
                x.multiplier+'x '+x.probability_percent+'%').join(' · ')+
                '. Virtual rewards only; no cashout or resale.';
              send.parentElement.insertBefore(label,send);
            }
          }
        } else frame.toast('Gift box unavailable');
      }catch(error){frame.toast('Gift catalog unavailable: '+errText(error));}
    }
    frame.__sharikaOpenVerifiedGiftBox=openVerifiedGiftBox;
    if(giftButton)giftButton.onclick=()=>openVerifiedGiftBox(null);
    // The original gift game debits a local wallet; always intercept before it
    // executes, settle at the server, then use the original gift flight artwork.
    frame.document.addEventListener('click',async event=>{
      const button=event.target.closest?.('#snd');
      if(!button)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(giftBusy||!session)return;
      giftBusy=true;button.disabled=true;
      let giftCommitted=false;
      try{
        const chosen=Number(frame.gsel);
        const giftId=availableGiftIds[chosen];
        const quantity=Number(frame.qty);
        const indices=Array.isArray(frame.rec)?frame.rec:[];
        const recipients=directGiftTarget
          ?[directGiftTarget.id]
          :[...new Set(indices.map(index=>
            frame.seats?.[Number(index)]?.public_id).filter(Boolean))];
        if(!giftId||!Number.isInteger(quantity)||quantity<1||quantity>10||
          !recipients.length)throw new Error('Select a gift and an occupied seat');
        const fingerprint=JSON.stringify([giftId,quantity,[...recipients].sort()]);
        const requestId=pendingGiftRequest?.fingerprint===fingerprint
          ?pendingGiftRequest.requestId:nextWalletRequestId('gift');
        pendingGiftRequest={fingerprint,requestId};
        const result=await api('POST','/rooms/'+room.id+'/gifts',{
          gift_id:giftId,quantity,recipient_public_ids:recipients,request_id:requestId
        });
        giftCommitted=true;pendingGiftRequest=null;
        await refreshWalletAfterConfirmedTransaction({coins:result.coins});
        frame.S.coins=balance.coins;
        frame.S.xp=balance.xp;
        frame.close();
        frame.toast('Gift sent · '+result.spent_coins+' coins charged · Room reward 10% · Owner +'+
          Number(result.owner_reward_coins||0).toLocaleString('en-US')+' coins ✓');
        if(result.lucky) {
          frame.toast('Lucky Gift: receiver 5% diamonds · room 1% reward');
        }
        if(result.lucky && typeof frame.luckyFx==='function') {
          const confirmed={payout_coins:Number(result.lucky.payout_coins)||0,
            max_multiplier:Number(result.lucky.max_multiplier)||0};
          setTimeout(()=>{
            if(window.cur?.id===room.id)
              frame.luckyFx(confirmed.payout_coins,confirmed.max_multiplier,
                frame.G[chosen]||[result.gift.emoji]);
          },1000);
        }
        const animatedIndices=directGiftTarget
          ?(frame.seats||[]).filter(slot=>slot?.public_id===directGiftTarget.id)
            .map(slot=>slot.i)
          :indices;
        for(const index of animatedIndices.slice(0,20)){
          const slot=frame.seats?.[Number(index)];
          if(!slot||!recipients.includes(slot.public_id))continue;
          for(let n=0;n<Math.min(quantity,2);n++){
            if(typeof frame.fly==='function')
              frame.fly(result.gift.emoji,Number(index),n*180,Number(frame.G[chosen]?.[1]||0));
          }
        }
        // Show the same verified sender → recipient notice on the sender's
        // phone too. Do not advance the cursor past this newly sent event.
        await pollGiftEvents(result.duplicate?null:result.transaction_id).catch(error=>
          console.warn('Gift celebration delayed:',errText(error)));
      }catch(error){
        frame.toast(giftCommitted
          ?'Gift sent, but screen update delayed: '+errText(error)
          :'Gift not confirmed; check wallet before retrying: '+errText(error));
      }
      finally{giftBusy=false;button.disabled=false;}
    },true);
    function presentVerifiedGift(event){
      const id=Number(event.id);
      if(!Number.isSafeInteger(id)||shownGiftEvents.has(id))return;
      shownGiftEvents.add(id);
      if(shownGiftEvents.size>100)shownGiftEvents.clear();
      queueGiftPresentation(frame,event);
      if(Number(event.tab)===FEATURED_GIFT_TAB)
        queueGiftPresentation(frame,event,true);
    }
    async function pollGiftEvents(ownTransactionId=null){
      const data=await api('GET','/rooms/'+room.id+'/gifts');
      const events=data.events||[];
      const latest=Math.max(0,...events.map(e=>Number(e.id)||0));
      if(lastGiftEventId===null){
        lastGiftEventId=latest;
        // A send can finish before the first poll. Show only the confirmed
        // transaction, never replay the room's old history to a new joiner.
        if(ownTransactionId!==null)for(const event of events){
          if(String(event.transaction_id)!==String(ownTransactionId))continue;
          presentVerifiedGift(event);
        }
        return;
      }
      let receivedGift=false;
      let sawNewGift=false;
      for(const event of events){
        if(event.id<=lastGiftEventId){
          if(ownTransactionId!==null &&
             String(event.transaction_id)===String(ownTransactionId))
            presentVerifiedGift(event);
          continue;
        }
        sawNewGift=true;
        presentVerifiedGift(event);
        if(event.sender_id===profile?.public_id)continue;
        if(event.recipient_id===profile?.public_id)receivedGift=true;
        const seat=(frame.seats||[]).find(s=>s?.public_id===event.recipient_id);
        if(seat && typeof frame.fly==='function')
          frame.fly(event.emoji,seat.i,0,event.price_coins);
      }
      lastGiftEventId=Math.max(lastGiftEventId,latest);
      // The owner also sees the verified 10% gift reward in the coin wallet
      // when somebody sends a gift to another user in this room.
      if(receivedGift||(sawNewGift&&room.owner_id===session?.user?.id))
        await reloadWallet();
    }
    async function moderateSeat(action,seat) {
      if(room.owner_id!==session?.user?.id)throw new Error('Room owner only');
      const target=frame.seats?.[seat];
      if(!target||target.empty||!target.public_id||
         target.user_id===room.owner_id)throw new Error('Choose a guest seat');
      const result=await api('POST','/rooms/'+room.id+'/moderate',{
        action,target_public_id:target.public_id
      });
      frame.close();
      await syncFrame(room,frame);
      frame.toast(action==='kick'?'Guest removed for 10 minutes':
        action==='remove_seat'?'Guest removed from mic':'Guest '+action+'d');
      return result;
    }
    frame.act=async function(action,seat) {
      try {
        const target=frame.seats?.[seat];
        const isSelf=target?.user_id===session?.user?.id;
        const owner=room.owner_id===session?.user?.id;
        if((action==='lock'||action==='unlock')&&seat>0) {
          if(!owner)throw new Error('Room owner only');
          await api('PUT','/rooms/'+room.id+'/locks',{
            seat_no:seat,locked:action==='lock'
          });
          frame.close();
          await syncFrame(room,frame);
          frame.toast(action==='lock'?'Seat locked':'Seat unlocked');
        } else if((action==='inv'||action==='invite') && seat>0) {
          if(!owner)throw new Error('Only the room owner may invite members');
          const data=await api('GET','/rooms/'+room.id+'/members');
          const listeners=(data.members||[]).filter(m=>
            m.seat_no===null&&m.user_id!==room.owner_id&&m.sharika_users?.public_id
          );
          frame.open('<h3>🎤 Invite to mic seat '+seat+'</h3>'+
            '<div id="sh-invite-list"></div>');
          const list=frame.$('sh-invite-list');
          if(!list)return;
          if(!listeners.length) {
            list.textContent='No audience members available to invite';
            return;
          }
          for(const listener of listeners) {
            const button=frame.document.createElement('button');
            button.className='row';
            button.textContent=(listener.sharika_users.name||'Member')+
              ' · ID '+listener.sharika_users.public_id;
            button.onclick=async()=>{
              if(button.disabled)return;
              button.disabled=true;
              try {
                await api('POST','/rooms/'+room.id+'/invitations',{
                  seat_no:seat,target_public_id:listener.sharika_users.public_id
                });
                frame.close();
                frame.toast('Mic invitation sent');
              }catch(error) {
                button.disabled=false;
                frame.toast('Invite not sent: '+errText(error));
              }
            };
            list.append(button);
          }
        } else if(action==='take' && seat>0) {
          // The owner already occupies seat zero; invite a guest instead.
          if(owner){await frame.act('inv',seat);return;}
          await api('PUT','/rooms/'+room.id+'/seat',{seat_no:seat});
          frame.close(); await syncFrame(room,frame);
          let state=await connectVoice(room.id);
          // An in-flight listener connection might have started before the
          // seat assignment; recheck verified publish permission once.
          if(!state.publishing) {
            const current=await api('GET','/rooms/'+room.id+'/voice/config');
            if(current.publish)state=await connectVoice(room.id);
          }
          frame.toast(state.publishing?'Microphone enabled':'Listening to room');
        } else if(action==='down' && seat>0) {
          if(!isSelf && owner && target?.user_id) {
            await moderateSeat('remove_seat',seat);
          } else if(isSelf) {
            await api('PUT','/rooms/'+room.id+'/seat',{seat_no:null});
            frame.close(); await syncFrame(room,frame);
            await connectVoice(room.id);
            frame.toast('Seat released; listening only');
          } else throw new Error('You can only leave your own seat');
        } else if(action==='mute' && seat>=0) {
          if(owner && target?.user_id && !isSelf)
            await moderateSeat(target.muted?'unmute':'mute',seat);
          else if(isSelf) {
            const enabled=await toggleVoice();
            frame.close();
            frame.toast(enabled?'Microphone on':'Microphone off');
          } else throw new Error('Only the owner can mute another user');
        } else if(action==='kick' && seat>0) {
          await moderateSeat('kick',seat);
        } else if(action==='own' && owner) {
          frame.open('<h3>👑 Verified owner controls</h3>'+
            '<div class="row">Tap an occupied seat to mute, unmute, remove from mic or kick a guest.</div>');
        } else if(action==='prof' && target?.public_id) {
          frame.close();
          await openVerifiedRoomMemberProfile(target.public_id,room.id,seat);
        } else if(action==='gift' && target?.public_id) {
          await openVerifiedGiftBox({id:target.public_id,name:target.n||'Member'});
        } else frame.toast('This action is not connected to the verified server yet');
      } catch (error) { frame.toast(errText(error)); }
    };
    // The stock room menu displays a fake "ID 482915" for seat zero and
    // grants the owner menu to anybody tapping it. Keep the same sheet design
    // but attach each visible action to the real occupied seat and its user.
    const originalSeatSheet=frame.seatSheet;
    frame.seatSheet=function(index){
      const result=originalSeatSheet(index);
      const selected=frame.seats?.[index];
      if(!selected)return result;
      const owner=room.owner_id===session?.user?.id;
      const self=selected.user_id===session?.user?.id;
      const sheet=frame.$('sheet');
      if(selected.empty||selected.lock){
        if(!owner&&selected.lock&&sheet){
          sheet.innerHTML='<div class="grab"></div><h3>🔒 Seat locked</h3>';
        }
        return result;
      }
      const id=String(selected.public_id||'');
      const detail=sheet?.querySelector('.who small');
      if(detail)detail.textContent='ID '+id+' · '+(index===0?'Room owner':'Mic seat '+index);
      const actions=sheet?.querySelector('.acts');
      if(!actions)return result;
      actions.textContent='';
      const options=[['prof','👤','Profile']];
      options.push(['gift','🎁','Gift']);
      if(self)options.push(['mute',selected.muted?'🔊':'🔇',
        selected.muted?'Unmute':'Mute']);
      if(self&&index>0)options.push(['down','⬇️','Leave mic']);
      if(owner&&index===0)options.push(['own','⚙️','Manage']);
      if(owner&&index>0&&!self)options.push(
        ['mute',selected.muted?'🔊':'🔇',selected.muted?'Unmute':'Mute'],
        ['down','⬇️','Remove from mic'],['lock','🔒','Lock seat'],
        ['kick','🚫','Kick out']);
      for(const [action,icon,label] of options){
        const button=frame.document.createElement('button');
        button.className='act'+(action==='kick'?' dg':'');
        const picture=frame.document.createElement('span');
        picture.textContent=icon;
        button.append(picture,frame.document.createTextNode(label));
        button.onclick=()=>frame.act(action,index);
        actions.appendChild(button);
      }
      return result;
    };
    const originalSeatEmoji=frame.seatEmoji;
    // Original emoji box invokes seatEmoji(0,...) on every device. Resolve
    // the currently logged-in user's actual mic seat before animating.
    frame.seatEmoji=function(_ignoredIndex,emoji){
      const mine=frame.seats?.find(slot=>slot?.user_id===session?.user?.id);
      if(!mine||mine.empty||mine.lock){
        frame.toast('Take an unlocked mic seat to show a seat emoji');return;
      }
      if(!Array.isArray(emoji)||!frame.ER?.some(item=>item[0]===emoji[0]))return;
      originalSeatEmoji(mine.i,emoji);
      const requestId='reaction:'+Date.now().toString(36)+':'+
        Math.random().toString(36).slice(2);
      api('POST','/rooms/'+room.id+'/reactions',{
        emoji:emoji[0],request_id:requestId
      }).catch(error=>frame.toast('Emoji shown locally: '+errText(error)));
    };
    // A verified guest taps any open/unlocked seat to sit immediately.
    // This bypasses the old demo "Seat a guest" menu; owner invitations remain optional.
    let directSeatBusy=false;
    frame.document.addEventListener('click',async event=>{
      const button=event.target.closest?.('.seat.empty[data-i]');
      if(!button||!frame.document.querySelector('#grid')?.contains(button) ||
         room.owner_id===session?.user?.id)return;
      const seat=Number(button.dataset.i);
      if(!Number.isInteger(seat)||seat<1||seat>room.seat_count)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(directSeatBusy)return;
      directSeatBusy=true;button.disabled=true;
      try{
        await api('PUT','/rooms/'+room.id+'/seat',{seat_no:seat});
        await syncFrame(room,frame);
        let joined=await connectVoice(room.id);
        if(!joined.publishing){
          const current=await api('GET','/rooms/'+room.id+'/voice/config');
          if(current.publish)joined=await connectVoice(room.id);
        }
        frame.toast(joined.publishing?'Joined mic seat '+seat+' · microphone on':
          'Joined seat '+seat+' · microphone connecting');
      }catch(error){frame.toast('Unable to take seat: '+errText(error));}
      finally{
        directSeatBusy=false;
        if(button.isConnected)button.disabled=false;
      }
    },true);
    // The room template's audience menu previously changed local demo seats.
    // Wire those buttons to authenticated server operations instead.
    const originalMemberSheet=frame.userSheet;
    if(typeof originalMemberSheet==='function')frame.userSheet=function(user,search) {
      originalMemberSheet(user,search);
      const sheet=frame.$('sheet');
      const photo=user?.seat!=null?frame.seats?.[user.seat]?.pic:
        frame.U?.[user?.k]?.pic;
      paintVerifiedAvatar(sheet?.querySelector('.who .ua'),photo,frame.document);
      const verifiedId=String(user?.id||'');
      const verified=/^[0-9]{8}$/.test(verifiedId);
      const profileButton=sheet?.querySelector('button.act[data-a="pf"]');
      if(profileButton)profileButton.onclick=async()=>{
        if(!verified){frame.toast('Verified member ID unavailable');return;}
        if(profileButton.disabled)return;
        profileButton.disabled=true;
        try {
          const member=await api('GET','/users/'+verifiedId);
          frame.open('<h3>👤 Verified member profile</h3>'+
            '<div id="sh-member-profile"></div>');
          const panel=frame.$('sh-member-profile');
          if(panel) {
            cosmeticCss(frame.document);
            const picture=frame.document.createElement('div');
            picture.className='sh-sovera-preview';
            picture.style.cssText='width:94px;height:94px;margin:16px auto;font-size:45px';
            picture.textContent='👤';
            paintVerifiedAvatar(picture,member.pic,frame.document);
            const chosen=frameArt(member.frame_style);
            if(chosen){
              const art=frame.document.createElement('i');
              art.className='fxr sh-sovera-frame';
              art.style.backgroundImage='url('+effectPath(chosen.art)+')';
              picture.appendChild(art);
            }
            const name=frame.document.createElement('div');
            name.className='row';
            name.textContent=String(member.name||'Member')+' · ID '+String(member.id);
            const details=frame.document.createElement('div');
            details.className='lbl';
            details.textContent='Country: '+String(member.country||'Not set')+
              ' · Wealth Lv '+Number(member.wealth_level||0)+
              ' · Charm Lv '+Number(member.charm_level||0)+
              ' · Frame: '+String(chosen?.name||'None')+
              ' · Entry: '+String(entryArt(member.entry_style)?.name||'None');
            const strip=frame.document.createElement('div');
            strip.className='sh-sovera-id-effects';
            for(const item of [medalArt(member.medal_style),nameTagArt(member.name_tag_style)]){
              if(!item)continue;
              const img=frame.document.createElement('img');
              img.src=cosmeticMedia(item);
              img.alt=item.name+' (decorative)';
              strip.appendChild(img);
            }
            panel.append(picture,name,details,strip);
          }
        }catch(error) {
          profileButton.disabled=false;
          frame.toast('Profile unavailable: '+errText(error));
        }
      };
      const followButton=sheet?.querySelector('button.act[data-a="fo"]');
      if(followButton) {
        // Never toggle a local-only follow state before the backend confirms.
        followButton.disabled=true;
        followButton.textContent='Checking follow…';
        if(verified)api('GET','/users/'+verifiedId+'/follow').then(status=>{
          if(!followButton.isConnected)return;
          followButton.dataset.following=status.following?'true':'false';
          followButton.textContent=status.following?'✅ Following':'➕ Follow';
          followButton.disabled=false;
        }).catch(error=>{
          if(!followButton.isConnected)return;
          followButton.textContent='Follow unavailable';
          followButton.title=errText(error);
        });
        else followButton.textContent='ID unavailable';
        followButton.onclick=async()=>{
          if(followButton.disabled||!verified)return;
          const following=followButton.dataset.following==='true';
          followButton.disabled=true;
          try {
            const status=await api(following?'DELETE':'PUT',
              '/users/'+verifiedId+'/follow');
            if(!followButton.isConnected)return;
            followButton.dataset.following=status.following?'true':'false';
            followButton.textContent=status.following?'✅ Following':'➕ Follow';
            frame.FOL[verifiedId]=!!status.following;
          }catch(error) {
            frame.toast('Follow update failed: '+errText(error));
          }finally {
            if(followButton.isConnected)followButton.disabled=false;
          }
        };
      }
      // Use the same D1 gift catalog and wallet ledger as the room Gift box.
      // A room audience member may receive a gift without occupying a mic seat.
      const memberGiftButton=sheet?.querySelector('button.act[data-a="gf"]');
      if(memberGiftButton)memberGiftButton.onclick=async()=>{
        if(memberGiftButton.disabled)return;
        if(!verified){frame.toast('Verified member ID unavailable');return;}
        memberGiftButton.disabled=true;
        try {
          const members=await api('GET','/rooms/'+room.id+'/members');
          if(!(members.members||[]).some(member=>
            member.sharika_users?.public_id===verifiedId))
            throw new Error('This user has left the room');
          await openVerifiedGiftBox({id:verifiedId,name:String(user.n||'Member')});
        }catch(error) {
          frame.toast('Gift unavailable: '+errText(error));
        }finally {
          if(memberGiftButton.isConnected)memberGiftButton.disabled=false;
        }
      };
      // Open the existing authenticated private-message view. Its server
      // already enforces mutual follow before enabling message sending.
      const messageButton=frame.document.createElement('button');
      messageButton.type='button';
      messageButton.className='act';
      messageButton.textContent='💬 Message';
      sheet?.querySelector('.acts')?.appendChild(messageButton);
      messageButton.onclick=async()=>{
        if(messageButton.disabled)return;
        if(!verified){frame.toast('Verified member ID unavailable');return;}
        if(verifiedId===profile?.public_id) {
          frame.toast('Choose another member to message');return;
        }
        messageButton.disabled=true;
        try {
          const member=await api('GET','/users/'+verifiedId);
          frame.close();
          document.getElementById('rw')?.classList.remove('on');
          const bubble=document.getElementById('minib');
          if(bubble)bubble.textContent=room.emoji||'🎙️';
          document.getElementById('mini')?.classList.add('on');
          window.go('msg');
          await window.renderMsg();
          await openPrivateThread(verifiedId,String(member.name||'Member'));
        }catch(error) {
          messageButton.disabled=false;
          frame.toast('Message unavailable: '+errText(error));
        }
      };
      const reportMemberButton=frame.document.createElement('button');
      reportMemberButton.type='button';
      reportMemberButton.className='act';
      reportMemberButton.textContent='🚩 Report';
      sheet?.querySelector('.acts')?.appendChild(reportMemberButton);
      reportMemberButton.onclick=()=>{
        if(!verified){frame.toast('Verified member ID unavailable');return;}
        openVerifiedReport('user',verifiedId,String(user.n||'Member'));
      };
      const inviteButton=sheet?.querySelector('button.act[data-a="iv"]');
      if(inviteButton)inviteButton.onclick=async()=>{
        if(inviteButton.disabled)return;
        if(room.owner_id!==session?.user?.id) {
          frame.toast('Only the room owner can send a mic invite');return;
        }
        const seat=frame.seats.findIndex((item,index)=>
          index>0&&item?.empty&&!item?.lock
        );
        if(seat<1){frame.toast('No open mic seats');return;}
        inviteButton.disabled=true;
        try {
          await api('POST','/rooms/'+room.id+'/invitations',{
            seat_no:seat,target_public_id:String(user.id)
          });
          frame.close();
          frame.toast('Invitation sent to ID '+String(user.id));
        }catch(error) {
          inviteButton.disabled=false;
          frame.toast('Invite not sent: '+errText(error));
        }
      };
      for(const [code,action] of [['dn','remove_seat'],['kk','kick']]) {
        const button=sheet?.querySelector('button.act[data-a="'+code+'"]');
        if(!button)continue;
        button.onclick=async()=>{
          if(button.disabled)return;
          const onSeat=Number.isInteger(user.seat)&&user.seat>0;
          const target=onSeat?frame.seats[user.seat]:null;
          const isSelf=target?.user_id===session?.user?.id;
          if(!isSelf && room.owner_id!==session?.user?.id) {
            frame.toast('Room owner only');return;
          }
          button.disabled=true;
          try {
            if(isSelf && action==='remove_seat') {
              await api('PUT','/rooms/'+room.id+'/seat',{seat_no:null});
              frame.close();await syncFrame(room,frame);await connectVoice(room.id);
            }else if(onSeat)await moderateSeat(action,user.seat);
            else if(action==='kick') {
              await api('POST','/rooms/'+room.id+'/moderate',{
                action,target_public_id:String(user.id)
              });
              frame.close();await syncFrame(room,frame);
              frame.toast('Guest removed for 10 minutes');
            }
          }catch(error) {
            button.disabled=false;
            frame.toast('Action failed: '+errText(error));
          }
        };
      }
    };
    // Read the actual D1 room reward ledger. Never expose the old local
    // claim button, which simulated a wallet mutation.
    frame.rewardSheet=async function(){
      frame.open('<h3>💰 Verified Room Reward</h3>'+
        '<div id="sh-real-room-reward" class="row">Checking room reward…</div>');
      const target=frame.$('sh-real-room-reward');
      if(!target)return;
      try{
        const rewards=await api('GET','/rooms/'+room.id+'/rewards');
        const normal=Number(rewards.regular_reward_hundredths||0)/100;
        const lucky=Number(rewards.lucky_reward_hundredths||0)/100;
        const paid=Number(rewards.owner_wallet_credited_coins||0);
        if(target.isConnected)target.textContent='Ordinary gift room reward 10%: '+
          normal.toLocaleString('en-US')+' coins · Paid to room owner wallet: '+
          paid.toLocaleString('en-US')+' coins · Lucky Gift room share 1% (if enabled): '+
          lucky.toLocaleString('en-US')+' coins. New ordinary gifts automatically credit whole coins to the owner. '+
          'The recorded room total is not a second claimable balance.';
      }catch(error){
        if(target.isConnected)target.textContent='Room rewards unavailable: '+errText(error);
      }
    };
    // The original +/- controls updated only iframe-local S.n. A rejoin then
    // restored the old D1 limit. Persist each tap before updating the visual.
    // Unlike the original local-only frame picker, the room's seat frame is
    // saved in D1 so every guest sees the same decorative ring after rejoin.
    let seatFrameSaveBusy=false;
    frame.document.addEventListener('click',async event=>{
      const choice=event.target.closest?.('.fr button[data-f]');
      if(!choice||!frame.$('sheet')?.querySelector('h3')?.textContent?.includes('Seat arrangement'))return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if(room.owner_id!==session?.user?.id){frame.toast('Room owner only');return;}
      if(seatFrameSaveBusy)return;
      const style=choice.dataset.f;
      if(!['grad','gold','neon','sq'].includes(style)){frame.toast('Unknown seat frame');return;}
      if(style===(room.seat_frame_style||'grad'))return;
      seatFrameSaveBusy=true;
      frame.$('sheet')?.querySelectorAll('.fr button').forEach(button=>{button.disabled=true;});
      try{
        const result=await api('PATCH','/rooms/'+room.id,{
          name:room.name||'My Sharika room',seat_count:room.seat_count,
          theme:room.th||'mid',seat_frame_style:style
        });
        if(result.room?.seat_frame_style!==style)throw new Error('Seat frame not confirmed by server');
        room.seat_frame_style=style;
        frame.S.frame=style;
        if(typeof frame.applyTheme==='function')frame.applyTheme();
        if(typeof frame.seatSet==='function')frame.seatSet();
        await reloadRooms();
        frame.toast('Seat frame saved for everyone ✓');
      }catch(error){
        frame.toast('Seat frame not saved: '+errText(error));
      }finally{
        seatFrameSaveBusy=false;
        frame.$('sheet')?.querySelectorAll('.fr button').forEach(button=>{button.disabled=false;});
      }
    },true);
    let seatCountSaveBusy=false;
    frame.document.addEventListener('click',async event=>{
      const control=event.target.closest?.('#mn,#pl');
      if(!control||!frame.$('sheet')?.querySelector('h3')?.textContent?.includes('Seat arrangement'))return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if(room.owner_id!==session?.user?.id){
        frame.toast('Only the room owner can change seats');return;
      }
      if(seatCountSaveBusy)return;
      const oldCount=Number(room.seat_count);
      if(!Number.isInteger(oldCount)||oldCount<4||oldCount>20){
        frame.toast('Refresh the room before editing seats');return;
      }
      const requested=oldCount+(control.id==='pl'?1:-1);
      if(requested<4||requested>20){
        frame.toast('Choose between 5 and 21 total seats');return;
      }
      seatCountSaveBusy=true;
      const buttons=[frame.$('mn'),frame.$('pl')].filter(Boolean);
      buttons.forEach(button=>{button.disabled=true;});
      let note=frame.$('sharika-seat-save-state');
      if(!note){
        note=frame.document.createElement('div');
        note.id='sharika-seat-save-state';
        note.setAttribute('role','status');
        note.style.cssText='text-align:center;font-size:12px;min-height:20px;color:#fbe6ae;padding:4px';
        frame.$('sheet')?.querySelector('.step')?.after(note);
      }
      note.textContent='Saving seat count…';
      try{
        const result=await api('PATCH','/rooms/'+room.id,{
          name:room.name||'My Sharika room',seat_count:requested,
          theme:room.th||'mid'
        });
        if(!Number.isInteger(result.room?.seat_count)||result.room.seat_count!==requested)
          throw new Error('Server did not confirm the new seat count');
        room.name=result.room.name;
        room.seat_count=result.room.seat_count;
        room.th=result.room.theme;
        // Saving is already committed; a temporary refresh outage must not
        // incorrectly tell the owner that the room change was lost.
        await syncFrame(room,frame).catch(error=>
          console.warn('Seat count saved; member refresh delayed:',errText(error)));
        await reloadRooms();
        if(frame.$('cnt'))frame.$('cnt').textContent=String(room.seat_count+1);
        if(note.isConnected)note.textContent='Saved ✓ '+String(room.seat_count+1)+' total seats';
        frame.toast('Seat count saved to room ✓');
      }catch(error){
        await syncFrame(room,frame).catch(()=>{});
        const detail=errText(error);
        const message=detail.includes('seats_occupied_above_new_limit')
          ?'Move guests from the highest seats before reducing the room'
          :'Seat count not saved: '+detail;
        if(note.isConnected)note.textContent=message;
        frame.toast(message);
      }finally{
        seatCountSaveBusy=false;
        buttons.forEach(button=>{if(button.isConnected)button.disabled=false;});
      }
    },true);
    // The existing room-settings sheet is reused. Its original Save action
    // runs only after the authenticated D1 owner update succeeds.
    const roomButton=frame.$ && frame.$('roomBtn');
    if(roomButton){
      const oldRoomOpen=roomButton.onclick;
      roomButton.onclick=()=>{
        if(room.owner_id!==session?.user?.id){
          // Guests can inspect and report a room without owner privileges.
          frame.open('<h3>🎙️ Room information</h3><div id="sh-room-info"></div>');
          const info=frame.$('sh-room-info');
          if(info){
            const label=frame.document.createElement('div');
            label.className='row';
            label.textContent=String(room.name||'Room')+' · ID '+String(room.id);
            const report=frame.document.createElement('button');
            report.type='button';report.className='send';
            report.textContent='🚩 Report this room';
            report.style.cssText='display:block;width:100%;padding:12px;margin:12px 0';
            report.onclick=()=>openVerifiedReport('room',room.id,room.name);
            info.append(label,report);
          }
          return;
        }
        if(typeof frame.settings==='function')frame.settings();
        else if(typeof oldRoomOpen==='function')oldRoomOpen.call(roomButton);
        const rewardLabel=frame.$('rRw')?.querySelector('small');
        if(rewardLabel)rewardLabel.textContent='10% of ordinary gifts · verified room ledger';
        const photo=frame.$('pbig');
        if(photo){
          if(verifiedCoverUrl(room.cover_url)){
            photo.style.backgroundImage='url("'+room.cover_url+'")';
            photo.style.backgroundSize='cover';
          }
          photo.title='Choose room photo from gallery';
          photo.onclick=()=>pickRoomCover(room,frame);
        }
        const sheet=frame.$('sheet');
        if(sheet&&!frame.$('sh-room-photo-action')){
          const button=frame.document.createElement('button');
          button.id='sh-room-photo-action';button.type='button';
          button.className='send';button.textContent='📷 Change room card photo';
          button.style.cssText='display:block;width:100%;margin:12px 0;padding:12px;border-radius:12px';
          button.onclick=()=>pickRoomCover(room,frame);
          const actions=sheet.querySelector('.gbar');
          sheet.insertBefore(button,actions||null);
        }
      };
    }
    // The original theme sheet stores themes/photos only on this device.
    // Intercept its controls before local handlers run and commit every
    // change to the verified owner-only room endpoint instead.
    let sharedThemeBusy=false;
    frame.document.addEventListener('click',async event=>{
      const control=event.target.closest?.('button.th,#gal,#rmbg');
      if(!control||!frame.$('sheet')?.querySelector('h3')?.textContent?.includes('Room theme'))return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if(room.owner_id!==session?.user?.id){
        frame.toast('Only the room owner can change themes');return;
      }
      if(sharedThemeBusy)return;
      if(control.id==='gal'){
        pickRoomCover(room,frame,true);
        return;
      }
      const nextTheme=control.id==='rmbg'?'mid':control.dataset.id;
      if(!['mid','gold','ocean','rose','forest','sunset'].includes(nextTheme))return;
      sharedThemeBusy=true;
      frame.$('sheet')?.querySelectorAll('button.th,#rmbg').forEach(x=>{x.disabled=true;});
      try{
        const result=await api('PATCH','/rooms/'+room.id,{theme:nextTheme});
        if(result.room?.theme!==nextTheme)
          throw new Error('Room theme not confirmed by server');
        room.th=nextTheme;
        if(window.cur?.id===room.id)
          await syncFrame(room,frame).catch(error=>
            console.warn('Theme saved; sync delayed:',errText(error)));
        await reloadRooms().catch(()=>{});
        if(frame.$('sheet')?.querySelector('h3')?.textContent?.includes('Room theme'))
          frame.themeSheet();
        frame.toast('Room theme updated for everyone ✓');
      }catch(error){
        await syncFrame(room,frame).catch(()=>{});
        frame.toast('Room theme not saved: '+errText(error));
      }finally{
        sharedThemeBusy=false;
        frame.$('sheet')?.querySelectorAll('button.th,#rmbg').forEach(x=>{x.disabled=false;});
      }
    },true);
    frame.document.addEventListener('click',async event=>{
      const saveButton=event.target.closest?.('#save');
      if(!saveButton || !frame.$('sheet')?.querySelector('h3')?.textContent?.includes('Room settings'))return;
      event.preventDefault();event.stopImmediatePropagation();
      if(room.owner_id!==session?.user?.id){frame.toast('Room owner only');return;}
      if(saveButton.disabled)return;
      const oldSave=saveButton.onclick;
      const name=frame.$('nm')?.value?.trim()||'My Sharika room';
      const newSeatCount=Number(frame.S.n)-1;
      if(!Number.isInteger(newSeatCount)||newSeatCount<4||newSeatCount>20){
        frame.toast('Please choose 5–21 total seats');return;
      }
      saveButton.disabled=true;
      try{
        const data=await api('PATCH','/rooms/'+room.id,{
          name,seat_count:newSeatCount,theme:room.th||'mid',
          seat_frame_style:room.seat_frame_style||'grad'
        });
        room.name=data.room.name;
        room.seat_count=data.room.seat_count;
        room.th=data.room.theme;
        if(typeof oldSave==='function')oldSave.call(saveButton);
        await reloadRooms();
        await syncFrame(room,frame);
        frame.toast('Room settings saved on server ✓');
      }catch(error){
        frame.S.name=room.name;
        await syncFrame(room,frame).catch(()=>{});
        frame.toast('Settings not saved: '+errText(error));
        saveButton.disabled=false;
      }
    },true);
    // Audience invitations stay in the existing room sheet. The invitee
    // explicitly accepts or declines before their verified mic seat changes.
    let displayedInviteAt=0;
    let pollingInvite=false;
    async function pollSeatInvite() {
      if(pollingInvite||window.cur?.id!==room.id)return;
      pollingInvite=true;
      try {
        const data=await api('GET','/rooms/'+room.id+'/invitations');
        const invite=data.invite;
        if(!invite||!Number.isInteger(invite.seat_no)||
           invite.invited_at_ms===displayedInviteAt)return;
        // Keep gift, settings and moderation sheets usable while inviting.
        if(frame.$('bg')?.classList.contains('on') ||
           frame.$('sheet')?.classList.contains('on'))return;
        displayedInviteAt=invite.invited_at_ms;
        const seat=invite.seat_no;
        frame.open('<h3>🎤 Mic seat invitation</h3>'+
          '<div class="row">The room owner invited you to seat '+seat+'.</div>'+
          '<button id="sh-accept-invite" class="row">Accept</button>'+
          '<button id="sh-decline-invite" class="row">Decline</button>');
        for(const [id,accept] of [
          ['sh-accept-invite',true],['sh-decline-invite',false]
        ]) {
          const button=frame.$(id);
          if(!button)continue;
          button.onclick=async()=>{
            if(button.disabled)return;
            button.disabled=true;
            try {
              await api('POST','/rooms/'+room.id+'/invitations/respond',{
                seat_no:seat,accept
              });
              frame.close();
              if(accept) {
                await syncFrame(room,frame);
                await connectVoice(room.id);
                frame.toast('Joined microphone seat '+seat);
              } else frame.toast('Mic invitation declined');
            }catch(error) {
              // Expired or taken seats can be retried with a fresh invite.
              frame.toast('Invitation unavailable: '+errText(error));
              frame.close();
            }
          };
        }
      }finally{pollingInvite=false;}
    }
    if(invitePoll)clearInterval(invitePoll);
    invitePoll=setInterval(()=>{
      if(window.cur?.id===room.id)pollSeatInvite().catch(()=>{});
    },10000);
    pollSeatInvite().catch(()=>{});
    // Mirror the verified room conversation into the original chat area.
    // No local-only send, simulated user, or repeated history on reconnect.
    async function pollRoomChat() {
      if(chatPollInFlight)return chatPollInFlight;
      const work=(async()=>{
        if(window.cur?.id!==room.id)return;
        const data=await api('GET','/rooms/'+room.id+'/chat?after='+lastChatId);
        if(window.cur?.id!==room.id || !session ||
           document.getElementById('rf')?.contentWindow!==frame)return;
        const messages=Array.isArray(data.messages)?data.messages:[];
        for(const item of messages) {
          const id=Number(item.id);
          if(!Number.isSafeInteger(id)||id<=lastChatId)continue;
          lastChatId=id;
          const memberPhoto=roomAvatarForPublicId(frame,item.sender_id);
          frame.msg(String(item.name||'Member'),'👤',String(item.body||''),{
            me:item.sender_id===profile?.public_id,lv:1
          });
          // Room chat uses the same saved avatar as the sender's room ID.
          const chatRow=frame.document.querySelector('#chat .msg:last-child');
          if(chatRow)chatRow.dataset.shSenderId=String(item.sender_id||'');
          paintVerifiedAvatar(chatRow?.querySelector('.mav'),memberPhoto,frame.document);
        }
      })();
      chatPollInFlight=work;
      try{await work;}finally{if(chatPollInFlight===work)chatPollInFlight=null;}
    }
    const messageInput=frame.$ && frame.$('txt');
    const messageSend=frame.$ && frame.$('sendTxt');
    async function sendRoomMessage() {
      const body=messageInput?.value?.trim()||'';
      if(!body||chatSendBusy)return;
      if(body.length>300){frame.toast('Room messages must be 300 characters or fewer');return;}
      chatSendBusy=true;
      if(messageSend)messageSend.disabled=true;
      try {
        // Keep the same idempotency key when an acknowledged message times out
        // on the phone. Retrying that text must not post it twice.
        if(!pendingChatMessage||pendingChatMessage.body!==body)
          pendingChatMessage={body,requestId:'chat:'+Date.now().toString(36)+':'+
            Math.random().toString(36).slice(2)};
        await api('POST','/rooms/'+room.id+'/chat',
          {body,request_id:pendingChatMessage.requestId});
        pendingChatMessage=null;
        if(messageInput?.value?.trim()===body)messageInput.value='';
        if(typeof frame.updBtn==='function')frame.updBtn();
        await pollRoomChat();
      }catch(error){frame.toast('Message not sent: '+errText(error));}
      finally {
        chatSendBusy=false;
        if(messageSend)messageSend.disabled=false;
      }
    }
    if(messageSend)messageSend.onclick=sendRoomMessage;
    if(messageInput)messageInput.onkeydown=event=>{
      if(event.key==='Enter'&&!event.shiftKey){
        event.preventDefault();
        sendRoomMessage();
      }
    };
    const imageSend=frame.$ && frame.$('imgBtn');
    if(imageSend)imageSend.onclick=()=>frame.toast('Room photo messages are not online yet');
    pollRoomChat().catch(error=>frame.toast('Chat unavailable: '+errText(error)));
    if(chatPoll)clearInterval(chatPoll);
    chatPoll=setInterval(()=>{
      if(window.cur?.id===room.id)pollRoomChat().catch(()=>{});
    },3500);
    // Other phones replay only short-lived reactions on the authenticated
    // sender's currently occupied seat. Never trust an old seat number.
    let reactionEndpointUnavailable=false;
    let reactionFailureCount=0,reactionRetryAfterMs=0;
    async function pollRoomReactions(){
      if(reactionPollInFlight||reactionEndpointUnavailable||Date.now()<reactionRetryAfterMs)
        return reactionPollInFlight;
      const work=(async()=>{
        if(window.cur?.id!==room.id)return;
        const data=await api('GET','/rooms/'+room.id+'/reactions?after='+lastReactionId);
        if(window.cur?.id!==room.id||!session||
           document.getElementById('rf')?.contentWindow!==frame)return;
        reactionFailureCount=0;reactionRetryAfterMs=0;
        for(const event of Array.isArray(data.events)?data.events:[]){
          const id=Number(event.id);
          if(!Number.isSafeInteger(id)||id<=lastReactionId)continue;
          lastReactionId=id;
          if(event.public_id===profile?.public_id)continue;
          const target=frame.seats?.find(slot=>slot?.public_id===event.public_id);
          const emoji=frame.ER?.find(item=>item[0]===event.emoji);
          if(target&&!target.empty&&!target.lock&&emoji&&
             Math.abs(Date.now()-Number(event.created_at_ms))<=6000)
            originalSeatEmoji(target.i,emoji);
        }
      })();
      reactionPollInFlight=work;
      try{await work;}catch(error){
        const reason=errText(error);
        // An outdated APK/Worker may truly lack this route, but a single
        // network timeout must never permanently disable two-way emojis.
        if(/staging_route_not_available|reaction_route_not_found|migration_pending/i.test(reason)){
          reactionEndpointUnavailable=true;
          console.warn('Shared room reactions unsupported:',reason);
        }else{
          reactionFailureCount=Math.min(reactionFailureCount+1,5);
          reactionRetryAfterMs=Date.now()+Math.min(30000,1000*2**reactionFailureCount);
          if(reactionFailureCount===1)
            console.warn('Shared room reactions reconnecting:',reason);
        }
      }finally{if(reactionPollInFlight===work)reactionPollInFlight=null;}
    }
    if(reactionPoll)clearInterval(reactionPoll);
    reactionPoll=setInterval(()=>{
      if(window.cur?.id===room.id)pollRoomReactions().catch(()=>{});
    },2200);
    pollRoomReactions().catch(()=>{});
    const mic=frame.$ && frame.$('mic');
    if(mic) mic.onclick=async ()=>{
      try {
        const enabled=await toggleVoice();
        mic.textContent=enabled?'🎤':'🔇';
        mic.classList.toggle('off',!enabled);
        frame.toast(enabled?'Microphone enabled':'Microphone muted');
      } catch(error) {frame.toast(errText(error));}
    };
    const inboxButton=frame.$ && frame.$('bMsg');
    if(inboxButton) {
      // The original badge was a demo unread count, not verified server data.
      inboxButton.querySelector('em')?.remove();
      inboxButton.onclick=()=>{
        // Minimize without leaving the D1 room or disconnecting WebRTC audio.
        if(typeof frame.close==='function')frame.close();
        document.getElementById('rw')?.classList.remove('on');
        const bubble=document.getElementById('minib');
        if(bubble)bubble.textContent=room.emoji||'🎙️';
        document.getElementById('mini')?.classList.add('on');
        window.go('msg'); // Reuses verified direct messages and mutual-follow checks.
      };
    }
    const ownerButton=frame.$ && frame.$('bOwn');
    if(ownerButton) {
      ownerButton.style.display=room.owner_id===session?.user?.id?'':'none';
      ownerButton.onclick=()=>frame.open('<h3>👑 Verified owner controls</h3>'+
        '<div class="row">Tap any occupied guest seat to mute, unmute, remove from mic or kick.</div>');
    }
    const roomGameButton=frame.$ && frame.$('bGame');
    if(roomGameButton)roomGameButton.onclick=()=>showGameCard(frame.document,true,frame.toast);
    const rewards=frame.$ && frame.$('rrpill');
    if(rewards) rewards.onclick=async()=>{
      frame.open('<h3>🏆 Weekly Top Rooms</h3>'+
        '<div id="sh-room-week" class="empty">Loading verified room results…</div>'+
        '<p style="font-size:12px;opacity:.7;text-align:center">'+
        'This ranking is read-only. Automatic room-reward coins are not enabled yet.</p>');
      const target=frame.$('sh-room-week');
      if(!target)return;
      try{
        const data=await api('GET','/rankings?period=weekly&kind=room');
        if(!target.isConnected||!session)return;
        target.textContent='';
        const rooms=Array.isArray(data.leaders)?data.leaders.slice(0,10):[];
        if(!rooms.length){
          target.textContent='No verified room gifts recorded this week.';
          return;
        }
        for(const item of rooms){
          const row=frame.document.createElement('div');
          row.className='row';
          const label=frame.document.createElement('b');
          label.textContent='#'+item.rank+' '+(item.emoji||'🎙️')+' '+
            (item.name||'Room')+' · ID '+item.room_id;
          const amount=frame.document.createElement('span');
          amount.textContent='🪙 '+Number(item.total||0).toLocaleString('en-US');
          row.append(label,amount);
          target.appendChild(row);
        }
      }catch(error){
        if(target.isConnected)target.textContent='Room ranking unavailable: '+errText(error);
      }
    };
    wireSoveraRoomFrames(frame);
    await loadVerifiedCosmetics().catch(error=>console.warn('Cosmetic art:',errText(error)));
    await syncFrame(room,frame);
    // Each phone consumes the same verified room-entry event stream.
    // Display recent joins once, including this user's own arrival.
    async function pollRoomEntries(){
      if(entryPollInFlight)return entryPollInFlight;
      const work=(async()=>{
        if(window.cur?.id!==room.id)return;
        const data=await api('GET','/rooms/'+room.id+'/entries?after='+lastEntryEventId);
        if(window.cur?.id!==room.id ||
           document.getElementById('rf')?.contentWindow!==frame)return;
        for(const event of data.events||[]){
          const id=Number(event.id);
          if(!Number.isSafeInteger(id)||id<=lastEntryEventId)continue;
          lastEntryEventId=id;
          if(Date.now()-Number(event.created_at_ms)>20000)continue;
          if(!entryArt(event.entry_style))
            await loadVerifiedCosmetics().catch(()=>{});
          if(entryArt(event.entry_style))
            playSoveraEntry(frame.document,event.entry_style);
        }
      })();
      entryPollInFlight=work;
      try{return await work;}finally{if(entryPollInFlight===work)entryPollInFlight=null;}
    }
    pollRoomEntries().catch(error=>console.warn('Room entries:',errText(error)));
    if(entryPoll)clearInterval(entryPoll);
    entryPoll=setInterval(()=>{
      if(window.cur?.id===room.id)pollRoomEntries().catch(()=>{});
    },2500);
    try {
      const voice=await connectVoice(room.id);
      frame.toast(voice.publishing?'Voice connected, microphone on':'Listening to room');
    } catch(error) {
      frame.toast('Voice pending: '+errText(error));
    }
    if(framePoll) clearInterval(framePoll);
    framePoll=setInterval(()=>{
      if(window.cur?.id!==room.id)return;
      syncFrame(room,frame).catch(error=>{
        if(errText(error)==='join_room_first') {
          window.leaveRoom();
          toast('The room owner removed you from the room');
        }
      });
    },8000);
    if(giftPoll)clearInterval(giftPoll);
    pollGiftEvents().catch(()=>{});
    giftPoll=setInterval(()=>{if(window.cur?.id===room.id)pollGiftEvents().catch(()=>{});},5000);
  }
  // Block simulated gift/chat bots in the original room HTML only in this
  // packaged staging APK. Do not edit the user's original layout or art.
  if(typeof window.ROOM_HTML === 'string') {
    window.ROOM_HTML=window.ROOM_HTML.replace('coins:12450,xp:7200','coins:0,xp:0');
    window.ROOM_HTML=window.ROOM_HTML.replace(
      /var base=\[\{n:"You",e:"😎"\}[\s\S]*?\];\nfor\(var q=0;/,
      'var base=[];\nfor(var q=0;');
    window.ROOM_HTML=window.ROOM_HTML.replace('setInterval(botGift,28000);','');
    window.ROOM_HTML=window.ROOM_HTML.replace(
      'function others(){return seats.filter(function(s){return s.i>0&&!s.empty&&!s.lock})}',
      'function others(){return seats.filter(function(s){return !s.empty&&!s.lock})}');
    window.ROOM_HTML=window.ROOM_HTML.replace(
      /setInterval\(function\(\)\{var o=others\(\);[\s\S]*?\},9000\);/,'');
    window.ROOM_HTML=window.ROOM_HTML.replace(
      'msg("Rafi","🧑‍🎤","Greetings to everyone 👋",{ci:1,lv:16});'+
      'msg("Nusrat","👩‍🦰","Will sing tonight 🎶",{ci:2,lv:19});','');
  }
  const originalOpenRoom=window.openRoom;
  window.openRoom=async function(room) {
    if(!session){ window.showAuth('welcome'); return; }
    try {
      const prior=window.cur;
      if(prior?.id===room.id) {
        document.getElementById('rw')?.classList.add('on');
        document.getElementById('mini')?.classList.remove('on');
        return;
      }
      // Room-to-room navigation must release old seats, membership and audio.
      if(prior && prior.id!==room.id) {
        if(framePoll){clearInterval(framePoll);framePoll=null;}
        if(giftPoll){clearInterval(giftPoll);giftPoll=null;}
        if(chatPoll){clearInterval(chatPoll);chatPoll=null;}
        if(entryPoll){clearInterval(entryPoll);entryPoll=null;}
        if(reactionPoll){clearInterval(reactionPoll);reactionPoll=null;}
        if(invitePoll){clearInterval(invitePoll);invitePoll=null;}
        await releaseVoice();
        await api('POST','/rooms/'+prior.id+'/leave',{});
      }
      await api('POST','/rooms/'+room.id+'/join',{});
      heartbeatPresence(room.id);
      const iframe=document.getElementById('rf');
      iframe.onload=()=>attachFrame(room).catch(error=>toast(errText(error)));
      originalOpenRoom(room);
    } catch(error) { toast('Could not join: '+errText(error)); }
  };
  const originalLeaveRoom=window.leaveRoom;
  window.leaveRoom=function() {
    const current=window.cur;
    if(framePoll){clearInterval(framePoll);framePoll=null;}
    if(giftPoll){clearInterval(giftPoll);giftPoll=null;}
    if(chatPoll){clearInterval(chatPoll);chatPoll=null;}
        if(entryPoll){clearInterval(entryPoll);entryPoll=null;}
    if(reactionPoll){clearInterval(reactionPoll);reactionPoll=null;}
        if(invitePoll){clearInterval(invitePoll);invitePoll=null;}
    releaseVoice().catch(()=>{});
    if(current && session)api('POST','/rooms/'+current.id+'/leave',{}).catch(()=>{});
    if(session)heartbeatPresence(null);
    const iframe=document.getElementById('rf');
    if(iframe) iframe.onload=null;
    originalLeaveRoom();
  };
  // Preserve original recharge/exchange artwork and read the exact
  // Super-Admin controlled exchange quote from the verified Worker.
  window.RATE=0.7;
  window.SHARIKA_EXCHANGE_FROM=100;
  window.SHARIKA_EXCHANGE_TO=70;
  let exchangeRateRevision=1,exchangeRateFetch=null;
  async function refreshVerifiedExchangeRate(){
    if(!session)return;
    if(exchangeRateFetch)return exchangeRateFetch;
    const viewer=session.user.id;
    exchangeRateFetch=(async()=>{
      const quote=await api('GET','/wallet/exchange-rate');
      if(session?.user?.id!==viewer)return;
      const from=Number(quote.diamonds_per_unit),to=Number(quote.coins_per_unit);
      if(!Number.isSafeInteger(from)||from<1||!Number.isSafeInteger(to)||to<1||
         !Number.isSafeInteger(quote.revision)||quote.revision<1)
        throw new Error('Invalid verified exchange rate');
      const changed=window.SHARIKA_EXCHANGE_FROM!==from||
        window.SHARIKA_EXCHANGE_TO!==to;
      window.SHARIKA_EXCHANGE_FROM=from;
      window.SHARIKA_EXCHANGE_TO=to;
      window.RATE=to/from;
      exchangeRateRevision=quote.revision;
      if(changed&&document.getElementById('rcp')?.classList.contains('on')&&
         window.RCT===1&&typeof window.renderRcp==='function')
        window.renderRcp();
    })();
    try{return await exchangeRateFetch;}
    finally{exchangeRateFetch=null;}
  }
  const originalRechargeSheet=window.rechargeSheet;
  if(typeof originalRechargeSheet==='function')window.rechargeSheet=function(...args){
    const value=originalRechargeSheet.apply(this,args);
    if(args[0]===1)refreshVerifiedExchangeRate().catch(error=>toast(errText(error)));
    return value;
  };
  document.addEventListener('click',event=>{
    if(event.target.closest?.('#rcp [data-x="1"]'))
      refreshVerifiedExchangeRate().catch(error=>toast('Exchange rate: '+errText(error)));
  },true);
  let selectedRecharge='';let selectedDiamonds=null;let walletOperationBusy=false;
  let pendingExchangeRequest=null;
  document.addEventListener('click',e=>{
    const exchange=e.target.closest?.('#rcp [data-e]');
    if(exchange){
      const unit=Number(window.SHARIKA_EXCHANGE_FROM)||100;
      const presets=[500,1000,5000,20000].map(n=>Math.max(unit,Math.ceil(n/unit)*unit));
      selectedDiamonds=presets[Number(exchange.dataset.e)]||null;
    }
    const recharge=e.target.closest?.('#rcp [data-p]');
    if(recharge)selectedRecharge=recharge.textContent.trim().replace(/\s+/g,' ').slice(0,150);
  },true);
  function nextWalletRequestId(prefix){
    return prefix+':'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2);
  }

  // Approved Coin Sellers: actual D1 seller rows, never fabricated profiles.
  let pendingSellerTransfer=null; // retained across sheet reopen for safe network retries
  const sellerEscape=v=>String(v==null?'':v).replace(/[&<>"']/g,
    c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Seller Wallet styling is scoped to this sheet; the original app design stays intact.
  function ensureSellerWalletStyle(){
    if(document.getElementById('sharika-seller-wallet-v2-style'))return;
    const style=document.createElement('style');
    style.id='sharika-seller-wallet-v2-style';
    style.textContent=[
      '#sharika-seller-content{box-sizing:border-box;width:100%;max-width:100%;color:#f8f7ff;font-family:inherit}',
      '#sharika-seller-content *{box-sizing:border-box}',
      '#sharika-seller-content .shw-hero{position:relative;overflow:hidden;padding:21px 18px;border-radius:22px;background:linear-gradient(130deg,#5931a8 0%,#342b9f 55%,#1175b4 100%);border:1px solid #ffffff54;box-shadow:inset 0 2px 1px #ffffff65,0 12px 22px #050c4266;margin:14px 0}',
      '#sharika-seller-content .shw-hero:after{content:"";position:absolute;right:-42px;top:-55px;width:178px;height:178px;border-radius:50%;background:radial-gradient(circle,#ffcf6d6c 0%,transparent 68%);pointer-events:none}',
      '#sharika-seller-content .shw-eyebrow{font-size:12px;font-weight:800;letter-spacing:.8px;color:#e6dcff;text-transform:uppercase}',
      '#sharika-seller-content .shw-stock{font-size:30px;font-weight:900;line-height:1.3;letter-spacing:-.6px;text-shadow:0 2px 8px #0006;overflow-wrap:anywhere}',
      '#sharika-seller-content .shw-stock small{font-size:14px;font-weight:700;letter-spacing:0;color:#ffdf8b}',
      '#sharika-seller-content .shw-id{display:inline-flex;align-items:center;gap:7px;border:1px solid #ffffff68;border-radius:999px;padding:7px 11px;background:#ffffff22;font-size:12px;font-weight:700;margin-top:13px}',
      '#sharika-seller-content .shw-section{background:linear-gradient(160deg,#ffffff1e,#ffffff0b);border:1px solid #ffffff36;box-shadow:inset 0 1px #ffffff32,0 10px 18px #020e3860;border-radius:19px;padding:16px;margin:12px 0}',
      '#sharika-seller-content .shw-title{margin:0 0 6px;font-size:17px;font-weight:900;color:white}',
      '#sharika-seller-content .shw-sub{font-size:12px;color:#dcdff9;line-height:1.5;margin:0 0 14px}',
      '#sharika-seller-content .shw-label{display:block;font-size:12px;font-weight:800;color:#e7ddff;margin:12px 0 6px}',
      '#sharika-seller-content .shw-control-row{display:flex;gap:8px;align-items:stretch}',
      '#sharika-seller-content .shw-input{display:block;min-width:0;width:100%;flex:1;border:1px solid #9eaeed!important;border-radius:13px!important;background:#f8f9ff!important;color:#1b2355!important;font-size:16px!important;font-weight:800;padding:13px 12px!important;outline:none!important;box-shadow:inset 0 2px 5px #071b2522!important}',
      '#sharika-seller-content .shw-input:focus{border-color:#ffd373!important;box-shadow:0 0 0 3px #ffd37342!important}',
      '#sharika-seller-content .shw-input::placeholder{color:#7782a0;font-weight:500}',
      '#sharika-seller-content .shw-mini{border:1px solid #ffdb7e88;border-radius:12px;color:#ffecb8;background:#eab94726;font-size:12px;font-weight:800;padding:0 11px;white-space:nowrap}',
      '#sharika-seller-content .shw-chips{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:9px}',
      '#sharika-seller-content .shw-chip{border-radius:11px;border:1px solid #ffffff55;background:#ffffff18;color:#fff;padding:9px 3px;font-size:12px;font-weight:800}',
      '#sharika-seller-content .shw-chip:active,#sharika-seller-content .shw-mini:active{transform:translateY(1px)}',
      '#sharika-seller-content .shw-submit{display:block;width:100%;margin-top:16px;border:1px solid #fff2ab;border-radius:15px;padding:14px 12px;color:#392303;font-size:15px;font-weight:900;background:linear-gradient(180deg,#fff0a8,#ffc947 57%,#e5a821);box-shadow:inset 0 2px 2px #fff9,0 7px 14px #050a4066}',
      '#sharika-seller-content .shw-submit:disabled{opacity:.6;cursor:wait;box-shadow:none}',
      '#sharika-seller-content .shw-note{margin-top:10px;font-size:12px;line-height:1.5;min-height:1em;overflow-wrap:anywhere}',
      '#sharika-seller-content .shw-note[data-tone="success"]{color:#a6ffda}',
      '#sharika-seller-content .shw-note[data-tone="error"]{color:#ffbdbd}',
      '#sharika-seller-content .shw-note[data-tone="info"]{color:#f9e9bb}',
      '#sharika-seller-content .shw-details{border-radius:16px;border:1px solid #ffffff35;background:#ffffff11;margin:11px 0;overflow:hidden}',
      '#sharika-seller-content .shw-details summary{cursor:pointer;padding:14px 15px;font-size:14px;font-weight:900;color:#fff;list-style-position:inside}',
      '#sharika-seller-content .shw-entry{margin:0 10px 9px;padding:10px 12px;border-radius:12px;background:#ffffff18;border:1px solid #ffffff21;font-size:12px;line-height:1.5;color:#dfe7ff}',
      '#sharika-seller-content .shw-entry strong{display:block;font-size:13px;color:#fff;margin-bottom:3px}',
      '#sharika-seller-content .shw-tag{display:inline-block;margin-left:5px;padding:2px 5px;background:#a8ffe233;border-radius:5px;color:#b7ffe7;font-size:10px;font-weight:800}',
      '#sharika-seller-content .shw-empty{padding:4px 15px 14px;color:#becae9;font-size:12px}',
      '@media(max-width:360px){#sharika-seller-content .shw-stock{font-size:25px}#sharika-seller-content .shw-section{padding:12px}#sharika-seller-content .shw-mini{padding:0 8px}}',
      '@media(prefers-reduced-motion:reduce){#sharika-seller-content .shw-chip:active{transform:none}}'
    ].join('');
    document.head.appendChild(style);
  }
  async function showVerifiedCoinSellers({walletOnly=false,targetId=''}={}){
    if(walletOnly)ensureSellerWalletStyle();
    window.openSheet('<h3>🪙 '+(walletOnly?'Seller Wallet':'Coin sellers')+
      '</h3><div id="sharika-seller-content">Loading verified seller data…</div>');
    const root=document.getElementById('sharika-seller-content');
    if(!root)return;
    try{
      if(!walletOnly){
        // Public directory only. Never fetch private stock, allocations or
        // transfers, and never render a recharge control on this screen.
        const directory=await api('GET','/sellers');
        if(!root.isConnected)return;
        const listed=(directory.sellers||[]).map(s=>{
          const photo=verifiedAvatarUrl(s.pic);
          return '<div class="card" style="display:flex;align-items:center;gap:11px;'+
            'padding:12px;margin:9px 0;border-radius:16px;'+
            'background:linear-gradient(110deg,#b878f6,#8140e5);color:#fff">'+
            (photo?'<img src="'+sellerEscape(photo)+'" alt="" style="width:54px;'+
              'height:54px;border-radius:50%;object-fit:cover;flex-shrink:0">':
              '<span style="font-size:31px;flex-shrink:0">🪙</span>')+
            '<div style="min-width:0;flex:1"><b>'+sellerEscape(s.name||'Coin seller')+
            '</b><div style="font-size:12px;margin-top:5px">ID '+
            sellerEscape(s.public_id)+'</div></div>'+
            '<button class="btn" type="button" data-seller-copy="'+
            sellerEscape(s.public_id)+'" style="padding:8px 10px;flex-shrink:0">'+
            'Copy ID</button></div>';
        }).join('');
        root.innerHTML='<p class="n">Approved coin sellers · verified Sharika IDs</p>'+
          (listed||'<div class="empty">No approved coin sellers yet.</div>');
        root.querySelectorAll('[data-seller-copy]').forEach(button=>{
          button.onclick=async()=>{
            const id=button.dataset.sellerCopy;
            try{await navigator.clipboard.writeText(id);toast('Seller ID copied ✓');}
            catch(_){toast('Seller ID: '+id);}
          };
        });
        return;
      }
      // Private wallet: access and every stock movement are verified by the Worker.
      const [mine,transfers,allocations]=await Promise.all([
        api('GET','/sellers/me'),api('GET','/sellers/transfers'),
        api('GET','/sellers/allocations')
      ]);
      if(!root.isConnected)return;
      const self=mine.seller;
      root.classList.add('sharika-seller-wallet');
      if(!self?.active){
        root.innerHTML='<div class="shw-section">Seller Wallet is available only to approved coin sellers.</div>';
        return;
      }
      const coinsText=value=>Number(value||0).toLocaleString('en-US');
      const transferEntries=rows=>(rows||[]).slice(0,30).map(t=>{
        const isSelf=t.sender_public_id===t.recipient_public_id;
        return '<div class="shw-entry"><strong>🪙 '+coinsText(t.coins)+' coins'+
          (isSelf?'<span class="shw-tag">SELF</span>':'')+'</strong>'+
          'Transfer #'+sellerEscape(t.id)+' · ID '+sellerEscape(t.sender_public_id)+
          ' → '+sellerEscape(t.recipient_public_id)+
          (t.created_at?' · '+sellerEscape(t.created_at):'')+'</div>';
      }).join('')||'<div class="shw-empty">No transfers yet.</div>';
      const allocationEntries=(allocations.allocations||[]).slice(0,30).map(a=>
        '<div class="shw-entry"><strong>✨ +'+coinsText(a.coins)+' stock coins</strong>'+
        'Allocation #'+sellerEscape(a.id)+' · Admin '+sellerEscape(a.sender_public_id)+
        ' → Seller '+sellerEscape(a.seller_public_id)+
        (a.created_at?' · '+sellerEscape(a.created_at):'')+'</div>'
      ).join('')||'<div class="shw-empty">No stock allocations yet.</div>';
      root.innerHTML=
        '<section class="shw-hero">'+
          '<div class="shw-eyebrow">🪙 Available seller stock</div>'+
          '<div class="shw-stock"><span id="sharika-seller-stock">'+
            coinsText(self.available_coins)+'</span> <small>coins</small></div>'+
          '<div class="shw-id">✓ Verified seller · ID '+sellerEscape(self.public_id)+'</div>'+
        '</section>'+
        '<section class="shw-section">'+
          '<h4 class="shw-title">✨ Recharge my ID or another user</h4>'+
          '<p class="shw-sub">Recharge any active Sharika ID, including your own. Coins are deducted from your assigned seller stock.</p>'+
          '<label class="shw-label" for="sharika-seller-target">Recipient user ID</label>'+
          '<div class="shw-control-row">'+
            '<input class="shw-input" id="sharika-seller-target" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="8-digit user ID" aria-label="Recipient user ID">'+
            '<button class="shw-mini" id="sharika-seller-my-id" type="button">My ID</button>'+
          '</div>'+
          '<label class="shw-label" for="sharika-seller-amount">Amount in coins</label>'+
          '<input class="shw-input" id="sharika-seller-amount" inputmode="numeric" autocomplete="off" placeholder="Enter amount (up to 1,000,000)" aria-label="Coins to recharge">'+
          '<div class="shw-chips" aria-label="Quick recharge amounts">'+
            '<button type="button" class="shw-chip" data-seller-amount="1000">1K</button>'+
            '<button type="button" class="shw-chip" data-seller-amount="10000">10K</button>'+
            '<button type="button" class="shw-chip" data-seller-amount="100000">100K</button>'+
            '<button type="button" class="shw-chip" data-seller-amount="1000000">1M</button>'+
          '</div>'+
          '<button class="shw-submit" type="button" id="sharika-seller-send">🪙 Confirm coin recharge</button>'+
          '<div class="shw-note" id="sharika-seller-note" role="status" aria-live="polite"></div>'+
        '</section>'+
        '<details class="shw-details"><summary>📜 Transfer history ('+
          (transfers.transfers||[]).length+')</summary>'+
          '<div id="sharika-seller-history">'+transferEntries(transfers.transfers)+'</div>'+
        '</details>'+
        '<details class="shw-details"><summary>🏦 Stock allocations ('+
          (allocations.allocations||[]).length+')</summary>'+
          allocationEntries+'</details>';
      const targetField=document.getElementById('sharika-seller-target');
      const amountField=document.getElementById('sharika-seller-amount');
      const note=document.getElementById('sharika-seller-note');
      const send=document.getElementById('sharika-seller-send');
      // A seller's own verified ID is the default recipient. Other users
      // remain reachable by entering their eight-digit ID explicitly.
      if(targetField)targetField.value=/^[0-9]{8}$/.test(targetId)
        ?targetId:self.public_id;
      document.getElementById('sharika-seller-my-id')?.addEventListener('click',()=>{
        if(targetField){targetField.value=self.public_id;targetField.focus();}
      });
      root.querySelectorAll('[data-seller-amount]').forEach(button=>{
        button.addEventListener('click',()=>{
          if(amountField){amountField.value=button.dataset.sellerAmount;amountField.focus();}
        });
      });
      const showNote=(message,tone)=>{
        if(note){note.textContent=message;note.dataset.tone=tone;}
      };
      const sellerError=error=>{
        const code=errText(error);
        const messages={
          seller_stock_insufficient:'Not enough seller stock for this recharge.',
          recipient_balance_limit:'This user has reached the coin wallet limit.',
          recipient_unavailable:'Recipient ID not found or inactive.',
          seller_not_approved:'Your seller permission is not active.',
          idempotency_conflict:'This recharge attempt has changed. Check history before trying again.',
          invalid_seller_transfer:'Please enter a valid ID and coin amount.',
          seller_adult_only:'This account is not eligible for seller transfers.'
        };
        return messages[code]||code;
      };
      if(send)send.addEventListener('click',async()=>{
        const recipient=targetField?.value.trim()||'';
        const raw=amountField?.value.trim()||'';
        const amount=Number(raw);
        if(!/^[0-9]{8}$/.test(recipient)||!/^[0-9]+$/.test(raw)||
          !Number.isSafeInteger(amount)||amount<1||amount>1000000){
          showNote('Enter a valid 8-digit ID and an amount from 1 to 1,000,000 coins.','error');
          return;
        }
        if(amount>Number(self.available_coins)){
          showNote('Insufficient seller stock for this amount.','error');
          return;
        }
        send.disabled=true;
        let transferCommitted=false;
        try{
          showNote('Verifying recipient…','info');
          const verified=await api('GET','/users/'+recipient);
          if(String(verified.id)!==recipient)throw new Error('Recipient verification failed');
          const isSelf=recipient===self.public_id;
          const message=isSelf?
            'Recharge your own ID '+recipient+' with '+coinsText(amount)+' coins from seller stock?':
            'Send '+coinsText(amount)+' coins to '+String(verified.name||'User')+' (ID '+recipient+')?';
          if(!window.confirm(message)){showNote('Recharge cancelled.','info');return;}
          const fingerprint=session.user.id+':'+recipient+':'+amount;
          const requestId=pendingSellerTransfer?.fingerprint===fingerprint
            ?pendingSellerTransfer.requestId:nextWalletRequestId('seller');
          pendingSellerTransfer={fingerprint,requestId};
          showNote('Recording recharge securely…','info');
          const result=await api('POST','/sellers/transfer',{
            target_public_id:recipient,coins:amount,request_id:requestId
          });
          transferCommitted=true;pendingSellerTransfer=null;
          self.available_coins=Number(result.available_coins);
          const stockLabel=document.getElementById('sharika-seller-stock');
          if(stockLabel)stockLabel.textContent=coinsText(result.available_coins);
          if(amountField)amountField.value='';
          showNote((result.duplicate?'Already recorded: ':'Success! ')+
            (result.self_recharge?'Your own wallet':'Recipient ID '+recipient)+
            ' received '+coinsText(amount)+' coins. Transfer #'+result.transfer_id+
            (Number(result.first_recharge_bonus_coins)>0?
              '. 🎁 First recharge bonus +'+coinsText(result.first_recharge_bonus_coins)+' coins':'')+
            '. Remaining stock: '+coinsText(result.available_coins)+'.','success');
          toast('Coin recharge recorded ✓');
          const latest=await api('GET','/sellers/transfers').catch(()=>null);
          const history=document.getElementById('sharika-seller-history');
          if(history&&latest)history.innerHTML=transferEntries(latest.transfers);
          await refreshWalletAfterConfirmedTransaction();
        }catch(error){
          showNote((transferCommitted?'Recharge saved; display update delayed: ':
            'Recharge not confirmed. Check history before retrying: ')+
            sellerError(error),'error');
        }finally{if(send.isConnected)send.disabled=false;}
      });
    }catch(error){
      if(root.isConnected)root.textContent='Unable to load seller wallet: '+errText(error);
    }
  }


  // Keep the original Recharge screen and show the independent Seller Wallet
  // button there only for authenticated, approved sellers.
  let sellerWalletButtonCheck=false;
  function mountRechargeSellerWallet(){
    const listButton=document.querySelector('#rcp #rcl2');
    if(!listButton||!session?.user?.id||sellerWalletButtonCheck||
       listButton.previousElementSibling?.id==='sharika-recharge-seller-wallet')return;
    sellerWalletButtonCheck=true;
    const viewer=session.user.id;
    api('GET','/sellers/me').then(data=>{
      if(!data.seller?.active||session?.user?.id!==viewer||
         !listButton.isConnected||
         document.getElementById('sharika-recharge-seller-wallet'))return;
      const button=document.createElement('button');
      button.type='button';
      button.id='sharika-recharge-seller-wallet';
      button.className='cta bl';
      button.textContent='Seller Wallet';
      button.onclick=()=>showVerifiedCoinSellers({walletOnly:true});
      listButton.before(button);
    }).catch(()=>{}).finally(()=>{sellerWalletButtonCheck=false;});
  }
  const rechargeRoot=document.getElementById('rcp');
  if(rechargeRoot){
    new MutationObserver(mountRechargeSellerWallet).observe(rechargeRoot,{
      childList:true,subtree:false
    });
  }


  // Public banner metadata is populated by verified Super-Admin D1 records.
  // Keep the original 3D carousel/scroll behavior and never show demo offers.
  function renderVerifiedBanners(list){
    const approved=Array.isArray(list)?list.filter(row=>row&&
      typeof row.title==='string'&&row.title.length<=80&&
      /^#[0-9a-fA-F]{6}$/.test(row.color_a||'')&&
      /^#[0-9a-fA-F]{6}$/.test(row.color_b||'')&&
      ['none','daily','recharge','rank','invite'].includes(row.action)).slice(0,10):[];
    const cards=approved.map(row=>({
      t:row.title,s:String(row.subtitle||'').slice(0,160),
      e:String(row.emoji||'🎉').slice(0,12),
      c:row.color_a+','+row.color_b,a:row.action
    }));
    if(!cards.length)cards.push({t:'Welcome to Sharika',
      s:'Talk with friends in voice rooms',e:'🎙️',c:'#9b4dff,#0ea5e9',a:'none'});
    window.CFG.banners=cards;
    const slide=document.getElementById('ban'),dots=document.getElementById('dots');
    if(slide)slide.innerHTML=cards.map((row,i)=>
      '<div class="slide" data-i="'+i+'" style="background:linear-gradient(135deg,'+
      row.c+')"><b>'+sellerEscape(row.t)+'</b><small>'+sellerEscape(row.s)+
      '</small><i>'+sellerEscape(row.e)+'</i></div>').join('');
    if(dots)dots.innerHTML=cards.map((_,i)=>'<u'+(!i?' class="on"':'')+'></u>').join('');
    window.bi=0;
  }
  async function refreshVerifiedBanners(){
    if(!session)return;
    const data=await api('GET','/banners');
    if(session)renderVerifiedBanners(data.banners);
  }
  renderVerifiedBanners([]);

  // Seller tools belong only in the verified seller's own wallet/profile.
  // Showing a seller action on a stranger's public ID falsely suggests that
  // recipient has an approved seller role.

  // Original daily reward card retained; values and claim status come from D1.
  // Existing Sharika bottom sheet, with a premium raised/gold-frame finish.
  const dailyDepth=document.createElement('style');
  dailyDepth.id='sharika-daily-3d-styles';
  dailyDepth.textContent=[
    '#sh.sharika-daily-3d{background:radial-gradient(ellipse at 90% 0%,#7757d3 0,transparent 35%),',
    'linear-gradient(160deg,#252c88 0%,#181e64 62%,#0d1348 100%);',
    'border-top:3px solid #ffeaa0;border-radius:31px 31px 0 0;',
    'box-shadow:0 -12px 46px #7351ff99,inset 0 5px 0 #ffffff44;max-height:90%}',
    '#sh.sharika-daily-3d h3{font-size:22px;color:#fff;text-shadow:0 3px 9px #08083f;',
    'margin:3px 0 14px;font-weight:900}',
    '#sh-daily-hero{border-radius:24px;padding:16px;margin-bottom:15px;',
    'border:2px solid #ffe28a;background:linear-gradient(145deg,#6847bc,#283a94 65%,#18205f);',
    'box-shadow:inset 0 3px 0 #ffffff60,inset 0 -3px 6px #0d114b,',
    '0 7px 0 #8c59a8,0 15px 25px #090a3c88;position:relative;overflow:hidden}',
    '#sh-daily-hero:before{content:"✦";position:absolute;right:10px;top:-16px;',
    'color:#ffeab7;font-size:80px;opacity:.18;pointer-events:none}',
    '#sh-daily-hero b{display:block;color:#fff3bf;font-size:18px;text-shadow:0 2px 6px #0009}',
    '#sh-daily-hero small{display:block;color:#f0e9ff;margin-top:5px;font-size:12px}',
    '#sh-daily-reset{color:#ffecb0;font-size:12px;margin-top:10px;font-weight:700}',
    '#sh-daily-days{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));',
    'gap:10px;margin:13px 0 20px}',
    '#sh-daily-days .sh-day-tile{min-width:0;padding:12px 2px 10px;border-radius:20px;',
    'background:linear-gradient(150deg,#4154a5,#283178 68%,#1a2359);',
    'border:1px solid #6e82d3;text-align:center;color:#fff4c5;',
    'box-shadow:inset 0 2px 0 #ffffff55,0 5px 0 #141c55,0 9px 13px #080b3790}',
    '#sh-daily-days .sh-day-tile.current{border:2px solid #ffdb61;',
    'background:linear-gradient(150deg,#b875f5,#5740b3 55%,#353a96);',
    'box-shadow:inset 0 2px 1px #ffffffb0,0 5px 0 #8052a6,',
    '0 0 17px #f9d76eaa,0 11px 22px #130c4777}',
    '#sh-daily-days .sh-day-tile.collected{opacity:.68;filter:saturate(.5)}',
    '#sh-daily-days .sh-day-icon{display:block;font-size:28px;filter:drop-shadow(0 4px 3px #120c49);',
    'margin:0 auto 5px}',
    '#sh-daily-days .sh-day-name{display:block;font-size:12px;font-weight:700}',
    '#sh-daily-days .sh-day-coins{display:block;color:#ffe782;font-size:13px;font-weight:900}',
    '#sh.sharika-daily-3d #cl{border:2px solid #fff1b9;border-radius:25px;',
    'background:linear-gradient(155deg,#ffe892,#ffb82b 40%,#d68116);',
    'color:#563000;font-size:18px;font-weight:900;',
    'box-shadow:inset 0 3px 0 #ffffffb8,0 6px 0 #915211,0 14px 25px #080c3880}',
    '#sh.sharika-daily-3d #cl:disabled{background:linear-gradient(#7365b0,#4e428d);',
    'border-color:#a5a3d5;color:#e6e2ff;box-shadow:inset 0 2px 0 #ffffff42,0 4px 0 #373367}',
    '#sh-daily-activities{margin-top:22px}',
    '#sh-daily-activities h4{color:#ffebb4;font-size:18px;margin:0 0 13px}',
    '#sh-daily-activities .sh-task-card{display:flex;align-items:center;gap:10px;',
    'border:1px solid #b59de0;border-radius:20px;padding:12px 11px;margin:12px 0;',
    'background:linear-gradient(145deg,#4a428f,#242968 68%,#1b2056);',
    'box-shadow:inset 0 2px 0 #ffffff45,0 5px 0 #15164a,0 9px 17px #070a3580}',
    '#sh-daily-activities .sh-task-icon{flex:none;width:43px;height:43px;border-radius:15px;',
    'display:grid;place-items:center;font-size:26px;background:linear-gradient(#ffda77,#b574d9);',
    'box-shadow:inset 0 2px 1px #fff8,0 4px 0 #3a2d7e}',
    '#sh-daily-activities .sh-task-text{flex:1;min-width:0;font-size:13px;color:#fff}',
    '#sh-daily-activities .sh-task-text strong{display:block;line-height:1.35}',
    '#sh-daily-activities .sh-task-text small{color:#fce6a8;font-size:12px}',
    '#sh-daily-activities .sh-task-claim{flex:none;border:1px solid #fff5bd;',
    'border-radius:13px;color:#4e2d00;background:linear-gradient(#ffeb93,#ebad28);',
    'font-weight:900;padding:11px 12px;',
    'box-shadow:inset 0 2px 0 #fff9d4,0 4px 0 #92601c}',
    '#sh-daily-activities .sh-task-claim:disabled{background:#454878;color:#c6c5de;',
    'border-color:#767bb2;box-shadow:none}',
    '#sh-daily-activities .sh-task-claim:active:not(:disabled),',
    '#sh.sharika-daily-3d #cl:active:not(:disabled){transform:translateY(4px);box-shadow:0 1px 0 #5a3673}',
    '#sh-daily-foot{font-size:12px;color:#bdc3ed;padding:12px 3px 2px}'
  ].join('');
  document.head.appendChild(dailyDepth);
  let dailyResetTimer=null;
  const oldOpenSheetDaily=window.openSheet;
  if(typeof oldOpenSheetDaily==='function')window.openSheet=function(){
    const sheet=document.getElementById('sh');
    sheet?.classList.remove('sharika-daily-3d');
    if(dailyResetTimer){clearInterval(dailyResetTimer);dailyResetTimer=null;}
    return oldOpenSheetDaily.apply(this,arguments);
  };
  function setDailyClock(resetUtc){
    const resetTime=Date.parse(resetUtc);
    if(!Number.isFinite(resetTime))return;
    if(dailyResetTimer)clearInterval(dailyResetTimer);
    const tick=()=>{
      const node=document.getElementById('sh-daily-reset');
      if(!node?.isConnected){clearInterval(dailyResetTimer);dailyResetTimer=null;return;}
      const seconds=Math.max(0,Math.ceil((resetTime-Date.now())/1000));
      if(seconds<=0){clearInterval(dailyResetTimer);dailyResetTimer=null;showVerifiedDailySheet();return;}
      const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60);
      node.textContent='🔄 New tasks in '+h+'h '+String(m).padStart(2,'0')+'m · Resets at 00:00 UTC';
    };
    tick();dailyResetTimer=setInterval(tick,30000);
  }

  let dailyClaimBusy=false;
  async function showVerifiedDailySheet(){
    if(!session){window.showAuth('welcome');return;}
    window.openSheet('<h3>🎁 Daily Task Center</h3>'+
      '<div id="sharika-daily-content" aria-live="polite">Loading daily rewards…</div>');
    document.getElementById('sh')?.classList.add('sharika-daily-3d');
    const root=document.getElementById('sharika-daily-content');
    if(!root)return;
    try{
      const data=await api('GET','/daily');
      if(!root.isConnected)return;
      const steps=(data.rewards||[]).map((coins,i)=>{
        const day=i+1;
        const current=day===data.next_day;
        const collected=!!data.claimed_today&&day===data.claimed?.streak;
        return '<div class="sh-day-tile'+(current?' current':'')+(collected?' collected':'')+'">'+
          '<span class="sh-day-icon">'+(day===7?'🎁':'🪙')+'</span>'+
          '<span class="sh-day-name">Day '+day+(collected?' ✓':'')+'</span>'+
          '<span class="sh-day-coins">'+Number(coins).toLocaleString('en-US')+'</span></div>';
      }).join('');
      const claim=data.claimed_today?
        '<button class="big" id="cl" disabled>✓ Today’s check-in claimed</button>':
        '<button class="big" id="cl">🪙 Claim '+Number(data.rewards?.[data.next_day-1]||0).toLocaleString('en-US')+' coins</button>';
      const tasks=(data.tasks||[]).filter(t=>['follow','gift'].includes(t.key)).map(t=>{
        const claimLabel=t.claimed?'Collected ✓':t.completed?'Claim':'Pending';
        return '<div class="sh-task-card"><span class="sh-task-icon">'+
          (t.key==='follow'?'🤝':'🎁')+'</span><div class="sh-task-text"><strong>'+
          sellerEscape(t.title)+'</strong><small>'+
          (t.claimed?'Today’s coins received':t.completed?'Completed · reward ready':'Complete this task to unlock')+
          ' · 🪙 '+Number(t.reward_coins||0).toLocaleString('en-US')+'</small></div>'+
          '<button type="button" class="sh-task-claim" data-sh-daily-task="'+
          sellerEscape(t.key)+'"'+(!t.completed||t.claimed?' disabled':'')+'>'+
          claimLabel+'</button></div>';
      }).join('');
      root.innerHTML='<div id="sh-daily-hero"><b>✨ Daily Rewards</b>'+
        '<small>Complete real activities, collect coins and return every day.</small>'+
        '<div id="sh-daily-reset">Calculating reset time…</div></div>'+
        '<div id="sh-daily-days">'+steps+'</div>'+claim+
        '<p class="n" style="margin-top:17px;color:#dcd5ff">🔥 Check-in streak: '+
        Number(data.streak||0)+' day(s). Miss a UTC day and your streak restarts at Day 1.</p>'+
        '<div id="sh-daily-activities"><h4>⭐ Today’s Tasks</h4>'+
        (tasks||'<p>Tasks unavailable</p>')+'</div>'+
        '<button type="button" id="sh-event-launch" style="display:block;width:100%;margin:18px 0;'+
        'padding:15px;border-radius:19px;border:2px solid #ffdb7c;background:linear-gradient(155deg,#a64bff,#573ac4);'+
        'color:#fff;font-size:17px;font-weight:900;box-shadow:0 6px 0 #332179,0 11px 20px #100d4c">'+
        '🏆 Events & Rewards →</button>'+
        '<p id="sh-daily-foot">Rewards can be claimed once per task per UTC day. '+
        'Tomorrow tasks reset automatically; your previous coins remain in your wallet.</p>';
      setDailyClock(data.next_reset_utc);
    }catch(error){if(root.isConnected)root.textContent='Daily rewards unavailable: '+errText(error);}
  }

  // Server-published events only: no fake leaderboards, self-reported scores or client coins.
  async function showVerifiedEventSheet(){
    if(!session){window.showAuth('welcome');return;}
    window.openSheet('<h3>🏆 Events & Rewards</h3>'+
      '<div id="sh-event-app-list" aria-live="polite">Loading verified events…</div>');
    document.getElementById('sh')?.classList.add('sharika-daily-3d');
    const root=document.getElementById('sh-event-app-list');
    if(!root)return;
    try{
      const result=await api('GET','/events');
      if(!root.isConnected)return;
      const events=(result.events||[]).filter(e=>e.published);
      const fmtEventDate=iso=>{
        const date=new Date(iso);
        return Number.isFinite(+date)?date.toLocaleString('en-US',{month:'short',day:'numeric',
          year:'numeric',hour:'2-digit',minute:'2-digit'}):'Unknown date';
      };
      root.innerHTML='<div id="sh-daily-hero"><b>✨ Sharika Official Events</b>'+
        '<small>Participate during event time. Verified winners receive real wallet coins '+
        'when the event is settled by Admin.</small></div>'+
        (events.length?events.map(e=>{
          const status=e.status==='live'?'🔴 LIVE':e.status==='scheduled'?'⏰ UPCOMING':'✅ ENDED';
          const tiers=(e.prizes||[]).map((coins,i)=>Number(coins)>0?
            '<span style="padding:6px 8px;border:1px solid #f6da8f;border-radius:12px;'+
            'background:#20134e;font-size:13px;color:#ffe88a">'+
            (['🥇','🥈','🥉'][i]||'🏅')+' '+Number(coins).toLocaleString('en-US')+' coins</span>':'').join(' ');
          const winners=(e.awards||[]).map(a=>'<div style="font-size:13px;padding:5px 0;'+
            'color:#d9ffdf">✓ Rank '+Number(a.rank)+' · '+sellerEscape(a.name)+
            ' (ID '+sellerEscape(a.public_id)+') received '+Number(a.coins).toLocaleString('en-US')+
            ' coins</div>').join('');
          return '<section style="margin:13px 0 18px;padding:17px 14px;border-radius:22px;'+
            'background:linear-gradient(145deg,#5e459d,#232a72);border:2px solid #f1ca73;'+
            'box-shadow:inset 0 2px 0 #ffffff48,0 6px 0 #302164,0 10px 18px #090b3e88">'+
            '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">'+
            '<strong style="color:#fff;font-size:17px">'+sellerEscape(e.title)+'</strong>'+
            '<b style="font-size:11px;color:#ffe0a9">'+status+'</b></div>'+
            '<p style="color:#e6daff;margin:8px 0;font-size:12px">'+
            sellerEscape(fmtEventDate(e.starts_at))+' — '+sellerEscape(fmtEventDate(e.ends_at))+'</p>'+
            '<p style="color:#fff;margin:10px 0;white-space:pre-wrap;font-size:13px">'+
            sellerEscape(e.description||'Official event')+'</p>'+
            '<div style="display:flex;flex-wrap:wrap;gap:5px;margin:12px 0">'+tiers+'</div>'+
            (winners?'<div style="border-top:1px solid #ffffff44;padding-top:8px">'+winners+'</div>':
            '<small style="color:#e8dcff">Rewards are paid to verified winners after the event ends.</small>')+
            '</section>';
        }).join(''):'<div id="sh-daily-hero"><b>No events yet</b>'+
          '<small>New events will appear here when Admin publishes them.</small></div>')+
        '<button type="button" id="sh-event-back" style="width:100%;padding:12px;'+
        'background:#ffdb72;color:#3c2771;font-weight:900;border-radius:14px;border:0">'+
        '← Daily Task Center</button>';
    }catch(error){
      if(root.isConnected)root.textContent='Events unavailable: '+errText(error);
    }
  }
  window.showVerifiedEvents=showVerifiedEventSheet;
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('#sh-event-launch,#sh-event-back');
    if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(button.id==='sh-event-back')showVerifiedDailySheet();
    else showVerifiedEventSheet();
  },true);

  let dailyTaskClaimBusy=false;
  async function claimVerifiedDailyTask(key,button){
    if(dailyTaskClaimBusy||!['follow','gift'].includes(key))return;
    dailyTaskClaimBusy=true;button.disabled=true;
    let confirmed=false;
    try{
      const result=await api('POST','/daily/tasks/claim',{task_key:key});
      confirmed=true;
      toast(result.duplicate?'Already collected today ✓':
        '+'+Number(result.reward_coins||0).toLocaleString('en-US')+' task coins received 🎉');
      await reloadWallet().catch(error=>console.warn('Task reward display refresh pending:',errText(error)));
    }catch(error){
      toast('Task coin claim failed: '+errText(error));
    }finally{
      dailyTaskClaimBusy=false;
      if(confirmed||button.isConnected)await showVerifiedDailySheet();
    }
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-sh-daily-task]');
    if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    claimVerifiedDailyTask(button.dataset.shDailyTask,button);
  },true);
  async function claimVerifiedDaily(){
    if(dailyClaimBusy)return;
    dailyClaimBusy=true;
    const button=document.getElementById('cl');
    if(button)button.disabled=true;
    try{
      const result=await api('POST','/daily/check-in',{});
      await reloadWallet();
      toast(result.duplicate?'Today’s reward was already claimed':
        '+'+Number(result.claimed?.reward_coins||0).toLocaleString('en-US')+' coins received 🎉');
      await showVerifiedDailySheet();
    }catch(error){
      toast('Check-in failed: '+errText(error));
      if(button)button.disabled=false;
      // A concurrent claim may have succeeded: server refresh resolves truth.
      await showVerifiedDailySheet();
    }finally{dailyClaimBusy=false;}
  }
  function verifiedInviteStyles(){
    if(document.getElementById('sharika-invite-royal-style'))return;
    const style=document.createElement('style');
    style.id='sharika-invite-royal-style';
    style.textContent=[
      '#sh-invite-page{position:fixed;inset:0;z-index:2147483500;overflow-y:auto;',
      'background:radial-gradient(circle at 50% -12%,#a535c977,transparent 47%),',
      'linear-gradient(180deg,#3c086d,#25074a 57%,#150934);color:#fff9dc;',
      'padding:calc(16px + env(safe-area-inset-top,0px)) 12px ',
      'calc(95px + env(safe-area-inset-bottom,0px));box-sizing:border-box;',
      'font-family:inherit;overscroll-behavior:contain}',
      '#sh-invite-page *{box-sizing:border-box}',
      '#sh-invite-page .sh-invite-head{display:flex;align-items:center;gap:10px;',
      'margin-bottom:13px}',
      '#sh-invite-page .sh-invite-back{width:42px;height:42px;border-radius:50%;',
      'background:#240d43;border:2px solid #f7d771;color:#ffe6a6;font-size:25px}',
      '#sh-invite-page h1{font-size:23px;margin:0;color:#fff0b4;line-height:1.2}',
      '#sh-invite-page .sh-invite-kicker{letter-spacing:2px;font-size:10px;',
      'font-weight:900;color:#ffc76c}',
      '#sh-invite-page .sh-invite-panel{position:relative;padding:18px 13px;',
      'border:3px solid #f4cb64;border-radius:24px;margin:12px 0 18px;',
      'background:radial-gradient(ellipse at 50% 0%,#8c3eacaa,transparent 60%),',
      'linear-gradient(135deg,#501279ee,#250b55f5);',
      'box-shadow:inset 0 2px #fff7,0 10px 0 #6a3688,0 16px 29px #0b051bb8}',
      '#sh-invite-page .sh-invite-panel::before{content:"✦  👑  ✦";',
      'display:block;text-align:center;margin:-13px auto 7px;color:#ffe087;',
      'font-size:21px;letter-spacing:8px;text-shadow:0 2px 7px #efb321b8}',
      '#sh-invite-page .sh-invite-title{text-align:center;font-size:20px;',
      'font-weight:900;color:#ffdfa1;margin:0 0 9px;',
      'text-shadow:0 2px #3e155b,0 0 15px #ffbd4c88}',
      '#sh-invite-page .sh-invite-sub{font-size:12px;line-height:1.45;',
      'color:#eddbff;text-align:center;margin:0 0 13px}',
      '#sh-invite-page .sh-invite-rewards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));',
      'gap:8px;margin:13px 0}',
      '#sh-invite-page .sh-invite-reward{min-width:0;text-align:center;border:1px solid #ffe39b;',
      'border-radius:17px;padding:10px 4px;background:linear-gradient(150deg,#7435a1,#3a1466);',
      'box-shadow:inset 0 2px #ffffff4e,0 5px #1d0e40}',
      '#sh-invite-page .sh-invite-reward span{display:block;font-size:25px;margin-bottom:6px}',
      '#sh-invite-page .sh-invite-reward strong{display:block;font-size:clamp(13px,4vw,20px);',
      'color:#ffeb7e;overflow-wrap:anywhere}',
      '#sh-invite-page .sh-invite-reward small{display:block;margin-top:4px;',
      'font-size:10px;color:#ebd6ff}',
      '#sh-invite-page .sh-invite-code{display:flex;align-items:center;gap:10px;',
      'border:2px solid #ffca66;border-radius:19px;padding:10px;',
      'background:#2b104f;margin:15px 0}',
      '#sh-invite-page .sh-invite-code div{flex:1;min-width:0}',
      '#sh-invite-page .sh-invite-code small{display:block;color:#bca8d9}',
      '#sh-invite-page .sh-invite-code strong{font-size:24px;color:#ffe33a;letter-spacing:1px}',
      '#sh-invite-page .sh-invite-gold{border:2px solid #fff0a0;color:#512300;',
      'background:linear-gradient(170deg,#fff29e,#ffbf33 53%,#d97a13);',
      'border-radius:999px;padding:10px 18px;font-size:14px;font-weight:900;',
      'box-shadow:inset 0 2px #fff8,0 5px #8d421b;cursor:pointer}',
      '#sh-invite-page .sh-invite-share{display:block;width:100%;margin:12px 0;',
      'font-size:17px;padding:13px 16px}',
      '#sh-invite-page .sh-invite-tabs{display:grid;grid-template-columns:1fr 1fr;',
      'gap:5px;border:1px solid #e3b0f5;border-radius:17px;padding:4px;background:#1d0b3c}',
      '#sh-invite-page .sh-invite-tabs button{border:0;border-radius:13px;',
      'font-size:13px;font-weight:900;padding:11px 4px;background:transparent;color:#d7b2eb}',
      '#sh-invite-page .sh-invite-tabs button.on{background:linear-gradient(#ffe988,#edaa21);',
      'color:#522447;box-shadow:0 3px #874619}',
      '#sh-invite-page .sh-invite-stats{display:grid;grid-template-columns:1fr 1fr;',
      'gap:8px;margin:13px 0}',
      '#sh-invite-page .sh-invite-stat{text-align:center;background:#4e258555;',
      'border:1px solid #ffc87b88;padding:12px 6px;border-radius:16px}',
      '#sh-invite-page .sh-invite-stat strong{display:block;font-size:21px;color:#ffe38e}',
      '#sh-invite-page .sh-invite-stat small{font-size:11px;color:#decaed}',
      '#sh-invite-page .sh-invite-rule{font-size:12px;line-height:1.65;color:#eadcf9;',
      'padding:9px 12px;border-left:3px solid #ffce7f;margin:7px 0;background:#1d0a3680}',
      '#sh-invite-page .sh-invite-entry{width:100%;padding:14px 12px;',
      'border:2px solid #ffd75a;border-radius:15px;background:#2a124f;',
      'color:white;font-size:17px;outline:0;margin:9px 0}',
      '#sh-invite-page .sh-invite-entry::placeholder{color:#b9a0cb}',
      '#sh-invite-page .sh-invite-rankrow{display:flex;align-items:center;gap:11px;',
      'border:1px solid #a566d9;border-radius:14px;padding:10px;margin:7px 0;',
      'background:linear-gradient(100deg,#583186,#32145d)}',
      '#sh-invite-page .sh-invite-rankrow span{min-width:35px;color:#ffd875;font-weight:900}',
      '#sh-invite-page .sh-invite-rankrow b{flex:1;min-width:0;font-size:12px}',
      '#sh-invite-page .sh-invite-rankrow small{display:block;color:#dcbcf0}',
      '#sh-invite-page .sh-invite-rankrow em{font-style:normal;color:#ffe082;font-weight:900}',
      '#sh-invite-page .sh-invite-alert{font-size:12px;color:#ffe2a1;',
      'padding:11px;border-radius:12px;background:#120b2d;border:1px solid #ffdc7b77}',
      '#sh-invite-page .sh-invite-cash{border:2px solid #e5b950;border-radius:21px;',
      'padding:14px;margin:16px 0;background:linear-gradient(145deg,#422260,#1d1248);',
      'box-shadow:0 7px 0 #201135,inset 0 2px #fff5}',
      '#sh-invite-page .sh-invite-cash-grid{display:grid;grid-template-columns:1fr 1fr;',
      'gap:8px;margin:10px 0}',
      '#sh-invite-page .sh-invite-cash button:disabled{opacity:.5;filter:grayscale(.35)}',
      '#sh-invite-newbie{position:fixed;inset:0;z-index:2147483550;',
      'display:flex;align-items:center;justify-content:center;padding:18px;',
      'background:#080319d9;backdrop-filter:blur(8px)}',
      '#sh-invite-newbie .sh-invite-welcome{position:relative;width:min(100%,420px);',
      'max-height:93vh;overflow-y:auto;text-align:center;padding:26px 19px;',
      'border:3px solid #ffe493;border-radius:32px;',
      'background:radial-gradient(circle at 50% 0%,#eb7b3f80,transparent 45%),',
      'linear-gradient(150deg,#751a54,#38104d 63%,#1a0f44);',
      'box-shadow:0 0 35px #eaa84988,inset 0 3px #fff8}',
      '#sh-invite-newbie .sh-invite-chests{font-size:35px;letter-spacing:5px;margin:12px 0}',
      '#sh-invite-newbie h2{font-size:24px;margin:6px 0;color:#ffeaad}',
      '#sh-invite-newbie p{font-size:13px;line-height:1.5;color:#fae8f5}',
      '#sh-invite-newbie .sh-invite-welcome-close{position:absolute;right:11px;top:9px;',
      'background:transparent;border:0;color:#ffe7aa;font-size:28px}',
      '#sh-invite-newbie .sh-invite-welcome-input{width:100%;margin:12px 0;',
      'padding:14px;border:1px solid #ffdc80;border-radius:15px;',
      'background:#39134b;color:#fff;font-size:16px;text-align:center}',
      '#sh-invite-newbie .sh-invite-gold{border:2px solid #ffeca3;border-radius:28px;',
      'padding:12px;color:#5e2500;background:linear-gradient(#ffe987,#f6a322,#d8730d);',
      'font-size:16px;font-weight:900;box-shadow:inset 0 2px #fff9,0 5px #722d22}',
      '#sh-invite-newbie .sh-invite-gold:disabled{opacity:.65}',
      '@media(max-width:350px){#sh-invite-page .sh-invite-rewards{gap:4px}',
      '#sh-invite-page .sh-invite-reward{padding:8px 2px}}'
    ].join('');
    document.head.appendChild(style);
  }
  async function redeemVerifiedInvite(code){
    if(!/^[0-9]{8}$/.test(String(code||'')))
      throw new Error('Enter the full 8-digit invitation code');
    const result=await api('POST','/invites/redeem',{invite_code:String(code)});
    if(!result?.claimed)throw new Error('Invitation could not be confirmed');
    await reloadWallet();
    return result;
  }
  function bindInviteRedeem(root){
    const button=root.querySelector('#sh-invite-redeem');
    const field=root.querySelector('#sh-invite-redeem-code');
    const status=root.querySelector('#sh-invite-redeem-status');
    if(!button||!field)return;
    button.onclick=async()=>{
      button.disabled=true;
      if(status)status.textContent='Checking invitation…';
      try{
        const result=await redeemVerifiedInvite(field.value.trim());
        toast('Invite verified! '+Number(result.invitee_extra_coins||0).toLocaleString('en-US')+
          ' bonus coins added ✓');
        if(document.getElementById('sh-invite-page'))await showVerifiedInviteSheet();
      }catch(error){
        if(status)status.textContent='Could not claim: '+errText(error);
        button.disabled=false;
      }
    };
  }
  function bindInviteWithdraw(root){
    const buttons=[...root.querySelectorAll('[data-sh-invite-withdraw]')];
    for(const button of buttons){
      button.onclick=async()=>{
        if(button.disabled)return;
        const amount=Number(button.dataset.shInviteWithdraw);
        if(![5000,10000].includes(amount))return;
        const status=root.querySelector('#sh-invite-withdraw-status');
        for(const item of buttons)item.disabled=true;
        if(status)status.textContent='Submitting your $'+(amount/100)+' withdrawal request…';
        try{
          const result=await api('POST','/invites/withdrawals',{
            amount_cents:amount,request_id:nextWalletRequestId('invite-withdraw')
          });
          if(!result?.requested&&!result?.duplicate)
            throw new Error('Withdrawal not submitted');
          toast('$'+(amount/100)+' withdrawal request submitted for manual review ✓');
          if(document.getElementById('sh-invite-page'))await showVerifiedInviteSheet();
        }catch(error){
          if(status)status.textContent='Request unavailable: '+errText(error);
          for(const item of buttons)item.disabled=false;
        }
      };
    }
  }
  async function maybeShowNewUserInviteWelcome(){
    if(!session||!profile||document.getElementById('sh-invite-newbie'))return;
    const publicId=String(profile.public_id||'');
    if(!/^[0-9]{8}$/.test(publicId))return;
    const seenKey='sh-invite-welcome-v1-'+publicId;
    try{if(localStorage.getItem(seenKey)==='seen')return;}catch(_){}
    let info;
    try{info=await api('GET','/invites');}catch(_){return;}
    if(!session||String(profile?.public_id)!==publicId||!info?.new_user)return;
    verifiedInviteStyles();
    const overlay=document.createElement('section');
    overlay.id='sh-invite-newbie';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-label','New member welcome bonus');
    const extra=Math.max(0,Number(info.signup_invitee_reward||0)-2000);
    overlay.innerHTML='<div class="sh-invite-welcome">'+
      '<button class="sh-invite-welcome-close" type="button" aria-label="Close">×</button>'+
      '<div style="font-size:30px">✨ 👑 ✨</div><h2>New User Royal Bonus</h2>'+
      '<div class="sh-invite-chests">🧰 🎁 💎 🏆</div>'+
      '<p>Welcome to Sharika! New members can unlock a one-time invite reward '+
      'through a verified friend.</p>'+
      '<div style="color:#ffe27b;font-size:28px;font-weight:900">🪙 '+
      Number(info.signup_invitee_reward||0).toLocaleString('en-US')+'</div>'+
      '<p>Total starting coins with a valid friend invite</p>'+
      '<div style="border:2px solid #ffe4a2;border-radius:19px;padding:10px;'+
      'background:#3d135c;margin:12px 0">'+
      '<div style="font-weight:900;color:#ffdf8c">🎁 FIRST RECHARGE CHEST</div>'+
      '<div style="font-size:23px;color:#fff6b7;font-weight:900">500K + 200K</div>'+
      '<p>For the first verified $1-equivalent recharge (500,000 coins), '+
      'unlock 200,000 extra coins once. Other amounts earn 40%.</p></div>'+
      (info.claim_eligible?'<p>Have an invitation code? Claim your remaining '+
       extra.toLocaleString('en-US')+' bonus coins within '+
       Number(info.claim_window_hours||48)+' hours of registering.</p>'+
       '<input class="sh-invite-welcome-input" inputmode="numeric" maxlength="8" '+
       'autocomplete="off" placeholder="Enter 8-digit invitation code" '+
       'aria-label="Invitation code">'+
       '<p id="sh-invite-welcome-error" aria-live="polite"></p>'+
       '<button class="sh-invite-gold" id="sh-invite-welcome-claim" type="button" '+
       'style="width:100%">🎁 Confirm & Claim</button>':
       '<p>'+(info.invited_by?'✓ Your invitation is already linked.':
        'Your invitation claim period has ended.')+'</p>')+
      '<button class="sh-invite-gold" id="sh-invite-welcome-explore" type="button" '+
      'style="width:100%;margin-top:13px">👑 Explore Invite Rewards</button>'+
      '<p style="margin:12px 0 0;font-size:11px">Invite cash earnings need '+
      'finance review. No automatic USD payout is connected yet.</p></div>';
    document.body.appendChild(overlay);
    try{localStorage.setItem(seenKey,'seen');}catch(_){}
    overlay.querySelector('.sh-invite-welcome-close').onclick=()=>overlay.remove();
    overlay.querySelector('#sh-invite-welcome-explore').onclick=()=>{
      overlay.remove();showVerifiedInviteSheet();
    };
    const claim=overlay.querySelector('#sh-invite-welcome-claim');
    if(claim)claim.onclick=async()=>{
      claim.disabled=true;
      const errorView=overlay.querySelector('#sh-invite-welcome-error');
      try{
        const code=overlay.querySelector('.sh-invite-welcome-input').value.trim();
        const redeemed=await redeemVerifiedInvite(code);
        overlay.remove();
        toast('Welcome! '+Number(redeemed.invitee_extra_coins).toLocaleString('en-US')+
          ' invite bonus coins added ✓');
      }catch(error){
        if(errorView)errorView.textContent=errText(error);
        claim.disabled=false;
      }
    };
  }
  async function showVerifiedInviteSheet(){
    if(!session){window.showAuth('welcome');return;}
    verifiedInviteStyles();
    document.getElementById('sh-invite-page')?.remove();
    const root=document.createElement('section');
    root.id='sh-invite-page';
    root.innerHTML='<div class="sh-invite-head">'+
      '<button class="sh-invite-back" type="button" aria-label="Close invites">‹</button>'+
      '<div><div class="sh-invite-kicker">✦ SHARIKA ROYAL REWARDS ✦</div>'+
      '<h1>👑 Invite Friends</h1></div></div>'+
      '<div class="sh-invite-panel" id="sharika-invite-data" aria-live="polite">'+
      'Loading verified invite rewards…</div>';
    document.body.appendChild(root);
    root.querySelector('.sh-invite-back').onclick=()=>root.remove();
    const panel=root.querySelector('#sharika-invite-data');
    try{
      const result=await api('GET','/invites');
      if(!root.isConnected)return;
      const invite=String(result.invite_code||'');
      if(!/^[0-9]{8}$/.test(invite))throw new Error('Verified ID unavailable');
      const fmt=n=>Math.max(0,Number(n)||0).toLocaleString('en-US');
      const total=fmt(result.total_invites);
      const inviteReward=fmt(result.signup_inviter_reward);
      const newcomerReward=fmt(result.signup_invitee_reward);
      const percent=Number(result.recharge_bonus_percent)||0;
      const money=cents=>'$'+(Math.max(0,Number(cents)||0)/100).toFixed(2);
      const cash=result.cash_balance||{};
      const withdrawable=Math.max(0,Number(cash.available_cents)||0);
      const newUserBonus=Math.floor(Number(result.recharge_coins_per_usd||500000)*
        Number(result.first_recharge_bonus_percent||40)/100);
      const history=(result.referrals||[]).slice(0,50).map(r=>
        '<div class="sh-invite-rankrow"><span>✓</span><b>'+
        sellerEscape(r.name||'Member')+'<small>ID '+sellerEscape(r.public_id)+
        '</small></b><em>Joined</em></div>').join('');
      panel.innerHTML='<h2 class="sh-invite-title">✨ Invite once, earn together</h2>'+
        '<p class="sh-invite-sub">Each verified invite credits 100,000 coins to YOUR '+
        'main coin wallet and 100,000 coins to your new friend. Your $0.10 '+
        'cash earning is tracked separately as Pending until reviewed.</p>'+
        '<div class="sh-invite-rewards">'+
        '<div class="sh-invite-reward"><span>🪙</span><strong>'+inviteReward+
        '</strong><small>You get per invited friend</small></div>'+
        '<div class="sh-invite-reward"><span>💝</span><strong>'+newcomerReward+
        '</strong><small>Friend gets with valid invite</small></div>'+
        '<div class="sh-invite-reward"><span>💵</span><strong>'+
        money(result.invite_usd_cents_per_verified_user||10)+
        '</strong><small>USD per verified invite · review first</small></div></div>'+
        '<div class="sh-invite-code"><div><small>YOUR INVITE CODE</small>'+
        '<strong>'+sellerEscape(invite)+'</strong></div>'+
        '<button class="sh-invite-gold" id="sharika-copy-invite" type="button">COPY</button></div>'+
        '<button class="sh-invite-gold sh-invite-share" id="sharika-share-invite" type="button">'+
        '📤 Invite friends · Share</button>'+
        '<div class="sh-invite-tabs"><button type="button" id="sh-invite-tab-overview" class="on">'+
        'My Invites</button><button type="button" id="sh-invite-tab-ranking">'+
        '🏆 Code Rankings</button></div>'+
        '<div id="sh-invite-tab-body"><div class="sh-invite-stats">'+
        '<div class="sh-invite-stat"><strong>'+total+'</strong><small>Total invitations</small></div>'+
        '<div class="sh-invite-stat"><strong>'+fmt(result.signup_bonus_coins)+
        '</strong><small>Signup coins earned</small></div>'+
        '<div class="sh-invite-stat"><strong>'+fmt(result.recharge_bonus_coins)+
        '</strong><small>Recharge coins earned</small></div>'+
        '<div class="sh-invite-stat"><strong>'+fmt(Number(result.signup_bonus_coins||0)+
        Number(result.recharge_bonus_coins||0))+
        '</strong><small>Total invite reward coins</small></div></div>'+
        '<div class="sh-invite-cash"><h2 class="sh-invite-title">💵 Invite & Earn Dollars</h2>'+
        '<p class="sh-invite-sub">10 verified referrals = $1. Each account counts once. '+
        'Cash reward requires anti-fraud review.</p>'+
        '<div class="sh-invite-stats">'+
        '<div class="sh-invite-stat"><strong>'+money(cash.pending_cents)+
        '</strong><small>Pending review</small></div>'+
        '<div class="sh-invite-stat"><strong>'+money(withdrawable)+
        '</strong><small>Available to request</small></div></div>'+
        '<div class="sh-invite-cash-grid">'+
        '<button type="button" data-sh-invite-withdraw="5000" class="sh-invite-gold" '+
        (withdrawable<5000||profile?.minor?'disabled':'')+'>Withdraw $50</button>'+
        '<button type="button" data-sh-invite-withdraw="10000" class="sh-invite-gold" '+
        (withdrawable<10000||profile?.minor?'disabled':'')+'>Withdraw $100</button></div>'+
        '<p id="sh-invite-withdraw-status" class="sh-invite-alert">Withdrawal requests '+
        'require finance review and an externally verified payout. No automatic money '+
        'transfer is connected yet.</p>'+
        (result.withdrawals||[]).map(w=>'<div class="sh-invite-rankrow">'+
          '<span>#'+fmt(w.id)+'</span><b>'+money(w.amount_cents)+
          '<small>Requested '+sellerEscape(w.created_at||'')+'</small></b><em>'+
          sellerEscape(w.status)+'</em></div>').join('')+
        '<button type="button" class="sh-invite-gold" id="sh-invite-support" '+
        'style="width:100%;margin-top:10px">💬 Contact Support for payout details</button></div>'+
        '<div class="sh-invite-cash"><h2 class="sh-invite-title">🎁 First Recharge Bonus</h2>'+
        '<p class="sh-invite-sub">Recharge equivalent: $1 = 🪙 '+
        fmt(result.recharge_coins_per_usd||500000)+'. The first verified recharge '+
        'gets '+Number(result.first_recharge_bonus_percent||40)+'% EXTRA once.</p>'+
        '<div class="sh-invite-rewards"><div class="sh-invite-reward"><span>💳</span><strong>500K</strong><small>Recharge coins</small></div>'+
        '<div class="sh-invite-reward"><span>🎊</span><strong>'+fmt(newUserBonus)+
        '</strong><small>Bonus coins</small></div>'+
        '<div class="sh-invite-reward"><span>👑</span><strong>'+percent+
        '%</strong><small>Inviter recharge reward</small></div></div>'+
        '<p class="sh-invite-alert">First recharge is counted only after approved '+
        'seller or finance verification; seller self-recharges do not qualify.</p></div>'+
        '<h2 class="sh-invite-title">How invitation works</h2>'+
        '<div class="sh-invite-rule">① Copy or share your 8-digit ID invite code.</div>'+
        '<div class="sh-invite-rule">② Your friend creates a verified Sharika account.</div>'+
        '<div class="sh-invite-rule">③ They enter your code during signup or within '+
        Number(result.claim_window_hours||48)+' hours of account creation.</div>'+
        '<div class="sh-invite-rule">④ After verification, one-time referral rewards are '+
        'recorded in the actual coin wallets.</div>'+
        '<div class="sh-invite-rule">⑤ The inviter receives '+percent+
        '% of eligible verified recharge coins and '+
        money(result.invite_usd_cents_per_verified_user||10)+
        ' pending USD earnings per referral. Cash is reviewed separately.</div>'+
        (result.claim_eligible?'<div class="sh-invite-panel">'+
        '<h2 class="sh-invite-title">🎁 New User Bonus</h2>'+
        '<p class="sh-invite-sub">Have a friend’s invite code? Enter it before your window expires.</p>'+
        '<input id="sh-invite-redeem-code" class="sh-invite-entry" maxlength="8" '+
        'inputmode="numeric" autocomplete="off" placeholder="Enter 8-digit invitation code">'+
        '<button type="button" id="sh-invite-redeem" class="sh-invite-gold sh-invite-share">'+
        'Confirm invite code</button><p class="sh-invite-alert" id="sh-invite-redeem-status">'+
        'The same account cannot claim two referral bonuses.</p></div>':
        result.invited_by?'<p class="sh-invite-alert">✓ You joined with ID '+
          sellerEscape(result.invited_by)+'</p>':'')+
        '<h2 class="sh-invite-title">Verified invited friends</h2>'+
        (history||'<p class="sh-invite-alert">No verified referrals yet.</p>')+
        '<p class="sh-invite-alert">Ranking cash prizes are separate from the regular '+
        '$0.10 per verified referral and have not been configured.</p></div>';
      root.querySelector('#sharika-copy-invite').onclick=async()=>{
        try{await native('copyInviteCode',{code:invite});toast('Invite code copied ✓');}
        catch(error){toast('Copy unavailable: '+errText(error));}
      };
      root.querySelector('#sharika-share-invite').onclick=async()=>{
        const text='Join me on Sharika Voice Chat! Use my invite code '+invite+
          ' during registration or within '+Number(result.claim_window_hours||48)+
          ' hours of creating your account.';
        try{await native('shareInvite',{text});}
        catch(error){toast('Share unavailable: '+errText(error));}
      };
      root.addEventListener('click',event=>{
        if(!event.target.closest?.('#sh-invite-support'))return;
        root.remove();openSupportThread();
      });
      const body=root.querySelector('#sh-invite-tab-body');
      const overview=body.innerHTML;
      const overviewButton=root.querySelector('#sh-invite-tab-overview');
      const rankButton=root.querySelector('#sh-invite-tab-ranking');
      overviewButton.onclick=()=>{
        overviewButton.classList.add('on');rankButton.classList.remove('on');
        body.innerHTML=overview;bindInviteRedeem(body);bindInviteWithdraw(body);
      };
      rankButton.onclick=async()=>{
        overviewButton.classList.remove('on');rankButton.classList.add('on');
        body.innerHTML='<p class="sh-invite-alert">Loading verified monthly ranking…</p>';
        try{
          const ranking=await api('GET','/invites/rankings');
          if(!body.isConnected||!rankButton.classList.contains('on'))return;
          body.innerHTML='<div class="sh-invite-panel">'+
            '<h2 class="sh-invite-title">🏆 Monthly Invitation Ranking</h2>'+
            '<p class="sh-invite-sub">Real accounts invited this month · UTC</p>'+
            ((ranking.leaders||[]).map(r=>'<div class="sh-invite-rankrow">'+
              '<span>#'+Number(r.rank)+'</span><b>'+sellerEscape(r.name||'Member')+
              '<small>ID '+sellerEscape(r.id)+'</small></b><em>'+
              fmt(r.total_invites)+' invited · '+money(r.estimated_usd_cents)+
              ' pending</em></div>').join('')||
              '<p class="sh-invite-alert">No ranking entries yet.</p>')+
            '<p class="sh-invite-alert">Dollar estimates assume verified accounts; '+
            'cash approval is required. Separate rank prizes are not enabled.</p></div>';
        }catch(error){if(body.isConnected)body.textContent='Ranking unavailable: '+errText(error);}
      };
      bindInviteRedeem(body);bindInviteWithdraw(body);
    }catch(error){if(panel.isConnected)panel.textContent='Invite tracking unavailable: '+errText(error);}
  }
  window.dailySheet=showVerifiedDailySheet;
  window.inviteSheet=showVerifiedInviteSheet;
  document.addEventListener('click',event=>{
    const daily=event.target.closest?.('#qd,[data-m="daily"]');
    const invite=event.target.closest?.('#qi,[data-m="invite"]');
    if(!daily&&!invite)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(daily)showVerifiedDailySheet();else showVerifiedInviteSheet();
  },true);

  // Wallet writes require verified exchange, check-in or approved seller transfer.
  document.addEventListener('click', async event => {
    const button=event.target.closest('button');
    if(!button) return;
    const id=button.id;
    if(!['cl','pc','ec','cm','rcs','rcl2'].includes(id)) return;
    if(id==='ec' && !document.querySelector('#sh h3')?.textContent?.includes('Exchange')) return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!session){window.showAuth('welcome');return;}
    if(id==='cl'){await claimVerifiedDaily();return;}
    if(id==='rcl2'){await showVerifiedCoinSellers();return;}
    if(id==='rcs'){
      document.getElementById('rcp')?.classList.remove('on');
      openSupportThread();return;
    }
    if(id==='ec'||id==='pc'){
      if(walletOperationBusy)return;
      walletOperationBusy=true;button.disabled=true;
      let actionConfirmed=false;
      try{
        if(id==='ec'){
          if(!selectedDiamonds)throw new Error('Select a diamond amount');
          const requestId=pendingExchangeRequest?.diamonds===selectedDiamonds
            ?pendingExchangeRequest.requestId:nextWalletRequestId('exchange');
          pendingExchangeRequest={diamonds:selectedDiamonds,requestId};
          const result=await api('POST','/wallet/exchange',{
            diamonds:selectedDiamonds,request_id:requestId,
            exchange_rate_revision:exchangeRateRevision
          });
          actionConfirmed=true;pendingExchangeRequest=null;
          await refreshWalletAfterConfirmedTransaction({
            coins:result.coins,diamonds:result.diamonds
          });
          window.closeSheet();
          toast(result.duplicate?'Exchange already completed':
            'Exchange complete: +'+result.credited_coins+' coins');
        }else{
          if(!selectedRecharge)throw new Error('Choose a recharge package');
          await api('POST','/support/messages',{
            body:'Recharge request · '+selectedRecharge+' · User ID '+
              String(profile?.public_id||'')+
              '. Please verify payment and confirm before crediting coins.',
            request_id:nextWalletRequestId('recharge')
          });
          actionConfirmed=true;
          window.closeSheet();
          toast('Recharge request sent to verified support. No coins added yet.');
        }
      }catch(error){
        const detail=errText(error);
        if(id==='ec'&&(detail==='exchange_rate_changed'||
           detail==='exchange_rate_refresh_required')){
          pendingExchangeRequest=null;
          refreshVerifiedExchangeRate().catch(()=>{});
        }
        toast(actionConfirmed
          ?'Request confirmed; screen update delayed: '+detail
          :'Request not confirmed; check transaction history before retrying: '+detail);
      }
      finally{walletOperationBusy=false;button.disabled=false;}
      return;
    }
    button.disabled=true;
    try {
      const name=document.getElementById('cn')?.value?.trim() || 'My Sharika room';
      const chosen=document.querySelector('#ce button.sel');
      await api('POST','/rooms',{name,emoji:chosen?.textContent?.trim() || '🎙️',theme:'mid'});
      window.closeSheet();
      await reloadRooms();
      const room=window.myR();
      if(room) window.openRoom(room);
      toast('Your staging room has been created');
    } catch(error) {toast(errText(error));}
    finally {button.disabled=false;}
  },true);

  // Real user-to-admin support chat using the original Sharika message cards.
  let supportPoll=null;
  let supportBusy=false;
  let activePrivateId=null;
  let canSendPrivate=false;
  // A late poll for a previous conversation must never repaint a newer one.
  let messageThreadEpoch=0, messageFetchSeq=0;
  function messageThreadCurrent(epoch,publicId,fetchSeq) {
    return !!session && epoch===messageThreadEpoch &&
      (fetchSeq===undefined || fetchSeq===messageFetchSeq) &&
      activePrivateId===publicId &&
      !!document.getElementById('th')?.classList.contains('on');
  }
  function preserveMessageScroll(container,render) {
    const before=container.scrollTop;
    const nearBottom=container.scrollHeight-container.clientHeight-before<=64;
    render();
    container.scrollTop=nearBottom?container.scrollHeight:before;
  }
  function clearMessageDraft() {
    const input=document.getElementById('ti');
    if(input)input.value='';
  }
  const safeMessageHTML=value=>String(value??'').replace(/[&<>"']/g,
    c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function loadSupportMessages(){
    const container=document.getElementById('tb');
    if(!container||!session)return;
    const epoch=messageThreadEpoch,fetchSeq=++messageFetchSeq;
    const data=await api('GET','/support/messages');
    if(!messageThreadCurrent(epoch,null,fetchSeq))return;
    preserveMessageScroll(container,()=>{
      container.textContent='';
      for(const message of data.messages||[]){
        const bubble=document.createElement('div');
        bubble.className='bub '+(message.sender_role==='user'?'me':'th');
        bubble.textContent=message.body;
        container.appendChild(bubble);
      }
    });
  }
  async function openSupportThread(){
    if(!session){window.showAuth('welcome');return;}
    const epoch=++messageThreadEpoch;
    activePrivateId=null;canSendPrivate=false;
    clearMessageDraft();
    const restoredSend=document.getElementById('ts');if(restoredSend)restoredSend.disabled=false;
    document.getElementById('th')?.classList.add('on');
    document.getElementById('thn').textContent='🎧 Customer service';
    const container=document.getElementById('tb');
    container.textContent='Loading support messages…';
    try{await loadSupportMessages();}
    catch(error){
      if(messageThreadCurrent(epoch,null))
        container.textContent='Messages unavailable: '+errText(error);
    }
    if(!messageThreadCurrent(epoch,null))return;
    if(supportPoll)clearInterval(supportPoll);
    supportPoll=setInterval(()=>{
      if(!session||!document.getElementById('th')?.classList.contains('on')||
         !messageThreadCurrent(epoch,null))return;
      loadSupportMessages().catch(()=>{});
    },15000);
  }
  async function loadPrivateMessages(publicId){
    const id=String(publicId);
    const epoch=messageThreadEpoch,fetchSeq=++messageFetchSeq;
    const [data,status]=await Promise.all([
      api('GET','/messages/'+encodeURIComponent(id)),
      api('GET','/users/'+encodeURIComponent(id)+'/follow')
    ]);
    if(!messageThreadCurrent(epoch,id,fetchSeq))return;
    const container=document.getElementById('tb');
    if(!container)return;
    canSendPrivate=!!status.mutual;
    preserveMessageScroll(container,()=>{
      container.textContent='';
      for(const m of data.messages||[]){
        const bubble=document.createElement('div');
        bubble.className='bub '+(m.from_me?'me':'th');
        bubble.textContent=m.body;
        container.appendChild(bubble);
      }
      const hint=document.createElement('div');
      hint.className='bub th';
      hint.textContent=canSendPrivate?'Both users follow each other. Chat enabled.':
        status.following?'You follow this user. Waiting for them to follow back.':
        'Follow this user to request a private conversation.';
      container.appendChild(hint);
      const followButton=document.createElement('button');
      followButton.type='button';
      followButton.className='btn';
      followButton.textContent=status.following?'Unfollow':'Follow';
      followButton.onclick=async()=>{
        followButton.disabled=true;
        try{
          await api(status.following?'DELETE':'PUT','/users/'+encodeURIComponent(id)+'/follow');
          await loadPrivateMessages(id);
          window.renderMsg();
        }catch(error){toast('Follow failed: '+errText(error));followButton.disabled=false;}
      };
      container.appendChild(followButton);
    });
    const sendButton=document.getElementById('ts');
    if(sendButton)sendButton.disabled=!canSendPrivate;
  }
  async function openPrivateThread(publicId,name){
    if(!session){window.showAuth('welcome');return;}
    if(!/^[0-9]{8}$/.test(String(publicId))){toast('Invalid 8-digit user ID');return;}
    const epoch=++messageThreadEpoch;
    activePrivateId=String(publicId);canSendPrivate=false;
    clearMessageDraft();
    const guardedSend=document.getElementById('ts');if(guardedSend)guardedSend.disabled=true;
    document.getElementById('th')?.classList.add('on');
    document.getElementById('thn').textContent='💬 '+name+' · '+publicId;
    document.getElementById('tb').textContent='Loading conversation…';
    try{await loadPrivateMessages(activePrivateId);}
    catch(error){
      if(messageThreadCurrent(epoch,String(publicId)))
        document.getElementById('tb').textContent=errText(error);
    }
    if(!messageThreadCurrent(epoch,String(publicId)))return;
    if(supportPoll)clearInterval(supportPoll);
    supportPoll=setInterval(()=>{
      if(!session||!document.getElementById('th')?.classList.contains('on')||
         !messageThreadCurrent(epoch,String(publicId)))return;
      loadPrivateMessages(String(publicId)).catch(()=>{});
    },15000);
  }
  window.renderMsg=async function(){
    const view=document.getElementById('ml');
    if(!view)return;
    const demoBadge=document.querySelector('.ni[data-v="msg"] em');
    if(demoBadge)demoBadge.style.display='none';
    if(!session){view.innerHTML='<div class="empty">Sign in to view your conversations.</div>';return;}
    view.innerHTML='<div class="chatrow" id="verified-support-chat">'+
      '<div class="av">🎧</div><div><b>Customer service</b>'+
      '<small>Verified Sharika support conversation</small></div><time>›</time></div>'+
      '<div class="row"><input class="field" id="find-user-id" inputmode="numeric" '+
      'maxlength="8" placeholder="Enter 8-digit user ID" aria-label="Find user by ID">'+
      '<button class="btn" type="button" id="find-user-button">Find</button></div>'+
      '<div id="real-inbox">Loading messages…</div>';
    document.getElementById('verified-support-chat').onclick=openSupportThread;
    const find=async()=>{
      const value=document.getElementById('find-user-id').value.trim();
      if(!/^[0-9]{8}$/.test(value)){toast('Enter an 8-digit user ID');return;}
      try{
        const user=await api('GET','/users/'+encodeURIComponent(value));
        await openPrivateThread(value,user.name);
      }catch(error){toast('User unavailable: '+errText(error));}
    };
    document.getElementById('find-user-button').onclick=find;
    document.getElementById('find-user-id').onkeydown=e=>{
      if(e.key==='Enter'){e.preventDefault();find();}
    };
    const list=document.getElementById('real-inbox');
    try{
      const [inbox,follows]=await Promise.all([
        api('GET','/messages'),api('GET','/follows')
      ]);
      const following=follows.following||[],followers=follows.followers||[];
      const known=new Set(following.map(f=>f.public_id));
      const conv=inbox.conversations||[];
      const byId=new Set(conv.map(c=>c.public_id));
      const rows=conv.map(c=>'<div class="chatrow" data-private-id="'+safeMessageHTML(c.public_id)+
        '" data-private-name="'+safeMessageHTML(c.name)+'"><div class="av">💬</div><div><b>'+
        safeMessageHTML(c.name)+'</b><small>'+safeMessageHTML(c.last_body||'')+
        '</small></div><time>'+safeMessageHTML(c.public_id)+'</time></div>');
      for(const f of following){
        if(byId.has(f.public_id))continue;
        rows.push('<div class="chatrow" data-private-id="'+safeMessageHTML(f.public_id)+
          '" data-private-name="'+safeMessageHTML(f.name)+'"><div class="av">👤</div><div><b>'+
          safeMessageHTML(f.name)+'</b><small>'+(f.follows_me?'Mutual follow · Chat ready':
          'Following · Waiting for follow back')+'</small></div><time>'+
          safeMessageHTML(f.public_id)+'</time></div>');
      }
      for(const f of followers){
        if(known.has(f.public_id)||byId.has(f.public_id))continue;
        rows.push('<div class="chatrow" data-private-id="'+safeMessageHTML(f.public_id)+
          '" data-private-name="'+safeMessageHTML(f.name)+'"><div class="av">➕</div><div><b>'+
          safeMessageHTML(f.name)+'</b><small>Follows you · Follow back to chat</small></div><time>'+
          safeMessageHTML(f.public_id)+'</time></div>');
      }
      list.innerHTML=rows.length?rows.join(''):'<div class="empty">No private conversations yet.</div>';
      // Inbox/follower avatars share the same verified equipped cosmetics as
      // rankings, public profile and the voice-room seats.
      cosmeticCss(document);
      const inboxPeople=new Map([...following,...followers,...conv]
        .map(u=>[String(u.public_id),u]));
      for(const row of list.querySelectorAll('.chatrow[data-private-id]')){
        const person=inboxPeople.get(row.dataset.privateId);
        const avatar=row.querySelector('.av');
        if(!avatar||!person)continue;
        paintVerifiedAvatar(avatar,person.pic,document);
        const frame=frameArt(person.frame_style),medal=medalArt(person.medal_style),
          tag=nameTagArt(person.name_tag_style);
        if(!frame&&!medal&&!tag)continue;
        const wrap=document.createElement('span');
        wrap.className='sh-royal-inbox-wrap';
        avatar.replaceWith(wrap);
        wrap.appendChild(avatar);
        if(frame)wrap.insertAdjacentHTML('beforeend',frameTag(frame.id));
        if(medal){
          const badge=document.createElement('img');
          badge.className='sh-royal-medal';
          badge.src=cosmeticMedia(medal);badge.alt=medal.name;
          wrap.appendChild(badge);
        }
        if(tag){
          const badge=document.createElement('img');
          badge.className='sh-royal-inbox-tag';
          badge.src=cosmeticMedia(tag);badge.alt=tag.name;
          row.querySelector('b')?.insertAdjacentElement('afterend',badge);
        }
      }
      list.onclick=e=>{
        const row=e.target.closest('.chatrow[data-private-id]');
        if(row)openPrivateThread(row.dataset.privateId,row.dataset.privateName);
      };
    }catch(error){list.textContent='Messages unavailable: '+errText(error);}
  };
  const supportSendButton=document.getElementById('ts');
  const supportInput=document.getElementById('ti');
  async function sendSupportMessage(){
    if(!session){window.showAuth('welcome');return;}
    if(supportBusy)return;
    const body=supportInput?.value?.trim()||'';
    if(!body)return;
    if(body.length>1000){toast('Message is too long');return;}
    const targetId=activePrivateId,epoch=messageThreadEpoch;
    supportBusy=true;
    if(supportSendButton)supportSendButton.disabled=true;
    try{
      const request_id='usr:'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2);
      if(targetId){
        if(!canSendPrivate)throw new Error('mutual_follow_required');
        await api('POST','/messages/'+encodeURIComponent(targetId),{body,request_id});
        if(messageThreadCurrent(epoch,targetId)){
          supportInput.value='';
          await loadPrivateMessages(targetId);
        }
      }else{
        await api('POST','/support/messages',{body,request_id});
        if(messageThreadCurrent(epoch,null)){
          supportInput.value='';
          await loadSupportMessages();
        }
      }
    }catch(error){toast('Message not sent: '+errText(error));}
    finally{supportBusy=false;if(supportSendButton)supportSendButton.disabled=!!activePrivateId&&!canSendPrivate;}
  }
  if(supportSendButton)supportSendButton.onclick=sendSupportMessage;
  if(supportInput)supportInput.onkeydown=e=>{
    if(e.key==='Enter'){e.preventDefault();sendSupportMessage();}
  };
  const supportBackButton=document.getElementById('thb');
  if(supportBackButton)supportBackButton.onclick=()=>{
    ++messageThreadEpoch;
    document.getElementById('th')?.classList.remove('on');
    if(supportPoll){clearInterval(supportPoll);supportPoll=null;}
    activePrivateId=null;canSendPrivate=false;
    clearMessageDraft();
    if(supportSendButton)supportSendButton.disabled=false;
    window.renderMsg();
  };
  // The supplied HTML contains a simulated weekly podium. Never display it
  // as real winners while this staging app uses verified server data.
  window.showWeekly=function(done){if(typeof done==='function')done();};
  // Ranking artwork: keep every uploaded face centered and clipped to its
  // circular frame, including portrait photos with a taller source ratio.
  const rankAvatarStyle=document.createElement('style');
  rankAvatarStyle.id='sharika-verified-rank-avatar';
  rankAvatarStyle.textContent=[
    '#rb .rr .ra{position:relative!important;box-sizing:border-box!important;',
    'flex:0 0 68px!important;width:68px!important;height:68px!important;',
    'min-width:68px!important;min-height:68px!important;max-width:68px!important;',
    'max-height:68px!important;aspect-ratio:1!important;',
    'border-radius:50%!important;overflow:hidden!important;',
    'border:3px solid #eac4ff!important;line-height:1!important;',
    'box-shadow:inset 0 3px 6px #2d175c99,0 0 0 3px #9862de88,',
    '0 6px 12px #100b4080!important}',
    '#rb .rr .ra>img{display:block!important;position:absolute!important;',
    'inset:0!important;width:100%!important;height:100%!important;',
    'min-width:100%!important;max-width:100%!important;max-height:100%!important;',
    'object-fit:cover!important;object-position:50% 32%!important;',
    'border-radius:50%!important;aspect-ratio:1!important}',
    '#rb .rr[data-rank-user]{cursor:pointer;touch-action:manipulation}',
    '#rb .rr[data-rank-user]:active{transform:translateY(2px);filter:brightness(1.12)}',
    '#rb .rr[data-rank-user]:focus-visible{outline:3px solid #ffd875;outline-offset:3px}',
    '#pfo .sh-ranked-profile .pavw{width:118px;height:118px}',
    '#pfo .sh-ranked-profile .pav3{overflow:hidden!important;border-radius:50%!important;',
    'background-position:50% 32%!important;background-size:cover!important;',
    'box-shadow:inset 0 3px 6px #120b3955,0 9px 24px #0007}',
    '#pfo .sh-ranked-profile .pavr{filter:drop-shadow(0 0 12px #d8afff)}',
    '#pfo .sh-ranked-profile .meta span{font-size:13px}',
    '#pfo .sh-ranked-profile .sh-profile-note{margin:18px 0 12px;padding:13px;',
    'border:1px solid #ae90ed;border-radius:18px;',
    'background:linear-gradient(140deg,#483577,#251c54);color:#eee4ff;text-align:center}',
    '#pfo .sh-ranked-profile .pbtn button{color:#fff;border:1px solid #e9c2ff;',
    'background:linear-gradient(150deg,#a96af3,#6036b7);',
    'box-shadow:inset 0 2px 1px #fff6,0 5px 0 #352078}',
    '#pfo .sh-ranked-profile .pbtn button:active{transform:translateY(3px)}',
    '#pfo .sh-ranked-profile .pbtn button:disabled{opacity:.6}'
  ].join('');
  document.head.appendChild(rankAvatarStyle);

  // Keep Sharika's original screens, tab order and purple base. Only the
  // verified ranking surface receives a royal, responsive 3D treatment.
  const royalRankingStyle=document.createElement('style');
  royalRankingStyle.id='sharika-royal-ranking';
  royalRankingStyle.textContent=[
    '#v-rank{background:radial-gradient(ellipse at 50% 0%,#49418d8e,transparent 46%),',
    'radial-gradient(ellipse at 95% 32%,#5146af54,transparent 50%),',
    'linear-gradient(180deg,#20235e 0%,#101046 45%,#080a29 100%)!important}',
    '#v-rank .rtop{background:linear-gradient(135deg,#322467e8,#1b194ce8)!important;',
    'border-bottom:1px solid #d6bd6d45;box-shadow:0 9px 25px #08062299!important}',
    '#v-rank #rt{gap:8px!important;padding:5px 7px 9px!important;align-items:center}',
    '#v-rank #rt button{font-size:12px!important;font-weight:800!important;',
    'color:#cdbce9!important;background:linear-gradient(#50417b,#2b245a)!important;',
    'border:1px solid #9983c866!important;border-radius:13px!important;',
    'padding:10px 12px!important;box-shadow:inset 0 1px 0 #fff4,0 4px 0 #100f35!important;',
    'transition:background .2s,transform .14s,color .2s!important}',
    '#v-rank #rt button.on{background:linear-gradient(145deg,#fff2b6,#ffcf65 45%,#e38a30)!important;',
    'color:#543263!important;border-color:#ffeab1!important;',
    'box-shadow:inset 0 2px 1px #fff9,0 4px 0 #9b5a25,0 0 15px #ffc75d75!important}',
    '#v-rank #rt button.on::after{display:none!important}',
    '#v-rank .seg{width:min(370px,90%)!important;max-width:90%!important;',
    'margin:16px auto 8px!important;padding:5px!important;',
    'background:linear-gradient(145deg,#4e4382,#292253)!important;',
    'border:1px solid #c7aae189!important;',
    'box-shadow:inset 0 2px 3px #fff3,0 6px 15px #07071d8c!important}',
    '#v-rank .seg button{font-size:13px!important;font-weight:800!important;',
    'padding:11px 0!important;color:#e8daff!important}',
    '#v-rank .seg button.on{background:linear-gradient(155deg,#ffe8a5,#f9b94b,#d87635)!important;',
    'color:#392451!important;text-shadow:0 1px 0 #fff9!important;',
    'box-shadow:0 4px 0 #8e4e21,0 0 16px #ffce7280!important}',
    '#v-rank #rb{padding:4px 12px 124px!important;max-width:690px;margin:0 auto}',
    '#rb .sh-royal-hero{position:relative;overflow:hidden;margin:15px 0 13px;',
    'border:1px solid #e9c775ab;border-radius:28px;',
    'background:radial-gradient(circle at 50% -10%,#8d67c36b,transparent 58%),',
    'linear-gradient(155deg,#403471,#241a51 60%,#19173f);',
    'box-shadow:inset 0 2px 1px #ffffff4a,inset 0 -3px 0 #120b35,',
    '0 10px 23px #0304168e;padding:18px 10px 16px}',
    '#rb .sh-royal-hero:before{content:"✦            ✧     ✦";position:absolute;',
    'top:10px;left:8%;width:84%;text-align:center;font-size:13px;letter-spacing:15px;',
    'color:#ffe3a281;pointer-events:none}',
    '#rb .sh-royal-kicker{text-align:center;font-size:10px;letter-spacing:2px;',
    'font-weight:900;color:#eecb7c;text-transform:uppercase}',
    '#rb .sh-royal-title{text-align:center;margin:5px 0 3px;',
    'font-size:clamp(19px,6vw,27px);font-weight:950;letter-spacing:.5px;',
    'color:#fff1c2;text-shadow:0 2px 0 #61355f,0 0 17px #ffc36c75}',
    '#rb .sh-royal-sub{text-align:center;font-size:11px;line-height:1.45;',
    'color:#d0beed;max-width:300px;margin:0 auto 10px}',
    '#rb .sh-royal-podium{display:grid;grid-template-columns:minmax(0,1fr) 1.17fr minmax(0,1fr);',
    'gap:6px;align-items:end;margin:16px 0 0}',
    '#rb .sh-royal-podium-card{position:relative;min-width:0;display:flex;',
    'flex-direction:column;align-items:center;gap:6px;justify-content:flex-end;',
    'text-align:center;padding:20px 3px 11px;border-radius:22px 22px 18px 18px;',
    'background:linear-gradient(155deg,#6b5796b5,#3d306eb8 55%,#292256f2);',
    'border:1px solid #a5a1dd77;box-shadow:inset 0 2px 1px #fff6,0 5px 0 #191337;',
    'color:#fff;touch-action:manipulation}',
    '#rb .sh-royal-podium-card.first{grid-column:2;grid-row:1;min-height:203px;',
    'padding-top:28px;background:linear-gradient(155deg,#9471bc,#533a83 62%,#342361);',
    'border:2px solid #ffe19a;box-shadow:inset 0 2px 2px #fff8,0 6px 0 #ad6c27,',
    '0 0 26px #ffca6d69}',
    '#rb .sh-royal-podium-card.second{grid-column:1;grid-row:1;min-height:171px}',
    '#rb .sh-royal-podium-card.third{grid-column:3;grid-row:1;min-height:166px}',
    '#rb .sh-royal-podium-card:focus-visible{outline:3px solid #fff5b7;outline-offset:4px}',
    '#rb .sh-royal-place{position:absolute;top:-16px;left:50%;transform:translateX(-50%);',
    'font-size:25px;filter:drop-shadow(0 3px 3px #0a062d);white-space:nowrap}',
    '#rb .sh-royal-avatar{position:relative;flex:none;display:grid;place-items:center;',
    'width:58px;height:58px;margin:4px auto;isolation:isolate}',
    '#rb .first .sh-royal-avatar{width:78px;height:78px}',
    '#rb .sh-royal-face{display:grid;place-items:center;width:100%;height:100%;',
    'border-radius:50%;font-size:27px;overflow:hidden;',
    'background:linear-gradient(145deg,#aa54d3,#dc3ead);border:3px solid #ebcffb;',
    'box-shadow:inset 0 2px 9px #1a083d,0 0 0 3px #8363bcaa}',
    '#rb .first .sh-royal-face{border-color:#ffe6a0;box-shadow:0 0 0 3px #bc813e,',
    '0 0 18px #ffe29b9c}',
    '#rb .sh-royal-face img{width:100%;height:100%;display:block;object-fit:cover;',
    'object-position:center 32%;border-radius:50%}',
    '#rb .sh-royal-avatar>.sh-sovera-frame{width:160%!important;height:160%!important;',
    'z-index:2!important}',
    '#rb .sh-royal-avatar>.sh-royal-medal{position:absolute;right:-14px;bottom:-12px;',
    'z-index:4;width:29px;height:29px;object-fit:contain;filter:drop-shadow(0 2px 2px #140936)}',
    '#rb .sh-royal-name{font-weight:900;font-size:clamp(10px,3.1vw,14px);',
    'max-width:100%;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;',
    'padding:0 2px;text-shadow:0 1px 2px #100927}',
    '#rb .sh-royal-id{font-size:9px;letter-spacing:.3px;color:#e5d8fa;',
    'background:#180e3e80;border:1px solid #ffffff44;border-radius:11px;',
    'padding:3px 5px;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}',
    '#rb .sh-royal-amount{font-size:12px;font-weight:900;color:#ffe29d;',
    'text-shadow:0 2px 2px #5e3c0b;white-space:nowrap}',
    '#rb .sh-royal-member-tag{display:block;max-width:86px;max-height:22px;',
    'object-fit:contain;margin:0 auto}',
    '#rb .sh-royal-divider{display:flex;align-items:center;gap:10px;',
    'font-size:11px;font-weight:900;letter-spacing:1px;color:#e0c889;',
    'margin:18px 10px 10px;text-transform:uppercase}',
    '#rb .sh-royal-divider:before,#rb .sh-royal-divider:after{content:"";height:1px;',
    'flex:1;background:linear-gradient(90deg,transparent,#eac98399,transparent)}',
    '#rb .rr.sh-royal-row{position:relative;margin:10px 0!important;',
    'padding:14px 13px!important;gap:12px!important;border-radius:23px!important;',
    'background:linear-gradient(150deg,#51447fae,#26235fe8)!important;',
    'border:1px solid #aeb1e499!important;box-shadow:inset 0 2px 1px #ffffff45,',
    '0 6px 0 #0a0c2d,0 12px 18px #03051d79!important}',
    '#rb .rr.sh-royal-row.me{border-color:#ffde91!important;box-shadow:',
    'inset 0 2px 1px #fff5,0 6px 0 #835028,0 0 16px #f6bf5457!important}',
    '#rb .rr.sh-royal-row>.n{flex:none;width:28px!important;height:36px;display:grid;',
    'place-items:center;border-radius:12px;background:linear-gradient(#ffe6a0,#ef9c31);',
    'box-shadow:0 4px 0 #9e501c;color:#5f3170;font-size:15px!important}',
    '#rb .rr.sh-royal-row .sh-royal-avatar{width:58px;height:58px;margin:0}',
    '#rb .rr.sh-royal-row .rn{flex:1;min-width:0}',
    '#rb .rr.sh-royal-row .rn b{font-size:14px!important;color:#fff!important}',
    '#rb .rr.sh-royal-row .idl{margin-top:5px;font-size:11px;color:#e3d4ff}',
    '#rb .rr.sh-royal-row .rv{flex:none;margin:0;font-size:13px!important;',
    'color:#ffda91;font-weight:900}',
    '#rb .rr.sh-royal-row .rv .cn{width:17px;height:17px}',
    '#rb .sh-royal-empty{margin:16px 0;padding:24px 18px;border-radius:24px;',
    'text-align:center;color:#e8dff7;background:linear-gradient(150deg,#4c3a7d,#242052);',
    'border:1px solid #c5a46a89;box-shadow:inset 0 2px 1px #fff3,0 8px 20px #09062182}',
    '#rb .sh-royal-empty strong{display:block;font-size:15px;color:#ffe6ad;margin:8px 0}',
    '#pfo .sh-ranked-profile .pavw>.sh-sovera-frame{z-index:4!important}',
    // Both room-opened and ranking-opened profiles display verified artwork.
    // The original wide nameplate must never enlarge the phone's viewport.
    '#pfo{overflow-x:hidden!important;max-width:100vw;box-sizing:border-box}',
    '#pfo #pfc,#pfo .pf,#pfo .pfh{min-width:0;max-width:100%;box-sizing:border-box}',
    '#pfo .sh-royal-profile-effects{display:flex;flex-wrap:wrap;align-items:center;',
    'justify-content:center;gap:8px;width:min(100%,320px);max-width:100%;',
    'margin:9px auto 16px;overflow:hidden}',
    '#pfo .sh-royal-profile-effects img{display:block;flex:0 1 auto;',
    'width:auto;max-width:100%;height:auto;max-height:64px;object-fit:contain;',
    'filter:drop-shadow(0 2px 3px #2d1158)}',
    '#pfo .sh-royal-profile-effects img[src*="legend-tag"]{width:min(100%,300px);',
    'max-height:78px;object-fit:contain}',
    '#pfo .pfh .pavw{isolation:isolate}',
    '#pfo .pfh .pav3{overflow:hidden!important;background-size:cover!important;',
    'background-position:center 30%!important}',
    '#v-msg .chatrow .sh-royal-inbox-wrap{display:block;position:relative;',
    'width:48px;height:48px;flex:0 0 48px;overflow:visible}',
    '#v-msg .chatrow .sh-royal-inbox-wrap>.av{width:48px;height:48px;',
    'border:2px solid #ead5ff;box-shadow:0 0 9px #b37dff80;overflow:hidden}',
    '#v-msg .chatrow .sh-royal-inbox-wrap>.sh-sovera-frame{width:148%!important;',
    'height:148%!important;z-index:3!important}',
    '#v-msg .chatrow .sh-royal-inbox-wrap>.sh-royal-medal{position:absolute;',
    'right:-9px;bottom:-8px;width:21px;height:21px;z-index:5;object-fit:contain}',
    '#v-msg .chatrow .sh-royal-inbox-tag{display:block;width:64px;height:19px;',
    'object-fit:contain;margin:1px 0}',
    '@media(max-width:365px){#rb .sh-royal-podium{gap:4px}',
    '#rb .sh-royal-podium-card{padding-left:1px;padding-right:1px}',
    '#rb .sh-royal-name{font-size:10px}#rb .rr.sh-royal-row{gap:8px!important}',
    '#rb .rr.sh-royal-row .sh-royal-avatar{width:49px;height:49px}',
    '#rb .rr.sh-royal-row .rv{font-size:11px!important}}',
    '@media(prefers-reduced-motion:reduce){#v-rank #rt button{transition:none!important}}'
  ].join('');
  document.head.appendChild(royalRankingStyle);

  // One authoritative appearance helper powers both podium and list cards.
  // Unknown/unequipped server keys never become untrusted remote media URLs.
  function royalRankAvatar(leader,isRoom=false){
    const wrap=document.createElement('div');
    wrap.className='sh-royal-avatar';
    const face=document.createElement('div');
    face.className='sh-royal-face';
    if(isRoom)face.textContent=leader.emoji||'🎙️';
    else{
      const url=verifiedAvatarUrl(leader.pic);
      if(url){
        const photo=document.createElement('img');
        photo.src=url;photo.alt='';photo.loading='lazy';
        photo.onerror=()=>{photo.remove();face.textContent='👤';};
        face.appendChild(photo);
      }else face.textContent='👤';
    }
    wrap.appendChild(face);
    if(!isRoom){
      const frame=frameArt(leader.frame_style);
      if(frame){
        const art=document.createElement('i');
        art.className='fxr sh-sovera-frame';
        art.setAttribute('aria-hidden','true');
        art.style.backgroundImage='url("'+effectPath(frame.art)+'")';
        wrap.appendChild(art);
      }
      const medal=medalArt(leader.medal_style);
      if(medal){
        const badge=document.createElement('img');
        badge.className='sh-royal-medal';
        badge.src=cosmeticMedia(medal);badge.alt=medal.name;
        wrap.appendChild(badge);
      }
    }
    return wrap;
  }
  function royalRankNameTag(leader){
    const tag=nameTagArt(leader.name_tag_style);
    if(!tag)return null;
    const image=document.createElement('img');
    image.className='sh-royal-member-tag';
    image.src=cosmeticMedia(tag);image.alt=tag.name;
    return image;
  }
  function royalRankAction(node,leader,isRoom){
    const target=String(isRoom?'':leader.public_id||'');
    if(!/^[0-9]{8}$/.test(target))return;
    node.dataset.rankUser=target;
    node.tabIndex=0;node.setAttribute('role','button');
    node.setAttribute('aria-label','Open profile for ID '+target);
    node.onclick=()=>openVerifiedRankProfile(target);
    node.onkeydown=event=>{
      if(event.key==='Enter'||event.key===' '){
        event.preventDefault();openVerifiedRankProfile(target);
      }
    };
  }
  function decorateVerifiedPublicProfile(root,person){
    if(!root||!person)return;
    cosmeticCss(document);
    const wrapper=root.querySelector('.pfh .pavw');
    if(wrapper){
      wrapper.querySelectorAll('.sh-sovera-frame').forEach(x=>x.remove());
      const frame=frameTag(person.frame_style);
      if(frame)wrapper.insertAdjacentHTML('beforeend',frame);
    }
    root.querySelector('.sh-royal-profile-effects')?.remove();
    const effects=document.createElement('div');
    effects.className='sh-royal-profile-effects';
    for(const item of [medalArt(person.medal_style),nameTagArt(person.name_tag_style)]){
      if(!item)continue;
      const artwork=document.createElement('img');
      artwork.src=cosmeticMedia(item);artwork.alt=item.name;
      effects.appendChild(artwork);
    }
    if(effects.children.length)root.querySelector('.pfh h2')?.insertAdjacentElement('afterend',effects);
  }

  // Royal CP / Friendship is shown on the ID detail profile only. The main
  // account, wallet, recharge and settings profile is intentionally unchanged.
  function bondStyles(){
    if(document.getElementById('sh-bond-royal-style'))return;
    const sheet=document.createElement('style');sheet.id='sh-bond-royal-style';
    sheet.textContent=[
      '.sh-bond-panel,.sh-bond-sheet{font-family:inherit;color:#fff;box-sizing:border-box}',
      '.sh-bond-panel{padding:10px 13px 23px;background:linear-gradient(170deg,#1c103e,#120827 80%);border-radius:25px;margin:12px 0 20px;border:1px solid #dfabff55}',
      '.sh-bond-hero{position:relative;text-align:center;padding:22px 11px 18px;margin:4px 0 13px;border-radius:22px;overflow:hidden;background:radial-gradient(ellipse at 50% -15%,#e77c9d88,transparent 55%),linear-gradient(148deg,#5a174f,#270d46 65%,#0f0b2f);border:1px solid #ffd4b587;box-shadow:inset 0 2px 0 #fff6,0 10px 21px #05011899}',
      '.sh-bond-hero:after{content:"✦  ✧  ✦";position:absolute;right:10px;top:7px;color:#ffd0a0aa;letter-spacing:9px;font-size:15px;pointer-events:none}',
      '.sh-bond-kicker{font-size:10px;font-weight:900;letter-spacing:2px;color:#ffd99c;text-transform:uppercase}',
      '.sh-bond-title{font-size:25px;font-weight:1000;letter-spacing:-.4px;color:#fff0d7;text-shadow:0 3px 0 #180a26,0 0 18px #ff99c5;margin:7px 0}',
      '.sh-bond-sub{font-size:12px;color:#e9c8eb;line-height:1.45}',
      '.sh-bond-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:12px 0}',
      '.sh-bond-stat{padding:11px 3px;background:linear-gradient(135deg,#48305f,#27173f);border:1px solid #ffe6b968;border-radius:15px;text-align:center;box-shadow:inset 0 1px #fff5}',
      '.sh-bond-stat strong{display:block;color:#ffe4ab;font-size:19px;font-weight:900}',
      '.sh-bond-stat span{display:block;font-size:10px;color:#e5d3f6;margin-top:3px}',
      '.sh-bond-section{margin:13px 0;padding:13px;border-radius:20px;background:linear-gradient(140deg,#351437,#240d34);border:1px solid #ffa1be70;box-shadow:inset 0 2px #fff3,0 8px 17px #08021788}',
      '.sh-bond-section.friends{background:linear-gradient(135deg,#10294d,#14163f);border-color:#8cceff85}',
      '.sh-bond-section h3{margin:0 0 10px;font-size:15px;color:#ffe3ae;font-weight:900}',
      '.sh-bond-section.friends h3{color:#c3e8ff}',
      '.sh-bond-couple{display:grid;grid-template-columns:minmax(0,1fr) 52px minmax(0,1fr);align-items:center;gap:4px}',
      '.sh-bond-person{border:0;background:none;color:#fff;font:inherit;min-width:0;padding:5px 2px;display:flex;align-items:center;flex-direction:column;gap:5px}',
      '.sh-bond-person strong{font-size:12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.sh-bond-person small{font-size:10px;color:#eec9d7}',
      '.sh-bond-avatar{width:67px;height:67px;position:relative;display:grid;place-items:center;border-radius:50%;background:linear-gradient(145deg,#a140c5,#362164);border:3px solid #ffe2ad;box-shadow:0 0 0 3px #a1487e,0 7px 13px #02011099;font-size:30px}',
      '.sh-bond-avatar img{width:100%;height:100%;object-fit:cover;border-radius:50%}',
      '.sh-bond-avatar .sh-sovera-frame{position:absolute;inset:-20%;width:140%!important;height:140%!important;z-index:3;pointer-events:none}',
      '.sh-bond-heart{font-size:38px;text-align:center;filter:drop-shadow(0 0 15px #ff6cbd);animation:shBondPulse 2.5s ease-in-out infinite}',
      '@keyframes shBondPulse{50%{transform:scale(1.13);filter:drop-shadow(0 0 22px #ff9bd5)}}',
      '.sh-bond-friendlist{display:flex;flex-wrap:wrap;gap:7px}',
      '.sh-bond-friend{display:flex;align-items:center;gap:7px;border-radius:999px;background:#7bbaff22;border:1px solid #a7dcff88;color:#fff;padding:7px 10px;font-size:11px;font-weight:800}',
      '.sh-bond-social-list{display:flex;flex-direction:column;gap:7px}',
      '.sh-bond-social-user{display:flex;align-items:center;gap:9px;text-align:left;border:1px solid #ffffff4f;border-radius:14px;background:#fff1;padding:7px;color:#fff;font:inherit}',
      '.sh-bond-social-user .sh-bond-avatar{width:42px;height:42px;font-size:20px;flex:none}',
      '.sh-bond-social-user .sh-bond-avatar .sh-sovera-frame{inset:-20%;width:140%!important;height:140%!important}',
      '.sh-bond-social-user strong{display:block;font-size:12px}',
      '.sh-bond-social-user small{display:block;font-size:10px;color:#f7d0ab}',
      '.sh-bond-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}',
      '.sh-bond-button{padding:11px 6px;border:1px solid #ffe6a6;border-radius:15px;background:linear-gradient(165deg,#cf70d1,#7a319a 60%,#4a236c);color:#fff;font-weight:900;font-size:12px;box-shadow:inset 0 2px #fff7,0 5px 0 #2a0b46;min-height:45px}',
      '.sh-bond-button.blue{background:linear-gradient(160deg,#67c8f8,#285eab 65%,#232e73);border-color:#bce9ff}',
      '.sh-bond-button.gold{background:linear-gradient(155deg,#ffdfa8,#e8a84c 75%,#b97f30);color:#40221e}',
      '.sh-bond-button:disabled{opacity:.55}.sh-bond-button:focus-visible{outline:3px solid #fff;outline-offset:3px}',
      '.sh-bond-muted{font-size:12px;line-height:1.5;color:#d8cee7;text-align:center;padding:6px}',
      '.sh-bond-sheet .sh-bond-section{margin:9px 0}.sh-bond-input{box-sizing:border-box;width:100%;font-size:16px;padding:12px;color:#fff;background:#190d32;border-radius:13px;border:1px solid #f4b5d7}',
      '.sh-bond-gift{display:flex;align-items:center;justify-content:space-between;gap:9px;margin:9px 0;padding:12px;border-radius:16px;border:1px solid #ffd2b96b;background:#fff1}',
      '.sh-bond-gift strong{font-size:13px}.sh-bond-gift small{font-size:11px;color:#ffdfa8}',
      '.sh-bond-invite{margin:9px 0;padding:11px;border-radius:15px;border:1px solid #ffd6af77;background:#fff1;font-size:12px}',
      '.sh-bond-invite .sh-bond-actions{margin-top:8px}',
      '.sh-bond-rankrow{display:flex;align-items:center;justify-content:space-between;gap:7px;border-radius:19px;padding:11px 8px;margin:11px 0;background:linear-gradient(125deg,#4b2049,#292359);border:1px solid #ffdc9d91;box-shadow:0 6px 15px #09021d99}',
      '.sh-bond-rankrow.friends{background:linear-gradient(125deg,#14476a,#20235e);border-color:#9edaf7}',
      '.sh-bond-rankrow .sh-bond-person{flex:1}.sh-bond-rankrow .sh-bond-avatar{width:49px;height:49px;font-size:22px}',
      '.sh-bond-rankrow .sh-bond-heart{font-size:20px}',
      '@media(prefers-reduced-motion:reduce){.sh-bond-heart{animation:none}}'
    ].join('');
    document.head.appendChild(sheet);
  }
  const bondFmt=n=>Number(n||0).toLocaleString('en-US');
  let pendingBondInvite=null;
  function bondPerson(person,open=true){
    const button=document.createElement('button');button.type='button';button.className='sh-bond-person';
    const avatar=document.createElement('span');avatar.className='sh-bond-avatar';
    const img=verifiedAvatarUrl(person?.pic);
    if(img){const photo=document.createElement('img');photo.alt='';photo.src=img;avatar.appendChild(photo);}
    else avatar.textContent='👤';
    const frame=frameArt(person?.frame_style);
    if(frame){const art=document.createElement('i');art.className='sh-sovera-frame';
      art.style.backgroundImage='url("'+effectPath(frame.art)+'")';avatar.appendChild(art);}
    const name=document.createElement('strong');name.textContent=person?.name||'No partner';
    const id=document.createElement('small');id.textContent=person?.id?'ID '+person.id:'Awaiting invitation';
    button.append(avatar,name,id);
    if(open&&/^[0-9]{8}$/.test(String(person?.id||'')))
      button.onclick=()=>openVerifiedRankProfile(person.id);
    else button.disabled=true;
    return button;
  }
  async function showBondGiftSheet(initialTarget=null,type='cp'){
    if(!session){toast('Sign in to send relationship gifts');return;}
    bondStyles();
    window.openSheet('<h3>💝 CP & Friendship Gifts</h3><div id="sh-bond-gift-sheet" class="sh-bond-sheet">Loading verified gifts…</div>');
    const root=document.getElementById('sh-bond-gift-sheet');if(!root)return;
    try{
      const [config,mine]=await Promise.all([
        api('GET','/bonds/catalog'),api('GET','/bonds/me').catch(()=>null)
      ]);
      if(!root.isConnected)return;
      root.replaceChildren();
      const hero=document.createElement('div');hero.className='sh-bond-hero';
      hero.innerHTML='<div class="sh-bond-kicker">✦ ROYAL BOND COLLECTION ✦</div>'+
        '<div class="sh-bond-title">💗 CP · 🤝 Friendship</div>'+
        '<div class="sh-bond-sub">Both people must agree. No link is created until accepted.</div>';
      root.appendChild(hero);
      const label=document.createElement('label');label.textContent='Recipient ID';
      label.style.cssText='display:block;color:#ffe1ad;margin:11px 0 5px;font-weight:800';
      const input=document.createElement('input');input.className='sh-bond-input';
      input.inputMode='numeric';input.maxLength=8;input.placeholder='Enter exact 8-digit member ID';
      input.value=initialTarget?.id||'';
      root.append(label,input);
      const frame=document.getElementById('rf')?.contentWindow;
      const suggestions=[...(frame?.seats||[])].filter(s=>s?.public_id&&s.public_id!==profile?.public_id);
      if(suggestions.length){
        const chooser=document.createElement('select');chooser.className='sh-bond-input';
        chooser.style.marginTop='7px';
        const blank=document.createElement('option');blank.value='';blank.textContent='Or choose a room member';
        chooser.appendChild(blank);
        for(const seat of suggestions){const option=document.createElement('option');
          option.value=seat.public_id;option.textContent=seat.n+' · '+seat.public_id;
          chooser.appendChild(option);}
        chooser.onchange=()=>{if(chooser.value)input.value=chooser.value;};root.appendChild(chooser);
      }
      const tabs=document.createElement('div');tabs.className='sh-bond-actions';
      const giftList=document.createElement('div');
      const render=selected=>{
        giftList.replaceChildren();
        const allowed=config.policy?.[selected+'_enabled'];
        const gifts=(config.gifts||[]).filter(g=>g.type===selected&&g.active);
        if(!allowed||!gifts.length){giftList.textContent='This gift type is disabled by the admin.';return;}
        for(const gift of gifts){
          const card=document.createElement('div');card.className='sh-bond-gift';
          const description=document.createElement('div');
          const title=document.createElement('strong');title.textContent=gift.emoji+' '+gift.name;
          const price=document.createElement('small');price.style.display='block';
          price.textContent='🪙 '+bondFmt(gift.price_coins)+' · held until acceptance';
          description.append(title,price);
          const send=document.createElement('button');send.type='button';send.className='sh-bond-button '+
            (selected==='friendship'?'blue':'');send.textContent='Send invite';
          send.onclick=async()=>{
            const id=input.value.trim();
            if(!/^[0-9]{8}$/.test(id)||id===profile?.public_id){
              toast('Choose another member’s valid 8-digit ID');return;}
            const fingerprint=id+':'+gift.id;
            const requestId=pendingBondInvite?.fingerprint===fingerprint?
              pendingBondInvite.requestId:nextWalletRequestId('bond');
            pendingBondInvite={fingerprint,requestId};send.disabled=true;
            try{
              const activeBond=selected==='cp'
                ?mine?.profile?.cp?.partner?.id===id
                :(mine?.profile?.friendships||[]).some(friend=>friend.partner?.id===id);
              const result=await api('POST',activeBond?'/bonds/gift':'/bonds/invite',{
                recipient_public_id:id,gift_id:gift.id,request_id:requestId
              });
              pendingBondInvite=null;
              // The invitation/gift is already committed. An unrelated wallet
              // refresh timeout must not tell someone their gift failed.
              await reloadWallet().catch(()=>{});
              window.closeSheet();
              toast(result.duplicate?'Gift request already confirmed ✓':activeBond?
                '💝 Bond gift sent! '+bondFmt(result.spent_coins)+' coins · Pair rank boosted ✓':
                '💌 Invitation sent! '+bondFmt(result.held_coins)+' coins held until accepted.');
            }catch(error){
              const reason=errText(error);
              const hints={bond_invite_pair_pending:'An invitation to this person is already awaiting a reply.',
                cp_invite_already_pending:'Only one open CP proposal is allowed. Reply to the existing invitation first.',
                bond_invite_rate_limited:'Daily invitation limit reached (20 in 24 hours). Please try again later.',
                bond_already_active:'You are already linked. Reopen Gifts to send a pair-ranking gift.',
                wallet_insufficient:'Not enough coins for this gift.'};
              toast(hints[reason]||'Invitation not confirmed: '+reason);send.disabled=false;
            }
          };
          card.append(description,send);giftList.appendChild(card);
        }
      };
      for(const item of [{id:'cp',label:'💝 CP Gifts'},{id:'friendship',label:'🤝 Friendship'}]){
        const button=document.createElement('button');button.type='button';button.className='sh-bond-button '+
          (item.id==='friendship'?'blue':'');button.textContent=item.label;
        button.onclick=()=>render(item.id);tabs.appendChild(button);
      }
      root.append(tabs,giftList);
      const note=document.createElement('p');note.className='sh-bond-muted';
      note.textContent='Declined or expired invitations refund held coins automatically. One CP partner, multiple friends. Invitation expires after '+config.policy.expiry_hours+' hours.';
      root.appendChild(note);render(type==='friendship'?'friendship':'cp');
    }catch(error){root.textContent='Gift catalog unavailable: '+errText(error);}
  }
  async function showBondInbox(){
    if(!session)return;
    bondStyles();
    window.openSheet('<h3>💌 Relationship Invitations</h3><div class="sh-bond-sheet" id="sh-bond-inbox">Loading invitations…</div>');
    const root=document.getElementById('sh-bond-inbox');
    try{
      const data=await api('GET','/bonds/me');if(!root?.isConnected)return;
      root.replaceChildren();
      const notice=document.createElement('div');notice.className='sh-bond-hero';
      notice.innerHTML='<div class="sh-bond-kicker">✦ PRIVATE INVITATIONS ✦</div>'+
        '<div class="sh-bond-title">💌 CP & Friends</div>'+
        '<div class="sh-bond-sub">Accept only invitations you want.</div>';
      root.appendChild(notice);
      for(const invite of data.received||[]){
        const row=document.createElement('div');row.className='sh-bond-invite';
        row.textContent=invite.emoji+' '+invite.sender_name+' · ID '+invite.sender_id+
          ' invited you to '+(invite.type==='cp'?'CP 💗':'Friendship 🤝')+
          ' · Gift '+bondFmt(invite.held_coins)+' coins';
        const actions=document.createElement('div');actions.className='sh-bond-actions';
        for(const accept of [true,false]){
          const button=document.createElement('button');button.type='button';
          button.className='sh-bond-button '+(accept?'gold':'blue');
          button.textContent=accept?'✓ Accept':'✕ Decline';
          button.onclick=async()=>{
            [...actions.querySelectorAll('button')].forEach(b=>b.disabled=true);
            try{await api('POST','/bonds/invites/'+invite.id+'/respond',{accept});
              toast(accept?'Relationship linked ✓':'Invitation declined and coins refunded ✓');
              await showBondInbox();
            }catch(error){toast('Could not respond: '+errText(error));
              [...actions.querySelectorAll('button')].forEach(b=>b.disabled=false);}
          };actions.appendChild(button);
        }
        row.appendChild(actions);root.appendChild(row);
      }
      for(const invite of data.sent||[]){const row=document.createElement('div');
        row.className='sh-bond-invite';
        row.textContent='⏳ Sent to '+invite.recipient_name+' · '+invite.recipient_id+
          ' · '+bondFmt(invite.held_coins)+' coins held until reply';root.appendChild(row);}
      if(!(data.received?.length||data.sent?.length)){
        const empty=document.createElement('p');empty.className='sh-bond-muted';
        empty.textContent='No pending CP or Friendship invitations.';root.appendChild(empty);}
    }catch(error){if(root?.isConnected)root.textContent='Invitations unavailable: '+errText(error);}
  }
  async function showBondRanking(type='cp',period='weekly'){
    bondStyles();
    window.openSheet('<h3>👑 Royal Relationship Ranking</h3><div class="sh-bond-sheet" id="sh-bond-rank">Loading ranking…</div>');
    const root=document.getElementById('sh-bond-rank');if(!root)return;
    const render=async(kind,range)=>{
      root.textContent='Loading verified pair ranking…';
      try{
        const result=await api('GET','/bonds/rankings?type='+kind+'&period='+range);
        if(!root.isConnected)return;
        root.replaceChildren();
        const hero=document.createElement('div');hero.className='sh-bond-hero';
        hero.innerHTML='<div class="sh-bond-kicker">✦ ROYAL PAIR LEAGUE ✦</div>'+
          '<div class="sh-bond-title">'+(kind==='cp'?'💞 CP Royalty':'🤝 Friendship Royalty')+'</div>'+
          '<div class="sh-bond-sub">Verified accepted gift value · '+range.toUpperCase()+' · UTC</div>';
        root.appendChild(hero);
        const kinds=document.createElement('div');kinds.className='sh-bond-actions';
        for(const k of ['cp','friendship']){
          const button=document.createElement('button');button.type='button';
          button.className='sh-bond-button '+(k==='friendship'?'blue':'');
          button.textContent=k==='cp'?'💗 CP':'🤝 Friendship';
          button.onclick=()=>render(k,range);kinds.appendChild(button);
        }root.appendChild(kinds);
        const dates=document.createElement('div');dates.className='sh-bond-actions';
        dates.style.gridTemplateColumns='repeat(3,minmax(0,1fr))';
        for(const p of ['daily','weekly','monthly']){
          const button=document.createElement('button');button.type='button';
          button.className='sh-bond-button '+(range===p?'gold':'blue');button.textContent=p;
          button.onclick=()=>render(kind,p);dates.appendChild(button);
        }root.appendChild(dates);
        if(!result.leaders?.length){const empty=document.createElement('p');
          empty.className='sh-bond-muted';empty.textContent='No verified pairs have ranked in this period yet.';
          root.appendChild(empty);}
        for(const pair of result.leaders||[]){
          const row=document.createElement('div');row.className='sh-bond-rankrow '+
            (kind==='friendship'?'friends':'');
          const rank=document.createElement('strong');rank.textContent='#'+pair.rank;
          rank.style.cssText='color:#ffe3a5;font-size:14px';row.appendChild(rank);
          row.appendChild(bondPerson(pair.a));
          const middle=document.createElement('span');middle.className='sh-bond-heart';
          middle.textContent=kind==='cp'?'💗':'🤝';row.appendChild(middle);
          row.appendChild(bondPerson(pair.b));
          const score=document.createElement('small');score.textContent='🪙'+bondFmt(pair.total);
          score.style.color='#ffe3a5';row.appendChild(score);
          root.appendChild(row);
        }
      }catch(error){if(root.isConnected)root.textContent='Ranking unavailable: '+errText(error);}
    };
    await render(type,period);
  }
  async function mountBondDetails(root,id,person){
    if(!root||!root.isConnected)return;
    bondStyles();
    root.querySelector('.sh-bond-panel')?.remove();
    const panel=document.createElement('section');panel.className='sh-bond-panel';
    const intro=document.createElement('div');intro.className='sh-bond-hero';
    intro.innerHTML='<div class="sh-bond-kicker">✦ SHARIKA ROYAL ID ✦</div>'+
      '<div class="sh-bond-title">💗 Royal Connections</div>'+
      '<div class="sh-bond-sub">Real followers · Gifts · CP · Friendship</div>';
    panel.appendChild(intro);
    const loading=document.createElement('p');loading.className='sh-bond-muted';
    loading.textContent='Loading verified relationship details…';panel.appendChild(loading);
    root.appendChild(panel);
    try{
      await api('POST','/bonds/visits/'+id).catch(()=>{});
      const data=await api('GET','/bonds/profile/'+id);
      if(!panel.isConnected||String(data.public_id)!==id)return;
      loading.remove();
      const stats=document.createElement('div');stats.className='sh-bond-stats';
      for(const [value,label] of [
        [data.followers,'Followers'],[data.following,'Following'],[data.visitors,'Visitors'],
        [data.gifts_received,'Gifts received'],[data.gifts_sent,'Gifts sent'],
        [data.friendships?.length||0,'Friends']]){
        const stat=document.createElement('div');stat.className='sh-bond-stat';
        const count=document.createElement('strong');count.textContent=bondFmt(value);
        const text=document.createElement('span');text.textContent=label;
        stat.append(count,text);stats.appendChild(stat);
      }panel.appendChild(stats);
      const giftTotals=document.createElement('p');giftTotals.className='sh-bond-muted';
      giftTotals.textContent='🎁 Received 🪙 '+bondFmt(data.gift_value_received)+
        '  ·  Sent 🪙 '+bondFmt(data.gift_value_sent);
      panel.appendChild(giftTotals);
      for(const sectionInfo of [
        {key:'recent_gifters',title:'🎁 Who sent gifts',type:'gifts'},
        {key:'followers_preview',title:'💖 Followers',type:'followers'},
        {key:'following_preview',title:'✨ Following',type:'following'}]){
        const section=document.createElement('section');section.className='sh-bond-section '+
          (sectionInfo.type==='followers'?'friends':'');
        const heading=document.createElement('h3');heading.textContent=sectionInfo.title;
        section.appendChild(heading);
        const list=document.createElement('div');list.className='sh-bond-social-list';
        for(const personEntry of data[sectionInfo.key]||[]){
          const row=document.createElement('button');row.type='button';
          row.className='sh-bond-social-user';
          const avatar=bondPerson(personEntry,false).querySelector('.sh-bond-avatar');
          const detail=document.createElement('span');
          const name=document.createElement('strong');name.textContent=personEntry.name;
          const sub=document.createElement('small');sub.textContent='ID '+personEntry.id+
            (sectionInfo.type==='gifts'?' · '+personEntry.emoji+' '+personEntry.gift_name+
              ' · 🪙 '+bondFmt(personEntry.coins):'');
          detail.append(name,sub);row.append(avatar,detail);
          row.onclick=()=>openVerifiedRankProfile(personEntry.id);
          list.appendChild(row);
        }
        if(!list.children.length){const empty=document.createElement('p');
          empty.className='sh-bond-muted';
          empty.textContent=sectionInfo.type==='gifts'?'No verified gifts yet.':
            'No verified members to show yet.';list.appendChild(empty);}
        section.appendChild(list);panel.appendChild(section);
      }
      const cp=document.createElement('section');cp.className='sh-bond-section';
      const cpTitle=document.createElement('h3');cpTitle.textContent='💗 CP · Rose Gold Promise';
      const couple=document.createElement('div');couple.className='sh-bond-couple';
      couple.appendChild(bondPerson({id,name:person?.name,pic:person?.pic,
        frame_style:person?.frame_style},false));
      const heart=document.createElement('span');heart.className='sh-bond-heart';
      heart.textContent='💞';couple.appendChild(heart);
      couple.appendChild(bondPerson(data.cp?.partner||null));
      cp.append(cpTitle,couple);
      const cpHint=document.createElement('div');cpHint.className='sh-bond-muted';
      cpHint.textContent=data.cp?'Together since '+new Date(data.cp.created_at_ms).toLocaleDateString():
        'One CP partner at a time · Accept a Rose Promise gift to bind';
      cp.appendChild(cpHint);panel.appendChild(cp);
      const friends=document.createElement('section');friends.className='sh-bond-section friends';
      const friendTitle=document.createElement('h3');
      friendTitle.textContent='🤝 Friendship Palace · '+(data.friendships?.length||0);
      friends.appendChild(friendTitle);
      const friendList=document.createElement('div');friendList.className='sh-bond-friendlist';
      for(const friendship of data.friendships||[]){
        const button=document.createElement('button');button.type='button';
        button.className='sh-bond-friend';
        button.textContent='💙 '+friendship.partner.name+' · '+friendship.partner.id;
        button.onclick=()=>openVerifiedRankProfile(friendship.partner.id);
        friendList.appendChild(button);
      }
      if(!friendList.children.length){const empty=document.createElement('p');
        empty.className='sh-bond-muted';empty.textContent='Friendship gifts connect multiple friends.';
        friendList.appendChild(empty);}
      friends.appendChild(friendList);panel.appendChild(friends);
      // Keep the couple/friendship portrait immediately below the stats;
      // longer gift/follower histories belong beneath those primary cards.
      [...panel.querySelectorAll('.sh-bond-section')]
        .filter(section=>section.querySelector('.sh-bond-social-list'))
        .forEach(section=>panel.appendChild(section));
      const actions=document.createElement('div');actions.className='sh-bond-actions';
      const gift=document.createElement('button');gift.className='sh-bond-button';
      gift.textContent='🎁 CP / Friends Gifts';gift.onclick=()=>showBondGiftSheet(
        id===profile?.public_id?null:{id,name:person?.name});
      const rank=document.createElement('button');rank.className='sh-bond-button blue';
      rank.textContent='🏆 Pair Ranking';rank.onclick=()=>showBondRanking('cp','weekly');
      actions.append(gift,rank);
      if(id===profile?.public_id){
        const inbox=document.createElement('button');inbox.className='sh-bond-button gold';
        inbox.textContent='💌 Invitations';inbox.onclick=showBondInbox;actions.appendChild(inbox);
        for(const bound of [data.cp,...(data.friendships||[])].filter(Boolean)){
          const leave=document.createElement('button');leave.className='sh-bond-button blue';
          leave.textContent='✕ Unbind '+(bound.type==='cp'?'CP':'Friend')+' · '+bound.partner.name;
          leave.onclick=async()=>{
            if(!window.confirm('End '+bound.type+' relationship with '+bound.partner.name+'?'))return;
            leave.disabled=true;
            try{await api('POST','/bonds/'+bound.id+'/unbind',{});
              toast('Relationship ended ✓');await mountBondDetails(root,id,person);
            }catch(error){toast('Unbind failed: '+errText(error));leave.disabled=false;}
          };actions.appendChild(leave);
        }
      }
      panel.appendChild(actions);
    }catch(error){loading.textContent='Connections unavailable: '+errText(error);}
  }

  let rankProfileRequest=0;
  async function openVerifiedRankProfile(publicId){
    const id=String(publicId||'');
    if(!/^[0-9]{8}$/.test(id)||!session){toast('Verified user ID unavailable');return;}
    const panel=document.getElementById('pfo'),root=document.getElementById('pfc');
    if(!panel||!root)return;
    const requestNo=++rankProfileRequest;
    panel.classList.add('on');panel.scrollTop=0;
    root.innerHTML='<div class="empty">Loading verified profile for ID '+id+'…</div>';
    try{
      // A verified profile must come from D1. The original demo model
      // fabricates age, followers and pictures and must not be used here.
      const person=await api('GET','/users/'+id);
      if(requestNo!==rankProfileRequest||!panel.classList.contains('on'))return;
      if(String(person.id)!==id)throw new Error('Profile ID does not match');
      const face=verifiedAvatarUrl(person.pic);
      const wealth=Math.max(0,Number(person.wealth_level)||0);
      const charm=Math.max(0,Number(person.charm_level)||0);
      root.innerHTML='<div class="pf sh-ranked-profile">'+
        '<div class="cov"></div><div class="pfh"><div class="pavw">'+
        '<div class="pavr" style="--g1:#ffdc7b;--g2:#a06bff"></div>'+
        '<div class="pav3" id="sh-ranked-avatar" role="img" aria-label="Profile photo"></div>'+
        '</div><h2>'+sellerEscape(person.name||'User')+'</h2>'+
        '<div class="meta"><span>🆔 '+id+'</span>'+
        (person.country?'<span>🌍 '+sellerEscape(person.country)+'</span>':'')+
        '</div></div><div class="lvs">'+
        '<div class="lvc w"><b>💰 Wealth level</b><div class="big3">'+
        wealth+'</div><small>Verified profile level</small></div>'+
        '<div class="lvc c"><b>💗 Charm level</b><div class="big3">'+
        charm+'</div><small>Verified profile level</small></div></div>'+
        '<div class="sh-profile-note">This is the real Sharika profile for ID '+id+
        '. Only server-verified details are shown.</div>'+
        '<div class="pbtn"><button id="sh-ranked-follow" type="button" disabled>'+
        'Loading follow status…</button></div>'+
        '</div>';
      const avatar=root.querySelector('#sh-ranked-avatar');
      if(face)avatar.style.backgroundImage='url("'+face+'")';
      else avatar.textContent='👤';
      decorateVerifiedPublicProfile(root,person);
      mountBondDetails(root,id,person).catch(error=>
        console.warn('Ranked ID bond details:',errText(error)));
      const follow=root.querySelector('#sh-ranked-follow');
      async function loadFollowing(){
        const data=await api('GET','/users/'+id+'/follow');
        if(requestNo!==rankProfileRequest||!follow.isConnected)return;
        const following=!!data.following;
        follow.disabled=false;
        follow.textContent=following?'✓ Following':'＋ Follow';
        follow.onclick=async()=>{
          follow.disabled=true;
          try{
            await api(following?'DELETE':'PUT','/users/'+id+'/follow');
            await loadFollowing();
          }catch(error){
            toast('Follow action failed: '+errText(error));
            if(follow.isConnected)follow.disabled=false;
          }
        };
      }
      if(id===profile?.public_id){
        follow.style.display='none';
      }else loadFollowing().catch(error=>{
        if(follow.isConnected)follow.textContent='Follow unavailable';
        console.warn('Verified follow status unavailable:',errText(error));
      });
    }catch(error){
      if(requestNo===rankProfileRequest&&panel.classList.contains('on'))
        root.textContent='Unable to open verified profile: '+errText(error);
    }
  }

  let rankingRequest=0;
  window.renderRank=async function(){
    const view=document.getElementById('rb');
    if(!view)return;
    const rankView=document.getElementById('v-rank');
    if(rankView&&!document.getElementById('sh-bond-rank-shortcuts')){
      bondStyles();
      const shortcuts=document.createElement('div');
      shortcuts.id='sh-bond-rank-shortcuts';
      shortcuts.style.cssText='display:flex;justify-content:center;gap:9px;padding:11px 13px;'+
        'margin:5px auto;max-width:550px';
      for(const item of [{type:'cp',label:'💗 CP Royal Ranking'},
        {type:'friendship',label:'🤝 Friendship Ranking'}]){
        const button=document.createElement('button');button.className='sh-bond-button '+
          (item.type==='friendship'?'blue':'');button.type='button';
        button.textContent=item.label;
        button.onclick=()=>showBondRanking(item.type,'weekly');
        shortcuts.appendChild(button);
      }
      const anchor=rankView.querySelector('#rb');
      if(anchor)rankView.insertBefore(shortcuts,anchor);
      else rankView.appendChild(shortcuts);
    }
    if(rankView&&!document.getElementById('wgb')){
      const weeklyButton=document.createElement('button');
      weeklyButton.id='wgb';
      weeklyButton.textContent='🏆';
      weeklyButton.title='Verified weekly leaders';
      weeklyButton.onclick=()=>window.box();
      rankView.appendChild(weeklyButton);
    }
    const requestNo=++rankingRequest;
    const periods=['daily','weekly','monthly'];
    // Original navigation order: Lucky, Rich, Charm, Room, Noble, Play,
    // Recharge. Never show Recharge data when the member tapped Lucky.
    const categories={
      0:{kind:'lucky',icon:'🎰',title:'Lucky Gift',description:'Verified lucky gift winnings'},
      1:{kind:'rich',icon:'💎',title:'Rich',description:'Verified gifts sent to other members'},
      2:{kind:'charm',icon:'💗',title:'Charm',description:'Verified gifts received'},
      3:{kind:'room',icon:'🎙️',title:'Room',description:'Gifts sent in each voice room'},
      6:{kind:'recharge',icon:'🪙',title:'Recharge',description:'Approved coin recharge totals'}
    };
    const period=periods[window.rper]||'weekly';
    const selected=categories[window.rtab];
    const kind=selected?.kind;
    view.innerHTML='<div class="sh-royal-empty">✦ Loading verified royal rankings…</div>';
    if(!selected){
      const name={4:'Noble',5:'Play'}[window.rtab]||'This';
      view.innerHTML='<div class="sh-royal-empty"><span aria-hidden="true">👑</span>'+
        '<strong>'+name+' ranking</strong>'+
        'This category is awaiting its verified ranking service. No demo users or '+
        'Recharge results are shown as '+name+' winners.</div>';
      return;
    }
    if(!session){
      view.innerHTML='<div class="sh-royal-empty"><strong>Sign in required</strong>'+
        'Sign in to see verified rankings.</div>';
      return;
    }
    try{
      const data=await api('GET','/rankings?period='+period+'&kind='+kind);
      if(requestNo!==rankingRequest)return;
      const leaders=Array.isArray(data.leaders)?data.leaders:[];
      view.textContent='';
      cosmeticCss(document);
      const isRoom=kind==='room';
      const fmt=n=>Number(n||0).toLocaleString('en-US');
      const hero=document.createElement('section');
      hero.className='sh-royal-hero';
      const kicker=document.createElement('div');
      kicker.className='sh-royal-kicker';
      kicker.textContent='✦ Sharika Royal Ranking ✦';
      const heading=document.createElement('h2');
      heading.className='sh-royal-title';
      heading.textContent=selected.icon+' '+selected.title+' Champions';
      const description=document.createElement('p');
      description.className='sh-royal-sub';
      description.textContent=selected.description+' · '+period.toUpperCase()+' · UTC';
      hero.append(kicker,heading,description);
      if(leaders.length){
        const podium=document.createElement('div');
        podium.className='sh-royal-podium';
        for(const leader of leaders.slice(0,3)){
          const place=Number(leader.rank);
          if(![1,2,3].includes(place))continue;
          const card=document.createElement('article');
          card.className='sh-royal-podium-card '+
            ({1:'first',2:'second',3:'third'}[place]);
          const trophy=document.createElement('span');
          trophy.className='sh-royal-place';
          trophy.textContent={1:'👑',2:'🥈',3:'🥉'}[place];
          trophy.setAttribute('aria-label','Rank '+place);
          const avatar=royalRankAvatar(leader,isRoom);
          const name=document.createElement('div');
          name.className='sh-royal-name';
          name.textContent=leader.name|| (isRoom?'Voice room':'Member');
          name.title=name.textContent;
          const id=document.createElement('div');
          id.className='sh-royal-id';
          id.textContent='ID '+String(isRoom?leader.room_id:leader.public_id||'');
          const amount=document.createElement('div');
          amount.className='sh-royal-amount';
          amount.textContent='🪙 '+fmt(leader.total);
          card.append(trophy,avatar,name,id,amount);
          const tag=!isRoom&&royalRankNameTag(leader);
          if(tag)card.appendChild(tag);
          royalRankAction(card,leader,isRoom);
          if(leader.public_id&&leader.public_id===profile?.public_id)
            card.classList.add('me');
          podium.appendChild(card);
        }
        hero.appendChild(podium);
      }
      view.appendChild(hero);
      if(!leaders.length){
        const empty=document.createElement('div');
        empty.className='sh-royal-empty';
        empty.innerHTML='<span aria-hidden="true">✨</span>'+
          '<strong>No verified winners yet</strong>'+
          'When real activity is settled on the server, this ranking will fill automatically.';
        view.appendChild(empty);return;
      }
      if(leaders.length>3){
        const line=document.createElement('div');
        line.className='sh-royal-divider';
        line.textContent='✦ Rising Stars ✦';
        view.appendChild(line);
      }
      for(const leader of leaders.slice(3)){
        const row=document.createElement('div');
        row.className='rr sh-royal-row'+
          (leader.public_id&&leader.public_id===profile?.public_id?' me':'');
        row.innerHTML='<b class="n"></b><div class="ra"></div>'+
          '<div class="rn"><b></b><span class="idl"><i class="idb">ID</i>'+
          '<span class="sid"></span></span></div>'+
          '<div class="rv"><i class="cn"></i><span class="amt"></span></div>';
        row.querySelector('.n').textContent=String(leader.rank);
        row.querySelector('.ra').replaceWith(royalRankAvatar(leader,isRoom));
        row.querySelector('.rn b').textContent=leader.name||'User';
        row.querySelector('.sid').textContent=isRoom?leader.room_id:leader.public_id;
        row.querySelector('.amt').textContent=fmt(leader.total);
        const tag=!isRoom&&royalRankNameTag(leader);
        if(tag)row.querySelector('.rn')?.appendChild(tag);
        // Ranking user IDs, names and photos all open the same verified ID.
        // Room-ranking IDs are room IDs and are deliberately not treated as users.
        royalRankAction(row,leader,isRoom);
        view.appendChild(row);
      }
    }catch(error){
      if(requestNo===rankingRequest)view.textContent='Rankings unavailable: '+errText(error);
    }
  };
  // Each uploaded original gets its own compact card. The uploaded HTML layouts are retained, but their local finance logic is
  // removed. A strict source-checked bridge calls only authenticated API routes.
  // Never accept wallet amounts or winner results from child messages.
  const originalGameCards=[
    {id:'sovera-food',name:'Sovera Food Wheel',tag:'🎡 Classic',
      image:'file:///android_asset/food-wheel-original-card.png',
      page:'file:///android_asset/original-games/sovera-food-wheel.html'},
    {id:'night-food',name:'Night Food Wheel',tag:'🌙 Night',
      image:'file:///android_asset/food-wheel-original-card.png',
      page:'file:///android_asset/original-games/night-food-wheel.html'},
    {id:'jackpot-fruit',name:'Jackpot Fruit',tag:'🎰 Jackpot',
      image:'file:///android_asset/jackpot-fruit-original-card.png',
      page:'file:///android_asset/original-games/jackpot-fruit.html'},
    {id:'greedy-wheel',name:'Greedy Wheel',tag:'🍕 Food & Veg',
      image:'file:///android_asset/greedy-wheel/img/pizza.webp',
      page:'file:///android_asset/greedy-wheel/index.html?sheet=1&lang=en'}
  ];
  // Only announce server-confirmed round winners during the first ten seconds
  // after settlement. Persist one announcement per game/round across reopens.
  const announcedOriginalGameRounds=new Map();
  function verifiedOriginalGameTopThree(game,state){
    const prev=state?.previous_result;
    if(!prev||!Number.isSafeInteger(prev.round_no)||prev.round_no<0)return null;
    const elapsed=Number(state.server_time)-(prev.round_no+1)*40000;
    if(!Number.isFinite(elapsed)||elapsed<0||elapsed>10000)return null;
    const winners=Array.isArray(prev.top_winners)?prev.top_winners.slice(0,3)
      .filter(w=>w&&/^[0-9]{8}$/.test(String(w.public_id||''))&&
        typeof w.name==='string'&&w.name.trim()&&
        Number.isSafeInteger(Number(w.total_win))&&Number(w.total_win)>0):[];
    if(!winners.length||announcedOriginalGameRounds.get(game)===prev.round_no)return null;
    announcedOriginalGameRounds.set(game,prev.round_no);
    return {round_no:prev.round_no,winners};
  }
  let originalGameWalletRefreshTime=0;
  function showGameCard(doc,insideRoom,showToast){
    if(!session){window.showAuth('welcome');return;}
    const sheet=doc.getElementById(insideRoom?'sheet':'sh');
    const overlay=doc.getElementById(insideRoom?'bg':'shb');
    if(!sheet||!overlay){showToast('Game menu unavailable');return;}
    function catalog(){
      sheet.innerHTML='<div class="grab"></div><h3>🎮 Original Games</h3>'+
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));'+
        'gap:10px;padding:8px 1px 16px;max-height:70vh;overflow:auto" id="sh-original-grid"></div>'+
        '<p style="font-size:12px;opacity:.8;text-align:center;margin:3px 0">'+
        'Original graphics · live virtual-coin server rounds</p>';
      const grid=sheet.querySelector('#sh-original-grid');
      originalGameCards.forEach(item=>{
        const card=doc.createElement('button');
        card.type='button';
        card.setAttribute('aria-label','View '+item.name);
        card.style.cssText='display:flex;flex-direction:column;align-items:stretch;'+
          'padding:6px;min-width:0;border:1px solid #e9ba50;border-radius:14px;'+
          'background:linear-gradient(150deg,#381760,#130b32);color:#fff;'+
          'box-shadow:inset 0 2px 2px #fff5,inset 0 -5px 9px #0009,0 9px 16px #0009;text-align:left;cursor:pointer';
        const img=doc.createElement('img');
        img.src=item.image;
        img.alt=item.name;
        img.style.cssText='width:100%;aspect-ratio:3/2;object-fit:cover;'+
          'border-radius:10px;display:block';
        if(item.id==='night-food')img.style.filter='hue-rotate(24deg) brightness(.72)';
        const title=doc.createElement('b');
        title.textContent=item.name;
        title.style.cssText='font-size:13px;line-height:1.3;padding:7px 2px 1px';
        const tag=doc.createElement('span');
        tag.textContent=item.tag;
        tag.style.cssText='color:#fbbf24;font-size:11px;padding:0 2px 4px';
        card.append(img,title,tag);
        card.onclick=()=>preview(item);
        grid.appendChild(card);
      });
    }
    let currentGameFrame=null;
    const view=doc.defaultView||window;
    if(typeof view.__sharikaOriginalGameCleanup==='function')
      view.__sharikaOriginalGameCleanup();
    // A game result may be announced only after the verified D1 settlement.
    // Each winning player gets a compact top-slide card; the game UI underneath
    // is untouched, and no child iframe may provide winner names or amounts.
    let winnerBannerTimer=null;
    let winnerBannerStepTimer=null;
    function clearWinnerBanner(){
      if(winnerBannerTimer!==null){view.clearTimeout(winnerBannerTimer);winnerBannerTimer=null;}
      if(winnerBannerStepTimer!==null){view.clearInterval(winnerBannerStepTimer);winnerBannerStepTimer=null;}
      doc.getElementById('sh-verified-original-winners')?.remove();
    }
    function ensureWinnerBannerStyle(){
      if(doc.getElementById('sh-verified-win-style'))return;
      const style=doc.createElement('style');
      style.id='sh-verified-win-style';
      style.textContent=[
        '#sh-verified-original-winners{position:fixed;top:calc(12px + env(safe-area-inset-top,0px));left:50%;width:min(82vw,560px);max-width:calc(100vw - 44px);z-index:2147483000;pointer-events:none;filter:drop-shadow(0 10px 18px #000b);animation:shWinSlide .65s cubic-bezier(.18,1.4,.36,1) both}',
        '#sh-verified-original-winners .sh-win-pill{position:relative;isolation:isolate;display:flex;align-items:center;gap:8px;min-height:62px;padding:6px 7px;border:2px solid #ffdf75;border-radius:46px;background:linear-gradient(110deg,#276578,#1b8c97 52%,#1baea6);box-shadow:inset 0 2px 4px #ffffff66,inset 0 -5px 10px #064c6299,0 0 12px #f7d46eaa;color:#fff}',
        '#sh-verified-original-winners .sh-win-wing{position:absolute;z-index:-1;top:-20px;width:108px;height:105px;filter:drop-shadow(0 2px 2px #ad6f25)}',
        '#sh-verified-original-winners .sh-win-left{left:-76px;animation:shWinWingLeft 1.15s ease-in-out infinite alternate}',
        '#sh-verified-original-winners .sh-win-right{right:-76px;transform:scaleX(-1);animation:shWinWingRight 1.15s ease-in-out infinite alternate}',
        '#sh-verified-original-winners .sh-win-crown{position:absolute;top:-31px;left:50%;transform:translateX(-50%);font-size:28px;filter:drop-shadow(0 2px 5px #e5a132);line-height:1}',
        '#sh-verified-original-winners .sh-win-avatar{display:grid;place-items:center;flex:none;width:50px;height:50px;border:2px solid #f9d676;border-radius:50%;background:#10263f;box-shadow:0 2px 8px #001d3699;overflow:hidden;font-size:27px}',
        '#sh-verified-original-winners .sh-win-avatar img{width:100%;height:100%;object-fit:cover}',
        '#sh-verified-original-winners .sh-win-copy{flex:1;min-width:0;text-shadow:0 2px 4px #063b5e}',
        '#sh-verified-original-winners .sh-win-name{display:block;font-size:11px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '#sh-verified-original-winners .sh-win-number{display:block;font-size:clamp(17px,4.6vw,25px);font-weight:1000;line-height:1.14;white-space:nowrap}',
        '#sh-verified-original-winners .sh-win-number em{font-style:normal;color:#ffe27a}',
        '#sh-verified-original-winners .sh-win-game{display:grid;place-items:center;flex:none;width:42px;height:42px;border-radius:50%;background:#00bcbc;border:2px dotted #ffe998;font-size:25px;box-shadow:inset 0 0 9px #00383c}',
        '#sh-verified-original-winners .sh-win-go{pointer-events:auto;flex:none;display:grid;place-items:center;width:47px;height:47px;padding:0;border:3px solid #fbe49d;border-radius:50%;background:radial-gradient(circle at 30% 28%,#fff8c7,#e5a837 68%,#b36d18);color:#9e3a03;font:1000 17px system-ui;box-shadow:0 2px 6px #31230d;cursor:pointer}',
        '@keyframes shWinSlide{0%{transform:translate(-50%,-170%) scale(.88);opacity:0}65%{transform:translate(-50%,5%) scale(1.03);opacity:1}100%{transform:translate(-50%,0) scale(1);opacity:1}}',
        '@keyframes shWinWingLeft{to{transform:rotate(-8deg)}}@keyframes shWinWingRight{to{transform:scaleX(-1) rotate(-8deg)}}',
        '@media(max-width:360px){#sh-verified-original-winners .sh-win-pill{gap:5px;min-height:56px;padding:5px}#sh-verified-original-winners .sh-win-avatar{width:43px;height:43px}#sh-verified-original-winners .sh-win-game{width:35px;height:35px;font-size:21px}#sh-verified-original-winners .sh-win-go{width:41px;height:41px;font-size:15px}#sh-verified-original-winners .sh-win-wing{width:85px;left:-62px}#sh-verified-original-winners .sh-win-right{left:auto;right:-62px}}',
        '@media(prefers-reduced-motion:reduce){#sh-verified-original-winners,#sh-verified-original-winners .sh-win-wing{animation:none!important}}'
      ].join('');
      doc.head.appendChild(style);
    }
    function winnerWing(side){
      const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','0 0 120 112');
      svg.setAttribute('aria-hidden','true');
      svg.classList.add('sh-win-wing','sh-win-'+side);
      const gradient='shWinFeather-'+side;
      svg.innerHTML='<defs><linearGradient id="'+gradient+'" x1="0" y1="0" x2="1" y2="1">'+
        '<stop offset="0" stop-color="#fffbe7"/><stop offset=".5" stop-color="#f6cb67"/>'+
        '<stop offset="1" stop-color="#c87938"/></linearGradient></defs>'+
        '<path d="M117 91 Q78 80 6 3 Q29 54 78 80 Q34 60 4 28 Q19 75 82 93 Q38 85 15 64 Q41 103 117 98Z" fill="url(#'+gradient+')" stroke="#ad6b27" stroke-width="2"/>'+
        '<path d="M110 90 Q55 51 15 8 M105 94 Q50 72 12 33 M106 98 Q61 94 19 67" stroke="#fff9de" stroke-width="3" fill="none" opacity=".85"/>';
      return svg;
    }
    function announceRoundWinners(game,result){
      const confirmed=verifiedOriginalGameTopThree(game,result);
      if(!confirmed)return;
      clearWinnerBanner();
      ensureWinnerBannerStyle();
      const banner=doc.createElement('div');
      banner.id='sh-verified-original-winners';
      banner.setAttribute('role','status');
      banner.setAttribute('aria-live','polite');
      const gameIcon=game==='jackpot-fruit'?'🎰':game==='night-food'?'🌙':'🎡';
      let currentIndex=0;
      function paint(winner){
        const pill=doc.createElement('div');
        pill.className='sh-win-pill';
        const crown=doc.createElement('span');
        crown.className='sh-win-crown';crown.textContent='👑';
        const avatar=doc.createElement('span');
        avatar.className='sh-win-avatar';
        const avatarSrc=verifiedAvatarUrl(winner.pic);
        if(avatarSrc){
          const photo=doc.createElement('img');
          photo.src=avatarSrc;photo.alt='';
          photo.onerror=()=>{avatar.textContent='👤';};
          avatar.appendChild(photo);
        }else avatar.textContent='👤';
        const copy=doc.createElement('span');
        copy.className='sh-win-copy';
        const name=doc.createElement('span');
        name.className='sh-win-name';name.textContent=winner.name;
        const number=doc.createElement('strong');
        number.className='sh-win-number';
        number.append('WIN ');
        const amount=doc.createElement('em');
        amount.textContent='🪙'+Number(winner.total_win).toLocaleString('en-US');
        number.appendChild(amount);copy.append(name,number);
        const gameBadge=doc.createElement('span');
        gameBadge.className='sh-win-game';gameBadge.textContent=gameIcon;
        const go=doc.createElement('button');
        go.type='button';go.className='sh-win-go';go.textContent='GO';
        go.setAttribute('aria-label','Return to '+(currentGameFrame?.item?.name||'game'));
        go.onclick=()=>{
          clearWinnerBanner();
          currentGameFrame?.element?.scrollIntoView({block:'nearest',behavior:'smooth'});
        };
        pill.append(winnerWing('left'),winnerWing('right'),crown,avatar,copy,gameBadge,go);
        banner.replaceChildren(pill);
      }
      paint(confirmed.winners[currentIndex]);
      doc.body.appendChild(banner);
      if(confirmed.winners.length>1){
        winnerBannerStepTimer=view.setInterval(()=>{
          currentIndex+=1;
          if(currentIndex>=confirmed.winners.length){
            view.clearInterval(winnerBannerStepTimer);winnerBannerStepTimer=null;
          }else paint(confirmed.winners[currentIndex]);
        },3000);
      }
      winnerBannerTimer=view.setTimeout(clearWinnerBanner,
        Math.min(9500,confirmed.winners.length*3200));
    }
    function preview(item){
      currentGameFrame=null;clearWinnerBanner();
      sheet.innerHTML='<div class="grab"></div>'+
        '<button id="sh-original-back" type="button" '+
        'style="padding:8px 14px;border:1px solid #d4af37;border-radius:10px;'+
        'background:#351164;color:#fff">← All games</button>'+
        '<h3 style="margin:8px 0"></h3>'+
        '<div id="sh-original-host" style="width:100%;height:min(74vh,750px);'+
        'min-height:380px;border:1px solid #a56dff;border-radius:12px;'+
        'overflow:hidden;background:#100424"></div>';
      sheet.querySelector('h3').textContent=item.name;
      sheet.querySelector('#sh-original-back').onclick=()=>{currentGameFrame=null;clearWinnerBanner();catalog()};
      const gameFrame=doc.createElement('iframe');
      gameFrame.src=item.page;
      gameFrame.setAttribute('title',item.name);
      gameFrame.style.cssText='width:100%;height:100%;border:0;display:block';
      gameFrame.setAttribute('referrerpolicy','no-referrer');
      sheet.querySelector('#sh-original-host').appendChild(gameFrame);
      currentGameFrame={element:gameFrame,item};
    }
    // Child frame has no Firebase session, no native bridge, no wallet setter.
    // Only the active exact iframe can request one of these fixed operations.
    const onOriginalGameMessage=async function(event){
      const current=currentGameFrame;
      if(!current||event.source!==current.element.contentWindow||!session)return;
      if(!overlay.classList.contains('on')){
        // Closing the sheet must stop the hidden game from polling the server.
        view.__sharikaOriginalGameCleanup?.();
        return;
      }
      const data=event.data;
      if(!data||typeof data!=='object')return;
      if(current.item.id==='greedy-wheel'){
        if(data.source==='greedy-game'&&data.type==='close'){
          currentGameFrame=null;clearWinnerBanner();catalog();return;
        }
        if(data.source==='greedy-game'&&data.type==='topup'){
          showToast('Open Wallet from your profile to recharge');return;
        }
        if(data.type!=='sharika:greedy-request'||
          !Number.isSafeInteger(data.id)||data.id<1||
          !['state','bet','records'].includes(data.action))return;
        const target=current.element.contentWindow;
        const method=data.action==='bet'?'POST':'GET';
        try{
          const result=await api(method,'/greedy-wheel/'+data.action,
            data.action==='bet'?data.body:undefined);
          if(!session||currentGameFrame!==current)return;
          target.postMessage({type:'sharika:greedy-response',id:data.id,ok:true,value:result},'*');
          if(data.action==='bet'||(data.action==='state'&&
            Number.isSafeInteger(result?.balance)&&result.balance!==balance.coins&&
            Date.now()-originalGameWalletRefreshTime>=2500)){
            originalGameWalletRefreshTime=Date.now();
            reloadWallet().catch(()=>{});
          }
        }catch(error){
          if(!session||currentGameFrame!==current)return;
          target.postMessage({type:'sharika:greedy-response',id:data.id,
            ok:false,error:errText(error)},'*');
        }
        return;
      }
      if(data.type==='sharika:original-exit'){currentGameFrame=null;clearWinnerBanner();catalog();return;}
      if(data.type!=='sharika:original-request')return;
      const permitted=['state','history','stats','rankings','bet'];
      if(data.game!==current.item.id||!permitted.includes(data.action)||
         !Number.isSafeInteger(data.id)||data.id<1)return;
      const method=data.action==='bet'?'POST':'GET';
      if(data.method!==method)return;
      const target=current.element.contentWindow;
      if(!target)return;
      try{
        const result=await api(method,'/original-games/'+current.item.id+'/'+data.action,
          data.action==='bet'?data.body:undefined);
        // If the user changed games mid-request, do not send any data to it.
        if(!session||currentGameFrame!==current)return;
        target.postMessage({type:'sharika:original-response',id:data.id,ok:true,value:result},'*');
        if(data.action==='state'){
          announceRoundWinners(current.item.id,result);
          // A winning round credits D1 on state reads. Refresh the shared
          // profile/room wallet when its coin balance changes, not just on bets.
          if(Number.isSafeInteger(result?.coins)&&result.coins>=0&&
             result.coins!==balance.coins&&
             Date.now()-originalGameWalletRefreshTime>=2500){
            originalGameWalletRefreshTime=Date.now();
            reloadWallet().catch(()=>{});
          }
        }
        if(data.action==='bet')reloadWallet().catch(()=>{});
      }catch(error){
        if(!session||currentGameFrame!==current)return;
        target.postMessage({type:'sharika:original-response',id:data.id,ok:false,error:errText(error)},'*');
      }
    };
    view.addEventListener('message',onOriginalGameMessage);
    view.__sharikaOriginalGameCleanup=()=>{
      view.removeEventListener('message',onOriginalGameMessage);
      clearWinnerBanner();
      currentGameFrame?.element?.remove();
      currentGameFrame=null;
    };
    catalog();
    overlay.classList.add('on');
  }
  const gamesShortcut=document.getElementById('qg');
  if(gamesShortcut)gamesShortcut.onclick=()=>showGameCard(document,false,toast);
  // The original reward button used a fake #128 rank and local coin credit.
  // Show verified weekly leaders instead; no claim or coin-grant control.
  window.box=function() {
    if(!session){window.showAuth('welcome');return;}
    window.openSheet('<h3>🏆 Verified Weekly Leaders</h3>'+
      '<div class="empty">Results are based on completed server records, not demo users.</div>'+
      '<div id="sh-week-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0"></div>'+
      '<div id="sh-week-list" aria-live="polite"></div>'+
      '<p style="font-size:12px;opacity:.75;text-align:center;margin:14px 3px">'+
      'Weekly coin rewards and Couple ranking are not enabled yet.</p>');
    const tabs=document.getElementById('sh-week-tabs');
    const list=document.getElementById('sh-week-list');
    if(!tabs||!list)return;
    const options=[
      {kind:'recharge',title:'Top Recharge'},
      {kind:'charm',title:'Top Gift'},
      {kind:'room',title:'Top Room'}
    ];
    let requestNo=0;
    const buttons=new Map();
    async function select(kind) {
      const selected=++requestNo;
      for(const [key,button] of buttons)
        button.style.opacity=key===kind?'1':'.55';
      list.textContent='Loading verified results…';
      try {
        const data=await api('GET','/rankings?period=weekly&kind='+kind);
        if(requestNo!==selected||!list.isConnected||!session)return;
        list.textContent='';
        const leaders=Array.isArray(data.leaders)?data.leaders.slice(0,10):[];
        if(!leaders.length){
          list.textContent='No verified results for this week yet.';
          return;
        }
        for(const item of leaders) {
          const row=document.createElement('div');
          row.className='wrw';
          const place=document.createElement('span');
          place.className='m';
          place.textContent=['🥇','🥈','🥉'][item.rank-1]||'🏅';
          const title=document.createElement('b');
          title.textContent='#'+item.rank+' '+(item.name||'User')+
            ' · ID '+(kind==='room'?item.room_id:item.public_id);
          const amount=document.createElement('em');
          amount.textContent='🪙 '+Number(item.total||0).toLocaleString('en-US');
          row.append(place,title,amount);
          list.appendChild(row);
        }
      }catch(error){
        if(requestNo===selected&&list.isConnected)
          list.textContent='Unable to load verified rankings: '+errText(error);
      }
    }
    for(const option of options){
      const button=document.createElement('button');
      button.type='button';
      button.textContent=option.title;
      button.style.cssText='padding:9px 10px;border-radius:12px;'+
        'border:1px solid #d4af37;background:#351164;color:#fff;font-weight:700';
      button.onclick=()=>select(option.kind);
      tabs.appendChild(button);
      buttons.set(option.kind,button);
    }
    select('recharge');
  };
  const originalLogout=window.logout;
  window.logout=function(){
    if(window.cur)window.leaveRoom();
    if(presenceTimer){clearInterval(presenceTimer);presenceTimer=null;}
    document.getElementById('sh-invite-newbie')?.remove();
    document.getElementById('sh-invite-page')?.remove();
    session=null;profile=null;balance={coins:0,dia:0,xp:0};
    native('signOut').catch(()=>{});
    cleanLocalFakeState();
    originalLogout();
  };
  window.SharikaServer={api,reloadWallet,reloadRooms,connected:()=>!!session,voiceProvider:()=>voiceBackend};

  async function restore(){
    cleanLocalFakeState();
    try{
      const account=await native('session');
      if(!account.signedIn || !account.emailVerified) {
        window.showAuth('welcome');
        if(account.signedIn)toast('Verify your email, then sign in');
        return;
      }
      const local=await authenticated(account);
      window.A=Object.assign({
        name:'Me',pic:null,myRoom:null,claim:{d:'',streak:0},
        st:{},sw:{},rw:{},fol:[]
      },local.p);
      if(typeof window.fixA==='function')window.fixA();
      try{localStorage.setItem('vr_sess',local.key);}catch(_){}
      window.saveA();
      window.hideAuth();
      window.refresh();
      window.renderRooms();
      window.go('home');
    }catch(error){
      window.showAuth('welcome');
      toast('Sign-in needed: '+errText(error));
    }finally{
      // Signed-out users see real Firebase login, signed-in users their D1
      // home; neither ever sees the old unverified demo between the two.
      finishVerifiedStartup();
    }
  }
  restore();
})();
