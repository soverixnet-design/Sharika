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
  let framePoll = null, giftPoll = null, chatPoll = null, invitePoll = null;
  let voiceRoom = null, voiceRoomId = null, voiceSdkPromise = null;
  let voiceBackend = null;

  function errText(error) { return String(error && error.message || error || 'Connection unavailable'); }
  function toast(message) { if (window.toast) window.toast(message); }
  function native(action, payload) {
    if (!window.SharikaNative || typeof window.SharikaNative.call !== 'function')
      return Promise.reject(new Error('Android native bridge unavailable'));
    return new Promise((resolve, reject) => {
      const id = String(++seq);
      const timeoutMs = action === 'pickProfilePhoto' ? 180000 : 25000;
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
      '.sh-sovera-entry-cover{position:fixed;inset:0;z-index:2147483600;',
      'pointer-events:none;display:flex;justify-content:center;align-items:center;',
      'background:radial-gradient(circle,#251054a8,transparent 70%)}',
      '.sh-sovera-entry-cover img{width:min(82vw,410px);height:min(65dvh,560px);',
      'max-width:100%;max-height:100%;object-fit:contain;opacity:0;',
      'filter:drop-shadow(0 0 12px #e6c6ff80)}',
      '.sh-sovera-entry-cover.ready img{opacity:1}',
      '@media(max-height:560px){.sh-sovera-entry-cover img{height:70vh;width:min(58vw,350px)}}',
      '.sh-sovera-entry-cover button{position:absolute;top:20px;right:18px;',
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
  function decorateRoomPeople(frame){
    const doc=frame?.document;
    for(const row of doc?.querySelectorAll('#ul .urow')||[]){
      const index=Number(row.dataset.i);
      if(!Number.isInteger(index)||index<0)continue;
      const item=row.dataset.t==='m'?frame.seats?.[index]:
        row.dataset.t==='a'?frame.U?.[index]:null;
      if(item)paintVerifiedAvatar(row.querySelector('.ua'),item.pic,doc);
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
      const item=frameArt(seat.frame_style);
      const medal=medalArt(seat.medal_style);
      avatar.classList.toggle('sh-has-sovera-frame',!!item);
      if(!item&&!medal)continue;
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
  function styleSelectionSheet(kind){
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
      '<p style="font-size:12px;color:#c9bbed">Free decorative styles; no coins charged and no staff/VIP rank awarded. Your choice is saved on the verified server.</p>');
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
    const choices=[{id:'',name:'None',art:''},...catalog];
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
        button.disabled=true;
        try{
          const saved=await api('PATCH','/me',{[kind]:item.id});
          if(!Object.prototype.hasOwnProperty.call(saved,kind)||
             saved[kind]!==item.id)throw new Error('Profile effects server update is pending');
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
            ' saved to your verified profile ✓');
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
      if(!seller)return;
      const button=document.createElement('button');
      button.id='sharika-seller-wallet-entry';
      button.type='button';
      button.textContent='🪙 Seller Wallet · '+Number(seller.available_coins||0).toLocaleString('en-US')+' coins';
      button.style.cssText='display:block;margin:8px auto;padding:8px 14px;border:1px solid #f0be55;'+
        'border-radius:15px;background:#3b225b;color:#fff;font-weight:700;font-size:12px';
      button.onclick=()=>showVerifiedCoinSellers({walletOnly:true});
      (document.getElementById('sh-sovera-own-identity')||anchor).insertAdjacentElement('afterend',button);
    }catch(error){console.warn('Seller wallet profile unavailable:',errText(error));}
  }
  let avatarUploadBusy=false;
  async function pickProfilePhoto(){
    if(!session||!profile){toast('Sign in to change your profile photo');return;}
    if(avatarUploadBusy){toast('Profile photo upload is already running');return;}
    avatarUploadBusy=true;
    const accountId=session.user.id;
    const publicId=profile.public_id;
    try{
      toast('Opening your Android photo gallery…');
      // Use a native, single-image Android picker. It decodes HEIC/JPEG and
      // produces a bounded JPEG; no broad storage permission is needed.
      const picked=await native('pickProfilePhoto');
      if(session?.user?.id!==accountId)throw new Error('Account changed; please select the photo again');
      const image_data=picked?.image_data;
      if(typeof image_data!=='string'||!image_data.startsWith('data:image/jpeg;base64,'))
        throw new Error('Gallery did not return a usable photo');
      toast('Uploading your profile photo…');
      const saved=await api('PUT','/me/avatar',{image_data});
      if(session?.user?.id!==accountId || saved?.public_id!==publicId)
        throw new Error('Profile changed before photo confirmation');
      if(!/^https:\/\/sharika-api-staging\.soverixnet\.workers\.dev\/api\/v1\/users\/[0-9]{8}\/avatar\?v=[0-9]+$/.test(saved.pic||''))
        throw new Error('Profile photo confirmation unavailable');
      profile=saved;
      window.A.pic=saved.pic;
      window.saveA();window.renderMe();
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
      toast('Profile photo saved · visible on your ID and room ✓');
    }catch(error){
      if(errText(error)!=='profile_photo_cancelled')
        toast('Profile photo not saved: '+errText(error));
    }finally{avatarUploadBusy=false;}
  }
  // The original HTML photo picker writes only to localStorage. In staging
  // route every profile photo selection through the verified server wallet ID.
  document.addEventListener('click',event=>{
    if(event.target.closest?.('#v-me #pavb, #v-me .mav, #sh #ep')){
      event.preventDefault();event.stopImmediatePropagation();
      pickProfilePhoto();
    }
  },true);
  // The original edit form writes only to localStorage. Save verified
  // profile name/bio through the same Firebase-authenticated D1 profile.
  document.addEventListener('click',event=>{
    const save=event.target.closest?.('#sh #es');
    if(!save)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!session||!profile){toast('Sign in to edit your profile');return;}
    const name=document.getElementById('en')?.value?.trim()||'';
    const bio=document.getElementById('eb')?.value?.trim()||'';
    if(!name||name.length>80||bio.length>500){toast('Check name and bio length');return;}
    if(save.disabled)return;
    save.disabled=true;
    api('PATCH','/me',{name,bio}).then(saved=>{
      if(saved.public_id!==profile.public_id)throw new Error('Profile identity mismatch');
      profile=saved;
      window.A.name=saved.name;window.A.bio=saved.bio||'';
      window.saveA();window.closeSheet();window.renderMe();
      toast('Profile saved to your verified ID ✓');
    }).catch(error=>toast('Profile not saved: '+errText(error)))
      .finally(()=>{if(save.isConnected)save.disabled=false;});
  },true);
  const priorRenderMe=window.renderMe;
  if(typeof priorRenderMe==='function')window.renderMe=function(){
    priorRenderMe.apply(this,arguments);
    renderVerifiedIdentity();
    renderSellerWalletProfileButton().catch(()=>{});
  };
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
    audio.play().catch(()=>{ /* Android may require a user tap for playback */ });
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
  async function jpegRoomPreview(file){
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
      for(const side of [900,720,600,480,360,280]){
        const scale=Math.min(1,side/Math.max(sourceWidth,sourceHeight));
        canvas.width=Math.max(1,Math.round(sourceWidth*scale));
        canvas.height=Math.max(1,Math.round(sourceHeight*scale));
        ctx.fillStyle='#161029';ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(photo,0,0,canvas.width,canvas.height);
        for(const quality of [.76,.60,.45]){
          const preview=canvas.toDataURL('image/jpeg',quality);
          if(preview.startsWith('data:image/jpeg;base64,')&&preview.length<=120023)
            return preview;
        }
      }
      throw new Error('Photo too large after resizing');
    }finally{URL.revokeObjectURL(blobUrl);}
  }
  let coverUploadBusy=false;
  function pickRoomCover(room,frame=null){
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
        await reloadRooms();
        toast('Room photo saved · visible on room cards ✓');
      }catch(error){toast('Room photo not saved: '+errText(error));}
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
    if(frame.S.frame!==chosenSeatFrame){
      frame.S.frame=chosenSeatFrame;
      if(typeof frame.applyTheme==='function')frame.applyTheme();
    }
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
    const present=new Set((data.members||[]).map(m=>m.user_id));
    if(!frame.__soveraSeenMembers){
      frame.__soveraSeenMembers=present;
      // Local user sees the selected entry on initial room visit.
      const first=(data.members||[]).find(m=>m.user_id===session?.user?.id);
      if(first?.sharika_users?.entry_style){
        playSoveraEntry(frame.document,first.sharika_users.entry_style);
      }
    }else{
      for(const item of data.members||[]){
        if(!frame.__soveraSeenMembers.has(item.user_id)&&
           item.user_id!==session?.user?.id&&
           item.sharika_users?.entry_style){
          playSoveraEntry(frame.document,item.sharika_users.entry_style);
          break;
        }
      }
      frame.__soveraSeenMembers=present;
    }
  }
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
    let lastChatId=0,chatPollInFlight=null,chatSendBusy=false;
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
    const giftButton=frame.$ && frame.$('bGift');
    const originalGiftOpen=giftButton && giftButton.onclick;
    let directGiftTarget=null;
    async function openVerifiedGiftBox(recipientOverride=null){
      directGiftTarget=recipientOverride;
      try{
        const data=await api('GET','/gifts');
        const gifts=(data.gifts||[]).filter(g=>g.tab===0||g.tab===1||
          (g.tab===2 && data.lucky_enabled===true && profile?.minor===false));
        if(!gifts.length){frame.toast('No active gifts in the catalog yet');return;}
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
        frame.toast('Gift sent · '+result.spent_coins+' coins charged · Room +'+
        Number(result.room_reward_coins||0).toLocaleString('en-US')+' coins ✓');
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
        const feed=await api('GET','/rooms/'+room.id+'/gifts').catch(()=>null);
        if(feed?.events?.length)lastGiftEventId=Math.max(...feed.events.map(e=>e.id));
      }catch(error){
        frame.toast(giftCommitted
          ?'Gift sent, but screen update delayed: '+errText(error)
          :'Gift not confirmed; check wallet before retrying: '+errText(error));
      }
      finally{giftBusy=false;button.disabled=false;}
    },true);
    async function pollGiftEvents(){
      const data=await api('GET','/rooms/'+room.id+'/gifts');
      const events=data.events||[];
      const latest=Math.max(0,...events.map(e=>Number(e.id)||0));
      if(lastGiftEventId===null){lastGiftEventId=latest;return;}
      let receivedGift=false;
      for(const event of events){
        if(event.id<=lastGiftEventId||event.sender_id===profile?.public_id)continue;
        if(event.recipient_id===profile?.public_id)receivedGift=true;
        const seat=(frame.seats||[]).find(s=>s?.public_id===event.recipient_id);
        if(seat && typeof frame.fly==='function')
          frame.fly(event.emoji,seat.i,0,event.price_coins);
      }
      lastGiftEventId=Math.max(lastGiftEventId,latest);
      // Recipients see their verified diamond/coin balance after incoming gifts.
      if(receivedGift)await reloadWallet();
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
        } else if(action==='mute' && seat>0) {
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
          const member=await api('GET','/users/'+target.public_id);
          frame.open('<h3>👤 Verified profile</h3><div id="sh-room-profile"></div>');
          const node=frame.$('sh-room-profile');
          if(node) {
            const avatar=frame.document.createElement('div');
            avatar.className='sh-sovera-preview';
            avatar.textContent='👤';
            paintVerifiedAvatar(avatar,member.pic,frame.document);
            node.appendChild(avatar);
            const name=frame.document.createElement('div');
            name.className='row';
            name.textContent=(member.name||'Member')+' · ID '+member.id;
            const detail=frame.document.createElement('div');
            detail.className='lbl';
            detail.textContent='Country: '+(member.country||'Not set')+
              ' · Wealth Lv '+Number(member.wealth_level||0)+
              ' · Charm Lv '+Number(member.charm_level||0);
            node.append(name,detail);
          }
        } else if(action==='gift' && seat>0 && target?.public_id) {
          frame.rec=[seat];
          frame.$('bGift')?.click();
        } else frame.toast('This action is not connected to the verified server yet');
      } catch (error) { frame.toast(errText(error)); }
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
        if(target.isConnected)target.textContent='Ordinary gifts 10%: '+
          normal.toLocaleString('en-US')+' coins · Lucky Gift 1% (if enabled): '+
          lucky.toLocaleString('en-US')+' coins. Total: '+
          (normal+lucky).toLocaleString('en-US')+
          ' coins. Verified room ledger only; no personal-wallet transfer or withdrawal.';
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
          name,seat_count:newSeatCount,theme:frame.S.theme||room.th||'mid',
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
        const requestId='chat:'+Date.now().toString(36)+':'+
          Math.random().toString(36).slice(2);
        await api('POST','/rooms/'+room.id+'/chat',{body,request_id:requestId});
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
    await syncFrame(room,frame);
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
    },15000);
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
  async function showVerifiedCoinSellers({walletOnly=false,targetId=''}={}){
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
      // Private wallet: server independently verifies the seller permission.
      const [mine,transfers,allocations]=await Promise.all([
        api('GET','/sellers/me'),api('GET','/sellers/transfers'),
        api('GET','/sellers/allocations')
      ]);
      if(!root.isConnected)return;
      const self=mine.seller;
      if(!self?.active){
        root.textContent='Seller Wallet is available only to approved coin sellers.';
        return;
      }
      const me=self&&self.active?
        '<div class="card" style="margin-top:12px;padding:12px">'+
        '<b>Seller ID '+sellerEscape(self.public_id)+'</b><div style="height:6px"></div>'+
        '<b id="sharika-seller-stock">Your seller stock: '+Number(self.available_coins||0).toLocaleString('en-US')+' coins</b>'+
        '<p class="n">Recharge an existing Sharika user with your assigned seller stock.</p>'+
        '<input id="sharika-seller-target" inputmode="numeric" maxlength="8" placeholder="Recipient 8-digit user ID" aria-label="Recipient user ID">'+
        '<input id="sharika-seller-amount" inputmode="numeric" placeholder="Coins to send (1–1,000,000)" aria-label="Coins to send">'+
        '<button class="btn" type="button" id="sharika-seller-send">Transfer coins</button>'+
        '<div id="sharika-seller-note" aria-live="polite"></div></div>':
        self?'<p class="n">Your seller permission is currently suspended.</p>':'';
      const historyRows=(transfers.transfers||[]).slice(0,30).map(t=>
        '<div class="opt" style="padding:8px 10px;border-radius:10px">'+
        'Transfer #'+sellerEscape(t.id)+' · Sender ID '+sellerEscape(t.sender_public_id)+
        ' → Recipient ID '+sellerEscape(t.recipient_public_id)+
        ' · '+Number(t.coins||0).toLocaleString('en-US')+' coins</div>').join('');
      const stockRows=(allocations.allocations||[]).slice(0,30).map(a=>
        '<div class="opt" style="padding:8px 10px;border-radius:10px">'+
        'Allocation #'+sellerEscape(a.id)+' · Admin ID '+sellerEscape(a.sender_public_id)+
        ' → Seller ID '+sellerEscape(a.seller_public_id)+
        ' · +'+Number(a.coins||0).toLocaleString('en-US')+' stock coins</div>').join('');
      root.innerHTML=me+
        (self?'<div class="card" style="margin-top:12px;padding:12px"><h4>Coin transfer list</h4>'+
          '<div id="sharika-seller-history">'+(historyRows||'No transfers yet.')+'</div>'+
          '<h4>Seller wallet stock allocations</h4>'+(stockRows||'No allocations yet.')+'</div>':'');
      const targetField=document.getElementById('sharika-seller-target');
      if(targetField&&/^[0-9]{8}$/.test(targetId))targetField.value=targetId;
      const send=document.getElementById('sharika-seller-send');
      if(send)send.addEventListener('click',async()=>{
        const recipient=document.getElementById('sharika-seller-target')?.value.trim()||'';
        const raw=document.getElementById('sharika-seller-amount')?.value.trim()||'';
        const amount=Number(raw);
        const note=document.getElementById('sharika-seller-note');
        if(!/^[0-9]{8}$/.test(recipient)||!/^\d+$/.test(raw)||
          !Number.isSafeInteger(amount)||amount<1||amount>1000000){
          if(note)note.textContent='Enter a valid eight-digit user ID and 1–1,000,000 coins.';
          return;
        }
        send.disabled=true;
        let transferCommitted=false;
        try{
          const verified=await api('GET','/users/'+recipient);
          if(String(verified.id)!==recipient)throw new Error('Recipient verification failed');
          if(!window.confirm('Send '+amount.toLocaleString('en-US')+' coins to '+
            String(verified.name||'User')+' (ID '+recipient+')?')){send.disabled=false;return;}
          const fingerprint=session.user.id+':'+recipient+':'+amount;
          const requestId=pendingSellerTransfer?.fingerprint===fingerprint
            ?pendingSellerTransfer.requestId:nextWalletRequestId('seller');
          pendingSellerTransfer={fingerprint,requestId};
          const result=await api('POST','/sellers/transfer',{
            target_public_id:recipient,coins:amount,request_id:requestId
          });
          transferCommitted=true;pendingSellerTransfer=null;
          if(note)note.textContent='Transfer #'+result.transfer_id+' from ID '+
            sellerEscape(result.sender_public_id)+' to ID '+sellerEscape(recipient)+
            ' complete. Remaining seller stock: '+
            Number(result.available_coins).toLocaleString('en-US')+' coins.';
          const stockLabel=document.getElementById('sharika-seller-stock');
          if(stockLabel)stockLabel.textContent='Your seller stock: '+
            Number(result.available_coins).toLocaleString('en-US')+' coins';
          const amountField=document.getElementById('sharika-seller-amount');
          if(amountField)amountField.value='';
          const latest=await api('GET','/sellers/transfers').catch(()=>null);
          const history=document.getElementById('sharika-seller-history');
          if(history&&latest)history.innerHTML=(latest.transfers||[]).slice(0,30).map(t=>
            '<div class="opt" style="padding:8px 10px;border-radius:10px">'+
            'Transfer #'+sellerEscape(t.id)+' · Sender ID '+sellerEscape(t.sender_public_id)+
            ' → Recipient ID '+sellerEscape(t.recipient_public_id)+
            ' · '+Number(t.coins||0).toLocaleString('en-US')+' coins</div>').join('')||'No transfers yet.';
          toast('Coin transfer recorded');
          await refreshWalletAfterConfirmedTransaction();
        }catch(error){
          if(note)note.textContent=(transferCommitted
            ?'Transfer recorded; display update delayed: '
            :'Transfer not confirmed; check history before retrying: ')+errText(error);
        }finally{if(send.isConnected)send.disabled=false;}
      });
    }catch(error){if(root.isConnected)root.textContent='Unable to load sellers: '+errText(error);}
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

  // A verified seller may recharge directly from another real user's ID card.
  const originalOpenProfile=window.openProfile;
  if(typeof originalOpenProfile==='function')window.openProfile=function(user){
    originalOpenProfile.apply(this,arguments);
    const targetId=String(user?.id||'');
    const root=document.querySelector('#pfc .pfh .meta');
    if(!/^[0-9]{8}$/.test(targetId)||!root||!session)return;
    Promise.all([api('GET','/sellers/me'),api('GET','/users/'+targetId)])
      .then(([mine,verified])=>{
        if(!root.isConnected||!mine.seller?.active||String(verified.id)!==targetId)return;
        const button=document.createElement('button');
        button.type='button';button.className='act';
        button.textContent='🪙 Send seller coins to ID '+targetId;
        button.style.cssText='display:block;margin:8px auto;padding:9px 13px;border-radius:12px';
        button.onclick=()=>{
          document.getElementById('pfo')?.classList.remove('on');
          showVerifiedCoinSellers({walletOnly:true,targetId});
        };
        root.insertAdjacentElement('afterend',button);
      }).catch(()=>{});
  };

  // Original daily reward card retained; values and claim status come from D1.
  let dailyClaimBusy=false;
  async function showVerifiedDailySheet(){
    if(!session){window.showAuth('welcome');return;}
    window.openSheet('<h3>🎁 Daily check-in</h3>'+
      '<div id="sharika-daily-content" aria-live="polite">Loading verified daily rewards…</div>');
    const root=document.getElementById('sharika-daily-content');
    if(!root)return;
    try{
      const data=await api('GET','/daily');
      if(!root.isConnected)return;
      const steps=(data.rewards||[]).map((coins,i)=>
        '<button type="button" class="'+(data.next_day===i+1&&!data.claimed_today?'sel':'')+
        '" disabled style="'+(data.claimed_today&&data.claimed?.streak===i+1?'opacity:.6;':'')+'">'+
        '<span>'+(i===6?'🎁':'🪙')+'</span>Day '+(i+1)+'<br>'+
        Number(coins).toLocaleString('en-US')+'</button>').join('');
      const claim=data.claimed_today?
        '<button class="big" id="cl" disabled style="opacity:.5">Today reward already claimed ✓</button>':
        '<button class="big" id="cl">🪙 '+Number(data.rewards?.[data.next_day-1]||0).toLocaleString('en-US')+
        ' Get coins</button>';
      const tasks=(data.tasks||[]).map(t=>
        '<div class="row"><span>'+(t.completed?'✅ ':'☑️ ')+sellerEscape(t.title)+
        '</span><b>'+(t.completed?'Done':'Pending')+'</b></div>').join('');
      root.innerHTML='<div class="g4">'+steps+'</div>'+claim+
        '<p class="n">Your streak: '+Number(data.streak||0)+' days · Resets after a missed UTC day.</p>'+
        '<div class="card" style="margin-top:12px;padding:12px"><b>Today’s activity</b>'+
        (tasks||'<p class="n">No task activity available.</p>')+
        '<p class="n">Task progress is verified; separate task coin rewards are not enabled.</p></div>';
    }catch(error){if(root.isConnected)root.textContent='Daily rewards unavailable: '+errText(error);}
  }
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
  async function showVerifiedInviteSheet(){
    if(!session){window.showAuth('welcome');return;}
    window.openSheet('<h3>🤝 Invite a friend</h3>'+
      '<div id="sharika-invite-data" aria-live="polite">Loading verified invites…</div>');
    const root=document.getElementById('sharika-invite-data');
    if(!root)return;
    try{
      const result=await api('GET','/invites');
      if(!root.isConnected)return;
      const invite=String(result.invite_code||'');
      if(!/^[0-9]{8}$/.test(invite))throw new Error('Verified ID unavailable');
      const referrals=(result.referrals||[]).map(r=>
        '<div class="row"><span>ID '+sellerEscape(r.public_id)+'</span>'+
        '<b>'+sellerEscape(r.name)+'</b></div>').join('');
      root.innerHTML='<p class="n">New invite signup: you earn 5,000 coins; your friend starts with 10,000 coins. You also earn 5% of their verified coin-seller recharges.</p>'+
        '<div class="idp" style="margin-top:12px">Your invite code: <b>'+
        sellerEscape(invite)+'</b></div>'+
        '<div class="row"><span>Friends who joined</span><b>'+
        Number(result.total_invites||0).toLocaleString('en-US')+'</b></div>'+
        '<div class="row"><span>Signup invite rewards earned</span><b>'+
        Number(result.signup_bonus_coins||0).toLocaleString('en-US')+' coins</b></div>'+
        '<div class="row"><span>5% recharge rewards earned</span><b>'+
        Number(result.recharge_bonus_coins||0).toLocaleString('en-US')+' coins</b></div>'+
        (result.invited_by?'<p class="n">You joined with code '+sellerEscape(result.invited_by)+'</p>':'')+
        (referrals?'<div class="card" style="padding:12px;margin-top:12px">'+
        '<b>Verified referrals</b>'+referrals+'</div>':'')+
        '<button class="big" id="sharika-share-invite">📤 Share code</button>';
      document.getElementById('sharika-share-invite')?.addEventListener('click',async()=>{
        const message='Join me on Sharika Voice Chat! Enter my invite code '+invite+
          ' when creating your account.';
        try{
          if(navigator.share)await navigator.share({text:message});
          else if(navigator.clipboard)await navigator.clipboard.writeText(message);
          else{toast('Invite code: '+invite);return;}
          toast('Invite code shared');
        }catch(_){toast('Invite code: '+invite);}
      });
    }catch(error){if(root.isConnected)root.textContent='Invite tracking unavailable: '+errText(error);}
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
  const safeMessageHTML=value=>String(value??'').replace(/[&<>"']/g,
    c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function loadSupportMessages(){
    const container=document.getElementById('tb');
    if(!container||!session)return;
    const data=await api('GET','/support/messages');
    container.textContent='';
    for(const message of data.messages||[]){
      const bubble=document.createElement('div');
      bubble.className='bub '+(message.sender_role==='user'?'me':'th');
      bubble.textContent=message.body;
      container.appendChild(bubble);
    }
    container.scrollTop=container.scrollHeight;
  }
  async function openSupportThread(){
    activePrivateId=null;canSendPrivate=false;
    const restoredSend=document.getElementById('ts');if(restoredSend)restoredSend.disabled=false;
    if(!session){window.showAuth('welcome');return;}
    document.getElementById('th')?.classList.add('on');
    document.getElementById('thn').textContent='🎧 Customer service';
    const container=document.getElementById('tb');
    container.textContent='Loading support messages…';
    try{await loadSupportMessages();}
    catch(error){container.textContent='Messages unavailable: '+errText(error);}
    if(supportPoll)clearInterval(supportPoll);
    supportPoll=setInterval(()=>{
      if(!session||!document.getElementById('th')?.classList.contains('on'))return;
      loadSupportMessages().catch(()=>{});
    },15000);
  }
  async function loadPrivateMessages(publicId){
    const data=await api('GET','/messages/'+encodeURIComponent(publicId));
    const container=document.getElementById('tb');
    if(!container)return;
    container.textContent='';
    for(const m of data.messages||[]){
      const bubble=document.createElement('div');
      bubble.className='bub '+(m.from_me?'me':'th');
      bubble.textContent=m.body;
      container.appendChild(bubble);
    }
    const status=await api('GET','/users/'+encodeURIComponent(publicId)+'/follow');
    canSendPrivate=!!status.mutual;
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
        await api(status.following?'DELETE':'PUT','/users/'+encodeURIComponent(publicId)+'/follow');
        await loadPrivateMessages(publicId);
        window.renderMsg();
      }catch(error){toast('Follow failed: '+errText(error));followButton.disabled=false;}
    };
    container.appendChild(followButton);
    const sendButton=document.getElementById('ts');
    if(sendButton)sendButton.disabled=!canSendPrivate;
    container.scrollTop=container.scrollHeight;
  }
  async function openPrivateThread(publicId,name){
    if(!session){window.showAuth('welcome');return;}
    if(!/^[0-9]{8}$/.test(String(publicId))){toast('Invalid 8-digit user ID');return;}
    activePrivateId=String(publicId);canSendPrivate=false;
    const guardedSend=document.getElementById('ts');if(guardedSend)guardedSend.disabled=true;
    document.getElementById('th')?.classList.add('on');
    document.getElementById('thn').textContent='💬 '+name+' · '+publicId;
    document.getElementById('tb').textContent='Loading conversation…';
    try{await loadPrivateMessages(activePrivateId);}
    catch(error){document.getElementById('tb').textContent=errText(error);}
    if(supportPoll)clearInterval(supportPoll);
    supportPoll=setInterval(()=>{
      if(!session||!document.getElementById('th')?.classList.contains('on'))return;
      loadPrivateMessages(activePrivateId).catch(()=>{});
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
      // The existing follow APIs return verified profile pictures.
      // Match by public ID, never by display name or demo avatar.
      const inboxPhotos=new Map([...following,...followers,...conv]
        .filter(u=>verifiedAvatarUrl(u.pic))
        .map(u=>[String(u.public_id),u.pic]));
      for(const row of list.querySelectorAll('.chatrow[data-private-id]'))
        paintVerifiedAvatar(row.querySelector('.av'),inboxPhotos.get(row.dataset.privateId),document);
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
    supportBusy=true;
    if(supportSendButton)supportSendButton.disabled=true;
    try{
      const request_id='usr:'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2);
      if(activePrivateId){
        if(!canSendPrivate)throw new Error('mutual_follow_required');
        await api('POST','/messages/'+encodeURIComponent(activePrivateId),{body,request_id});
        supportInput.value='';
        await loadPrivateMessages(activePrivateId);
      }else{
        await api('POST','/support/messages',{body,request_id});
        supportInput.value='';
        await loadSupportMessages();
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
    document.getElementById('th')?.classList.remove('on');
    if(supportPoll){clearInterval(supportPoll);supportPoll=null;}
    activePrivateId=null;canSendPrivate=false;
    if(supportSendButton)supportSendButton.disabled=false;
    window.renderMsg();
  };
  // The supplied HTML contains a simulated weekly podium. Never display it
  // as real winners while this staging app uses verified server data.
  window.showWeekly=function(done){if(typeof done==='function')done();};
  let rankingRequest=0;
  window.renderRank=async function(){
    const view=document.getElementById('rb');
    if(!view)return;
    const rankView=document.getElementById('v-rank');
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
    const kinds={0:'recharge',1:'rich',2:'charm',3:'room'};
    const period=periods[window.rper]||'weekly';
    const kind=kinds[window.rtab];
    view.innerHTML='<div class="empty">Loading verified rankings…</div>';
    if(!kind){
      view.innerHTML='<div class="empty">This ranking has no verified server results yet.</div>';
      return;
    }
    if(!session){
      view.innerHTML='<div class="empty">Sign in to see verified rankings.</div>';
      return;
    }
    try{
      const data=await api('GET','/rankings?period='+period+'&kind='+kind);
      if(requestNo!==rankingRequest)return;
      const leaders=Array.isArray(data.leaders)?data.leaders:[];
      view.textContent='';
      if(!leaders.length){
        view.innerHTML='<div class="empty">No settled gifts recorded in this period yet.</div>';
        return;
      }
      const info=document.createElement('div');
      info.className='empty';
      info.textContent=kind==='recharge'?'Approved recharge coins · verified server ranking':
        kind==='rich'?'Gift coins sent · verified server ranking':
        kind==='charm'?'Gift coins received · verified server ranking':
        'Gift coins sent in each room · verified server ranking';
      view.appendChild(info);
      for(const leader of leaders){
        const row=document.createElement('div');
        row.className='rr'+(leader.public_id&&leader.public_id===profile?.public_id?' me':'');
        row.innerHTML='<b class="n"></b><div class="ra"></div>'+
          '<div class="rn"><b></b><span class="idl"><i class="idb">ID</i>'+
          '<span class="sid"></span></span></div>'+
          '<div class="rv"><i class="cn"></i><span class="amt"></span></div>';
        row.querySelector('.n').textContent=String(leader.rank);
        const avatar=row.querySelector('.ra');
        if(kind==='room')avatar.textContent=leader.emoji||'🎙️';
        else if(leader.pic){
          const img=document.createElement('img');
          img.src=leader.pic;img.alt='';
          img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:50%';
          avatar.appendChild(img);
        }else avatar.textContent='👤';
        row.querySelector('.rn b').textContent=leader.name||'User';
        row.querySelector('.sid').textContent=kind==='room'?leader.room_id:leader.public_id;
        row.querySelector('.amt').textContent=Number(leader.total||0).toLocaleString('en-US');
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
      page:'file:///android_asset/original-games/jackpot-fruit.html'}
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
    let winnerBannerTimer=null;
    function clearWinnerBanner(){
      if(winnerBannerTimer!==null){view.clearTimeout(winnerBannerTimer);winnerBannerTimer=null;}
      doc.getElementById('sh-verified-original-winners')?.remove();
    }
    function announceRoundWinners(game,result){
      const confirmed=verifiedOriginalGameTopThree(game,result);
      if(!confirmed)return;
      clearWinnerBanner();
      const banner=doc.createElement('div');
      banner.id='sh-verified-original-winners';
      banner.setAttribute('role','status');
      banner.setAttribute('aria-live','polite');
      banner.style.cssText='position:fixed;top:max(12px,env(safe-area-inset-top));'+
        'left:5%;width:90%;box-sizing:border-box;z-index:2147483000;'+
        'padding:11px 13px;border:2px solid #f9d76f;border-radius:18px;'+
        'background:linear-gradient(130deg,#3a1269,#10082e);'+
        'box-shadow:0 8px 32px #000b,0 0 20px #f59e0b66;'+
        'color:#fff;text-align:center;font-weight:700;pointer-events:none';
      const title=doc.createElement('div');
      title.textContent='🏆 Round '+confirmed.round_no+' · Top 3 winners';
      title.style.cssText='font-size:14px;color:#ffe49b;margin-bottom:5px';
      banner.appendChild(title);
      for(const [index,winner] of confirmed.winners.entries()){
        const line=doc.createElement('div');
        line.style.cssText='font-size:12px;line-height:1.45;overflow-wrap:anywhere';
        line.textContent=['🥇','🥈','🥉'][index]+' '+
          winner.name+' · ID '+winner.public_id+' · '+
          Number(winner.total_win).toLocaleString('en-US')+' coins';
        banner.appendChild(line);
      }
      doc.body.appendChild(banner);
      winnerBannerTimer=view.setTimeout(()=>{banner.remove();winnerBannerTimer=null;},10000);
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
