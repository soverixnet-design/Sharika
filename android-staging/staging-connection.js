/* Sharika Android-only staging adapter.
 * Preserves the original supplied HTML/CSS/room art. No Supabase endpoint,
 * service-role key, demo identity, fake payouts, or plaintext token in JS.
 * Requires native SharikaActivity, which verifies Firebase authentication
 * and sends allowlisted requests exclusively to the new Cloudflare Worker.
 */
(function () {
  'use strict';
  // BEGIN VERIFIED COMPACT COIN DISPLAY
  // Presentation only: APIs, transfers, wallet balances and receipts retain full integers.
  function formatCompactCoins(value) {
    const n=Number(value);
    if(!Number.isFinite(n))return '0';
    const magnitude=Math.abs(n);
    for(const [size,suffix] of [[1e12,'t'],[1e9,'b'],[1e6,'m'],[1e3,'k']]){
      if(magnitude>=size){
        const scaled=Math.floor(magnitude/size*100+1e-8)/100;
        return (n<0?'-':'')+String(scaled)+suffix;
      }
    }
    return String(Math.trunc(n));
  }
  // END VERIFIED COMPACT COIN DISPLAY
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
      '#sp.sharika-opening-pending{opacity:1!important;pointer-events:auto!important;transition:none!important}',
      '#app.sharika-startup-verifying::after{',
      'content:"Opening Sharika…";position:absolute;inset:0;z-index:94;',
      'display:grid;place-items:center;background:linear-gradient(180deg,#1a0b45,#05030f);',
      'color:#e9dbff;font-size:16px;font-weight:700;pointer-events:none}'
    ].join('');
    document.head.appendChild(style);
    document.getElementById('app')?.classList.add('sharika-startup-verifying');
    // Hold the original branded layer for the one verified weekly opening.
    // Otherwise its 1.3s demo timer hides it and a second fullscreen card
    // appears later, looking like two different opening screens.
    document.getElementById('sp')?.classList.add('sharika-opening-pending');
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
  // Ignore an older restore/login response after a newer sign-in or logout.
  let authAttemptId = 0;
  let balance = { coins: 0, dia: 0, xp: 0 };
  let framePoll = null, giftPoll = null, chatPoll = null, invitePoll = null, entryPoll = null,
    reactionPoll = null, musicPoll = null;
  let voiceRoom = null, voiceRoomId = null;
  let voiceBackend = null;

  function errText(error) { return String(error && error.message || error || 'Connection unavailable'); }
  function toast(message) { if (window.toast) window.toast(message); }
  function native(action, payload) {
    if (!window.SharikaNative || typeof window.SharikaNative.call !== 'function')
      return Promise.reject(new Error('Android native bridge unavailable'));
    return new Promise((resolve, reject) => {
      const id = String(++seq);
      const timeoutMs = action === 'pickProfilePhoto' ? 180000 :
        action === 'playBillingPurchase' ? 180000 :
        action === 'googleSignIn' ? 70000 :
        action === 'emailSignIn' ? 45000 :
        action === 'session' ? 12000 :
        action === 'pushToken' && payload?.promptPermission ? 60000 :
        action === 'api' && payload?.method === 'PUT' &&
          (payload?.path === '/api/v1/me/avatar' ||
           payload?.path === '/api/v1/me/cover-image' ||
           /^\/api\/v1\/rooms\/[0-9]{8}\/cover$/.test(payload?.path || ''))
          ? 90000 : 25000;
      // A generic "Request timed out" left testers unable to distinguish
      // Firebase sign-in from a slow Cloudflare /me or room-members call.
      // Keep this as a client-side diagnostic only: never log credentials,
      // tokens, request bodies, or internal account identifiers.
      const timeoutArea=action==='emailSignIn'?'Firebase email sign-in':
        action==='googleSignIn'?'Google account selection':
        action==='session'?'Firebase session restore':
        action==='api'&&payload?.path==='/api/v1/me'?'Cloudflare profile':
        action==='api'&&/\/rooms\/[0-9]{8}\/members$/.test(payload?.path||'')
          ?'Cloudflare verified seats':
        action==='api'?'Cloudflare request':'Android connection';
      const timer=setTimeout(()=>{
        calls.delete(id);
        reject(new Error('Request timed out ('+timeoutArea+')'));
      },timeoutMs);
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
  // The same verified rich-gift/jackpot feed plays above every app view,
  // including voice rooms and embedded games. No iframe or client can claim
  // a win: only an authenticated Worker response supplies these events.
  const celebrationQueues={ticker:[],winner:[]};
  const celebrationBusy={ticker:false,winner:false};
  let lastCelebrationId=0,celebrationFirstPoll=true,celebrationFetching=false;
  function ensureCelebrationStyle(){
    if(document.getElementById('sh-global-celebration-style'))return;
    const style=document.createElement('style');
    style.id='sh-global-celebration-style';
    style.textContent=[
      '#sh-global-marquee{position:fixed;z-index:2147483300;pointer-events:none;',
      'top:calc(4px + env(safe-area-inset-top,0px));left:8px;right:8px;',
      'max-width:580px;margin:auto;min-height:58px;box-sizing:border-box;',
      'display:flex;align-items:center;gap:8px;padding:6px 10px;overflow:hidden;',
      'border-radius:23px;border:1.5px solid #ffe39b;color:#fff4dc;',
      'background:linear-gradient(110deg,#32134bea,#75315fed,#24124af2);',
      'box-shadow:0 6px 18px #03000bbb,inset 0 1px 2px #fffa;',
      'animation:shGlobalMarquee 6s linear both}',
      '#sh-global-marquee .sh-gc-portrait{flex:none;width:41px;height:41px;',
      'overflow:hidden;display:grid;place-items:center;border-radius:50%;',
      'border:2px solid #f8d57a;background:#411b64;font-size:24px}',
      '#sh-global-marquee .sh-gc-portrait img,#sh-global-winner .sh-gc-portrait img{',
      'display:block;width:100%;height:100%;object-fit:cover}',
      '#sh-global-marquee .sh-gc-copy{min-width:0;flex:1;font-size:12px;line-height:1.35}',
      '#sh-global-marquee .sh-gc-copy strong{display:block;color:#ffe28b;',
      'font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#sh-global-marquee .sh-gc-copy span{display:block;max-height:38px;overflow:hidden}',
      '#sh-global-marquee .sh-gc-icon{flex:none;font-size:28px}',
      '@keyframes shGlobalMarquee{0%{transform:translateX(112vw);opacity:0}',
      '13%{opacity:1}80%{opacity:1}100%{transform:translateX(-112vw);opacity:0}}',
      '#sh-global-winner{position:fixed;z-index:2147483350;pointer-events:none;',
      'top:42%;left:50%;width:min(90vw,430px);box-sizing:border-box;',
      'display:flex;align-items:center;gap:12px;padding:14px 16px;',
      'border-radius:25px;border:2px solid #ffe49b;',
      'background:linear-gradient(140deg,#7c3e0c,#db9d38 46%,#442151);',
      'color:#fff9de;box-shadow:0 0 35px #ffce6699,0 14px 35px #000b,',
      'inset 0 2px 3px #fff8;animation:shGlobalWinner .32s ease-out both}',
      '#sh-global-winner .sh-gc-portrait{flex:none;width:56px;height:56px;',
      'display:grid;place-items:center;overflow:hidden;border-radius:50%;',
      'border:2px solid #fff2be;background:#521f64;font-size:27px}',
      '#sh-global-winner .sh-gc-copy{flex:1;min-width:0;text-shadow:0 2px 5px #371b25}',
      '#sh-global-winner .sh-gc-copy b{display:block;font-size:18px;color:#fff2b5}',
      '#sh-global-winner .sh-gc-copy strong{display:block;font-size:13px;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#sh-global-winner .sh-gc-copy em{font-style:normal;font-size:20px;',
      'font-weight:900;color:#fff}',
      '@keyframes shGlobalWinner{from{transform:translate(-50%,-30%) scale(.74);opacity:0}',
      'to{transform:translate(-50%,-50%) scale(1);opacity:1}}',
      '@media(prefers-reduced-motion:reduce){#sh-global-marquee{animation:none}',
      '#sh-global-winner{animation:none;transform:translate(-50%,-50%)}}'
    ].join('');
    document.head.appendChild(style);
  }
  function celebrationAvatar(pic,sizeClass){
    const box=document.createElement('span');box.className=sizeClass||'sh-gc-portrait';
    const src=verifiedAvatarUrl(pic);
    if(src){const img=document.createElement('img');img.src=src;img.alt='';
      img.onerror=()=>{box.replaceChildren(document.createTextNode('👤'));};
      box.appendChild(img);
    }else box.textContent='👤';
    return box;
  }
  function playCelebrations(kind){
    if(celebrationBusy[kind])return;
    const item=celebrationQueues[kind].shift();
    if(!item)return;
    celebrationBusy[kind]=true;
    ensureCelebrationStyle();
    const outer=document.createElement('aside');
    outer.id=kind==='ticker'?'sh-global-marquee':'sh-global-winner';
    outer.setAttribute('role','status');
    const copy=document.createElement('div');copy.className='sh-gc-copy';
    const from=String(item.sender_name||'Member');
    if(kind==='ticker'){
      const title=document.createElement('strong');
      title.textContent=item.kind==='gift'?'👑 ROYAL GIFT':'🏆 GLOBAL JACKPOT';
      const detail=document.createElement('span');
      detail.textContent=item.kind==='gift'?from+' sent '+
        String(item.gift_name||'Luxury Gift')+' ×'+item.quantity+' to '+
        String(item.recipient_name||'Member')+' · 🪙 '+formatCompactCoins(item.amount_coins):
        from+' won 🪙 '+formatCompactCoins(item.amount_coins)+' in '+String(item.game||'Game');
      copy.append(title,detail);
      const gift=document.createElement('span');gift.className='sh-gc-icon';
      gift.textContent=item.kind==='gift'?String(item.gift_emoji||'🎁'):'🏆';
      outer.append(celebrationAvatar(item.sender_pic),copy,gift);
    }else{
      const title=document.createElement('b');title.textContent='🎉 Congratulations!';
      const name=document.createElement('strong');name.textContent=from+' · '+String(item.game||'Game');
      const amount=document.createElement('em');
      amount.textContent='🪙 '+Number(item.amount_coins).toLocaleString('en-US');
      copy.append(title,name,amount);
      outer.append(celebrationAvatar(item.sender_pic),copy);
    }
    document.body.appendChild(outer);
    window.setTimeout(()=>{outer.remove();celebrationBusy[kind]=false;playCelebrations(kind);},
      kind==='ticker'?6000:3000);
  }
  function offerCelebration(item){
    if(!item||!Number.isSafeInteger(item.id)||item.id<1||
       !Number.isSafeInteger(item.amount_coins)||item.amount_coins<=0)return;
    if(celebrationQueues.ticker.length<8)celebrationQueues.ticker.push(item);
    playCelebrations('ticker');
    if(item.kind==='win'){
      if(celebrationQueues.winner.length<6)celebrationQueues.winner.push(item);
      playCelebrations('winner');
    }
  }
  async function pollGlobalCelebrations(){
    if(!session||celebrationFetching||document.visibilityState==='hidden')return;
    celebrationFetching=true;
    try{
      const data=await api('GET','/celebrations');
      const events=Array.isArray(data.events)?data.events:[];
      const now=Date.now();
      for(const event of events){
        if(!Number.isSafeInteger(event.id)||event.id<=lastCelebrationId)continue;
        // On sign-in, don't replay an entire previous minute of celebrations.
        const then=Date.parse(String(event.created_at||'').replace(' ','T')+'Z');
        if(!celebrationFirstPoll||Number.isFinite(then)&&now-then<12000)
          offerCelebration(event);
      }
      lastCelebrationId=Math.max(lastCelebrationId,Number(data.latest_id)||0,
        ...events.map(e=>Number(e.id)||0));
      celebrationFirstPoll=false;
    }catch(error){console.info('Celebration feed unavailable',errText(error));}
    finally{celebrationFetching=false;}
  }
  const celebrationTimer=window.setInterval(pollGlobalCelebrations,6500);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')pollGlobalCelebrations();
  });
  // The actual Android build type decides whether Play policy restrictions
  // apply. Never trust a query string, localStorage, or a user-editable toggle.
  let playStoreMode=null;
  // Only the separately isolated virtual Play backend may accept an email
  // password identity without inbox verification. If the native bridge fails,
  // Play restrictions stay closed but authentication cannot be relaxed.
  let playVirtualIdentityAllowed=false;
  const playModeReady=native('clientMode',{}).then(result=>{
    playStoreMode=result.play_store===true;
    playVirtualIdentityAllowed=playStoreMode && result.api_origin===
      'https://sharika-api-play-virtual.soverixnet.workers.dev';
    if(typeof result.api_origin==='string' && /^https:\/\/[A-Za-z0-9.-]+$/.test(result.api_origin))
      PUBLIC_INVITE_URL=result.api_origin+'/invite/';
    if(playStoreMode){
      const style=document.createElement('style');
      style.id='sharika-play-store-mode';
      style.textContent='#sharika-recharge-seller-wallet,#rcl2,#pc,#qi,'+
        '[data-m="invite"],#sh-bd-entry,#sh-agency-entry,#sh-host-entry,'+
        '#stage-invite-code{display:none!important}';
      document.head.append(style);
      clearIncomingInvite();
      // The original web app retains its older terms; replace the packaged
      // Play presentation so no seller, cash, betting or withdrawal promise appears.
      const applyVirtualTerms=()=>{
        if(!window.POLD)return;
        window.POLD.terms=['Terms & Conditions',[
          ['Eligibility','Sharika is a social voice-room app for people aged 13 and older.'],
          ['Virtual items','Coins, diamonds, gifts and cosmetics are virtual items for use inside Sharika only. They have no cash value, cannot be withdrawn, sold, redeemed for money or transferred to external sellers.'],
          ['Coin packs','If digital coin packs become available, they can only be purchased through Google Play Billing. Virtual items have no real-world cash value.'],
          ['Gifts and room rewards','Virtual gifts use virtual coins. Room owners may receive non-redeemable virtual coin rewards for gifts inside their rooms.'],
          ['Closed-loop use','Coins, gifts and rewards are only for activities inside Sharika. They cannot be exchanged for money or sold to third parties.'],
          ['Conduct and account','Follow community rules, respect moderation, and contact Customer Service for support or account deletion. We may restrict abusive accounts.']]];
        const age=window.POLD.privacy?.[1]?.find(row=>row[0]==='Children and teens');
        if(age)age[1]='Sharika is for people aged 13 and older. This Google Play edition disables betting games and Lucky Gifts for everyone.';
      };
      if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyVirtualTerms,{once:true});
      else applyVirtualTerms();
    }
    return playStoreMode;
  // Unknown mode must fail closed for payment routes; the Play build must
  // never fall back to the old external recharge controls on bridge failure.
  }).catch(()=>{playStoreMode=true;return true;});
  // The Agency Center is a separate first-party, packaged WebView module.
  // It reuses this authenticated native bridge; no demo login or wallet.
  window.sharikaFinancialFeaturesEnabled=()=>playStoreMode===false;
  window.sharikaAgencyApi=async(...args)=>{
    await playModeReady;
    if(playStoreMode!==false)throw Error('Agency and salary features are unavailable in the Google Play edition');
    return api(...args);
  };

  // Super Admin owns WHERE a cosmetic appears. The server-owned inventory and
  // user-selected cosmetic decide WHICH image/animation is displayed.
  const profileLayoutDefaults={
    main:{sections:['hero','stats','wallet','collection','account'],
      identity:['avatar','svip','name','id'],frame_scale:142,
      tag_position:'id',medal_position:'id',background:'original'},
    public:{sections:['cover','identity','levels','stats','actions'],
      identity:['avatar','name','id'],frame_scale:142,
      tag_position:'name',medal_position:'name',background:'original'}
  };
  let profileLayouts=profileLayoutDefaults,lastLayoutRequest=0,layoutRequest=null;
  function profileLayout(screen){return profileLayouts[screen]||profileLayoutDefaults[screen];}
  function profileLayoutCss(){
    if(document.getElementById('sh-profile-layout-css'))return;
    const style=document.createElement('style');
    style.id='sh-profile-layout-css';
    style.textContent=[
      '#v-me .mav .sh-sovera-frame.fxr,#pfo .pavw>.sh-sovera-frame.fxr{',
      'width:var(--sh-profile-frame-scale,142%)!important;',
      'height:var(--sh-profile-frame-scale,142%)!important}',
      '#v-me .sh-layout-ornament,#pfc .sh-layout-ornament{display:flex;',
      'align-items:center;justify-content:center;gap:5px;margin:5px auto;',
      'max-width:98%;min-height:18px;pointer-events:none}',
      '#v-me .sh-layout-ornament img,#pfc .sh-layout-ornament img{',
      'display:block;max-height:45px;max-width:min(220px,90%);object-fit:contain}',
      '#v-me .mav>.sh-layout-ornament,#pfc .pavw>.sh-layout-ornament{',
      'position:absolute;z-index:30;bottom:-30px;left:50%;transform:translateX(-50%);',
      'width:100px;min-width:70px;margin:0}',
      '#v-me .profile-hero>.sh-layout-ornament{flex:0 0 auto}',
      '#pfc .pfh .sh-layout-ornament{flex:0 0 auto}',
      '#v-me.sh-profile-gold .profile-royal-page::before{',
      'background:radial-gradient(circle at 50% 18%,#e3ac5470,transparent 54%),',
      'linear-gradient(155deg,#83511f,#311a30 55%,#170d1e)!important}',
      '#pfc.sh-profile-gold .pf{background:',
      'linear-gradient(150deg,#805522,#301c2b 55%,#170b24)!important}'
    ].join('');
    document.head.appendChild(style);
  }
  function placeProfileOrnaments(root,screen){
    if(!root)return;
    const layout=profileLayout(screen);
    const isMain=screen==='main';
    const name=isMain?root.querySelector('.profile-hero .mnm'):
      root.querySelector('.pfh h2');
    const id=isMain?root.querySelector('.profile-hero .profile-id-row'):
      root.querySelector('.pfh .meta');
    const avatar=isMain?root.querySelector('.profile-hero .mav'):
      root.querySelector('.pfh .pavw');
    for(const kind of ['medal','tag']){
      const ornament=root.querySelector('[data-sh-layout-ornament="'+kind+'"]');
      if(!ornament)continue;
      const position=layout[kind+'_position'];
      const target=position==='avatar'?avatar:position==='name'?name:id;
      if(!target)continue;
      // Responsive profile CSS must know which anchor the admin selected.
      // Otherwise ornaments become unnamed rows in the main profile grid.
      ornament.dataset.shPosition=position;
      if(position==='avatar')target.appendChild(ornament);
      else{
        target.insertAdjacentElement('afterend',ornament);
        // Flex order must follow the configured name/ID slot, not revert to 0.
        ornament.style.order=String((Number(target.style.order)||0)+0.5);
      }
    }
  }
  function applyProfileLayout(screen,root){
    if(!root)return;
    profileLayoutCss();
    const l=profileLayout(screen),isMain=screen==='main';
    const host=isMain?root.querySelector('.profile-royal-page'):
      root.querySelector('.pf');
    if(!host)return;
    host.style.display='flex';host.style.flexDirection='column';
    root.classList.toggle('sh-profile-gold',l.background==='gold');
    root.style.setProperty('--sh-profile-frame-scale',String(l.frame_scale)+'%');
    const selectors=isMain?{
      hero:'.profile-hero',stats:'.mst',wallet:'.wl',
      collection:'.profile-section:not(.profile-account)',
      account:'.profile-account'
    }:{
      cover:'.cov',identity:'.pfh',levels:'.lvs',
      stats:'.st4',actions:'.pbtn'
    };
    for(const [i,key] of l.sections.entries()){
      const element=host.querySelector(':scope > '+selectors[key]);
      if(element)element.style.order=String(i+1);
    }
    if(isMain){
      const bar=host.querySelector(':scope > .profile-topbar');
      if(bar)bar.style.order='0';
    }else{
      for(const child of host.children)
        if(!Object.values(selectors).some(sel=>child.matches(sel)))child.style.order='10';
    }
    const identity=isMain?host.querySelector('.profile-hero'):
      host.querySelector('.pfh');
    if(identity){
      identity.style.display='flex';identity.style.flexDirection='column';
      identity.style.alignItems='center';
      const keys=isMain?{
        avatar:'.mav',svip:'.profile-svip-badge',
        name:'.mnm',id:'.profile-id-row'
      }:{avatar:'.pavw',name:'h2',id:'.meta'};
      for(const [i,key] of l.identity.entries()){
        const el=identity.querySelector(':scope > '+keys[key]);
        if(el)el.style.order=String(i);
      }
      for(const child of identity.children){
        if(child.classList.contains('sh-svip-public-badge')){
          const name=identity.querySelector(':scope > h2');
          child.style.order=String((Number(name?.style.order)||0)+0.25);
        }else if(!Object.values(keys).some(sel=>child.matches(sel))&&
           !child.classList.contains('sh-layout-ornament'))child.style.order='9';
      }
    }
    placeProfileOrnaments(root,screen);
  }
  async function refreshGlobalProfileLayouts(){
    if(!session)return;
    if(layoutRequest)return layoutRequest;
    if(Date.now()-lastLayoutRequest<30000)return;
    lastLayoutRequest=Date.now();
    const current=session.user?.id;
    layoutRequest=(async()=>{
      try{
        const answer=await api('GET','/profile-layout');
        if(!session||session.user?.id!==current)return;
        for(const screen of ['main','public']){
          const raw=answer.layouts?.[screen];
          if(raw&&Array.isArray(raw.sections)&&Array.isArray(raw.identity)&&
             Number.isInteger(raw.frame_scale)&&raw.frame_scale>=110&&
             raw.frame_scale<=165&&
             ['original','gold'].includes(raw.background)&&
             ['avatar','name','id'].includes(raw.tag_position)&&
             ['avatar','name','id'].includes(raw.medal_position)&&
             raw.sections.length===profileLayoutDefaults[screen].sections.length&&
             raw.identity.length===profileLayoutDefaults[screen].identity.length&&
             raw.sections.every(x=>profileLayoutDefaults[screen].sections.includes(x))&&
             raw.identity.every(x=>profileLayoutDefaults[screen].identity.includes(x))&&
             new Set(raw.sections).size===raw.sections.length&&
             new Set(raw.identity).size===raw.identity.length)
            profileLayouts={...profileLayouts,[screen]:raw};
        }
        renderVerifiedIdentity();
        applyProfileLayout('main',document.getElementById('v-me'));
        applyProfileLayout('public',document.getElementById('pfc'));
      }catch(error){console.warn('Profile template refresh deferred:',errText(error));}
    })();
    try{await layoutRequest;}finally{layoutRequest=null;}
  }

  // An installed-app invite link can arrive before the signup view exists.
  // Keep only a validated public inviter ID. The Worker still enforces the
  // 48-hour/new-device rules; this client never awards coins locally.
  // HTTPS links and Play Install Referrer provide a pending inviter ID.
  // The Worker alone decides if the account and device qualify for a reward.
  let PUBLIC_INVITE_URL='https://sharika-api-staging.soverixnet.workers.dev/invite/';
  let deferredInviteCode='';
  let redeemingIncomingInvite=false;
  function rememberIncomingInvite(value){
    const code=String(value||'');
    if(!/^[0-9]{8}$/.test(code))return;
    deferredInviteCode=code;
    for(const input of document.querySelectorAll(
      '#stage-invite-code,#sharika-stage-profile-setup [name="invite_code"],#sh-invite-redeem-code')){
      input.value=code;
    }
    // A tester can reopen the link after sideloading the APK. If their
    // profile already exists, claim automatically during the allowed window.
    if(session?.user?.id&&profile?.public_id)
      Promise.resolve().then(claimPendingInviteAfterLogin).catch(()=>{});
  }
  window.SharikaIncomingInvite=rememberIncomingInvite;
  const invitePendingReady=native('invitePending')
    .then(data=>rememberIncomingInvite(data.code)).catch(()=>{});
  function clearIncomingInvite(expectedCode=''){
    if(expectedCode&&deferredInviteCode!==expectedCode)return;
    deferredInviteCode='';
    native('inviteClear').catch(()=>{});
  }
  async function claimPendingInviteAfterLogin(){
    await playModeReady;
    if(playStoreMode!==false){clearIncomingInvite();return;}
    if(redeemingIncomingInvite||!session?.user?.id||!deferredInviteCode)return;
    const viewer=session.user.id,code=deferredInviteCode;
    redeemingIncomingInvite=true;
    try{
      const result=await api('POST','/invites/redeem',{invite_code:code});
      if(result?.claimed&&session?.user?.id===viewer){
        clearIncomingInvite(code);
        reloadWallet().catch(()=>{});
        toast('Friend invitation linked automatically ✓');
      }
    }catch(error){
      const reason=errText(error);
      if(['invite_already_linked','invite_window_expired','cannot_invite_self',
          'invite_code_not_found'].includes(reason))clearIncomingInvite(code);
      else console.warn('Invite linking will retry when eligible:',reason);
    }finally{redeemingIncomingInvite=false;}
  }

  // A server-verified winner appears ONCE per launch. The backend advances
  // each viewer's cursor; the client never invents a ranking or rotates mid-view.
  let requestedOpening=false;
  function openingStyles(){
    if(document.getElementById('sh-opening-styles'))return;
    const style=document.createElement('style');
    style.id='sh-opening-styles';
    style.textContent=[
      '#sp.sharika-opening-pending,#sp.sharika-opening-featured{',
      'opacity:1!important;pointer-events:auto!important;transition:none!important}',
      '#sp.sharika-opening-featured>img,#sp.sharika-opening-featured>b{display:none!important}',
      '#sh-opening{position:absolute;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;',
      'overflow:hidden;color:#ffe9b0;text-align:center;background:radial-gradient(ellipse at 50% 32%,#872eb080,transparent 56%),',
      'linear-gradient(180deg,#300550e0,#0a0422f7),url("./royal-palace.png") center/cover}',
      '#sh-opening *{box-sizing:border-box}',
      '#sh-opening .sh-o-panel{width:100%;height:100%;padding:calc(20px + env(safe-area-inset-top,0px)) 16px ',
      'calc(20px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;align-items:center;gap:7px}',
      '#sh-opening .sh-o-header{font-size:clamp(29px,9vw,43px);line-height:.97;font-weight:1000;',
      'letter-spacing:.4px;color:#ffedac;text-shadow:0 2px 0 #873c06,0 5px 0 #4d1767,0 0 28px #ffbf71}',
      '#sh-opening .sh-o-tag{margin-top:7px;background:linear-gradient(135deg,#3e0962,#7a0ba3,#3e0962);',
      'border:2px solid #ffc85b;box-shadow:0 3px 0 #531a1c,0 0 18px #ca77ff99;',
      'color:#fff0a8;border-radius:12px;padding:7px 22px;font-weight:900;font-size:16px;letter-spacing:.4px}',
      '#sh-opening .sh-o-middle{flex:1;min-height:0;width:100%;display:flex;flex-direction:column;',
      'justify-content:space-evenly;align-items:center;gap:4px}',
      '#sh-opening .sh-o-profile{display:flex;flex-direction:column;align-items:center;gap:6px;max-width:100%;}',
      '#sh-opening .sh-o-photo{width:min(53vw,220px,24vh);height:min(53vw,220px,24vh);max-height:220px;',
      'border:8px ridge #ffd16d;border-radius:50%;background:radial-gradient(#8d4eb0,#28114a);',
      'box-shadow:0 0 0 6px #6a1c91,0 0 0 9px #ffdf86,0 0 55px #ffb84baa;',
      'display:grid;place-items:center;position:relative;font-size:60px}',
      '#sh-opening .sh-o-photo::before{content:"👑";position:absolute;bottom:90%;left:50%;',
      'transform:translateX(-50%);font-size:clamp(36px,11vw,58px);filter:drop-shadow(0 4px 6px #341131)}',
      '#sh-opening .sh-o-photo img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}',
      '#sh-opening .sh-o-name{margin-top:5px;font-size:clamp(18px,5.4vw,25px);font-weight:900;',
      'background:linear-gradient(130deg,#3a0755,#74129a,#3a0755);border:2px solid #e4af51;',
      'border-radius:15px;padding:7px 17px;max-width:92vw;white-space:nowrap;overflow:hidden;',
      'text-overflow:ellipsis;box-shadow:0 5px 17px #0007}',
      '#sh-opening .sh-o-id{font-weight:800;color:#ffe28d;background:#2b094d;border:1px solid #efc665;',
      'border-radius:25px;padding:3px 17px;font-size:14px}',
      '#sh-opening .sh-o-brand{display:flex;flex-direction:column;align-items:center;gap:1px;',
      'max-height:31vh;min-height:0}',
      '#sh-opening .sh-o-brand img{width:min(35vw,165px,16vh);height:min(35vw,165px,16vh);',
      'border-radius:29%;object-fit:cover;box-shadow:0 0 35px #c45cff8a}',
      '#sh-opening .sh-o-wordmark{font-size:clamp(30px,9vw,48px);font-weight:1000;font-style:italic;',
      'color:#ffecac;text-shadow:0 3px #8b3812,0 6px #431067,0 0 24px #ffc868}',
      '#sh-opening .sh-o-foot{width:100%;display:flex;align-items:center;gap:10px;margin-top:auto}',
      '#sh-opening .sh-o-time{font-weight:900;font-size:16px;white-space:nowrap}',
      '#sh-opening .sh-o-track{height:12px;flex:1;background:#1b0738;border:2px solid #ffc95f;',
      'border-radius:9px;overflow:hidden;box-shadow:0 0 12px #db8b55}',
      '#sh-opening .sh-o-fill{height:100%;width:100%;background:linear-gradient(90deg,#fcae2f,#fff9ae);',
      'transform-origin:left;animation:sh-opening-shrink var(--sh-opening-duration) linear forwards}',
      '@keyframes sh-opening-shrink{to{transform:scaleX(0)}}',
      '#sh-opening .sh-o-skip{border-radius:22px;border:2px solid #f6ca6e;background:#3d075a;',
      'color:#ffe9b0;padding:8px 13px;font-weight:900;cursor:pointer}',
      '@media (max-height:630px){#sh-opening .sh-o-photo{width:120px;height:120px;border-width:5px}',
      '#sh-opening .sh-o-header{font-size:26px}#sh-opening .sh-o-brand img{width:73px;height:73px}',
      '#sh-opening .sh-o-wordmark{font-size:27px}#sh-opening .sh-o-tag{padding:4px 12px}}',
      '@media(prefers-reduced-motion:reduce){#sh-opening .sh-o-fill{animation:none}}'
    ].join('');
    document.head.appendChild(style);
  }
  function displayOpening(data){
    return new Promise(resolve=>{
      if(!data?.show||!data.person||!session){resolve();return;}
      openingStyles();
      const app=document.getElementById('app');
      if(!app){resolve();return;}
      // Reuse the existing splash as the single opening surface. Updating
      // its contents in place prevents the old splash -> new card flash.
      const splash=document.getElementById('sp');
      if(splash){
        splash.classList.remove('sharika-opening-pending');
        splash.classList.add('sharika-opening-featured');
      }
      document.getElementById('sh-opening')?.remove();
      const layer=document.createElement('section');
      layer.id='sh-opening';layer.setAttribute('role','dialog');
      layer.setAttribute('aria-modal','true');
      layer.setAttribute('aria-label','Sharika weekly top user');
      const panel=document.createElement('div');panel.className='sh-o-panel';
      const header=document.createElement('div');header.className='sh-o-header';
      header.textContent=data.person.category==='custom'?'SHARIKA SPECIAL':'7 DAY TOP USERS';
      const tag=document.createElement('div');tag.className='sh-o-tag';
      tag.textContent=data.person.title||'SHARIKA STAR';
      const middle=document.createElement('div');middle.className='sh-o-middle';
      const person=document.createElement('div');person.className='sh-o-profile';
      const photo=document.createElement('div');photo.className='sh-o-photo';
      const url=String(data.person.pic||'');
      if(/^https:\/\//i.test(url)||/^data:image\/(jpeg|png|webp);base64,/i.test(url)){
        const img=document.createElement('img');img.src=url;img.alt='User profile picture';
        img.onerror=()=>{img.remove();photo.textContent='👤';};photo.appendChild(img);
      }else photo.textContent='👤';
      const name=document.createElement('div');name.className='sh-o-name';
      name.textContent=data.person.name||data.person.subtitle||'Featured Sharika member';
      person.append(photo,name);
      if(data.person.public_id){
        const id=document.createElement('div');id.className='sh-o-id';
        id.textContent='ID: '+(data.person.display_id||data.person.public_id);
        person.appendChild(id);
      }
      const brand=document.createElement('div');brand.className='sh-o-brand';
      const originalLogo=document.querySelector('#sp img[data-logo]');
      if(originalLogo?.src){
        const logo=document.createElement('img');logo.src=originalLogo.src;
        logo.alt='Sharika app logo';brand.appendChild(logo);
      }
      const word=document.createElement('div');word.className='sh-o-wordmark';
      word.textContent='Sharika';brand.appendChild(word);
      middle.append(person,brand);
      const footer=document.createElement('div');footer.className='sh-o-foot';
      const clock=document.createElement('span');clock.className='sh-o-time';
      const track=document.createElement('div');track.className='sh-o-track';
      const fill=document.createElement('div');fill.className='sh-o-fill';track.appendChild(fill);
      const skip=document.createElement('button');skip.type='button';
      skip.className='sh-o-skip';skip.textContent='SKIP »';
      footer.append(clock,track,skip);panel.append(header,tag,middle,footer);layer.appendChild(panel);
      (splash||app).appendChild(layer);
      const duration=Math.max(3,Math.min(30,Number(data.duration_seconds)||10));
      layer.style.setProperty('--sh-opening-duration',duration+'s');
      const start=Date.now();let ended=false;
      let timer,timeout;
      function close(){if(ended)return;ended=true;clearInterval(timer);clearTimeout(timeout);
        layer.remove();
        if(splash){
          splash.classList.remove('sharika-opening-pending','sharika-opening-featured');
          splash.classList.add('off');
        }
        document.dispatchEvent(new Event('sharika:opening-closed'));resolve();}
      function tick(){clock.textContent='⏱ '+Math.max(0,Math.ceil(duration-(Date.now()-start)/1000))+'s';}
      skip.onclick=close;tick();timer=setInterval(tick,250);
      timeout=setTimeout(close,duration*1000);
    });
  }
  async function openingOnLaunch(){
    if(requestedOpening||!session)return;
    requestedOpening=true;
    const startedBy=session.user?.id;
    try{
      // The opening is optional: never hide the real home for a 25-second
      // staging timeout. A quickly loaded opening still shows for 10 seconds.
      const data=await Promise.race([
        api('POST','/opening/next',{}),
        new Promise(resolve=>setTimeout(()=>resolve(null),4000))
      ]);
      if(session?.user?.id!==startedBy || !data)return;
      await displayOpening(data);
    }catch(error){console.warn('Weekly opening unavailable:',errText(error));}
    finally{
      // No verified winner (or an outage) must not leave the loading layer
      // covering the authenticated home or Firebase sign-in.
      document.getElementById('sp')?.classList.remove('sharika-opening-pending');
    }
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
  // User-supplied source videos are split into individual transparent,
  // 3.6-second looping WebP assets. No user URL or HTML is interpolated here.
  const premiumItem=(id,name,group)=>({id,name,group,source:'sharika',art:id+'.webp'});
  const premiumRange=(prefix,amount,label,group)=>Array.from({length:amount},(_,i)=>{
    const number=String(i+1).padStart(2,'0');
    return premiumItem(prefix+'-'+number,label+' '+(i+1),group);
  });
  const roleNumbers=[...Array.from({length:51},(_,i)=>i+1),54,55,56,57,58,59,60,61,62,63,64];
  SOVERA_FRAMES.push(
    premiumItem('vip5-animated','VIP5 Royal Wings','vip'),
    ...premiumRange('svip-frame',8,'SVIP Animated Frame','svip'),
    ...[2,3,4,5].map(level=>premiumItem('vip-royal-frame-'+String(level).padStart(2,'0'),
      'VIP '+level+' Royal Frame','vip')),
    ...[4,5].map(level=>premiumItem('svip-royal-frame-'+String(level).padStart(2,'0'),
      'SVIP '+level+' Royal Frame','svip')),
    premiumItem('noble-gold-microphone','Noble Gold Microphone','noble'),
    premiumItem('cs-royal-wings','CS Royal Wings · Official','role'),
    premiumItem('coin-seller-royal','Coin Seller Crown · Official','role'),
    ...roleNumbers.map(number=>premiumItem('role-frame-'+String(number).padStart(2,'0'),
      'Royal Role Frame '+number,'role'))
  );
  playModeReady.then(isPlay=>{
    if(!isPlay)return;
    const item=SOVERA_FRAMES.find(frame=>frame.id==='coin-seller-royal');
    if(item)item.name='Royal Crown · Official';
  });
  SOVERA_ENTRIES.push(...Array.from({length:8},(_,i)=>{
    const key=String(i+1).padStart(2,'0');
    return {id:'svip-entry-'+key,name:'SVIP '+(i+1)+' Royal Arrival',
      source:'sharika',art:'svip-medal-'+key+'.webp',still:'svip-medal-'+key+'.webp',
      group:'svip',ms:3800};
  }));
  SOVERA_MEDALS.push(...premiumRange('svip-medal',8,'SVIP Animated Medal','svip'));
  SOVERA_MEDALS.push(
    ...[2,3,4,5].map(level=>premiumItem('vip-royal-badge-'+String(level).padStart(2,'0'),
      'VIP '+level+' Royal Badge','vip')),
    ...[1,2,3,4,5].map(level=>premiumItem('svip-royal-badge-'+String(level).padStart(2,'0'),
      'SVIP '+level+' Royal Badge','svip'))
  );
  SOVERA_TAGS.push(...premiumRange('svip-tag',17,'SVIP Nameplate','svip'));
  function medalArt(key){return SOVERA_MEDALS.find(m=>m.id===key);}
  function nameTagArt(key){return SOVERA_TAGS.find(m=>m.id===key);}
  function verifiedMediaUrl(value){
    if(typeof value!=='string'||value.length>500)return '';
    try{
      const uri=new URL(value);
      return uri.protocol==='https:'&&!uri.username&&!uri.password&&
        !/[\x00-\x20<>"']/u.test(value)?uri.href:'';
    }catch(_){return '';}
  }
  function isVideoMedia(value){return /\.(mp4|webm)(?:[?#]|$)/i.test(value||'');}
  function cosmeticMedia(item){
    const uploaded=verifiedMediaUrl(item?.remote_image_url)||
      (isVideoMedia(item?.remote_animation_url)?'':verifiedMediaUrl(item?.remote_animation_url));
    if(uploaded)return uploaded;
    return item?.source==='sharika'?
    './sharika-premium/'+item.art:item?.group==='medals'?
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
      '#v-me .mav,#pfc .pfh .pavw{overflow:visible!important;isolation:isolate}',
      '#v-me .mav img,#pfc .pfh .pav3{object-fit:cover!important;object-position:center!important}',
      '#pfc .pfh .pav3{background-size:cover!important;background-position:center!important;',
      'background-repeat:no-repeat!important;border-radius:50%!important;overflow:hidden!important}',
      '#pfc .pfh .pavw>.sh-sovera-frame.fxr{left:50%!important;top:50%!important;',
      'transform:translate(-50%,-50%)!important}',
      '.sh-neon-public-id{font-size:13px!important;letter-spacing:.05em!important;',
      'padding:5px 10px!important;margin:5px auto 9px!important}',
      '.pavw{overflow:visible!important;margin-bottom:22px!important}',
      '.pavw>.sh-sovera-frame{width:142%!important;height:142%!important}',
      '@keyframes shSoGlow{50%{filter:brightness(1.18) drop-shadow(0 0 6px #ffe6a055)}}',
      '.sh-sovera-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:14px 0}',
      '.sh-sovera-item{min-width:0;display:flex;flex-direction:column;align-items:center;gap:8px;',
      'border:1px solid #6b61ad;background:#211747;border-radius:14px;color:#fff;padding:24px 8px 18px;',
      'min-height:210px;overflow:hidden;',
      'font-size:11px;font-weight:700}',
      '.sh-sovera-item[aria-pressed="true"]{border:2px solid #ffdb70;background:#423068}',
      '.sh-sovera-item img{object-fit:contain;width:72px;height:72px;max-width:100%}',
      '.sh-sovera-preview{position:relative;width:96px;height:96px;border-radius:50%;',
      'display:grid;place-items:center;background:linear-gradient(135deg,#8149c8,#26104a);',
      'font-size:36px;margin:24px 0 24px;flex:none;overflow:visible!important}',
      '.sh-sovera-preview .sh-sovera-frame.fxr{width:137%!important;height:137%!important;',
      'background-size:contain!important;background-position:center!important}',
      '.sh-sovera-id-effects{display:flex;justify-content:center;align-items:center;gap:8px;margin:6px auto 12px}',
      '.sh-sovera-id-effects img{max-width:45%;height:48px;object-fit:contain}',
      '.sh-sovera-seat-medal{position:absolute;z-index:15;right:-18%;bottom:-25%;width:29px;height:29px;object-fit:contain;pointer-events:none}',
      '.sh-sovera-seat-tag{position:absolute;z-index:18;left:50%;top:100%;width:104px;height:29px;transform:translateX(-50%);object-fit:contain;pointer-events:none}',
      '.sh-neon-profile-id{display:block;width:max-content;max-width:94%;margin:7px auto 12px;padding:7px 18px;',
      'color:#ff4055;font-size:20px;font-weight:1000;letter-spacing:.12em;border:2px solid #ff8871;',
      'border-radius:14px;background:linear-gradient(110deg,#3b0818,#7c1231,#470b26);',
      'box-shadow:0 0 16px #ff395088,inset 0 0 14px #f3633970;',
      'animation:sh-special-id-fire 2.8s ease-in-out infinite}',
      // Profile keeps the actual special ID number; avoid a duplicate seat label.
      '.sh-sovera-user-tag{display:inline-block;width:74px;height:25px;object-fit:contain;margin-left:4px;vertical-align:middle}',
      '.sh-sovera-entry-cover{position:fixed;inset:0;z-index:2147483600;',
      'pointer-events:none;display:block;overflow:hidden;background:#16082f}',
      '.sh-sovera-entry-cover img{position:absolute;inset:0;width:100%;height:100%;',
      'max-width:none;max-height:none;object-fit:cover;object-position:center top;',
      'opacity:0;filter:drop-shadow(0 0 12px #e6c6ff80)}',
      '.sh-sovera-entry-cover.ready img{opacity:1}',
      '.sh-sovera-entry-cover.sh-uploaded-entry{height:58vh;bottom:auto;background:linear-gradient(180deg,#16082fba,#16082f00)}',
      '.sh-sovera-entry-cover.sh-uploaded-entry video{width:100%;height:100%;object-fit:contain;object-position:center top}',
      '.sh-sovera-entry-cover button{position:absolute;top:calc(12px + env(safe-area-inset-top,0px));right:18px;',
      'pointer-events:auto;border:1px solid #fff7;color:white;border-radius:50%;',
      'background:#25134a;font-size:22px;width:40px;height:40px}',

      '.sh-svip-badge{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;',
      'padding:4px 11px;color:#ffe8a3!important;font-size:11px;font-weight:900;letter-spacing:.05em;',
      'border:1px solid #f2d18c;border-radius:100px;background:linear-gradient(135deg,#331e5c,#8840bf 54%,#433069);',
      'box-shadow:inset 0 1px 1px #ffeca777,0 0 13px #b572f399;text-shadow:0 1px 3px #12041e}',
      '.sh-svip-badge[data-svip-level="1"],.sh-svip-badge[data-svip-level="2"]{border-color:#aab7ff;color:#e9e8ff!important}',
      '.sh-svip-badge[data-svip-level="3"],.sh-svip-badge[data-svip-level="4"]{border-color:#ebc577}',
      '.seat .av>.sh-svip-seat-badge{position:absolute;z-index:24;left:calc(100% - 3px);top:18%;',
      'transform:translate(-20%,-50%);font-size:9px!important;padding:2px 6px;',
      'pointer-events:none;line-height:1.25;max-width:68px;box-sizing:border-box}',
      '.sh-svip-public-badge{display:table;margin:4px auto 12px;font-size:12px;padding:6px 17px}',
      '#v-me .profile-svip-badge.sh-svip-badge{margin:8px auto 6px;padding:7px 18px;font-size:12px;',
      'background:linear-gradient(145deg,#2a164d,#632bb0,#3d1b68)}',
      '#sh-svip-royal{position:fixed;inset:0;z-index:2147483500;overflow:auto;overscroll-behavior:contain;',
      'box-sizing:border-box;padding:calc(20px + env(safe-area-inset-top,0px)) 15px;',
      'padding-bottom:calc(30px + env(safe-area-inset-bottom,0px));color:#fef5e3;',
      'font-family:inherit;background:radial-gradient(circle at 50% -15%,#71378e,#1a0b45 49%,#07031a 100%)}',
      '#sh-svip-royal *{box-sizing:border-box}',
      '#sh-svip-royal .svip-wrap{max-width:560px;margin:0 auto}',
      '#sh-svip-royal .svip-top{display:flex;align-items:center;justify-content:space-between;margin:0 0 19px}',
      '#sh-svip-royal .svip-top h2{font-family:Georgia,serif;color:#ffe2a6;font-size:23px;margin:0;',
      'letter-spacing:.07em;text-shadow:0 3px 10px #e7aa6470}',
      '#sh-svip-royal button{cursor:pointer;font:inherit}',
      '#sh-svip-royal .svip-back{border:1px solid #dabb7d88;background:#241141;',
      'color:#ffebbb;border-radius:13px;padding:8px 14px;font-size:20px}',
      '#sh-svip-royal .svip-card{position:relative;border:1px solid #d9b36d;border-radius:24px;',
      'padding:16px 17px 19px;min-height:176px;background:linear-gradient(137deg,#3b164d,#22113c 49%,#0d0b22);',
      'box-shadow:inset 0 1px #fbe6ad77,0 14px 32px #09041b88;overflow:visible}',
      '#sh-svip-royal .svip-card-top{font-size:10px;letter-spacing:.21em;color:#f4cc88;font-weight:900}',
      '#sh-svip-royal .svip-card h3{font-family:Georgia,serif;font-size:49px;color:#ffde97;',
      'line-height:1;margin:20px 0 4px;text-shadow:0 4px 14px #eec36e55}',
      '#sh-svip-royal .svip-card p{color:#e6d4fc;font-size:11px;margin:0}',
      '#sh-svip-royal .svip-card-avatar{position:absolute;right:23px;top:38px;width:92px;height:92px;',
      'border-radius:50%;background:#63398c;display:grid;place-items:center;font-size:35px}',
      '#sh-svip-royal .svip-card-avatar>img:first-child{width:100%;height:100%;border-radius:50%;object-fit:cover}',
      '#sh-svip-royal .svip-card-avatar .svip-ring{position:absolute;width:145%;height:145%;',
      'top:50%;left:50%;transform:translate(-50%,-50%);object-fit:contain;pointer-events:none}',
      '#sh-svip-royal .svip-level-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:21px 0}',
      '#sh-svip-royal .svip-level-tabs button{border:1px solid #9d71b3;border-radius:12px;',
      'background:#2b184b;color:#e0c4f8;padding:10px 0;font-size:12px;font-weight:900}',
      '#sh-svip-royal .svip-level-tabs button[aria-pressed="true"]{border-color:#fce2a2;',
      'color:#2a1245;background:linear-gradient(135deg,#fff0b0,#e3a851);box-shadow:0 4px 17px #f2bf6588}',
      '#sh-svip-royal .svip-view{border:1px solid #85608a;border-radius:22px;',
      'background:linear-gradient(150deg,#391e62,#1a1036);padding:19px 14px;margin-top:10px}',
      '#sh-svip-royal .svip-preview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));',
      'gap:14px;margin:14px 0}',
      '#sh-svip-royal .svip-preview-card{padding:22px 5px 13px;border:1px solid #b38d9a;',
      'border-radius:19px;background:#200f3a;text-align:center;min-width:0}',
      '#sh-svip-royal .svip-mini-avatar{width:75px;height:75px;position:relative;border-radius:50%;',
      'margin:10px auto 24px;background:#7543a0;display:grid;place-items:center;font-size:28px}',
      '#sh-svip-royal .svip-mini-avatar .photo{width:100%;height:100%;border-radius:50%;object-fit:cover}',
      '#sh-svip-royal .svip-mini-avatar .ring{width:145%;height:145%;position:absolute;inset:50% auto auto 50%;',
      'transform:translate(-50%,-50%);object-fit:contain;pointer-events:none}',
      '#sh-svip-royal .svip-mini-avatar .medal{position:absolute;right:-12px;bottom:-12px;',
      'height:35px;width:35px;object-fit:contain}',
      '#sh-svip-royal .svip-preview-card strong{display:block;margin-top:8px;color:#ffe4ad;font-size:12px}',
      '#sh-svip-royal .svip-preview-card small{color:#d6c1eb;font-size:10px}',
      '#sh-svip-royal .svip-art-row{display:flex;align-items:center;justify-content:center;gap:11px;margin:6px 0}',
      '#sh-svip-royal .svip-art-row img{width:82px;height:47px;object-fit:contain}',
      '#sh-svip-royal .svip-section-title{font-size:16px;color:#ffe6b7;margin:22px 0 10px}',
      '#sh-svip-royal .svip-power{display:flex;align-items:center;gap:11px;',
      'padding:11px 2px;border-bottom:1px solid #a7858855;font-size:13px}',
      '#sh-svip-royal .svip-power b{color:#ffe8b3}',
      '#sh-svip-royal .svip-main-btn{display:block;width:100%;border-radius:17px;',
      'padding:14px 9px;margin:16px 0 8px;border:1px solid #fff0c3;color:#351a43;font-weight:900;',
      'background:linear-gradient(135deg,#fff0c0,#e8b354);box-shadow:0 5px 16px #0008}',
      '#sh-svip-royal .svip-main-btn:disabled{opacity:.58}',
      '#sh-svip-royal .svip-note{font-size:12px;color:#d8c9e7;line-height:1.5}',
      '#sh-svip-royal [role="status"]{min-height:22px;color:#e9ca81;font-size:12px}',
      '.sh-sovera-frame.fxr.sh-svip-frame{width:176%!important;height:176%!important}',
      '#v-me .mav>.sh-sovera-frame.sh-svip-frame{width:178%!important;height:178%!important}',
      '#pfc .pfh .pavw>.sh-sovera-frame.fxr.sh-svip-frame{width:178%!important;height:178%!important}',
      '.seat .av>.sh-sovera-frame.fxr.sh-svip-frame{width:177%!important;height:177%!important}',
      '.host .av.sh-has-sovera-frame{margin-bottom:28px!important}',
      '#v-me .mav.sh-has-sovera-frame{margin-bottom:37px!important}',
      '#pfc .pfh .pavw:has(>.sh-svip-frame){margin-top:20px!important;margin-bottom:33px!important}',
      '.sh-neon-profile-id::before{content:none!important}',
      '@keyframes sh-special-id-fire{0%,100%{color:#ff3950;-webkit-text-fill-color:#ff3950;text-shadow:0 0 5px #ff253caa,0 0 13px #eb173d55}',
      '50%{color:#ffd16c;-webkit-text-fill-color:#ffd16c;text-shadow:0 0 7px #ff6a35,0 0 18px #ff273ab0}}',
      '#v-me .mid.sh-neon-single-id,#pfc .pfh .meta .sh-neon-single-id{',
      'border:2px solid #ff756a!important;background:linear-gradient(125deg,#3a0718,#74112a 52%,#400b26)!important;',
      'color:#ff3950!important;-webkit-text-fill-color:#ff3950;border-radius:100px!important;padding:6px 16px!important;',
      'font-weight:1000!important;letter-spacing:.065em!important;font-variant-numeric:tabular-nums;',
      'box-shadow:0 0 17px #ff304c88,inset 0 0 10px #b9273270;',
      'animation:sh-special-id-fire 2.8s ease-in-out infinite!important}',
      '@media(prefers-reduced-motion:reduce){',
      '#v-me .mid.sh-neon-single-id,#pfc .pfh .meta .sh-neon-single-id{',
      'animation:none!important;color:#ff4055!important;-webkit-text-fill-color:#ff4055}}',
      '#sh-svip-royal{background:radial-gradient(ellipse at 50% -20%,#76428e 0%,#230e4d 40%,#0c0722 100%)}',
      '#sh-svip-royal .svip-title{text-align:center}',
      '#sh-svip-royal .svip-title small{display:block;color:#d5b1e0;font-size:9px;font-weight:900;letter-spacing:2px}',
      '#sh-svip-royal .svip-card{background:linear-gradient(120deg,#27103e,#51204f 55%,#1c0938);',
      'border:2px solid #edc576;box-shadow:inset 0 2px 1px #ffefbd5c,0 10px 0 #120827,0 18px 28px #0301118f}',
      '#sh-svip-royal .svip-card-copy{position:relative;z-index:2;max-width:65%}',
      '#sh-svip-royal .svip-card-chip{display:inline-block;margin-top:10px;padding:5px 9px;',
      'border:1px solid #ffe0a7;border-radius:100px;font-size:9px;font-weight:900;color:#ffe3a8;',
      'background:#522b6680}',
      '#sh-svip-royal .svip-card-avatar .photo{display:grid;place-items:center;overflow:hidden;',
      'width:100%;height:100%;border-radius:50%;object-fit:cover;background:#67348a}',
      '#sh-svip-royal .svip-card-avatar .svip-ring{width:172%;height:172%}',
      '#sh-svip-royal .svip-level-tabs button{box-shadow:inset 0 1px #fff3,0 4px 0 #100826;',
      'border-color:#bb8fc1;background:linear-gradient(160deg,#4f2865,#291744);font-size:16px}',
      '#sh-svip-royal .svip-level-tabs button[aria-pressed="true"]{box-shadow:0 4px 0 #916329,0 0 18px #f3c4708a}',
      '#sh-svip-royal .svip-view{border:2px solid #bd8db2;background:linear-gradient(145deg,#42215b,#1b1038 60%,#100a2e);',
      'box-shadow:inset 0 1px 0 #ffffff35,0 10px 26px #03011280}',
      '#sh-svip-royal .svip-price-head{display:flex;align-items:center;justify-content:space-between;',
      'gap:10px;border-bottom:1px solid #d9a9b766;padding-bottom:13px}',
      '#sh-svip-royal .svip-price-head>div:first-child{display:flex;flex-direction:column}',
      '#sh-svip-royal .svip-price-head small,#sh-svip-royal .svip-price-head span{font-size:10px;color:#dec5e0}',
      '#sh-svip-royal .svip-price-head strong{font-size:23px;color:#ffe3a0}',
      '#sh-svip-royal .svip-price{text-align:right;min-width:100px}',
      '#sh-svip-royal .svip-price strong{display:block;font-size:16px;color:#ffe1a2}',
      '#sh-svip-royal .svip-mini-avatar .ring{width:171%;height:171%}',
      '#sh-svip-royal .svip-mini-avatar .photo{width:100%;height:100%;border-radius:50%;',
      'object-fit:cover;display:grid;place-items:center;overflow:hidden;background:#703aa4}',
      '#sh-svip-royal .svip-preview-card{padding:21px 7px 15px;overflow:visible;',
      'background:linear-gradient(150deg,#2e1646,#1b0d38);box-shadow:inset 0 1px #ffe1b84a}',
      '#sh-svip-royal .svip-reward-card{display:flex;flex-direction:column;align-items:center;',
      'gap:3px;padding:12px;border:1px solid #f0c57c;border-radius:17px;margin:14px 0;',
      'background:linear-gradient(140deg,#6b3a60,#38204f);box-shadow:inset 0 2px #ffdfac44}',
      '#sh-svip-royal .svip-reward-card span{font-size:10px;letter-spacing:1.4px;color:#eed0a3}',
      '#sh-svip-royal .svip-reward-card strong{font-size:23px;color:#fff0ad}',
      '#sh-svip-royal .svip-reward-card small{font-size:10px;color:#ded0e8}',
      '#sh-svip-royal .svip-perks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}',
      '#sh-svip-royal .svip-perks span{border:1px solid #b67eb678;border-radius:12px;',
      'padding:9px 7px;font-size:11px;background:#2b144a;color:#ffe6cb}',
      '#sh-svip-royal .svip-reward-btn{background:linear-gradient(135deg,#a972e4,#e2c5f3);',
      'color:#210c3c;border-color:#e9cbff}',
      '#sh-svip-royal .svip-rules{margin:12px 0;font-size:12px;color:#dcc6ea}',
      '@media(max-width:365px){#sh-svip-royal .svip-price-head strong{font-size:19px}',
      '#sh-svip-royal .svip-card h3{font-size:39px}}',
      '.sh-svip-room-entry{position:fixed;left:3%;right:3%;bottom:calc(105px + env(safe-area-inset-bottom,0px));',
      'z-index:2147483500;min-height:76px;display:flex;align-items:center;gap:10px;',
      'padding:10px 18px;border:2px solid #e9c582;border-radius:25px;',
      'background:linear-gradient(115deg,#2b105ceF,#54298bef,#1a0a36f0);color:#fff0c9;',
      'box-shadow:0 0 25px #e9c57988;pointer-events:none;animation:shSvEnter .4s ease-out}',
      '.sh-svip-room-entry img{width:65px;height:65px;object-fit:contain;flex:none}',
      '.sh-svip-room-entry strong{display:block;font-size:17px;font-weight:900}',
      '.sh-svip-room-entry small{font-size:11px;color:#e0c7ff}',
      '@keyframes shSvEnter{from{transform:translateY(35px);opacity:0}to{transform:translateY(0);opacity:1}}',
      '#ul .sh-svip-badge{font-size:10px;vertical-align:middle;padding:2px 6px;margin-left:5px}',
      '@media(prefers-reduced-motion:reduce){.sh-sovera-frame.fxr,.sh-svip-room-entry{animation:none!important}}'
    ].join('');
    doc.head.appendChild(style);
  }
  function frameTag(key){
    const item=frameArt(key);
    if(!item)return '';
    const remote=verifiedMediaUrl(item.remote_animation_url);
    if(isVideoMedia(remote))return '<video class="fxr sh-sovera-frame" aria-hidden="true" '+
      'autoplay muted loop playsinline preload="metadata" src="'+remote+'"></video>';
    // Only pinned package filenames are used; never interpolate user URLs.
    return '<i class="fxr sh-sovera-frame'+(item.group==='svip'?' sh-svip-frame':'')+
      '" aria-hidden="true" '+
      'style="background-image:url('+cosmeticMedia(item)+')"></i>';
  }
  function playSoveraEntry(doc,key){
    const choice=entryArt(key);
    if(!doc||!choice)return;
    if(/^svip-entry-0[1-8]$/.test(key)){
      playSvipRoomEntry(doc,Number(key.slice(-2)),'Royal member');return;
    }
    cosmeticCss(doc);
    doc.querySelector('.sh-sovera-entry-cover')?.remove();
    const cover=doc.createElement('div');
    cover.className='sh-sovera-entry-cover';
    const uploaded=verifiedMediaUrl(choice.remote_animation_url);
    if(isVideoMedia(uploaded)){
      cover.classList.add('sh-uploaded-entry');
      const video=doc.createElement('video');
      video.src=uploaded;video.autoplay=true;video.playsInline=true;
      video.preload='auto';video.controls=false;
      const close=doc.createElement('button');
      close.type='button';close.textContent='×';close.setAttribute('aria-label','Close entry animation');
      close.onclick=()=>{video.pause();cover.remove();};
      video.addEventListener('ended',()=>cover.remove(),{once:true});
      cover.append(video,close);doc.body.appendChild(cover);
      // Browser auto-play policy may require a tap for audio on receiving phones.
      video.play().catch(()=>{
        video.muted=true;video.play().catch(()=>{});
        const sound=doc.createElement('button');sound.type='button';
        sound.textContent='🔊';sound.setAttribute('aria-label','Play entry audio');
        sound.style.right='66px';
        sound.onclick=()=>{video.muted=false;video.play().catch(()=>{});sound.remove();};
        cover.appendChild(sound);
      });
      const separate=verifiedMediaUrl(choice.remote_audio_url);
      if(separate){
        const music=doc.createElement('audio');music.src=separate;
        cover.appendChild(music);music.play().catch(()=>{});
        close.onclick=()=>{music.pause();video.pause();cover.remove();};
      }
      doc.defaultView?.setTimeout(()=>{video.pause();cover.remove();},10000);
      return;
    }
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
    const soundtrack=verifiedMediaUrl(choice.remote_audio_url);
    if(soundtrack){
      const audio=doc.createElement('audio');audio.src=soundtrack;
      const soundButton=doc.createElement('button');soundButton.type='button';
      soundButton.textContent='🔊';soundButton.style.right='66px';
      soundButton.setAttribute('aria-label','Play entry sound');
      soundButton.onclick=()=>audio.play().then(()=>soundButton.remove()).catch(()=>{});
      cover.append(audio,soundButton);
      audio.play().then(()=>soundButton.remove()).catch(()=>{});
      close.onclick=()=>{audio.pause();cover.remove();};
    }
    doc.body.appendChild(cover);
    img.src=uploaded||effectPath(doc.defaultView?.matchMedia?.('(prefers-reduced-motion:reduce)')?.matches
      ?choice.still:choice.art);
    // Bound the network wait without truncating a successfully loaded effect.
    const timeout=doc.defaultView?.setTimeout(()=>{
      if(!started)cover.remove();
    },20000);
    img.addEventListener('load',()=>doc.defaultView?.clearTimeout(timeout),{once:true});
    img.addEventListener('error',()=>doc.defaultView?.clearTimeout(timeout),{once:true});
  }

  function svipLevel(value){
    const n=Number(value);
    return Number.isInteger(n)&&n>=1&&n<=8?n:0;
  }
  function svipArt(level,kind){
    if(!svipLevel(level)||!['frame','medal','tag'].includes(kind))return '';
    return './sharika-premium/svip-'+kind+'-'+String(level).padStart(2,'0')+'.webp';
  }
  function makeSvipBadge(doc,level,extraClass=''){
    const badge=doc.createElement('span');
    badge.className='sh-svip-badge '+extraClass;
    badge.dataset.svipLevel=String(level);
    badge.textContent='SVIP '+level;
    return badge;
  }
  function playSvipRoomEntry(doc,level,name){
    const n=svipLevel(level);
    if(!doc||!n)return;
    cosmeticCss(doc);
    doc.querySelector('.sh-svip-room-entry')?.remove();
    const notice=doc.createElement('div');
    notice.className='sh-svip-room-entry';
    notice.setAttribute('role','status');
    const art=doc.createElement('img');
    art.src=svipArt(n,'medal');
    art.alt='';
    const copy=doc.createElement('div');
    const title=doc.createElement('strong');
    title.textContent='SVIP '+n+' · '+String(name||'Royal member').slice(0,80);
    const sub=doc.createElement('small');
    sub.textContent='joined the voice room';
    copy.append(title,sub);
    notice.append(art,copy);
    doc.body.appendChild(notice);
    doc.defaultView?.setTimeout(()=>notice.remove(),3800);
  }
  function playStandardRoomEntry(doc,event){
    if(!doc)return;
    cosmeticCss(doc);
    doc.querySelector('.sh-svip-room-entry')?.remove();
    const notice=doc.createElement('div');
    notice.className='sh-svip-room-entry';
    notice.setAttribute('role','status');
    const avatar=doc.createElement('span');
    avatar.textContent='👋';
    avatar.setAttribute('aria-hidden','true');
    avatar.style.cssText='font-size:32px;display:grid;place-items:center;'+
      'width:59px;height:59px;flex:none;border:2px solid #ffdb97;'+
      'border-radius:50%;background:#3b185e';
    const copy=doc.createElement('div');
    const title=doc.createElement('strong');
    title.textContent=String(event?.name||'A member').slice(0,80);
    const sub=doc.createElement('small');
    sub.textContent='joined the voice room';
    copy.append(title,sub);
    notice.append(avatar,copy);
    doc.body.appendChild(notice);
    doc.defaultView?.setTimeout(()=>notice.remove(),3800);
  }

  // Avatar URLs come only from the authenticated Sharika profile API. Never
  // render arbitrary user-supplied image URLs in verified room identities.
  function verifiedAvatarUrl(value){
    return typeof value==='string' &&
      /^https:\/\/sharika-api-staging\.soverixnet\.workers\.dev\/api\/v1\/users\/[0-9]{8}\/avatar\?v=[0-9]+$/.test(value)
      ?value:null;
  }
  function verifiedCoverUrl(value){
    return typeof value==='string' &&
      /^https:\/\/sharika-api-staging\.soverixnet\.workers\.dev\/api\/v1\/users\/[0-9]{8}\/cover-image\?v=[0-9]+$/.test(value)
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
    // Keep the decorated avatar holder visible; clip only the actual photo.
    // Otherwise the 142% Royal/SVIP frame is cut off on some profile cards.
    node.style.overflow='visible';
    const image=doc.createElement('img');
    image.className='sh-verified-avatar-image';
    image.dataset.source=src;
    image.alt='';
    image.setAttribute('aria-hidden','true');
    image.style.cssText='position:absolute;inset:0;width:100%;height:100%;'+
      'display:block;object-fit:cover;object-position:center;border-radius:50%;z-index:2;'+
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
      // Luxury videos are cinematic, edge-to-edge celebrations. The video is
      // behind the caption, never squeezed into a 62vh column by the flex UI.
      '.sh-gift-parade.sh-gift-parade-video{inset:0;top:0;left:0;width:100%;height:100%;'+
      'max-width:none;box-sizing:border-box;padding:0;border:0;border-radius:0;'+
      'background:transparent;display:block;overflow:hidden;pointer-events:none;'+
      'opacity:0;animation:none}',
      '.sh-gift-parade.sh-gift-parade-video.sh-gift-video-playing{'+
      'opacity:1;animation:shGiftFullscreen 10s linear both}',
      '@keyframes shGiftFullscreen{0%{opacity:0}7%{opacity:1}93%{opacity:1}100%{opacity:0}}',
      '.sh-gift-parade-video video{position:absolute;inset:0;display:block;'+
      'width:100%;height:100%;object-fit:contain;object-position:center center;'+
      'transform-origin:center center;opacity:0;animation:none}',
      '.sh-gift-parade-video.sh-gift-video-playing video{opacity:1;'+
      'animation:shGiftCenterZoom 10s ease-out both}',
      '@keyframes shGiftCenterZoom{0%{transform:scale(.32);opacity:0}'+
      '12%{transform:scale(1.025);opacity:1}22%{transform:scale(1);opacity:1}'+
      '85%{transform:scale(1);opacity:1}100%{transform:scale(1.05);opacity:1}}',
      '.sh-gift-parade-video::after{content:"";position:absolute;inset:0;z-index:1;'+
      'pointer-events:none;background:linear-gradient(180deg,#080419c0 0%,transparent 22%,'+
      'transparent 68%,#080419ec 100%)}',
      '.sh-gift-parade-video .sh-gift-parade-title{position:absolute;z-index:2;'+
      'top:calc(24px + env(safe-area-inset-top,0px));left:8px;right:8px;'+
      'font-size:clamp(12px,3.5vw,18px);text-shadow:0 2px 8px #080419}',
      '.sh-gift-parade-video .sh-gift-parade-people{position:absolute;z-index:2;'+
      'left:12px;right:12px;bottom:calc(86px + env(safe-area-inset-bottom,0px));'+
      'gap:10px;margin:0}',
      '.sh-gift-parade-video .sh-gift-avatar{width:48px;height:48px}',
      '.sh-gift-parade-video .sh-gift-parade-caption{position:absolute;z-index:2;'+
      'bottom:calc(28px + env(safe-area-inset-bottom,0px));left:12px;right:12px;'+
      'margin:0;font-size:clamp(11px,3vw,15px);text-shadow:0 2px 8px #080419}',
      '.sh-gift-sound{position:absolute;right:12px;top:calc(16px + env(safe-area-inset-top,0px));'+
      'z-index:3;border:1px solid #ffe2a0;border-radius:14px;padding:8px 12px;'+
      'background:#301a49;color:#fff;font-size:13px;pointer-events:auto}',
      '.sh-gift-parade-video .sh-gift-sound{top:calc(64px + env(safe-area-inset-top,0px))}',
      '@media(max-width:350px){.sh-gift-parade-people{grid-template-columns:minmax(0,1fr) 48px minmax(0,1fr)}',
      '.sh-gift-parade{padding:8px 7px}.sh-gift-avatar{width:35px;height:35px}}',
      '@media(prefers-reduced-motion:reduce){.sh-gift-parade{animation:none}'+
      '.sh-gift-parade-video video{animation:none}}'
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
          ' · 🪙 '+formatCompactCoins(giftEventValue(item));
        box.append(heading,people,caption);
        const animation=verifiedMediaUrl(item.animation_url);
        const soundtrack=verifiedMediaUrl(item.audio_url);
        if(isVideoMedia(animation)){
          box.classList.add('sh-gift-parade-video');
          const video=doc.createElement('video');
          video.src=animation;video.autoplay=true;video.playsInline=true;
          video.setAttribute('playsinline','');
          video.setAttribute('webkit-playsinline','true');
          video.preload='auto';video.loop=true;
          // The signed staging WebView permits media playback without a gesture.
          // Play a gift's own AAC track when no separate soundtrack is supplied.
          // If this device denies audible autoplay, retry muted and leave the
          // explicit Sound button so the animation still appears.
          video.muted=!!soundtrack;
          box.insertBefore(video,people);
          const audio=soundtrack?doc.createElement('audio'):null;
          if(audio){audio.src=soundtrack;audio.preload='auto';box.appendChild(audio);}
          const unmute=doc.createElement('button');
          unmute.type='button';unmute.className='sh-gift-sound';unmute.textContent='🔊 Sound';
          unmute.setAttribute('aria-label','Play gift sound');
          unmute.onclick=()=>{
            if(audio){
              audio.currentTime=0;
              audio.play().then(()=>unmute.remove()).catch(()=>{});
            }else{
              video.muted=false;
              video.play().then(()=>unmute.remove()).catch(()=>{video.muted=true;});
            }
          };
          box.appendChild(unmute);
        }
      }else{
        box.className='sh-gift-live';
        box.textContent='🎁 '+giftEventText(item);
        box.setAttribute('role','status');
      }
      // Attach media BEFORE calling play(). Starting detached video/audio
      // silently fails on several Android WebView versions.
      doc.body.appendChild(box);
      const video=box.querySelector('video');
      const finishAfter=ms=>frame.setTimeout(()=>{
        box.querySelectorAll('video,audio').forEach(media=>media.pause());
        box.remove();next();
      },ms);
      if(video){
        let began=false,loadTimer=null;
        const fallback=()=>{
          if(began||!box.isConnected)return;
          began=true;
          frame.clearTimeout(loadTimer);
          video.pause();video.remove();
          box.querySelector('audio')?.pause();
          box.querySelector('.sh-gift-sound')?.remove();
          box.classList.remove('sh-gift-parade-video');
          // Never make a paid gift disappear if its MP4 or network fails.
          // Keep the verified sender/recipient/gift banner visible.
          console.warn('Gift video could not play; showing verified gift banner');
          finishAfter(4700);
        };
        const started=()=>{
          if(began||!box.isConnected)return;
          began=true;frame.clearTimeout(loadTimer);
          box.classList.add('sh-gift-video-playing');
          const audio=box.querySelector('audio');
          const button=box.querySelector('.sh-gift-sound');
          if(audio)audio.play().then(()=>button?.remove()).catch(()=>{});
          else if(!video.muted)button?.remove();
          // Ten seconds starts with the first PLAYING frame, not request time.
          finishAfter(10000);
        };
        video.addEventListener('playing',started,{once:true});
        video.addEventListener('error',fallback,{once:true});
        loadTimer=frame.setTimeout(fallback,12000);
        video.play().catch(()=>{
          video.muted=true;
          video.play().catch(fallback);
        });
      }else finishAfter(featured?10000:4700);
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
      row.querySelector('.sh-svip-badge')?.remove();
      row.querySelector('.sh-room-admin-tag')?.remove();
      if(item.room_role==='admin'||item.room_role==='owner'){
        const roleBadge=doc.createElement('span');
        roleBadge.className='sh-room-admin-tag';
        roleBadge.textContent=item.room_role==='owner'?'👑 OWNER':'🛡 ADMIN';
        roleBadge.style.cssText='display:inline-flex;align-items:center;max-width:100px;'+
          'border-radius:10px;border:1px solid #f9cf72;padding:2px 7px;'+
          'background:linear-gradient(100deg,#522a18,#b47622);color:#fff0b8;'+
          'font-size:10px;font-weight:800;white-space:nowrap';
        row.appendChild(roleBadge);
      }
      const level=svipLevel(item.svip_level);
      if(level)row.appendChild(makeSvipBadge(doc,level));
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
      el.querySelectorAll('.sh-sovera-seat-tag,.sh-neon-seat-id,.sh-svip-seat-badge,.sh-room-admin-badge,.sh-verified-seat-id')
        .forEach(decoration=>decoration.remove());
      // Always show the currently visible member ID beneath its name.
      // A special ID replaces (never accompanies) the permanent account ID.
      const visibleSeatId=frame.sid?.(seat);
      if(visibleSeatId){
        const id=doc.createElement('small');
        id.className='sh-verified-seat-id';
        id.textContent='ID '+visibleSeatId;
        el.appendChild(id);
      }
      // Room Admin power is shown in the management menu, never as a
      // shield drawn across a user's purchased or animated avatar frame.
      if(seat.room_role==='owner'){
        const roomBadge=doc.createElement('span');
        roomBadge.className='sh-room-admin-badge';
        roomBadge.textContent='👑';
        roomBadge.title='Room Owner';
        roomBadge.setAttribute('aria-label',roomBadge.title);
        roomBadge.style.cssText='position:absolute;right:-6px;top:-8px;z-index:18;'+
          'display:grid;place-items:center;width:23px;height:23px;border-radius:50%;'+
          'background:linear-gradient(140deg,#ffe4a1,#c78c27);border:1px solid #fff1c7;'+
          'box-shadow:0 2px 10px #3d160b;color:#2d1932;font-size:12px';
        avatar.style.position='relative';
        avatar.appendChild(roomBadge);
      }
      const svip=svipLevel(seat.svip_level);
      // VIP/SVIP status belongs beside the avatar frame; IDs are profile-only.
      if(svip)avatar.appendChild(makeSvipBadge(doc,svip,'sh-svip-seat-badge'));
      const item=frameArt(seat.frame_style);
      const medal=medalArt(seat.medal_style);
      const nameTag=nameTagArt(seat.name_tag_style);
      avatar.classList.toggle('sh-has-sovera-frame',!!item);
      if(!item&&!medal&&!nameTag)continue;
      avatar.style.position='relative';
      if(item){
        const decoration=doc.createElement('i');
        decoration.className='fxr sh-sovera-frame'+(item.group==='svip'?' sh-svip-frame':'');
        decoration.setAttribute('aria-hidden','true');
        decoration.style.backgroundImage='url('+cosmeticMedia(item)+')';
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
        const existing=list.find(x=>x.id===alias);
        const art=existing||list.find(x=>x.id===item.art_key);
        if(!art)continue;
        const media={remote_image_url:verifiedMediaUrl(item.image_url),
          remote_animation_url:verifiedMediaUrl(item.animation_url),
          remote_audio_url:verifiedMediaUrl(item.audio_url)};
        if(existing)Object.assign(existing,media);
        else list.push({...art,id:alias,name:item.name,...media});
      }
      return items;
    })();
    cosmeticCataloguePromise=work;
    try{return await work;}finally{cosmeticCataloguePromise=null;}
  }
  async function styleSelectionSheet(kind,gallery='all'){
    if(!session){window.showAuth('welcome');return;}
    cosmeticCss(document);
    const isEntry=kind==='entry_style';
    const isMedal=kind==='medal_style';
    const isTag=kind==='name_tag_style';
    const collection=gallery==='svip'?'SVIP Animated':
      gallery==='noble'?'Noble':gallery==='role'?'Royal Staff': 'Sharika & Sovera';
    const title=isEntry?'✨ '+collection+' Entry':
      isMedal?'🏅 '+collection+' Medals':
      isTag?'🎖️ '+collection+' Name Tags':'🖼️ '+collection+' Avatar Frames';
    const catalog=isEntry?SOVERA_ENTRIES:isMedal?SOVERA_MEDALS:isTag?SOVERA_TAGS:SOVERA_FRAMES;
    window.openSheet('<h3>'+title+'</h3><div id="sh-sovera-tabs"></div>'+
      '<div id="sh-sovera-list" class="sh-sovera-grid"></div>'+
      '<p style="font-size:12px;color:#c9bbed">Coins are charged only when buying. Owned or Super Admin-granted items can be equipped free. Preview is not ownership.</p>');
    const node=document.getElementById('sh-sovera-list');
    if(!node)return;
    const tabs=document.getElementById('sh-sovera-tabs');
    tabs.style.cssText='display:flex;gap:5px;margin:10px 0;flex-wrap:wrap';
    for(const option of [
      ['frame_style','Frames','all'],['entry_style','Entry','all'],
      ['medal_style','Medals','all'],['name_tag_style','Name Tags','all'],
      ['frame_style','Noble','noble'],
      ['frame_style','Royal Staff','role']
    ]){
      const tab=document.createElement('button');
      tab.type='button';tab.className='act';tab.textContent=option[1];
      tab.style.cssText='flex:1;padding:8px 6px;min-width:60px;font-size:12px;border-radius:10px;'+
        (option[0]===kind&&option[2]===gallery?'background:#6a40b7;color:#fff':
          'background:#2c2357;color:#fff');
      tab.onclick=()=>styleSelectionSheet(option[0],option[2]);
      tabs.appendChild(tab);
    }
    const current=profile?.[kind]||'';
    let records;
    try{
      records=(await loadVerifiedCosmetics()).filter(x=>{
        if(x.kind!==kind)return false;
        if(/^svip-(frame|medal|tag|entry)-[0-9]{2}$/.test(String(x.art_key||''))&&
           !x.owned)return false;
        if(gallery==='all')return true;
        const key=x.id.slice(kind.length+1);
        const art=catalog.find(item=>item.id===key)||
          catalog.find(item=>item.id===x.art_key);
        return art?.group===gallery;
      });
    }
    catch(error){
      if(gallery==='all'){
        node.textContent='Cosmetic shop unavailable: '+errText(error);return;
      }
      // Bundled preview artwork is safe to show offline, but does not imply
      // ownership or permit a client-side equipment/purchase shortcut.
      records=[];
      const warning=document.createElement('p');
      warning.className='lbl';
      warning.textContent='Gallery preview only. Verified catalogue pending: '+errText(error);
      node.insertAdjacentElement('beforebegin',warning);
    }
    if(!node.isConnected)return;
    const serverArts=new Set(records.map(row=>row.art_key));
    const serverIds=new Set(records.map(row=>row.id.slice(kind.length+1)));
    const previews=gallery==='all'?[]:catalog.filter(item=>
      item.source==='sharika'&&item.group===gallery&&
      !serverArts.has(item.id)&&!serverIds.has(item.id)
    ).map(item=>({...item,previewOnly:true,owned:false,active:false}));
    const choices=[{id:'',name:'None',art:'',owned:true},...records.map(row=>{
      const key=row.id.slice(kind.length+1);
      const art=catalog.find(x=>x.id===key)||catalog.find(x=>x.id===row.art_key);
      return {...art,id:key,item_id:row.id,name:row.name,owned:row.owned,
        active:row.active,price_coins:row.price_coins};
    }),...previews];
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
          ring.style.backgroundImage='url('+cosmeticMedia(item)+')';
          preview.appendChild(ring);
        }
        button.appendChild(preview);
      }
      const label=document.createElement('span');
      label.textContent=item.name;
      button.appendChild(label);
      const price=document.createElement('span');
      price.textContent=item.previewOnly?'Preview only · Admin rollout pending':
        item.owned?'✓ Owned':OFFICIAL_ROLE_FRAMES.has(item.item_id)?
        '🔒 Official role · Admin grant only':item.active?
        '🪙 '+formatCompactCoins(item.price_coins):'Unavailable';
      button.appendChild(price);
      button.disabled=!!item.previewOnly||!!item.item_id&&!item.owned&&!item.active;
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
  // Royal marketplace. Every price, ownership flag and equipped state comes
  // from the verified Worker; the UI never creates inventory on its own.
  const ROYAL_CATEGORIES=[
    {key:'car',label:'Cars',icon:'🏎️'},
    {key:'frame_style',label:'Photo Frames',icon:'🖼️'},
    {key:'entry_style',label:'Entrance',icon:'✨'},
    {key:'ring',label:'Rings',icon:'💞'},
    {key:'name_tag_style',label:'Name Plates',icon:'🏷️'},
    {key:'special_id',label:'Special IDs',icon:'👑'},
    {key:'profile_bg',label:'Profile Background',icon:'🏰'},
    {key:'bubble',label:'Chat Bubbles',icon:'💬'},
    {key:'track',label:'Tracks',icon:'🎼'},
    {key:'medal_style',label:'Medals',icon:'🏅'},
    {key:'event_title',label:'Event Titles',icon:'🌟'}
  ];
  const ROYAL_KINDS=new Set(['frame_style','entry_style','medal_style','name_tag_style']);
  const OFFICIAL_ROLE_FRAMES=new Set([
    'frame_style:cs-royal-wings','frame_style:coin-seller-royal'
  ]);
  let royalMarket=null,royalMarketRequest=0,royalMarketBusy=false;
  function marketEl(tag,className,textValue){
    const element=document.createElement(tag);
    if(className)element.className=className;
    if(textValue!==undefined)element.textContent=String(textValue);
    return element;
  }
  function royalMarketStyle(){
    if(document.getElementById('sh-royal-market-css'))return;
    const stylesheet=document.createElement('link');
    stylesheet.id='sh-royal-market-css';
    stylesheet.rel='stylesheet';
    stylesheet.href='./royal-market.css';
    document.head.appendChild(stylesheet);
  }
  function closeRoyalMarket(){
    royalMarketRequest++;
    if(royalMarket?.root){
      royalMarket.root.hidden=true;
      royalMarket.root.setAttribute('aria-hidden','true');
    }
    royalMarket=null;
  }
  window.sharikaCloseRoyalMarket=closeRoyalMarket;
  function marketCategoryArt(row){
    const key=String(row.id||'').slice(String(row.kind||'').length+1);
    const sources={frame_style:SOVERA_FRAMES,entry_style:SOVERA_ENTRIES,
      medal_style:SOVERA_MEDALS,name_tag_style:SOVERA_TAGS};
    const art=sources[row.kind]?.find(x=>x.id===key)||
      sources[row.kind]?.find(x=>x.id===row.art_key);
    return art||null;
  }
  function marketUpdateLocalProfile(saved){
    profile=saved;
    if(!window.A)return;
    window.A.frame=saved.frame_style||'';
    window.A.entry=saved.entry_style||'';
    window.A.cosmeticMedal=saved.medal_style||'';
    window.A.cosmeticTag=saved.name_tag_style||'';
    window.A.frameImg=null;
    if(typeof window.saveA==='function')window.saveA();
    if(typeof window.renderMe==='function')window.renderMe();
  }
  function marketRender(){
    const state=royalMarket;
    if(!state||state.root.hidden)return;
    state.root.dataset.mode=state.mode;
    state.root.querySelector('.sh-rm-title').textContent=state.mode==='shop'?'✦ Sharika Shop ✦':'✦ My Backpack ✦';
    state.root.querySelector('.sh-rm-coin').textContent='🪙 '+formatCompactCoins(balance.coins);
    for(const tab of state.root.querySelectorAll('.sh-rm-tab'))
      tab.setAttribute('aria-selected',String(tab.dataset.mode===state.mode));
    const ownedCount=state.items.filter(x=>x.owned).length;
    state.root.querySelector('.sh-rm-summary').textContent=state.mode==='shop'?
      'Premium collection · Official items only':
      'My collection · '+ownedCount+' owned item'+(ownedCount===1?'':'s');
    const categories=state.root.querySelector('.sh-rm-cats');
    const categoryScroll=categories.scrollTop;
    categories.replaceChildren();
    for(const category of ROYAL_CATEGORIES){
      const btn=marketEl('button','sh-rm-cat');
      btn.type='button';btn.dataset.category=category.key;
      btn.setAttribute('aria-current',String(category.key===state.category));
      btn.append(marketEl('span','sh-rm-cat-icon',category.icon),
        marketEl('span','',category.label));
      btn.addEventListener('click',()=>{
        if(royalMarketBusy)return;
        state.category=category.key;
        marketRender();
      });
      categories.appendChild(btn);
    }
    categories.scrollTop=categoryScroll;
    const content=state.root.querySelector('.sh-rm-content');
    content.replaceChildren();
    const category=ROYAL_CATEGORIES.find(x=>x.key===state.category)||ROYAL_CATEGORIES[1];
    content.appendChild(marketEl('div','sh-rm-section',category.icon+' '+category.label));
    if(state.loading){content.appendChild(marketEl('p','sh-rm-loading','Loading verified collection…'));return;}
    if(state.error){
      const message=marketEl('div','sh-rm-empty');
      message.append(marketEl('div','sh-rm-empty-icon','⚠️'),
        marketEl('strong','','Collection unavailable'),marketEl('p','',state.error));
      const retry=marketEl('button','sh-rm-btn','Retry');
      retry.onclick=()=>marketReload();message.appendChild(retry);content.appendChild(message);
      return;
    }
    const found=state.items.filter(x=>x.kind===state.category&&
      (state.mode==='backpack'||
        !/^svip-(frame|medal|tag|entry)-[0-9]{2}$/.test(String(x.art_key||'')))&&
      (state.mode==='shop'?x.active||x.owned||OFFICIAL_ROLE_FRAMES.has(x.id):x.owned));
    if(!found.length){
      const message=marketEl('div','sh-rm-empty');
      message.append(marketEl('div','sh-rm-empty-icon',state.mode==='shop'?'✨':'🎒'),
        marketEl('strong','',state.mode==='shop'?'Official items coming soon':'Your backpack is empty'),
        marketEl('p','',state.mode==='shop'?
          'This category will appear when official items are added by the admin.':
          'Purchased and admin-awarded items will appear here automatically.'));
      if(state.mode==='backpack'){
        const shop=marketEl('button','sh-rm-btn','Explore Shop');
        shop.onclick=()=>{state.mode='shop';marketRender();};message.appendChild(shop);
      }
      content.appendChild(message);return;
    }
    const grid=marketEl('div','sh-rm-grid');
    content.appendChild(grid);
    for(const item of found){
      const card=marketEl('article','sh-rm-card');
      const preview=marketEl('div','sh-rm-preview');
      const art=marketCategoryArt(item);
      if(item.kind==='frame_style'){
        const holder=marketEl('div','sh-rm-frame-icon','👤');
        if(art?.art){const picture=marketEl('img');picture.src=cosmeticMedia(art);
          picture.alt='';picture.loading='lazy';holder.appendChild(picture);}
        preview.appendChild(holder);
      }else if(art?.art){
        const picture=marketEl('img');picture.src=cosmeticMedia({...art,art:art.still||art.art});
        picture.alt=item.name;picture.loading='lazy';preview.appendChild(picture);
      }else preview.appendChild(marketEl('span','','👑'));
      if(item.owned)preview.appendChild(marketEl('span','sh-rm-owned',item.equipped?'✓ In use':'✓ Owned'));
      const label=marketEl('div','sh-rm-name',item.name);
      const expires=item.expires_at_ms?
        ' · until '+new Date(Number(item.expires_at_ms)).toLocaleDateString('en-GB'):'';
      const officialOnly=OFFICIAL_ROLE_FRAMES.has(item.id);
      const price=marketEl('div','sh-rm-price',item.owned?
        (item.equipped?'✓ Equipped':'✓ In backpack')+expires:
        officialOnly?'🔒 Official role · Admin grant only':
        '🪙 '+formatCompactCoins(item.price_coins));
      const ops=marketEl('div','sh-rm-ops');
      const primary=marketEl('button','sh-rm-btn');
      primary.type='button';
      if(state.mode==='shop'){
        primary.textContent=item.owned?'Use':officialOnly?'Admin only':'Purchase';
        primary.onclick=()=>item.owned?marketEquip(item,false):
          officialOnly?undefined:marketPurchase(item);
      }else{
        primary.textContent=item.equipped?'Take Off':'Use';
        primary.onclick=()=>marketEquip(item,!!item.equipped);
      }
      primary.disabled=royalMarketBusy||!!item.equipped&&state.mode==='shop'||
        (officialOnly&&!item.owned);
      ops.appendChild(primary);
      if(item.kind==='entry_style'&&art){
        const previewBtn=marketEl('button','sh-rm-btn sh-rm-btn-secondary','▶');
        previewBtn.title='Preview entrance';previewBtn.setAttribute('aria-label','Preview '+item.name);
        previewBtn.onclick=()=>playSoveraEntry(document,art.id);
        ops.appendChild(previewBtn);
      }
      card.append(preview,label,price,ops);grid.appendChild(card);
    }
    content.appendChild(marketEl('div','sh-rm-info',
      'Purchases use your verified coin wallet. Only owned official items can be worn.'));
  }
  async function marketReload(){
    const state=royalMarket;
    if(!state||!session)return;
    const request=++royalMarketRequest,account=session.user?.id;
    state.loading=true;state.error='';marketRender();
    try{
      const items=await loadVerifiedCosmetics();
      if(request!==royalMarketRequest||session?.user?.id!==account||royalMarket!==state)return;
      state.items=items;state.loading=false;marketRender();
    }catch(error){
      if(request!==royalMarketRequest||royalMarket!==state)return;
      state.loading=false;state.error=errText(error);marketRender();
    }
  }
  async function marketPurchase(item){
    if(royalMarketBusy||!session||!item.active||item.owned)return;
    const price=Number(item.price_coins||0);
    if(!Number.isSafeInteger(price)||price<=0)return;
    if(!window.confirm('Purchase '+item.name+' for '+price.toLocaleString('en-US')+
      ' coins? This will debit your verified wallet.'))return;
    const account=session.user?.id;
    royalMarketBusy=true;marketRender();
    let purchase;
    try{
      purchase=await api('POST','/cosmetics/purchase',{
        item_id:item.id,request_id:'cosmetic:'+Date.now().toString(36)+':'+
          Math.random().toString(36).slice(2,12)
      });
    }catch(error){toast('Purchase failed: '+errText(error));}
    if(purchase&&session?.user?.id===account){
      await refreshWalletAfterConfirmedTransaction({coins:Number(purchase.coins)});
      toast(item.name+' added to your backpack ✓');
    }
    royalMarketBusy=false;
    if(royalMarket&&session?.user?.id===account)await marketReload();
  }
  async function marketEquip(item,takeOff){
    if(royalMarketBusy||!session||!item.owned||!ROYAL_KINDS.has(item.kind))return;
    const account=session.user?.id;
    royalMarketBusy=true;marketRender();
    try{
      await api('POST','/cosmetics/equip',{kind:item.kind,item_id:takeOff?'':item.id});
      const saved=await api('GET','/me');
      if(session?.user?.id!==account)return;
      const expected=takeOff?'':item.id.slice(item.kind.length+1);
      if((saved[item.kind]||'')!==expected)throw new Error('Equip status not confirmed');
      marketUpdateLocalProfile(saved);
      toast(takeOff?'Item removed ✓':item.name+' equipped ✓');
    }catch(error){toast('Could not update item: '+errText(error));}
    finally{
      royalMarketBusy=false;
      if(royalMarket&&session?.user?.id===account)await marketReload();
    }
  }
  function openRoyalMarket(mode='shop',category='frame_style'){
    if(!session){window.showAuth('welcome');return;}
    royalMarketStyle();
    let root=document.getElementById('sh-royal-market');
    if(!root){
      root=marketEl('section');root.id='sh-royal-market';
      root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
      root.setAttribute('aria-label','Sharika Shop and My Backpack');
      const top=marketEl('header','sh-rm-top');
      const head=marketEl('div','sh-rm-head');
      const back=marketEl('button','sh-rm-back','‹');back.type='button';
      back.setAttribute('aria-label','Close Shop');back.onclick=closeRoyalMarket;
      head.append(back,marketEl('div','sh-rm-title'),marketEl('span','sh-rm-coin'));
      const switcher=marketEl('nav','sh-rm-switch');
      for(const [key,title] of [['shop','👑 Shop'],['backpack','🎒 My Backpack']]){
        const tab=marketEl('button','sh-rm-tab',title);tab.type='button';
        tab.dataset.mode=key;tab.onclick=()=>{
          if(royalMarketBusy||!royalMarket)return;
          royalMarket.mode=key;marketRender();
        };
        switcher.appendChild(tab);
      }
      top.append(head,switcher);
      const body=marketEl('div','sh-rm-body');
      body.append(marketEl('aside','sh-rm-cats'),marketEl('main','sh-rm-content'));
      root.append(top,marketEl('div','sh-rm-summary'),body);
      document.body.appendChild(root);
    }
    root.hidden=false;root.setAttribute('aria-hidden','false');
    royalMarket={root,mode:mode==='backpack'?'backpack':'shop',
      category:ROYAL_CATEGORIES.some(x=>x.key===category)?category:'frame_style',
      loading:true,error:'',items:[]};
    marketRender();marketReload();
  }
  window.sharikaOpenRoyalMarket=openRoyalMarket;
  // The champagne-gold Home has three shortcuts only. Keep the full royal
  // market available through its other app/profile entry points.
  function mountRoyalMarketShortcuts(){
    document.getElementById('sh-royal-home-shortcuts')?.remove();
  }
  royalMarketStyle();
  mountRoyalMarketShortcuts();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountRoyalMarketShortcuts,{once:true});
  // The old HTML creates random "Manager" badges locally. Never represent those
  // as real ranks in staging. Only verified server cosmetics are displayed.
  window.ownedMedals=function(){return [];};
  function renderVerifiedIdentity(){
    const anchor=document.querySelector('#v-me .mid');
    if(!anchor)return;
    const displayId=String(profile?.special_id||profile?.display_id||profile?.public_id||'');
    if(/^[0-9]{1,10}$/.test(displayId))anchor.textContent='ID '+displayId;
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
    document.querySelectorAll('#v-me .sh-layout-ornament').forEach(node=>node.remove());
    document.getElementById('sh-neon-own-id')?.remove();
    document.getElementById('sh-copy-own-id')?.remove();
    if(/^[0-9]{1,10}$/.test(displayId)){
      const copy=document.createElement('button');
      copy.id='sh-copy-own-id';copy.type='button';
      copy.className='sh-copy-own-id';copy.textContent='▢';
      copy.title='Copy my visible ID';copy.setAttribute('aria-label','Copy visible ID');
      copy.onclick=async()=>{
        try{await navigator.clipboard.writeText(displayId);toast('ID copied ✓');}
        catch(_error){toast('Your ID: '+displayId);}
      };
      anchor.insertAdjacentElement('afterend',copy);
    }
    anchor.classList.toggle('sh-neon-single-id',!!profile?.special_id);
    // Display only the chosen special number. The canonical ID stays on the
    // server for secure lookups but must not appear twice on this screen.
    const medal=medalArt(profile?.medal_style);
    const tag=nameTagArt(profile?.name_tag_style);
    for(const [kind,item] of [['medal',medal],['tag',tag]]){
      if(!item)continue;
      const holder=document.createElement('div');
      holder.className='sh-layout-ornament';
      holder.dataset.shLayoutOrnament=kind;
      const image=document.createElement('img');
      image.src=cosmeticMedia(item);
      image.alt=item.name+' (decoration only)';
      image.title=item.name+' · decorative';
      holder.appendChild(image);
      anchor.closest('.profile-hero')?.appendChild(holder);
    }
    applyProfileLayout('main',document.getElementById('v-me'));
  }
  async function showVerifiedFollowList(kind){
    if(!session){window.showAuth('welcome');return;}
    const title=kind==='followers'?'My Followers':'Following';
    window.openSheet('<h3>'+title+'</h3><div id="sh-profile-follow-list" '+
      'aria-live="polite">Loading real accounts…</div>');
    const list=document.getElementById('sh-profile-follow-list');
    try{
      const result=await api('GET','/follows');
      if(!list?.isConnected)return;
      const people=Array.isArray(result[kind])?result[kind]:[];
      list.replaceChildren();
      if(!people.length){
        list.textContent=kind==='followers'?'No followers yet.':'Not following anyone yet.';
        return;
      }
      for(const person of people){
        const canonical=String(person.public_id||'');
        if(!/^[0-9]{8}$/.test(canonical))continue;
        const display=String(person.display_id||person.special_id||canonical);
        const button=document.createElement('button');
        button.type='button';button.className='row sh-profile-follow-person';
        button.style.cssText='display:flex;width:100%;align-items:center;gap:12px;'+
          'text-align:left;cursor:pointer;padding:11px';
        const avatar=document.createElement('span');
        avatar.style.cssText='display:grid;place-items:center;width:42px;height:42px;'+
          'flex:none;border-radius:50%;background:#53226c;background-size:cover;'+
          'background-position:center;color:#ffdda1';
        const picture=verifiedAvatarUrl(person.pic);
        if(picture)avatar.style.backgroundImage='url("'+picture+'")';
        else avatar.textContent='👤';
        const label=document.createElement('span');label.style.minWidth='0';
        const name=document.createElement('strong');name.textContent=person.name||'Sharika Member';
        name.style.display='block';
        const id=document.createElement('small');id.textContent='ID '+display;
        id.style.display='block';id.style.color='#e3c7f2';
        label.append(name,id);button.append(avatar,label);
        button.onclick=()=>{
          window.closeSheet?.();
          openVerifiedRankProfile(canonical);
        };
        list.appendChild(button);
      }
    }catch(error){
      if(list?.isConnected)list.textContent='Unable to load accounts: '+errText(error);
    }
  }
  document.addEventListener('click',event=>{
    const trigger=event.target.closest?.('#v-me [data-profile-follow]');
    if(!trigger)return;
    event.preventDefault();event.stopImmediatePropagation();
    showVerifiedFollowList(trigger.dataset.profileFollow);
  },true);
  // Premium membership is independent of Wealth/Charm levels. Automatic
  // eligibility and daily credits are computed by the verified D1 Worker.
  let premiumProfileRequest=0;
  async function mountPremiumProfileEntry(){
    const button=document.querySelector('#v-me .profile-svip-badge');
    const requestNo=++premiumProfileRequest;
    if(!button||!session)return;
    const who=session.user.id;
    try{
      const data=await api('GET','/premium');
      if(!button.isConnected||requestNo!==premiumProfileRequest||session?.user?.id!==who)return;
      const tier=String(data.status?.tier||'none').toUpperCase();
      const level=tier==='SVIP'?svipLevel(data.status?.svip_level):0;
      button.classList.toggle('sh-svip-badge',!!level);
      if(level)button.dataset.svipLevel=String(level);
      else delete button.dataset.svipLevel;
      button.textContent=level?'SVIP '+level:tier==='NONE'?'SVIP Royal':tier+' Member';
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
    const format=n=>formatCompactCoins(n);
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
        const svipBase=item.tier==='svip'?(cfg.svip_levels||[])[0]:null;
        const shownPrice=svipBase?.price_coins??item.price_coins;
        const shownBonus=item.tier==='svip'&&active?status.daily_bonus_coins:
          svipBase?.daily_bonus_coins??item.daily_bonus_coins;
        return '<div style="border:1px solid '+(active?'#f6d678':'#896cad')+';border-radius:18px;'+
          'background:linear-gradient(155deg,#493477,#211b4b);padding:12px">'+
          '<b>'+labels[item.tier]+'</b>'+(active?' <small>✓ Current</small>':'')+
          '<div class="lbl">Level '+format(item.min_wealth_level)+' or sent gifts '+
          format(item.min_gift_coins)+' · Daily '+format(shownBonus)+' coins</div>'+
          '<div class="lbl">'+format(shownPrice)+' coins / '+(svipBase?30:item.duration_days)+' days'+
          (svipBase?' (SVIP 1 starting price)':'')+'</div>'+
          (cfg.policy?.purchase_enabled&&Number(status.rank||0)<=item.rank?
            '<button class="send" type="button" data-sh-premium-buy="'+item.tier+'">'+
              (item.tier==='svip'?'Explore SVIP 1–8':(active?'Extend ':'Buy ')+item.tier.toUpperCase())+
              '</button>':'')+'</div>';
      }).join('')+'</div>'+
      '<div style="margin-top:13px;padding:12px;border:1px solid #e8c178;'+
        'border-radius:17px;background:linear-gradient(155deg,#57367b,#201746)">'+
        '<b>✨ SVIP Animated Frames & Medals</b>'+
        '<div class="lbl">Separate 3.6-second transparent animations. '+
        'You can preview every item; equip only if owned or granted by Admin.</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">'+
          '<button class="send" type="button" data-sh-premium-gallery="svip:frame_style">🖼️ SVIP Frames</button>'+
          '<button class="send" type="button" data-sh-premium-gallery="svip:medal_style">🏅 SVIP Medals</button>'+
          '<button class="send" type="button" data-sh-premium-gallery="svip:name_tag_style">🎖️ SVIP Nameplates</button>'+
          '<button class="send" type="button" data-sh-premium-gallery="noble:frame_style">👑 Noble Frames</button>'+
        '</div></div>'+
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
    root.querySelectorAll('[data-sh-premium-gallery]').forEach(button=>{
      button.onclick=()=>{
        const [gallery,kind]=button.dataset.shPremiumGallery.split(':');
        styleSelectionSheet(kind,gallery).catch(error=>toast(errText(error)));
      };
    });
    root.querySelectorAll('[data-sh-premium-buy]').forEach(button=>{
      button.onclick=async()=>{
        const tier=button.dataset.shPremiumBuy;
        if(tier==='svip'){window.closeSheet?.();showSvipRoyalSheet().catch(error=>toast(errText(error)));return;}
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


  // Eight server-priced 30-day passes. All artwork is the user's real
  // animated level collection; no demo assets or client-side coin minting.
  let svipRoyalSelection=1;
  async function showSvipRoyalSheet(){
    if(!session){toast('Sign in to view SVIP');return;}
    document.getElementById('sh-svip-royal')?.remove();
    cosmeticCss(document);
    const panel=document.createElement('section');
    panel.id='sh-svip-royal';panel.setAttribute('role','dialog');
    panel.setAttribute('aria-label','SVIP Royal Membership');
    panel.innerHTML='<div class="svip-wrap"><div class="svip-top">'+
      '<button type="button" class="svip-back" aria-label="Back">‹</button>'+
      '<h2>SVIP ROYAL</h2><span>✦</span></div><p>Loading verified membership…</p></div>';
    document.body.appendChild(panel);
    const close=()=>panel.remove();
    panel.querySelector('.svip-back').onclick=close;
    let data;
    try{data=await api('GET','/premium');}
    catch(error){
      if(panel.isConnected)panel.querySelector('.svip-wrap').lastElementChild.textContent=
        'Unable to load SVIP: '+errText(error);
      return;
    }
    if(!panel.isConnected)return;
    const format=n=>formatCompactCoins(n);
    const realLevel=()=>data.status?.tier==='svip'?svipLevel(data.status.svip_level):0;
    svipRoyalSelection=realLevel()||svipRoyalSelection||1;
    let busy=false;
    function render(){
      if(!panel.isConnected)return;
      const status=data.status||{},cfg=data.config||{};
      const current=realLevel(),preview=svipLevel(svipRoyalSelection)||1;
      const choice=(cfg.svip_levels||[]).find(x=>x.level===preview);
      const svipTier=(cfg.tiers||[]).find(x=>x.tier==='svip');
      const canBuy=!!cfg.policy?.purchase_enabled&&!!choice?.enabled&&
        !!svipTier&&Number(status.rank||0)<=Number(svipTier.rank);
      const avatar=verifiedAvatarUrl(profile?.pic);
      const avatarMarkup=avatar?'<img class="photo" alt="" src="'+avatar+'">':
        '<span class="photo">👑</span>';
      const frame=svipArt(preview,'frame'),medal=svipArt(preview,'medal'),tag=svipArt(preview,'tag');
      const activeUntil=status.expires_at_ms?
        new Date(status.expires_at_ms).toLocaleDateString('en-GB'):'';
      const currentLabel=current?'ACTIVE · SVIP '+current+(activeUntil?' · Until '+activeUntil:''):
        'ROYAL MEMBERSHIP · Choose your level';
      const benefit=['Animated royal profile frame','SVIP medal & exclusive nameplate',
        'Royal voice room seat badge','Room entrance effect · about 4 seconds'];
      const price=choice?format(choice.price_coins):'—';
      const reward=choice?format(choice.daily_bonus_coins):'—';
      const activeReward=Number(status.daily_bonus_coins)||0;
      panel.innerHTML='<div class="svip-wrap">'+
        '<div class="svip-top"><button class="svip-back" type="button" aria-label="Close SVIP">‹</button>'+
        '<div class="svip-title"><small>SHARIKA EXCLUSIVE CLUB</small><h2>✦ SVIP ROYAL ✦</h2></div><span>♛</span></div>'+
        '<div class="svip-card"><span class="svip-card-top">ROYAL PREMIUM · 8 LEVELS</span>'+
        '<div class="svip-card-copy"><h3>SVIP '+(current||preview)+'</h3>'+
        '<p>'+sellerEscape(currentLabel)+'</p>'+
        '<span class="svip-card-chip">✧ 30 DAYS · ROYAL PASS ✧</span></div>'+
        '<div class="svip-card-avatar">'+avatarMarkup+
        '<img class="svip-ring" src="'+svipArt(current||preview,'frame')+'" alt=""></div></div>'+
        '<h3 class="svip-section-title">Choose your royal level</h3>'+
        '<div class="svip-level-tabs" role="group" aria-label="Choose SVIP level">'+
        Array.from({length:8},(_,i)=>'<button type="button" data-svip-preview="'+(i+1)+
          '" aria-pressed="'+(i+1===preview)+'">♛ '+(i+1)+'</button>').join('')+'</div>'+
        '<div class="svip-view">'+
        '<div class="svip-price-head"><div><small>ROYAL LEVEL '+preview+'</small>'+
        '<strong>SVIP '+preview+'</strong><span>30-day membership</span></div>'+
        '<div class="svip-price"><small>PASS PRICE</small><strong>🪙 '+price+'</strong></div></div>'+
        '<div class="svip-preview">'+
        '<div class="svip-preview-card"><small>PROFILE PREVIEW</small>'+
        '<div class="svip-mini-avatar">'+avatarMarkup+
        '<img class="ring" src="'+frame+'" alt=""><img class="medal" src="'+medal+'" alt=""></div>'+
        '<strong>'+sellerEscape(profile?.name||'Sharika User')+'</strong>'+
        '<span class="sh-svip-badge" data-svip-level="'+preview+'">SVIP '+preview+'</span></div>'+
        '<div class="svip-preview-card"><small>VOICE ROOM PREVIEW</small>'+
        '<div class="svip-mini-avatar">'+avatarMarkup+
        '<img class="ring" src="'+frame+'" alt=""><img class="medal" src="'+medal+'" alt=""></div>'+
        '<strong>Mic Seat · SVIP '+preview+'</strong><small>Visible to room members</small></div></div>'+
        '<div class="svip-art-row"><img src="'+tag+'" alt="Royal nameplate '+preview+'">'+
        '<img src="'+medal+'" alt="SVIP medal '+preview+'"></div>'+
        '<div class="svip-reward-card"><span>🎁 DAILY SVIP REWARD</span>'+
        '<strong>🪙 '+reward+' coins</strong><small>Claim once per UTC day while active</small></div>'+
        '<div class="svip-perks">'+benefit.map(x=>'<span>✦ '+x+'</span>').join('')+'</div>'+
        (canBuy?'<button class="svip-main-btn" id="sh-svip-buy" type="button">'+
          (current===preview?'Renew SVIP '+preview:'Unlock SVIP '+preview)+
          ' · '+price+' Coins / 30 Days</button>':
          '<p class="svip-note">'+(choice&&!choice.enabled?
            'This level is currently unavailable for purchase.':
            'Coin purchase is unavailable for this level or membership.')+'</p>')+
        (current&&activeReward>0?'<button class="svip-main-btn svip-reward-btn" id="sh-svip-daily" type="button" '+
          (status.claimed_today?'disabled':'')+'>'+
          (status.claimed_today?'Today’s coins claimed ✓':
            'Claim today’s '+format(activeReward)+' coins')+'</button>':'')+
        '<p class="svip-note">✓ Buying or receiving an SVIP pass adds its frame, entry effect, medal and tag '+
        'to My Backpack automatically. You can equip another owned frame whenever you like.</p>'+
        '<details class="svip-rules"><summary>SVIP policy & expiry</summary>'+
        '<p class="svip-note">SVIP coin purchases last 30 days. Buying the same level again extends its pass; '+
        'choosing a different level activates that level. Active assets and rewards are verified by the server. '+
        'All eight prices and daily bonuses are controlled by Super Admin.</p></details>'+
        '<p id="sh-svip-notice" role="status"></p></div></div>';
      panel.querySelector('.svip-back').onclick=close;
      panel.querySelectorAll('[data-svip-preview]').forEach(button=>{
        button.onclick=()=>{if(busy)return;svipRoyalSelection=Number(button.dataset.svipPreview);render();};
      });
      const note=panel.querySelector('#sh-svip-notice');
      const claim=panel.querySelector('#sh-svip-daily');
      if(claim)claim.onclick=async()=>{
        if(busy||claim.disabled)return;busy=true;claim.disabled=true;
        try{
          await api('POST','/premium/daily/claim',{});
          await refreshWalletAfterConfirmedTransaction();
          data=await api('GET','/premium');render();
          panel.querySelector('#sh-svip-notice').textContent='Daily coins received ✓';
        }catch(error){note.textContent='Reward not confirmed: '+errText(error);claim.disabled=false;}
        finally{busy=false;}
      };
      const buy=panel.querySelector('#sh-svip-buy');
      if(buy)buy.onclick=async()=>{
        if(busy||!choice||!canBuy||!window.confirm(
          'Buy SVIP '+preview+' for '+price+' coins / 30 days?'))return;
        busy=true;buy.disabled=true;
        const tier='svip',level=preview;
        const requestId=pendingPremiumPurchase?.tier===tier&&
          pendingPremiumPurchase?.level===level?
            pendingPremiumPurchase.requestId:nextWalletRequestId('premium');
        pendingPremiumPurchase={tier,level,requestId};
        try{
          await api('POST','/premium/purchase',{tier,svip_level:level,request_id:requestId});
          pendingPremiumPurchase=null;
          await refreshWalletAfterConfirmedTransaction();
          data=await api('GET','/premium');
          if(typeof window.renderMe==='function')window.renderMe();
          render();
          panel.querySelector('#sh-svip-notice').textContent=
            'SVIP '+level+' activated · Backpack items added ✓';
        }catch(error){note.textContent='Purchase not confirmed: '+errText(error);buy.disabled=false;}
        finally{busy=false;}
      };
    }
    render();
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
    '#v-me.profile-royal .profile-name-edit{display:inline-flex!important;align-items:center;gap:5px;',
    'vertical-align:middle;min-height:36px;padding:5px 12px!important;margin-left:5px;',
    'border:1px solid #e8c26e!important;border-radius:19px!important;',
    'background:#6c4b24!important;color:#fff2ba!important;font-size:15px!important;',
    'font-family:system-ui,sans-serif;font-weight:800;opacity:1!important;white-space:nowrap}',
    '#v-me .profile-name-edit span{font-size:12px;font-weight:800}',
    '#v-me.profile-royal .edp{display:inline-flex!important;align-items:center;justify-content:center;',
    'min-height:44px;min-width:155px;color:#fff1be!important;',
    'border:2px solid #f0c76a!important;background:#69411d!important;',
    'box-shadow:0 5px 14px #0007!important;font-size:14px!important}',
    '#shb.sharika-edit-page{display:flex;align-items:stretch;background:#100c1e!important;',
    'backdrop-filter:none}',
    '#shb.sharika-edit-page #sh{width:100%;max-height:none;height:100%;overflow-y:auto;',
    'border-radius:0;animation:none;padding:12px 18px calc(25px + env(safe-area-inset-bottom,0px));',
    'background:linear-gradient(165deg,#41275d,#1b1535 60%,#100c20)}',
    '#shb.sharika-edit-page .grab{display:none}',
    '#sh.sharika-profile-editor{background:linear-gradient(155deg,#413078,#241548 72%,#170c30);',
    'border-top:2px solid #a78bfa;box-shadow:0 -15px 40px #130b30b3;padding-top:17px}',
    '#sh.sharika-profile-editor .sh-edit-header{display:flex;align-items:center;gap:14px;',
    'padding:10px 0 17px;margin-bottom:15px;border-bottom:1px solid #ffffff35}',
    '#sh.sharika-profile-editor .sh-edit-back{width:42px;height:42px;border:1px solid #eacb86;',
    'border-radius:15px;color:#fff1bb;background:#4f336c;font-size:23px}',
    '#sh.sharika-profile-editor .sh-edit-header h2{margin:0;color:#ffe5a8;',
    'font-size:21px;line-height:1.3}',
    '#sh.sharika-profile-editor>h3{display:none}',
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
    document.getElementById('shb')?.classList.add('sharika-edit-page');
    const header=document.createElement('header');
    header.className='sh-edit-header';
    const back=document.createElement('button');
    back.type='button';back.className='sh-edit-back';
    back.setAttribute('aria-label','Back to profile');back.textContent='‹';
    back.onclick=()=>window.closeSheet();
    const title=document.createElement('h2');title.textContent='Edit Profile';
    header.append(back,title);sheet.prepend(header);
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
    document.getElementById('shb')?.classList.remove('sharika-edit-page');
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

  // Agency/BD/Host cards live under Account Features. Historical Family
  // records remain in D1 for the verified Agency membership relationship.
  const familyStyles=document.createElement('style');
  familyStyles.id='sh-family-royal-css';
  familyStyles.textContent=[
    '#sh-family-entries{margin:14px 12px 20px;display:grid;gap:10px}',
    '#sh-family-entries button{width:100%;display:flex;gap:14px;align-items:center;',
    'border:1px solid #f5d387;border-radius:20px;text-align:left;padding:14px;',
    'background:linear-gradient(145deg,#654113,#b98129 40%,#6b3c18 80%,#34220f);',
    'box-shadow:inset 0 2px 2px #ffecb988,0 5px 0 #35200f,0 9px 20px #09041499;',
    'color:#ffefc9;text-shadow:0 1px 2px #2b160a;font-weight:800}',
    '#sh-family-entries button .sh-fam-icon{font-size:31px;filter:drop-shadow(0 3px 3px #0008)}',
    '#sh-family-entries .sh-fam-icon{width:54px;height:54px;flex:none;display:grid;place-items:center}',
    '#sh-family-entries .sh-fam-icon img{width:100%;height:100%;object-fit:contain}',
    '#sh-family-panel .sh-fam-3d-icon{display:inline-block;width:26px;height:26px;',
    'object-fit:contain;vertical-align:middle;filter:drop-shadow(0 3px 4px #0008)}',
    '#sh-family-panel .sh-fam-kpi small{display:flex;align-items:center;gap:6px}',
    '#sh-family-panel .sh-fam-kpi .sh-fam-3d-icon{width:30px;height:30px;flex:none}',
    '#sh-family-panel .sh-fam-crest .sh-fam-3d-icon{width:74px;height:74px}',
    '@media(prefers-reduced-motion:no-preference){#sh-family-entries .sh-fam-icon img{',
    'animation:shAgencyIconFloat 3.6s ease-in-out infinite alternate}',
    '@keyframes shAgencyIconFloat{to{transform:translateY(-3px) rotate(-2deg)}}}',
    '#sh-family-entries button small{display:block;font-size:11px;opacity:.9;font-weight:500}',
    '#sh-family-entries button:active{transform:translateY(3px)}',
    '#sh-family-entries button[hidden]{display:none!important}',
    '#sh-family-panel{position:fixed;inset:0;z-index:2147483500;overflow:auto;',
    'background:radial-gradient(ellipse at 50% -20%,#9e6d2b 0%,#271b18 38%,#100c18 85%);',
    'color:#ffebc5;padding:calc(14px + env(safe-area-inset-top,0px)) 15px 24px}',
    '#sh-family-panel .sh-fam-wrap{max-width:620px;margin:auto}',
    '#sh-family-panel h2{font-size:23px;color:#ffe4a2;text-align:center;margin:8px 0 20px}',
    '#sh-family-panel h3{color:#f4d289;margin:3px 0 10px;font-size:17px}',
    '#sh-family-panel .sh-fam-card{border:1px solid #bd873f;border-radius:18px;',
    'background:linear-gradient(145deg,#3b2a2a,#241926);padding:15px;margin:12px 0;',
    'box-shadow:inset 0 1px 1px #fff3,0 8px 20px #0007}',
    '#sh-family-panel .sh-fam-stat{font-size:24px;font-weight:900;color:#ffe59e}',
    '#sh-family-panel .sh-fam-note{font-size:12px;opacity:.8;line-height:1.5}',
    '#sh-family-panel input,#sh-family-panel select{display:block;width:100%;padding:12px;border:1px solid #be8c47;',
    'border-radius:12px;background:#160f1c;color:white;margin:7px 0 11px;font-size:15px}',
    '#sh-family-panel details{margin-top:6px;padding:7px;border:1px solid #795c32;border-radius:10px}',
    '#sh-family-panel summary{color:#ffe09f;cursor:pointer;font-weight:700}',
    '#sh-family-panel .sh-fam-status{color:#ffd990;font-weight:700}',
    '#sh-family-panel button{border:1px solid #f1c777;border-radius:12px;padding:11px 15px;',
    'font-weight:800;background:linear-gradient(#fff0af,#c58c35);color:#38200c;margin:4px 5px 4px 0}',
    '#sh-family-panel button:disabled{opacity:.45}',
    '#sh-family-panel .sh-fam-head{display:flex;align-items:center;justify-content:space-between}',
    '#sh-family-panel .sh-fam-list{list-style:none;padding:0;margin:0}',
    '#sh-family-panel .sh-fam-list li{padding:8px 0;border-bottom:1px solid #fff2}',
    '#sh-family-panel .sh-fam-close{background:#241726;color:#ffe1a0}',
    '#sh-family-panel .sh-fam-feedback{min-height:18px;color:#ffd985;margin:8px 0}',
    '@media(prefers-reduced-motion:reduce){#sh-family-entries button{transition:none}}'
  ].join('');
  familyStyles.textContent += [
    '#sh-family-panel #sh-fam-body.sh-fam-dashboard{padding:0;border:0;',
    'background:none;box-shadow:none}',
    '#sh-family-panel .sh-fam-hero{position:relative;overflow:hidden;padding:25px 18px;',
    'border:2px solid #f6d388;border-radius:26px;text-align:center;',
    'background:radial-gradient(circle at 50% -10%,#d69e48,#613819 53%,#24131e);',
    'box-shadow:inset 0 3px 5px #fff8,inset 0 -8px 17px #10070caa,0 12px 28px #080308cc}',
    '#sh-family-panel .sh-fam-hero:before{content:"✦";position:absolute;left:10px;top:10px;',
    'font-size:35px;color:#ffeab2;opacity:.7}',
    '#sh-family-panel .sh-fam-crest{display:grid;place-items:center;width:78px;height:78px;',
    'margin:0 auto 8px;border:3px solid #ffeba8;border-radius:25px;',
    'background:linear-gradient(140deg,#ffe7a0,#a66d28 65%,#593215);',
    'box-shadow:0 5px 0 #73451b,0 11px 18px #14080b99;font-size:43px;',
    'transform:perspective(280px) rotateX(6deg)}',
    '#sh-family-panel .sh-fam-hero h3{font-size:25px;color:#fff0b6;margin:12px 0 5px}',
    '#sh-family-panel .sh-fam-hero small{font-size:12px;color:#f9dfab;letter-spacing:.06em}',
    '#sh-family-panel .sh-fam-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:13px 0}',
    '#sh-family-panel .sh-fam-kpi{padding:15px 12px;min-width:0;border:1px solid #dbad66;',
    'border-radius:18px;background:linear-gradient(150deg,#5a3b2a,#221825);',
    'box-shadow:inset 0 2px #fff2,0 5px 0 #160e17,0 9px 18px #0005}',
    '#sh-family-panel .sh-fam-kpi small{display:block;color:#edc994;font-size:11px}',
    '#sh-family-panel .sh-fam-kpi strong{display:block;font-size:21px;',
    'color:#ffe49d;overflow-wrap:anywhere;margin-top:3px}',
    '#sh-family-panel .sh-fam-section-title{display:flex;justify-content:space-between;',
    'gap:9px;align-items:center;margin:22px 3px 12px}',
    '#sh-family-panel .sh-fam-member-item{padding:9px 0;border-bottom:1px solid #b5874b55}',
    '#sh-family-panel .sh-fam-member-row{display:flex;align-items:center;',
    'gap:11px;width:100%;box-sizing:border-box;text-align:left;',
    'background:linear-gradient(140deg,#473025,#251b28);color:#fff0ca;',
    'box-shadow:inset 0 1px #fff3,0 4px 9px #0005;border-color:#a9824d}',
    '#sh-family-panel .sh-fam-member-number{width:36px;flex:none;color:#ffdf86;font-size:16px}',
    '#sh-family-panel .sh-fam-member-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}',
    '#sh-family-panel .sh-fam-member-name small{display:block;font-size:11px;',
    'font-weight:500;color:#eac99d;margin-top:3px}',
    '#sh-family-panel .sh-fam-member-arrow{font-size:25px;color:#ffdc87}',
    '#sh-family-panel .sh-fam-date-pills{display:flex;gap:7px;overflow:auto;padding:4px 0 10px}',
    '#sh-family-panel .sh-fam-date-pills button{white-space:nowrap;flex:none}',
    '#sh-family-panel .sh-fam-date-pills button[aria-pressed=true]{background:#3b2c35;color:#ffe3a2}',
    '#sh-family-panel .sh-fam-gift-row{display:flex;gap:12px;align-items:start;',
    'justify-content:space-between;padding:13px 2px;border-bottom:1px solid #f6d38833}',
    '#sh-family-panel .sh-fam-gift-row small{display:block;color:#d3b88f;margin-top:3px}',
    '#sh-family-panel .sh-agency-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:15px 0}',
    '#sh-family-panel .sh-agency-actions button{display:flex;align-items:center;justify-content:center;gap:6px;',
    'margin:0;font-size:12px;min-width:0;line-height:1.3}',
    '#sh-family-panel .sh-agency-report-row{padding:13px 10px;margin:9px 0;',
    'border:1px solid #a98050;border-radius:15px;background:linear-gradient(135deg,#513624,#231826)}',
    '#sh-family-panel .sh-agency-report-row b{display:block;color:#ffe0a0}',
    '#sh-family-panel .sh-agency-report-row small{display:block;line-height:1.7;color:#ebd3ac}',
    '#sh-family-panel .sh-agency-salary-note{border-left:4px solid #efb751;padding:11px 13px;',
    'background:#422e21;border-radius:8px;line-height:1.6;font-size:13px}',
    '@media(max-width:360px){#sh-family-panel .sh-fam-kpi strong{font-size:18px}',
    '#sh-family-panel .sh-fam-hero h3{font-size:21px}}',
    '@media(prefers-reduced-motion:no-preference){#sh-family-panel .sh-fam-crest{',
    'animation:shFamFloat 4s ease-in-out infinite alternate}',
    '@keyframes shFamFloat{to{transform:perspective(280px) rotateX(6deg) translateY(-4px)}}}'
  ].join('');
  document.head.appendChild(familyStyles);
  const famEsc=x=>String(x==null?'':x).replace(/[&<>"']/g,
    c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const famIcon=name=>'<img class="sh-fam-3d-icon" src="./sharika-agency-icons/'+
    name+'.webp" alt="" decoding="async">';
  let familyCache=null,familyCheckedAt=0,familyCheckedUser=null;
  let agencyRoleCache=null,agencyRoleCheckedAt=0,agencyRoleCheckedUser=null;
  function familyNotice(message){
    const info=document.querySelector('#sh-family-panel .sh-fam-feedback');
    if(info)info.textContent=String(message||'');
    else toast(String(message||''));
  }
  function mountFamilyTiles(){
    const root=document.getElementById('v-me');
    if(!root||!session)return;
    document.getElementById('sh-family-entries')?.remove();
    const entries=document.createElement('section');entries.id='sh-family-entries';
    entries.setAttribute('aria-label','Agency, Hosts and BD account features');
    const bd=document.createElement('button');bd.type='button';bd.id='sh-bd-entry';
    bd.innerHTML='<img class="sh-agency-tile-icon" src="./sharika-agency-icons/bd.webp" alt="">'+
      '<span>BD Center<small>Agencies • Pending Earnings • Reports</small></span>';
    bd.hidden=true;bd.onclick=()=>window.sharikaOpenAgencyCenter?.('bd');entries.appendChild(bd);
    const agency=document.createElement('button');agency.type='button';agency.id='sh-agency-entry';
    agency.innerHTML='<img class="sh-agency-tile-icon" src="./sharika-agency-icons/agency.webp" alt="">'+
      '<span>Agency Dashboard<small>Host Roster • Earnings • Salary Statement</small></span>';
    agency.onclick=()=>window.sharikaOpenAgencyCenter?.('agency');entries.appendChild(agency);
    const host=document.createElement('button');host.type='button';host.id='sh-host-entry';
    host.innerHTML='<img class="sh-agency-tile-icon" src="./sharika-agency-icons/host.webp" alt="">'+
      '<span>Host Earnings<small>Daily Room Time • Gift Salary • Reports</small></span>';
    host.hidden=true;host.onclick=()=>window.sharikaOpenAgencyCenter?.('host');entries.appendChild(host);
    const countryButton=document.createElement('button');
    countryButton.type='button';countryButton.id='sh-country-entry';
    countryButton.innerHTML='<span class="sh-fam-icon">🌍</span><span>Country / Location'+
      '<small>Set your own country • profile and room card • no GPS</small></span>';
    countryButton.onclick=openManualCountryPicker;entries.appendChild(countryButton);
    // Keep BD/Agency/Host inside the main profile Account Features section, not
    // after the profile page where the bottom navigation may cover the icon.
    const accountSection=root.querySelector('.profile-royal-page .profile-account');
    (accountSection||root.querySelector('.profile-royal-page')||root).appendChild(entries);
    const current=session.user?.id;
    if(current!==familyCheckedUser||Date.now()-familyCheckedAt>30000){
      familyCheckedUser=current;familyCheckedAt=Date.now();familyCache=null;
      api('GET','/family/me').then(data=>{
        if(session?.user?.id!==current)return;
        familyCache=data;
        const tile=document.getElementById('sh-bd-entry');
        if(tile)tile.hidden=!data.bd?.active;
      }).catch(error=>{
        console.warn('Family status unavailable:',errText(error));
      });
    }else if(familyCache)bd.hidden=!familyCache.bd?.active;
    if(current!==agencyRoleCheckedUser||Date.now()-agencyRoleCheckedAt>30000){
      agencyRoleCheckedUser=current;agencyRoleCheckedAt=Date.now();agencyRoleCache=null;
      api('GET','/agency/me').then(data=>{
        if(session?.user?.id!==current)return;
        agencyRoleCache=data;
        const tile=document.getElementById('sh-host-entry');
        if(tile)tile.hidden=!data.host?.active;
      }).catch(error=>console.warn('Agency Host status unavailable:',errText(error)));
    }else if(agencyRoleCache)host.hidden=!agencyRoleCache.host?.active;
  }
  async function openRoyalFamily(){
    if(!session){window.showAuth('welcome');return;}
    let layer=document.getElementById('sh-family-panel');
    if(!layer){
      layer=document.createElement('section');layer.id='sh-family-panel';
      layer.setAttribute('role','dialog');layer.setAttribute('aria-modal','true');
      layer.setAttribute('aria-label','Sharika Agency and Host');
      document.body.appendChild(layer);
    }
    layer.hidden=false;
    layer.innerHTML='<div class="sh-fam-wrap"><div class="sh-fam-head">'+
      '<button type="button" class="sh-fam-close" id="sh-fam-back">‹ Back</button>'+
      '<small>SHARIKA · AGENCY & HOST</small></div><h2>'+famIcon('agency')+' Agency & Host</h2>'+
      '<div id="sh-fam-body" class="sh-fam-card">Loading verified family data…</div>'+
      '<p class="sh-fam-feedback" role="status"></p></div>';
    layer.querySelector('#sh-fam-back').onclick=()=>{layer.hidden=true;};
    await reloadRoyalFamily();
  }
  async function reloadRoyalFamily(){
    const layer=document.getElementById('sh-family-panel');
    if(!layer||layer.hidden||!session)return;
    const target=layer.querySelector('#sh-fam-body');
    if(target)target.textContent='Loading verified family data…';
    const account=session.user?.id;
    try{
      const data=await api('GET','/family/me');
      if(account!==session?.user?.id||layer.hidden)return;
      familyCache=data;familyCheckedAt=Date.now();familyCheckedUser=account;
      const bdTile=document.getElementById('sh-bd-entry');
      if(bdTile)bdTile.hidden=!data.bd?.active;
      const header=layer.querySelector('.sh-fam-head');
      header.querySelector('#sh-fam-open-bd')?.remove();
      if(data.bd?.active){
        const button=document.createElement('button');button.id='sh-fam-open-bd';
        button.type='button';button.textContent='BD Overview';
        button.onclick=()=>renderBDOverview(data);
        header.appendChild(button);
      }
      renderRoyalFamily(data);
    }catch(error){
      if(target)target.textContent='Family service unavailable: '+errText(error)+
        '. Try again after the staging update.';
    }
  }

  async function renderFamilyDiscovery(data){
    const host=document.querySelector('#sh-family-panel #sh-fam-body');
    if(!host)return;
    const policy=data.policy||{},bd=data.bd||{};
    host.classList.remove('sh-fam-dashboard');
    host.classList.add('sh-fam-discovery');
    host.innerHTML='<div class="sh-fam-lobby-head"><span>✦ ROYAL AGENCIES ✦</span>'+
      '<h3>Discover Your Agency</h3><p>Join an existing Agency or apply to create your own.</p></div>'+
      '<div class="sh-fam-lobby-tabs" role="tablist" aria-label="Agency list">'+
      '<button data-fam-sort="recommend" aria-selected="true" role="tab">✦ Recommend</button>'+
      '<button data-fam-sort="new" aria-selected="false" role="tab">✧ New</button></div>'+
      '<label class="sh-fam-search">⌕ Search Agencies<input id="sh-fam-discover-q" placeholder="Agency name" maxlength="60"></label>'+
      '<div id="sh-fam-discover-list" aria-live="polite"><p>Loading Agencies…</p></div>'+
      '<div class="sh-fam-application-stack" id="sh-fam-application-stack"></div>'+
      ((data.invitations||[]).length?'<section class="sh-fam-app-card"><h3>✉️ Your Invitations</h3>'+
        data.invitations.map(a=>'<div class="sh-fam-invite-entry"><div><b>'+famEsc(a.family_name)+'</b>'+
          '<small>Invited by '+famEsc(a.inviter_id)+'</small></div>'+
          '<button data-fam-accept-invite="'+famEsc(a.id)+'">Join</button>'+
          '<button data-fam-decline-invite="'+famEsc(a.id)+'">Decline</button></div>').join('')+'</section>':'')+
      ((data.applications||[]).length?'<section class="sh-fam-app-card"><h3>📋 My Join Requests</h3>'+
        data.applications.map(a=>'<p>'+famEsc(a.family_name||a.family_id)+
        ' · '+famEsc(a.state)+'</p>').join('')+'</section>':'')+
      (bd.active&&bd.can_grant?'<details class="sh-fam-app-card"><summary>💼 BD Agency Grant</summary>'+
        '<p>Active BD: '+famEsc(policy.bd_percent)+'% verified Agency gift commission. Admin approval application is separate.</p>'+
        '<label>Owner 8-digit ID<input id="sh-fam-owner-id" maxlength="8" inputmode="numeric"></label>'+
        '<label>Agency Name<input id="sh-fam-name" maxlength="40"></label>'+
        '<button id="sh-fam-grant">Grant Agency</button>'+
        '<button id="sh-fam-bd-list">My Granted Agencies</button></details>':'')+
      '<div class="sh-fam-create-dock"><button type="button" id="sh-fam-show-create">'+
        '👑 Create Agency <span>Admin approval</span></button></div>'+
      '<section id="sh-fam-create-form" class="sh-fam-app-card" hidden>'+
        '<h3>👑 Apply to Create an Agency</h3>'+
        '<p>Choose a unique Agency name. An Admin must approve before the Agency appears on your ID.</p>'+
        '<label>Agency Name<input id="sh-fam-create-request-name" maxlength="40" placeholder="Your Royal Agency"></label>'+
        '<label>Description (optional)<input id="sh-fam-create-request-description" maxlength="240" placeholder="Family introduction"></label>'+
        '<label><input id="sh-fam-create-agree" type="checkbox"> I agree to the Agency rules and Admin review.</label>'+
        '<button id="sh-fam-create-request">Submit Application</button>'+
        '<button id="sh-fam-close-create" type="button">Cancel</button></section>';
    const list=host.querySelector('#sh-fam-discover-list');
    let rows=[],selectedSort='recommend',query='';
    const paint=()=>{
      if(!list.isConnected)return;
      const filtered=rows.filter(x=>String(x.name||'').toLowerCase().includes(query));
      const ordered=filtered.slice().sort((a,b)=>selectedSort==='new'?
        String(b.created_at||'').localeCompare(String(a.created_at||''))||Number(b.id)-Number(a.id):
        Number(b.member_count||0)-Number(a.member_count||0)||Number(b.level||0)-Number(a.level||0));
      list.innerHTML=ordered.length?ordered.map(f=>{
        const logo=verifiedAvatarUrl(f.logo);
        const full=Number(f.member_count||0)>=Number(f.max_members||20);
        return '<article class="sh-fam-discover-row">'+
          '<div class="sh-fam-row-emblem">'+(logo?'<img src="'+famEsc(logo)+'" alt="">':'👑')+'</div>'+
          '<div class="sh-fam-row-data"><b>'+famEsc(f.name)+'</b>'+
          '<small>Owner ID: '+famEsc(f.owner_id)+' · Lv '+famEsc(f.level||1)+'</small>'+
          '<small>♟ '+famEsc(f.member_count)+' / '+famEsc(f.max_members||20)+' members</small></div>'+
          '<button type="button" data-fam-discovery-apply="'+famEsc(f.id)+'" '+(full?'disabled':'')+'>'+
          (full?'Full':'Apply')+'</button></article>';
      }).join(''):'<p class="sh-fam-discover-empty">No matching Families found.</p>';
      list.querySelectorAll('[data-fam-discovery-apply]').forEach(btn=>btn.onclick=async()=>{
        const id=Number(btn.dataset.famDiscoveryApply);
        const item=rows.find(f=>Number(f.id)===id);
        if(!window.confirm('Apply to join '+(item?.name||'this Family')+'? The Owner must approve.'))return;
        btn.disabled=true;familyNotice('Sending join request…');
        try{await api('POST','/family/join',{family_id:id});
          familyNotice('Application sent ✓ Waiting for the Family Owner.');}
        catch(error){familyNotice('Application failed: '+errText(error));btn.disabled=false;}
      });
    };
    host.querySelectorAll('[data-fam-sort]').forEach(btn=>btn.onclick=()=>{
      selectedSort=btn.dataset.famSort;
      host.querySelectorAll('[data-fam-sort]').forEach(t=>t.setAttribute(
        'aria-selected',String(t===btn)));
      paint();
    });
    host.querySelector('#sh-fam-discover-q').oninput=e=>{
      query=String(e.target.value||'').trim().toLowerCase();paint();
    };
    const form=host.querySelector('#sh-fam-create-form');
    host.querySelector('#sh-fam-show-create').onclick=()=>{form.hidden=false;form.scrollIntoView({behavior:'smooth'});};
    host.querySelector('#sh-fam-close-create').onclick=()=>{form.hidden=true;};
    host.querySelector('#sh-fam-create-request').onclick=async()=>{
      const name=host.querySelector('#sh-fam-create-request-name').value.trim();
      const description=host.querySelector('#sh-fam-create-request-description').value.trim();
      const accept_rules=host.querySelector('#sh-fam-create-agree').checked;
      if(name.length<3||name.length>40||!accept_rules){
        familyNotice('Enter a name (3–40 characters) and accept the rules.');return;
      }
      const btn=host.querySelector('#sh-fam-create-request');btn.disabled=true;
      try{await api('POST','/family/creation/request',{name,description,accept_rules});
        familyNotice('Family application sent ✓ Admin approval required.');
        await reloadRoyalFamily();
      }catch(error){familyNotice('Application failed: '+errText(error));btn.disabled=false;}
    };
    host.querySelectorAll('[data-fam-accept-invite],[data-fam-decline-invite]').forEach(btn=>
      btn.onclick=async()=>{
        const accepted=!!btn.dataset.famAcceptInvite;
        const id=btn.dataset.famAcceptInvite||btn.dataset.famDeclineInvite;
        try{await api('POST','/family/invites/'+id+'/'+(accepted?'accept':'decline'),{});
          await reloadRoyalFamily();familyNotice(accepted?'Joined Family ✓':'Invitation declined');}
        catch(error){familyNotice('Invite response failed: '+errText(error));}
      });
    host.querySelector('#sh-fam-grant')?.addEventListener('click',async()=>{
      const id=host.querySelector('#sh-fam-owner-id').value.trim();
      const name=host.querySelector('#sh-fam-name').value.trim();
      if(!/^[0-9]{8}$/.test(id)||name.length<3)return familyNotice('Enter Owner ID and Family name.');
      if(!window.confirm('Grant '+name+' to '+id+'?'))return;
      try{await api('POST','/family/bd/grant',{owner_public_id:id,name,
        request_id:'family:'+crypto.randomUUID()});await reloadRoyalFamily();}
      catch(error){familyNotice('BD grant failed: '+errText(error));}
    });
    host.querySelector('#sh-fam-bd-list')?.addEventListener('click',async()=>{
      try{const r=await api('GET','/family/bd/families');
        familyNotice((r.families||[]).map(x=>x.name+' #'+x.id).join(' • ')||'No granted Families.');}
      catch(error){familyNotice('BD list unavailable: '+errText(error));}
    });
    try{
      const [found,applications]=await Promise.all([
        api('GET','/family/discover'),api('GET','/family/creation/requests')
      ]);
      if(!list.isConnected)return;
      rows=Array.isArray(found.families)?found.families:[];
      paint();
      const stack=host.querySelector('#sh-fam-application-stack');
      const entries=applications.requests||[];
      if(stack&&entries.length)
        stack.innerHTML='<section class="sh-fam-app-card"><h3>🗂️ Family Creation Applications</h3>'+
          entries.slice(0,5).map(x=>'<p><strong>'+famEsc(x.name)+'</strong>'+
            ' <span class="sh-fam-state">'+famEsc(x.state)+'</span>'+
            (x.decision_reason?' · '+famEsc(x.decision_reason):'')+'</p>').join('')+
          '</section>';
    }catch(error){if(list.isConnected)list.textContent='Family list unavailable: '+errText(error);}
  }

  const familyDiscoveryRoyalCss=document.createElement('style');
  familyDiscoveryRoyalCss.id='sharika-family-discovery-premium';
  familyDiscoveryRoyalCss.textContent=[
    '#sh-family-panel:has(.sh-fam-discovery){padding-bottom:0;background:',
    'radial-gradient(ellipse at 50% -10%,#b97e28a8,transparent 48%),',
    'repeating-conic-gradient(from 22deg at 50% 21%,#d59a2512 0deg 12deg,transparent 12deg 30deg),',
    'linear-gradient(180deg,#170d14 0%,#221408 44%,#0f0a11 100%)}',
    '#sh-family-panel:has(.sh-fam-discovery) .sh-fam-wrap{min-height:100%;position:relative}',
    '#sh-family-panel:has(.sh-fam-discovery) .sh-fam-wrap:before{content:"✦";',
    'position:absolute;top:7px;left:45%;z-index:-1;color:#bd8c3040;',
    'font-size:230px;text-shadow:0 0 75px #d6a54455}',
    '#sh-family-panel:has(.sh-fam-discovery) h2{font-size:27px;',
    'text-shadow:0 2px 8px #efb74a77}',
    '#sh-family-panel .sh-fam-discovery{padding:0;margin:0;',
    'background:transparent;border:0;box-shadow:none}',
    '#sh-family-panel .sh-fam-lobby-head{text-align:center;margin:10px 0 20px}',
    '#sh-family-panel .sh-fam-lobby-head>span{letter-spacing:3px;font-size:10px;color:#e6b95c}',
    '#sh-family-panel .sh-fam-lobby-head h3{font-size:23px;color:#ffdf96;margin:7px 0}',
    '#sh-family-panel .sh-fam-lobby-head p{font-size:13px;color:#e0c99c}',
    '#sh-family-panel .sh-fam-lobby-tabs{display:flex;padding:4px;gap:5px;',
    'border:1px solid #b98b3d;border-radius:22px;background:#251812dd}',
    '#sh-family-panel .sh-fam-lobby-tabs button{width:50%;margin:0;border:0;',
    'border-radius:18px;font-size:16px;box-shadow:none;background:transparent;color:#edcb8b}',
    '#sh-family-panel .sh-fam-lobby-tabs button[aria-selected=true]{',
    'background:linear-gradient(125deg,#fff0a3,#d79b29 65%,#996319);color:#3d2109}',
    '#sh-family-panel .sh-fam-search{display:block;margin:14px 0;color:#e5c48b;font-size:12px}',
    '#sh-family-panel .sh-fam-search input{margin:4px 0}',
    '#sh-family-panel .sh-fam-discover-row{display:flex;align-items:center;gap:11px;',
    'padding:14px 2px;border-bottom:1px solid #c69a3d55;background:linear-gradient(90deg,#3a251266,#120b0a33)}',
    '#sh-family-panel .sh-fam-row-emblem{height:64px;width:64px;flex:none;',
    'display:grid;place-items:center;border:2px solid #f1ca72;border-radius:17px;',
    'background:linear-gradient(135deg,#694112,#1e1a18);font-size:32px;overflow:hidden;',
    'box-shadow:inset 0 1px 4px #ffdf8b66,0 6px 16px #0008}',
    '#sh-family-panel .sh-fam-row-emblem img{height:100%;width:100%;object-fit:cover}',
    '#sh-family-panel .sh-fam-row-data{min-width:0;flex:1}',
    '#sh-family-panel .sh-fam-row-data b{display:block;white-space:nowrap;',
    'overflow:hidden;text-overflow:ellipsis;font-size:16px;color:#ffebc0}',
    '#sh-family-panel .sh-fam-row-data small{display:block;color:#e4bd77;',
    'font-size:11px;line-height:1.7}',
    '#sh-family-panel .sh-fam-discover-row button{flex:none;margin:0;padding:9px 13px;',
    'border-radius:13px;font-size:13px}',
    '#sh-family-panel .sh-fam-discover-empty{text-align:center;padding:25px;color:#e4c98d}',
    '#sh-family-panel .sh-fam-application-stack,.sh-fam-app-card{margin:14px 0}',
    '#sh-family-panel .sh-fam-app-card{padding:16px;border:1px solid #bb8c43;',
    'background:linear-gradient(135deg,#4a2e1c,#231519);border-radius:18px;',
    'box-shadow:0 6px 18px #0008}',
    '#sh-family-panel .sh-fam-app-card p{font-size:12px;color:#e6d2ad}',
    '#sh-family-panel .sh-fam-invite-entry{display:flex;align-items:center;gap:8px;margin:8px 0}',
    '#sh-family-panel .sh-fam-invite-entry div{flex:1;min-width:0}',
    '#sh-family-panel .sh-fam-invite-entry b,#sh-family-panel .sh-fam-invite-entry small{display:block}',
    '#sh-family-panel .sh-fam-state{font-weight:900;color:#ffcc64;text-transform:uppercase}',
    '#sh-family-panel .sh-fam-create-dock{position:sticky;bottom:0;margin:16px -15px 0;',
    'background:linear-gradient(0deg,#150b09 70%,#150b09aa);padding:13px 17px 20px;',
    'z-index:2;text-align:center;border-top:1px solid #ad803366}',
    '#sh-family-panel .sh-fam-create-dock button{width:100%;max-width:380px;',
    'font-size:18px;border:2px solid #ffdd85;border-radius:20px;',
    'background:linear-gradient(175deg,#ffed9d 0%,#ecb345 45%,#b97717 100%);',
    'box-shadow:inset 0 2px 2px #fff9a0,0 5px 0 #744407,0 8px 22px #000b}',
    '#sh-family-panel .sh-fam-create-dock span{display:block;font-size:10px;opacity:.8}',
    '#sh-family-panel #sh-fam-create-form[hidden]{display:none}',
    '#sh-family-panel #sh-fam-create-agree{display:inline-block;width:18px;vertical-align:middle}',
    // Public profile now has a dedicated compact cover layout in royal-profile.css.
    // The former !important gold sunburst here hid the owner's uploaded cover.
    '@media(max-width:380px){#sh-family-panel .sh-fam-row-emblem{width:53px;height:53px}',
    '#sh-family-panel .sh-fam-row-data b{font-size:14px}',
    '#sh-family-panel .sh-fam-discover-row button{padding:8px}}',
    '@media(prefers-reduced-motion:reduce){#sh-family-panel .sh-fam-create-dock button{transition:none}}'
  ].join('');
  familyDiscoveryRoyalCss.textContent +=
    '#pfo .sh-room-royal .pfh .meta{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px}'+
    '#pfo .sh-room-royal .pfh .meta .sh-royal-idline{width:100%;margin:0}'+
    '#pfo .sh-room-royal .sh-royal-room-family-link{border:1px solid #c58d22;border-radius:99px;'+
    'background:linear-gradient(#fff0ad,#e7b74d);color:#552909;font-weight:800;padding:7px 13px}';
  document.head.appendChild(familyDiscoveryRoyalCss);

  function agencyReportFormat(n){
    return Math.max(0,Number(n)||0).toLocaleString('en-US',{maximumFractionDigits:0});
  }
  function agencyReportCrystals(units){
    return (Number(units||0)/10000).toLocaleString('en-US',{maximumFractionDigits:4});
  }
  function agencyReportBack(data){
    const target=document.querySelector('#sh-family-panel #sh-fam-body');
    target?.querySelector('#sh-agency-report-back')?.addEventListener('click',()=>renderRoyalFamily(data));
  }
  async function renderBDOverview(data){
    const target=document.querySelector('#sh-family-panel #sh-fam-body');
    if(!target||!data.bd?.active)return;
    const account=session?.user?.id;
    target.classList.remove('sh-fam-discovery');target.classList.add('sh-fam-dashboard');
    target.textContent='Loading your verified BD agency report…';
    try{
      const result=await api('GET','/family/bd/overview');
      if(!target.isConnected||session?.user?.id!==account||target.closest('#sh-family-panel')?.hidden)return;
      const totals=result.totals||{},agencies=result.agencies||[];
      const ranked=agencies.slice().sort((a,b)=>Number(b.month_diamonds||0)-Number(a.month_diamonds||0));
      target.innerHTML='<button type="button" id="sh-agency-report-back">‹ Agency & Host</button>'+
        '<section class="sh-fam-hero"><span class="sh-fam-crest">'+famIcon('bd')+'</span>'+
        '<h3>BD Agency Management</h3><small>Your assigned agencies · verified D1 records</small></section>'+
        '<div class="sh-fam-kpis">'+
        '<div class="sh-fam-kpi"><small>'+famIcon('agency')+' Agencies</small><strong>'+agencyReportFormat(totals.agency_count)+'</strong></div>'+
        '<div class="sh-fam-kpi"><small>'+famIcon('host')+' Hosts & Members</small><strong>'+agencyReportFormat(totals.host_count)+'</strong></div>'+
        '<div class="sh-fam-kpi"><small>'+famIcon('gifts')+' Monthly Gift Diamonds</small><strong>'+agencyReportFormat(totals.month_gift_diamonds)+'</strong></div>'+
        '<div class="sh-fam-kpi"><small>'+famIcon('commission')+' BD Earned Crystal</small><strong>'+agencyReportCrystals(totals.earned_crystal_units)+'</strong></div></div>'+
        '<section class="sh-fam-card"><h3>'+famIcon('ranking')+' Agency Ranking · This Month (UTC)</h3>'+
        (ranked.length?ranked.map((a,i)=>'<article class="sh-agency-report-row"><b>#'+(i+1)+' · '+
          famEsc(a.name)+'</b><small>Owner ID '+famEsc(a.owner_id)+' · '+
          agencyReportFormat(a.member_count)+' members · '+famEsc(a.status)+'</small>'+
          '<small>Gift Diamonds: '+agencyReportFormat(a.month_diamonds)+' this month · '+
          agencyReportFormat(a.lifetime_diamonds)+' lifetime</small><small>BD Crystal: '+
          agencyReportCrystals(a.month_crystal_units)+' this month · '+
          agencyReportCrystals(a.earned_crystal_units)+' lifetime</small></article>').join(''):
          '<p>No agencies are assigned to this BD account yet.</p>')+
        (result.has_more_agencies?'<p class="sh-fam-note">Showing the newest 100 agencies only; totals are for the displayed agencies.</p>':'')+
        '<p class="sh-fam-note">BD commission is read from the immutable Crystal ledger. Gifts are verified regular gifts since a member joined; no wallet credit was performed.</p></section>';
      agencyReportBack(data);familyNotice('');
    }catch(error){target.innerHTML='<button type="button" id="sh-agency-report-back">‹ Back</button>'+
      '<p class="sh-fam-card">BD report unavailable: '+famEsc(errText(error))+'</p>';
      agencyReportBack(data);}
  }
  async function renderHostStatement(data){
    const target=document.querySelector('#sh-family-panel #sh-fam-body');
    if(!target||!data.family)return;
    const account=session?.user?.id;
    target.classList.remove('sh-fam-discovery');target.classList.add('sh-fam-dashboard');
    target.textContent='Loading your verified Host statement…';
    try{
      const result=await api('GET','/family/host/statement');
      if(!target.isConnected||session?.user?.id!==account||target.closest('#sh-family-panel')?.hidden)return;
      const host=result.host||{},gifts=result.gifts||{},days=result.days||[];
      target.innerHTML='<button type="button" id="sh-agency-report-back">‹ Agency Dashboard</button>'+
        '<section class="sh-fam-hero"><span class="sh-fam-crest">'+famIcon('host')+'</span>'+
        '<h3>My Host Performance</h3><small>'+famEsc(host.name)+' · ID '+famEsc(host.id)+
        ' · '+famEsc(host.agency_name)+'</small></section>'+
        '<div class="sh-fam-kpis">'+
        '<div class="sh-fam-kpi"><small>'+famIcon('gifts')+' Today</small><strong>'+agencyReportFormat(gifts.today_diamonds)+'</strong></div>'+
        '<div class="sh-fam-kpi"><small>'+famIcon('gifts')+' This Week</small><strong>'+agencyReportFormat(gifts.week_diamonds)+'</strong></div>'+
        '<div class="sh-fam-kpi"><small>'+famIcon('gifts')+' This Month</small><strong>'+agencyReportFormat(gifts.month_diamonds)+'</strong></div>'+
        '<div class="sh-fam-kpi"><small>'+famIcon('commission')+' Earned Crystal</small><strong>'+agencyReportCrystals(result.earned_crystal_units)+'</strong></div></div>'+
        '<section class="sh-fam-card"><h3>'+famIcon('salary')+' Salary Statement</h3>'+
        '<p class="sh-agency-salary-note">Not configured · No Host salary is due or paid yet. Admin must define the salary rules and approve payment separately. Gift diamonds and Crystal are not salary coins.</p>'+
        '<p>Lifetime verified gifts: <b>'+agencyReportFormat(gifts.lifetime_gifts)+'</b> · '+
        'Lifetime gift diamonds: <b>'+agencyReportFormat(gifts.lifetime_diamonds)+'</b></p></section>'+
        '<section class="sh-fam-card"><h3>'+famIcon('reports')+' Daily Gift History (UTC)</h3>'+
        (days.length?days.map(d=>'<div class="sh-agency-report-row"><b>'+famEsc(d.day)+
          '</b><small>'+agencyReportFormat(d.gift_count)+' gifts · '+
          agencyReportFormat(d.gift_diamonds)+' diamonds</small></div>').join(''):
          '<p>No verified regular gifts have been recorded since you joined.</p>')+
        '<p class="sh-fam-note">Showing up to 31 recent active days. The report comes from server gift events, not a demo counter.</p></section>';
      agencyReportBack(data);familyNotice('');
    }catch(error){target.innerHTML='<button type="button" id="sh-agency-report-back">‹ Back</button>'+
      '<p class="sh-fam-card">Host statement unavailable: '+famEsc(errText(error))+'</p>';
      agencyReportBack(data);}
  }
  async function renderAgencyHostRanking(data){
    const target=document.querySelector('#sh-family-panel #sh-fam-body');
    if(!target||!data.family)return;
    const account=session?.user?.id;
    target.classList.remove('sh-fam-discovery');target.classList.add('sh-fam-dashboard');
    target.textContent='Loading verified Host rankings…';
    try{
      const result=await api('GET','/family/agency/hosts');
      if(!target.isConnected||session?.user?.id!==account||target.closest('#sh-family-panel')?.hidden)return;
      const hosts=result.hosts||[];
      target.innerHTML='<button type="button" id="sh-agency-report-back">‹ Agency Dashboard</button>'+
        '<section class="sh-fam-hero"><span class="sh-fam-crest">'+famIcon('ranking')+'</span>'+
        '<h3>Agency Host Ranking</h3><small>'+famEsc(result.agency?.name||'')+' · Current UTC month</small></section>'+
        '<section class="sh-fam-card"><h3>'+famIcon('gifts')+' Monthly Verified Gift Diamonds</h3>'+
        (hosts.length?hosts.map((h,i)=>'<article class="sh-agency-report-row"><b>#'+(i+1)+' · '+
          famEsc(h.name)+' · '+famEsc(h.host_id)+'</b><small>Role: '+famEsc(h.role)+
          ' · Joined '+famEsc(h.joined_at)+'</small><small>Today: '+agencyReportFormat(h.today_diamonds)+
          ' · Week: '+agencyReportFormat(h.week_diamonds)+' · Month: '+
          agencyReportFormat(h.month_diamonds)+'</small><small>All-time: '+
          agencyReportFormat(h.lifetime_diamonds)+' diamonds from '+agencyReportFormat(h.gift_count)+
          ' verified gifts</small></article>').join(''):'<p>No hosts have joined this agency.</p>')+
        '</section>';
      agencyReportBack(data);familyNotice('');
    }catch(error){target.innerHTML='<button type="button" id="sh-agency-report-back">‹ Back</button>'+
      '<p class="sh-fam-card">Ranking unavailable: '+famEsc(errText(error))+'</p>';
      agencyReportBack(data);}
  }

  function renderRoyalFamily(data){
    const target=document.querySelector('#sh-family-panel #sh-fam-body');
    if(!target)return;
    const family=data.family,bd=data.bd||{},policy=data.policy||{},wallet=data.wallet||{};
    if(!family){renderFamilyDiscovery(data);return;}
    target.classList.remove('sh-fam-discovery');
    target.classList.add('sh-fam-dashboard');
    const fmtUnits=u=>(Number(u||0)/10000).toLocaleString('en-US',{maximumFractionDigits:4});
    const formatAmount=n=>Math.max(0,Number(n)||0).toLocaleString('en-US');
    const progress=data.target_progress||{},activity=data.activity||{};
    let html='<section class="sh-fam-hero"><span class="sh-fam-crest" aria-hidden="true">'+famIcon('agency')+'</span>'+
      '<small>✦ SHARIKA AGENCY & HOST ✦</small><h3>'+famEsc(family.name)+'</h3>'+
      '<small>Agency #'+famEsc(family.id)+' · LEVEL '+famEsc(family.level)+
      ' · '+famEsc(family.status)+'</small></section>'+
      '<div class="sh-agency-actions">'+
      '<button type="button" id="sh-open-host-statement">'+famIcon('salary')+' My Host Statement</button>'+
      (['leader','co_leader'].includes(family.role)?'<button type="button" id="sh-open-agency-host-ranking">'+
        famIcon('ranking')+' Host Ranking</button>':'')+
      (bd.active?'<button type="button" id="sh-open-bd-dashboard">'+famIcon('bd')+' BD Overview</button>':'')+
      '</div>'+
      '<div class="sh-fam-kpis">'+
      '<div class="sh-fam-kpi"><small>'+famIcon('host')+' Members</small><strong>'+famEsc(family.member_count)+'</strong></div>'+
      '<div class="sh-fam-kpi"><small>'+famIcon('gifts')+' All-Time Gift Diamonds</small><strong>'+formatAmount(progress.lifetime)+'</strong></div>'+
      '<div class="sh-fam-kpi"><small>'+famIcon('gifts')+' Monthly Gift Diamonds</small><strong>'+formatAmount(progress.month)+'</strong></div>'+
      '<div class="sh-fam-kpi"><small>'+famIcon('commission')+' My Earned Crystal</small><strong>'+fmtUnits(wallet.total_units)+'</strong></div>'+
      '</div><div class="sh-fam-card"><h3>'+famIcon('commission')+' Crystal Wallet</h3><div class="sh-fam-stat">'+
      fmtUnits(wallet.available_units)+' Crystal</div>'+
      '<p class="sh-fam-note">Verified total: '+fmtUnits(wallet.total_units)+
      ' · Reserved / transferred: '+fmtUnits(wallet.transferred_units)+
      '. Crystal is separate from coins and gift diamonds.</p>'+
      '<button type="button" id="sh-fam-ledger">Crystal & Coin Transfer History</button>';
    if(family.role==='leader'){
      html+='<p class="sh-fam-note" id="sh-fam-owner-commission-rule">Agency Owner commission ('+
        famEsc(policy.owner_percent||0)+'%) comes from verified regular gifts sent by other Agency members. '+
        'Your own gifts count toward the Agency Gift Target, but do not earn Owner Crystal commission.</p>';
    }
    html+='</div>';
    if(family){
      const activity=data.activity||{},progress=data.target_progress||{};
      const fmtDiamonds=value=>Math.max(0,Number(value)||0).toLocaleString('en-US',{maximumFractionDigits:0});
      html+='<div class="sh-fam-card" data-family-diamond-target="true">'+
        '<h3>'+famIcon('gifts')+' Agency Diamond Gift Target</h3>'+
        '<div class="sh-fam-stat">'+fmtDiamonds(progress.month)+'</div>'+
        '<p class="sh-fam-note">Diamonds contributed this month (UTC)</p>'+
        '<p>Today: <strong>'+fmtDiamonds(progress.today)+'</strong> 💎 · '+
        'Week: <strong>'+fmtDiamonds(progress.week)+'</strong> 💎</p>'+
        '<p>All-time: <strong>'+fmtDiamonds(progress.lifetime)+'</strong> 💎 · '+
        'Verified gifts: <strong>'+famEsc(activity.total_gifts||0)+'</strong></p>'+
        '<p class="sh-fam-note">Regular gifts from all current Agency members, including the Owner, count from the day they joined. Lucky gifts do not create these diamonds. Crystal commissions are separate.</p>'+
        '<button type="button" id="sh-fam-refresh-target">↻ Refresh Gift Target</button></div>';
      html+='<div class="sh-fam-card"><h3>👑 '+famEsc(family.name)+' · Level '+
        famEsc(family.level)+'</h3><p>Agency ID: '+famEsc(family.id)+
        ' · '+famEsc(family.member_count)+' members</p>'+
        '<p class="sh-fam-note">Owner: '+famEsc(family.owner_id)+
        ' · BD: '+famEsc(family.bd_id)+'</p>'+
        (family.status!=='active'?'<p class="sh-fam-status">This Family is suspended. Ask Admin to review it.</p>':'')+
        '<div class="sh-fam-section-title"><h3>'+famIcon('host')+' Member Directory</h3><small>'+famEsc(family.member_count)+' members</small></div>'+
        '<ol class="sh-fam-list">'+
        (family.members||[]).map((m,index)=>'<li class="sh-fam-member-item">'+
          '<button type="button" class="sh-fam-member-row" data-fam-member-detail="'+famEsc(m.public_id)+'">'+
          '<b class="sh-fam-member-number">#'+(index+1)+'</b><span class="sh-fam-member-name">'+
          famEsc(m.name)+'<small>ID '+famEsc(m.public_id)+' · '+famEsc(m.role)+'</small></span>'+
          '<span class="sh-fam-member-arrow" aria-hidden="true">›</span></button>'+
          (family.role==='leader'&&family.status==='active'&&m.role!=='leader'?
            '<details><summary>Manage member</summary>'+
            '<label>Agency role<select data-fam-role="'+famEsc(m.public_id)+'">'+
            ['member','elder','co_leader'].map(r=>
              '<option value="'+r+'" '+(r===m.role?'selected':'')+'>'+famEsc(r)+'</option>').join('')+
            '</select></label>'+
            '<button type="button" data-fam-save-role="'+famEsc(m.public_id)+'">Save Role</button>'+
            '<button type="button" data-fam-transfer-owner="'+famEsc(m.public_id)+'">Make Owner</button>'+
            '<button type="button" data-fam-remove-member="'+famEsc(m.public_id)+'">Remove</button>'+
            '</details>':'')+'</li>').join('')+'</ol>'+
        (['leader','co_leader'].includes(family.role)&&family.status==='active'?
          '<button id="sh-fam-requests" type="button">Review Join Requests</button>':'')+
        (family.role==='leader'&&family.status==='active'?
          '<div class="sh-fam-card"><h4>✉️ Invite User to '+famEsc(family.name)+'</h4>'+
          '<p class="sh-fam-note">Enter an 8-digit ID. User gets a notification and joins after accepting.</p>'+
          '<label>User ID<input id="sh-fam-invite-id" maxlength="8" inputmode="numeric" placeholder="8-digit ID"></label>'+
          '<button id="sh-fam-invite" type="button">Send Agency Invitation</button></div>':'')+
        (family.role!=='leader'?
          '<button id="sh-fam-leave" type="button">Leave Agency</button>':'')+'</div>';
    }else html+='<div class="sh-fam-card"><h3>Join an Agency</h3>'+
      '<p class="sh-fam-note">Only one family at a time. Leader approves membership.</p>'+
      '<label>Agency ID<input id="sh-fam-join-id" inputmode="numeric" placeholder="e.g. 1001"></label>'+
      '<button id="sh-fam-join" type="button">Send Join Request</button>'+
      ((data.invitations||[]).length?
        '<h3>✉️ Agency Invitations</h3><div class="sh-fam-list">'+
        (data.invitations||[]).map(a=>'<div class="sh-fam-card">👑 '+famEsc(a.family_name)+
          ' · #'+famEsc(a.family_id)+'<p class="sh-fam-note">Invited by '+famEsc(a.inviter_id)+'</p>'+
          '<button type="button" data-fam-accept-invite="'+famEsc(a.id)+'">Join Agency</button>'+
          '<button type="button" data-fam-decline-invite="'+famEsc(a.id)+'">Decline</button></div>').join('')+'</div>':'')+
      ((data.applications||[]).length?
        '<h3>Your recent applications</h3><ul class="sh-fam-list">'+
        (data.applications||[]).map(a=>'<li>#'+famEsc(a.family_id)+' · '+
          famEsc(a.family_name)+' · <span class="sh-fam-status">'+
          famEsc(a.state)+'</span></li>').join('')+'</ul>':'')+'</div>';
    if(bd.active&&bd.can_grant){
      html+='<div class="sh-fam-card"><h3>'+famIcon('bd')+' BD Agency Grant</h3>'+
        '<p class="sh-fam-note">Your account has Agency Grant permission. BD commission: '+
        famEsc(policy.bd_percent)+'% on verified non-Lucky family member gifts.</p>'+
        '<label>Owner Sharika ID<input id="sh-fam-owner-id" inputmode="numeric" maxlength="8" placeholder="8-digit ID"></label>'+
        '<label>Agency Name<input id="sh-fam-name" maxlength="40" placeholder="Agency name"></label>'+
        '<button type="button" id="sh-fam-grant">Grant Agency</button>'+
        '<button type="button" id="sh-fam-bd-list">My Granted Agencies</button></div>';
    }
    if(policy.conversion_enabled){
      html+='<div class="sh-fam-card"><h3>↔ Seller Transfer Request</h3>'+
        '<p class="sh-fam-note">Approval required before seller stock receives coins. Rate: '+
        famEsc(policy.coins_per_crystal)+' coins per Crystal.</p>'+
        '<label>Seller ID<input id="sh-fam-seller" maxlength="8" inputmode="numeric"></label>'+
        '<label>Whole Crystals<input id="sh-fam-amount" inputmode="numeric" type="number" min="1"></label>'+
        '<button type="button" id="sh-fam-transfer">Request Transfer</button></div>';
    }
    target.innerHTML=html;
    target.querySelector('#sh-open-host-statement')?.addEventListener('click',()=>renderHostStatement(data));
    target.querySelector('#sh-open-agency-host-ranking')?.addEventListener('click',()=>renderAgencyHostRanking(data));
    target.querySelector('#sh-open-bd-dashboard')?.addEventListener('click',()=>renderBDOverview(data));
    target.querySelector('#sh-fam-refresh-target')?.addEventListener('click',async event=>{
      const button=event.currentTarget;
      button.disabled=true;
      await reloadRoyalFamily();
    });
    const invoke=async(method,url,body,confirmText)=>{
      if(confirmText&&!window.confirm(confirmText))return;
      familyNotice('Saving…');
      try{
        const saved=await api(method,url,body);
        familyNotice('Verified ✓');
        await reloadRoyalFamily();familyNotice('Saved successfully ✓');
        return saved;
      }catch(error){familyNotice('Not saved: '+errText(error));return null;}
    };
    async function showMemberActivity(memberId,day){
      const path='/family/members/'+memberId+'/activity'+
        (day?'?date='+encodeURIComponent(day):'');
      target.innerHTML='<p class="sh-fam-card">Loading verified member activity…</p>';
      try{
        const record=await api('GET',path);
        if(!target.isConnected)return;
        const user=record.member||{},total=record.total||{};
        const selected=record.selected_date||new Date().toISOString().slice(0,10);
        const days=Array.isArray(record.days)?record.days:[];
        const gifts=Array.isArray(record.gifts)?record.gifts:[];
        target.innerHTML='<button type="button" id="sh-fam-detail-back">‹ Agency Dashboard</button>'+
          '<section class="sh-fam-hero"><div class="sh-fam-crest" aria-hidden="true">'+famIcon('host')+'</div>'+
          '<h3>'+famEsc(user.name)+'</h3><small>ID '+famEsc(user.id)+
          ' · '+famEsc(user.role)+' · Joined '+famEsc(user.joined_at)+'</small></section>'+
          '<div class="sh-fam-kpis">'+
          '<div class="sh-fam-kpi"><small>'+famIcon('gifts')+' Total Gift Diamonds</small><strong>'+formatAmount(total.gift_coins)+'</strong></div>'+
          '<div class="sh-fam-kpi"><small>'+famIcon('gifts')+' Verified Gift Events</small><strong>'+formatAmount(total.gift_count)+'</strong></div>'+
          '<div class="sh-fam-kpi"><small>'+famIcon('commission')+' Earned Crystal</small><strong>'+fmtUnits(total.earned_crystal_units)+'</strong></div>'+
          '<div class="sh-fam-kpi"><small>'+famIcon('reports')+' Selected Day · '+famEsc(selected)+'</small><strong>'+formatAmount(
            gifts.reduce((sum,g)=>sum+Number(g.quantity||0)*Number(g.price_coins||0),0))+'</strong></div></div>'+
          '<section class="sh-fam-card"><h3>'+famIcon('reports')+' Daily Gift Statement (UTC)</h3>'+
          '<label>Choose date<input id="sh-fam-selected-date" type="date" value="'+famEsc(selected)+
          '" max="'+new Date().toISOString().slice(0,10)+'"></label>'+
          '<div class="sh-fam-date-pills">'+days.slice(0,14).map(d=>
            '<button type="button" data-fam-day="'+famEsc(d.day)+'" aria-pressed="'+
            (d.day===selected)+'">'+famEsc(d.day.slice(5))+' · '+formatAmount(d.gift_coins)+'</button>'
          ).join('')+'</div>'+
          (gifts.length?gifts.map(g=>'<div class="sh-fam-gift-row"><div><b>'+famEsc(g.gift_name)+
            ' ×'+formatAmount(g.quantity)+'</b><small>'+famEsc(g.created_at)+' UTC'+
            ' · To ID '+famEsc(g.recipient_id)+'</small></div><b>💎 '+
            formatAmount(Number(g.quantity||0)*Number(g.price_coins||0))+'</b></div>').join(''):
            '<p class="sh-fam-note">No verified regular gifts on this date.</p>')+
          (record.has_more_gifts?'<p class="sh-fam-note">Showing latest 100 gift events for this day.</p>':'')+
          '</section><p class="sh-fam-note">Statements use server-verified regular gift events since this member joined. Crystal is not a spendable coin balance.</p>';
        target.querySelector('#sh-fam-detail-back').onclick=()=>renderRoyalFamily(data);
        target.querySelector('#sh-fam-selected-date').onchange=e=>{
          if(/^\d{4}-\d{2}-\d{2}$/.test(e.target.value))showMemberActivity(memberId,e.target.value);
        };
        target.querySelectorAll('[data-fam-day]').forEach(button=>{
          button.onclick=()=>showMemberActivity(memberId,button.dataset.famDay);
        });
        familyNotice('');
      }catch(error){
        target.innerHTML='<button type="button" id="sh-fam-detail-back">‹ Agency Dashboard</button>'+
          '<p class="sh-fam-card">Member details unavailable: '+famEsc(errText(error))+'</p>';
        target.querySelector('#sh-fam-detail-back').onclick=()=>renderRoyalFamily(data);
      }
    }
    target.querySelectorAll('[data-fam-member-detail]').forEach(button=>{
      const memberId=button.dataset.famMemberDetail;
      if(!['leader','co_leader'].includes(family.role)&&
        String(profile?.public_id||'')!==memberId){
        button.disabled=true;
        button.title='Only Family leaders can view other members’ gift statements';
      }else button.onclick=()=>showMemberActivity(memberId);
    });
    target.querySelectorAll('[data-fam-save-role]').forEach(button=>{
      button.onclick=()=>{
        const id=button.dataset.famSaveRole;
        const role=target.querySelector('[data-fam-role="'+id+'"]')?.value;
        if(!['member','elder','co_leader'].includes(role))return familyNotice('Choose a valid role');
        invoke('POST','/family/members/'+id+'/role',{role},
          'Change Family member '+id+' to '+role+'?');
      };
    });
    target.querySelectorAll('[data-fam-transfer-owner]').forEach(button=>{
      button.onclick=()=>{
        const id=button.dataset.famTransferOwner;
        invoke('POST','/family/ownership/transfer',{new_owner_public_id:id},
          'Transfer ownership to '+id+'? You will become Co-leader. Future Family owner Crystal goes to the new owner.');
      };
    });
    target.querySelectorAll('[data-fam-remove-member]').forEach(button=>{
      button.onclick=()=>{
        const id=button.dataset.famRemoveMember;
        invoke('POST','/family/members/'+id+'/remove',{},
          'Remove member '+id+'? A 24-hour Family join cooldown will apply.');
      };
    });
    target.querySelector('#sh-fam-invite')?.addEventListener('click',()=>{
      const id=target.querySelector('#sh-fam-invite-id')?.value?.trim();
      if(!/^[0-9]{8}$/.test(id||''))return familyNotice('Enter an 8-digit User ID');
      invoke('POST','/family/invite',{public_id:id},
        'Invite '+id+' to Family '+family.name+'? They must accept the invitation.');
    });
    target.querySelectorAll('[data-fam-accept-invite],[data-fam-decline-invite]').forEach(btn=>{
      btn.onclick=()=>{
        const yes=btn.dataset.famAcceptInvite;
        const id=yes||btn.dataset.famDeclineInvite;
        invoke('POST','/family/invites/'+id+'/'+(yes?'accept':'decline'),{},
          yes?'Join this Family?':'Decline this Family invitation?');
      };
    });
    target.querySelector('#sh-fam-join')?.addEventListener('click',()=>{
      const id=Number(target.querySelector('#sh-fam-join-id')?.value);
      if(!Number.isSafeInteger(id)||id<1)return familyNotice('Enter a valid Agency ID');
      invoke('POST','/family/join',{family_id:id});
    });
    target.querySelector('#sh-fam-grant')?.addEventListener('click',()=>{
      const id=target.querySelector('#sh-fam-owner-id')?.value?.trim();
      const name=target.querySelector('#sh-fam-name')?.value?.trim();
      if(!/^[0-9]{8}$/.test(id||'')||!name||name.length<3)
        return familyNotice('Enter the 8-digit ID and Family Name');
      invoke('POST','/family/bd/grant',{owner_public_id:id,name,
        request_id:'family:'+crypto.randomUUID()},'Grant family to '+id+'?');
    });
    target.querySelector('#sh-fam-leave')?.addEventListener('click',()=>
      invoke('POST','/family/leave',{},'Leave this Family?'));
    target.querySelector('#sh-fam-transfer')?.addEventListener('click',()=>{
      const id=target.querySelector('#sh-fam-seller')?.value?.trim();
      const crystals=Number(target.querySelector('#sh-fam-amount')?.value);
      if(!/^[0-9]{8}$/.test(id||'')||!Number.isSafeInteger(crystals)||crystals<1)
        return familyNotice('Enter seller ID and whole Crystals');
      invoke('POST','/family/crystal/transfer',{seller_public_id:id,crystals,
        request_id:'crystal:'+crypto.randomUUID()},
      'Reserve '+crystals+' Crystal for seller '+id+'?');
    });
    const detail=async(url,title,map)=>{
      familyNotice('Loading…');
      try{
        const result=await api('GET',url);
        const lines=map(result);
        target.innerHTML='<h3>'+famEsc(title)+'</h3>'+
          '<button type="button" id="sh-fam-detail-back">‹ Agency Dashboard</button>'+
          (lines.length?'<ul class="sh-fam-list">'+lines.join('')+'</ul>':
            '<p>No verified records yet.</p>');
        target.querySelector('#sh-fam-detail-back').onclick=()=>renderRoyalFamily(data);
        familyNotice('');
      }catch(error){familyNotice('Unavailable: '+errText(error));}
    };
    target.querySelector('#sh-fam-ledger')?.addEventListener('click',()=>detail(
      '/family/ledger','Verified Crystal & Coin Transfer Ledger',r=>[
        ...(r.credits||[]).map(x=>'<li>+'+fmtUnits(x.crystal_units)+
          ' Crystal · '+famEsc(x.kind)+' · Gift #'+famEsc(x.transaction_id)+
          '<small> · '+famEsc(x.created_at)+' UTC</small></li>'),
        ...(r.transfers||[]).map(x=>'<li>−'+fmtUnits(x.crystal_units)+
          ' Crystal → '+formatAmount(x.coins_to_seller)+' coins · Seller ID '+
          famEsc(x.seller_id)+' · '+famEsc(x.status)+
          '<small> · '+famEsc(x.created_at)+' UTC</small></li>')
      ]));
    target.querySelector('#sh-fam-bd-list')?.addEventListener('click',()=>detail(
      '/family/bd/families','My Granted Agencies',r=>(r.families||[]).map(x=>
        '<li>'+famEsc(x.name)+' · Owner '+famEsc(x.owner_id)+
        ' · '+famEsc(x.member_count)+' members</li>')));
    target.querySelector('#sh-fam-requests')?.addEventListener('click',async()=>{
      familyNotice('Loading requests…');
      try{
        const result=await api('GET','/family/requests');
        target.innerHTML='<h3>Family Join Requests</h3>'+
          '<button type="button" id="sh-fam-requests-back">‹ Dashboard</button>'+
          (result.requests||[]).map(x=>'<div class="sh-fam-card">'+famEsc(x.name)+
            ' · '+famEsc(x.public_id)+'<br>'+
            '<button data-fam-accept="'+x.id+'">Accept</button>'+
            '<button data-fam-reject="'+x.id+'">Reject</button></div>').join('');
        target.querySelector('#sh-fam-requests-back').onclick=()=>renderRoyalFamily(data);
        target.querySelectorAll('[data-fam-accept],[data-fam-reject]').forEach(button=>{
          button.onclick=()=>invoke('POST','/family/requests/'+
            (button.dataset.famAccept||button.dataset.famReject)+'/'+
            (button.dataset.famAccept?'accept':'reject'),{});
        });
        familyNotice('');
      }catch(error){familyNotice('Unavailable: '+errText(error));}
    });
  }

  // Royal Family V2: faithful four-screen layout without changing balances or payouts.
  const familyRoyalV2Styles=document.createElement('style');
  familyRoyalV2Styles.id='sh-family-v2-royal-css';
  familyRoyalV2Styles.textContent="\n#sh-family-panel{background:radial-gradient(ellipse at 54% -7%,#70401e 0%,#341929 27%,#1b0b20 68%,#100817 100%);color:#f9e9c5;overscroll-behavior:contain}\n#sh-family-panel .sh-fam-wrap{max-width:580px}\n#sh-family-panel .sh-fam-head{padding:8px 0 3px}\n#sh-family-panel .sh-fam-head small{font-size:10px;letter-spacing:1.5px;color:#efc777}\n#sh-family-panel .sh-fam-head+.sh-fam-v2-title,#sh-family-panel h2{font-family:Georgia,serif;font-size:27px;font-weight:900;text-shadow:0 2px 14px #db893b44;letter-spacing:.4px}\n#sh-family-panel .sh-fam-card,#sh-family-panel .sh-fam-app-card{background:linear-gradient(157deg,#512a35 0%,#331a31 52%,#220f26 100%);border:1px solid #ba8439;border-radius:17px;box-shadow:inset 0 1px 0 #ffe2a92e,0 9px 25px #1005168a}\n#sh-family-panel .sh-fam-v2-hero{text-align:center;margin:6px 0 17px;position:relative}\n#sh-family-panel .sh-fam-v2-hero .sh-fam-v2-kicker{display:block;letter-spacing:2px;font-size:10px;color:#efc471;font-weight:800}\n#sh-family-panel .sh-fam-v2-hero h2{display:flex;justify-content:center;align-items:center;gap:8px;margin:11px 0 13px;font-family:Georgia,serif;font-weight:900;letter-spacing:.8px;color:#ffe0a2}\n#sh-family-panel .sh-fam-v2-crown{width:46px;height:46px;object-fit:contain;filter:drop-shadow(0 3px 6px #e59f23b5);animation:shFamCrownFloat 4.2s ease-in-out infinite}\n#sh-family-panel .sh-fam-v2-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:16px}\n#sh-family-panel .sh-fam-v2-stat{border:1px solid #d3a257;border-radius:15px;background:linear-gradient(153deg,#583140,#34192f 70%);min-height:94px;padding:13px 11px;box-shadow:inset 0 1px 0 #fff1bf33,0 8px 18px #0501084d;display:flex;align-items:center;gap:9px;position:relative;overflow:hidden;animation:shFamCardEnter .4s ease both}\n#sh-family-panel .sh-fam-v2-stat:after{content:\"\";position:absolute;width:55px;height:200%;background:#fff5ab0d;transform:rotate(22deg);right:0;top:-50%;pointer-events:none}\n#sh-family-panel .sh-fam-v2-ico{font-size:29px;filter:drop-shadow(0 3px 2px #0006);flex:0 0 35px;animation:shFamIconFloat 4.4s ease-in-out infinite}\n#sh-family-panel .sh-fam-v2-stat small{display:block;font-size:11px;color:#ecd4a6;margin-bottom:4px}\n#sh-family-panel .sh-fam-v2-stat b{display:block;font-size:21px;color:#ffe3a2;line-height:1.12;font-weight:900}\n#sh-family-panel .sh-fam-v2-stat em{font-size:10px;font-style:normal;color:#f5d59a}\n#sh-family-panel .sh-fam-v2-tabs{display:flex;gap:0;border:1px solid #b88a52;border-radius:99px;margin:11px 0 18px;overflow:hidden;background:#251426}\n#sh-family-panel .sh-fam-v2-tabs button{flex:1;padding:11px 5px;background:transparent;color:#f6dfaa;border:0;border-right:1px solid #ae885233;border-radius:0;margin:0;box-shadow:none}\n#sh-family-panel .sh-fam-v2-tabs button[aria-selected=\"true\"]{background:linear-gradient(155deg,#fff1b1,#dca448);color:#361b0a;box-shadow:inset 0 2px 2px #fff7c5aa}\n#sh-family-panel .sh-fam-v2-members{padding:14px 11px}\n#sh-family-panel .sh-fam-v2-members h3{display:flex;align-items:center;justify-content:space-between;margin:1px 0 13px;font-size:17px}\n#sh-family-panel .sh-fam-v2-members h3 small{color:#ffe7b4;font-size:12px;font-weight:600}\n#sh-family-panel .sh-fam-v2-member{width:100%;display:flex;align-items:center;gap:9px;min-height:74px;text-align:left;background:linear-gradient(145deg,#66384d,#381830)!important;color:#ffe5ad!important;border:1px solid #c28c4c!important;border-radius:14px!important;padding:8px 10px!important;margin:6px 0!important;box-shadow:inset 0 1px 0 #ffe3b73d,0 4px 8px #0701076e;transition:transform .18s ease,box-shadow .18s ease}\n#sh-family-panel .sh-fam-v2-member:active,#sh-family-panel .sh-fam-v2-action:active{transform:perspective(550px) rotateX(4deg) scale(.98)}\n#sh-family-panel .sh-fam-v2-member-num{flex:0 0 27px;font-family:Georgia,serif;font-size:17px;font-weight:900;color:#ffd076}\n#sh-family-panel .sh-fam-v2-member-avatar{width:43px;height:43px;border:2px solid #e0ac4c;border-radius:50%;object-fit:cover;background:#653c50;box-shadow:0 0 13px #e8a64277}\n#sh-family-panel .sh-fam-v2-member-copy{flex:1;min-width:0}\n#sh-family-panel .sh-fam-v2-member-copy b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n#sh-family-panel .sh-fam-v2-member-copy small{display:block;font-size:10px;color:#dbbc98;margin-top:4px}\n#sh-family-panel .sh-fam-v2-member-total{font-size:12px;text-align:right;font-weight:900;white-space:nowrap}\n#sh-family-panel .sh-fam-v2-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px}\n#sh-family-panel .sh-fam-v2-action{min-height:53px;width:100%;font-size:12px;text-align:center;padding:10px 6px!important;margin:0!important;border-radius:13px!important}\n#sh-family-panel .sh-fam-v2-advanced{margin-top:18px;padding:12px;border-color:#805c47;background:#1f1025a8}\n#sh-family-panel .sh-fam-v2-advanced>summary{font-size:14px;color:#ffdfa4;cursor:pointer}\n#sh-family-panel .sh-fam-v2-advanced .sh-fam-card{margin:12px 0}\n#sh-family-panel .sh-fam-v2-detail-card{padding:15px 13px;text-align:left}\n#sh-family-panel .sh-fam-v2-member-head{display:flex;align-items:center;gap:14px;margin:4px 0 16px}\n#sh-family-panel .sh-fam-v2-member-head img{width:63px;height:63px;border-radius:50%;border:2px solid #e7b85b;object-fit:cover}\n#sh-family-panel .sh-fam-v2-member-head strong{font-size:18px;color:#ffdfa2}\n#sh-family-panel .sh-fam-v2-member-head small{display:block;font-size:12px;color:#ebd1aa}\n#sh-family-panel .sh-fam-v2-daily{display:flex;flex-direction:column;gap:7px;margin-top:12px}\n#sh-family-panel .sh-fam-v2-daily button{width:100%;text-align:left;background:linear-gradient(110deg,#654050,#422037);color:#ffdfb5;border:1px solid #82576b;display:flex;align-items:center;justify-content:space-between}\n#sh-family-panel .sh-fam-v2-daily button[aria-selected=\"true\"]{border-color:#ffdf92;background:#7a4666}\n#sh-family-panel .sh-fam-v2-seller-row{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:12px;border:1px solid #9b7157;background:#3f2235;border-radius:14px;margin:9px 0}\n#sh-family-panel .sh-fam-v2-seller-row b{display:block;font-size:14px}\n#sh-family-panel .sh-fam-v2-seller-row small{display:block;font-size:11px;color:#eed1a8}\n#sh-family-panel .sh-fam-v2-seller-row button{margin:0;font-size:12px}\n#sh-family-panel .sh-fam-v2-seller-row[aria-selected=\"true\"]{border:2px solid #f6cb64}\n#sh-family-panel .sh-fam-v2-hint{font-size:12px;color:#f9d58f;line-height:1.5}\n#sh-family-panel .sh-fam-v2-pending{background:#3a1b2a;border:1px solid #c8934b;border-radius:12px;padding:10px;font-size:12px;margin:10px 0}\n#sh-family-panel .sh-fam-v2-title{margin:8px 0 12px;text-align:center}\n#sh-family-panel .sh-fam-v2-topline{color:#eabc67;text-align:center;letter-spacing:1.5px;font-weight:800;font-size:11px}\n#sh-family-panel .sh-fam-v2-bd{padding:20px 15px}\n#sh-family-panel button:focus-visible{outline:2px solid #fff1ac;outline-offset:2px}\n@keyframes shFamCrownFloat{0%,100%{transform:translateY(0) rotateY(-6deg)}50%{transform:translateY(-5px) rotateY(6deg)}}\n@keyframes shFamIconFloat{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-3px) rotate(3deg)}}\n@keyframes shFamCardEnter{from{opacity:0;transform:perspective(700px) rotateX(8deg) translateY(8px)}to{opacity:1;transform:perspective(700px) rotateX(0) translateY(0)}}\n@media(max-width:380px){#sh-family-panel .sh-fam-v2-stat{padding:10px 7px}#sh-family-panel .sh-fam-v2-ico{font-size:23px;flex-basis:27px}#sh-family-panel .sh-fam-v2-stat b{font-size:17px}}\n@media(prefers-reduced-motion:reduce){#sh-family-panel .sh-fam-v2-ico,#sh-family-panel .sh-fam-v2-crown,#sh-family-panel .sh-fam-v2-stat{animation:none!important}#sh-family-panel .sh-fam-v2-member{transition:none}}\n\n#sh-family-panel .sh-fam-wrap>h2{display:none}\n#sh-family-panel #sh-fam-body.sh-fam-v2-dashboard{background:transparent;border:0;box-shadow:none;padding:0;margin:0}\n#sh-family-panel #sh-fam-body.sh-fam-v2-dashboard>.sh-fam-v2-advanced{margin-bottom:24px}\n";
  document.head.appendChild(familyRoyalV2Styles);
  const famAmount=n=>Math.max(0,Number(n)||0).toLocaleString('en-US',{maximumFractionDigits:0});
  const famCrystals=n=>(Math.max(0,Number(n)||0)/10000).toLocaleString('en-US',{maximumFractionDigits:4});
  const famPic=(name,pic)=>{
    const url=verifiedAvatarUrl(pic);
    return url?'<img class="sh-fam-v2-member-avatar" src="'+famEsc(url)+'" alt="">':
      '<span class="sh-fam-v2-member-avatar" style="display:grid;place-items:center">👤</span>';
  };
  const famTopLabel=title=>'<div class="sh-fam-v2-topline">SHARIKA · '+famEsc(title)+'</div>';
  const famViewBack=()=>{
    const panel=document.getElementById('sh-family-panel');
    if(panel){panel.dataset.mode='family';panel.querySelector('.sh-fam-head small').textContent='SHARIKA · ROYAL FAMILY';}
    if(familyCache)renderRoyalFamily(familyCache);
  };
  async function showFamilyMemberReport(id,data){
    const host=document.querySelector('#sh-family-panel #sh-fam-body');
    if(!host)return;
    host.innerHTML='<p role="status">Loading verified member report…</p>';
    try{
      const r=await api('GET','/family/members/'+encodeURIComponent(id)+'/report');
      if(!host.isConnected||document.getElementById('sh-family-panel')?.hidden)return;
      const m=r.member||{},summary=r.summary||{},daily=r.daily||[],events=r.events||[];
      const today=new Date().toISOString().slice(0,10);
      let selected=daily[0]?.day||today,period='daily';
      const avatar=verifiedAvatarUrl(m.pic);
      host.innerHTML=famTopLabel('FAMILY MEMBER REPORT')+
        '<button id="sh-fam-member-back" type="button">‹ Family Dashboard</button>'+
        '<h2 class="sh-fam-v2-title">👑 MEMBER REPORT</h2>'+
        '<section class="sh-fam-card sh-fam-v2-detail-card">'+
          '<div class="sh-fam-v2-member-head">'+(avatar?'<img src="'+famEsc(avatar)+'" alt="">':'<span class="sh-fam-v2-ico">👤</span>')+
          '<div><strong>'+famEsc(m.name)+'</strong><small>ID '+famEsc(m.public_id)+
          ' · '+famEsc(m.role)+'</small></div></div>'+
          '<div class="sh-fam-v2-stats">'+
          '<div class="sh-fam-v2-stat"><span class="sh-fam-v2-ico">💎</span><div><small>Lifetime Gifts</small><b>'+
          famAmount(summary.total_diamonds)+'</b><em>Diamonds</em></div></div>'+
          '<div class="sh-fam-v2-stat"><span class="sh-fam-v2-ico">🪙</span><div><small>Family Salary</small><b>'+
          (summary.salary_coins==null?'Not set':famAmount(summary.salary_coins))+
          '</b><em>Coins</em></div></div>'+
          '<div class="sh-fam-v2-stat"><span class="sh-fam-v2-ico">🎁</span><div><small>Verified Gifts</small><b>'+
          famAmount(summary.gift_count)+'</b><em>Events</em></div></div>'+
          '<div class="sh-fam-v2-stat"><span class="sh-fam-v2-ico">💠</span><div><small>Current Crystal</small><b>'+
          famCrystals(r.crystal_wallet?.available_units)+'</b><em>Crystal</em></div></div>'+
          '</div><small class="sh-fam-note">Verified regular gifts after joining this Family · UTC dates. Lucky gifts excluded from diamond target.</small></section>'+
        '<section class="sh-fam-card sh-fam-v2-detail-card"><h3>📅 Daily Activity Ledger</h3>'+
        '<div class="sh-fam-v2-tabs" role="tablist" aria-label="Gift report period">'+
        '<button data-fam-report-period="daily" aria-selected="true">Daily</button>'+
        '<button data-fam-report-period="weekly" aria-selected="false">Weekly</button>'+
        '<button data-fam-report-period="monthly" aria-selected="false">Monthly</button></div>'+
        '<div id="sh-fam-member-daily" class="sh-fam-v2-daily"></div></section>'+
        '<section class="sh-fam-card sh-fam-v2-detail-card"><h3>🎁 Gift History</h3>'+
        '<p class="sh-fam-v2-hint" id="sh-fam-member-date"></p>'+
        '<div id="sh-fam-member-gifts" class="sh-fam-v2-daily"></div></section>';
      host.querySelector('#sh-fam-member-back').onclick=famViewBack;
      const dailyHost=host.querySelector('#sh-fam-member-daily');
      const giftsHost=host.querySelector('#sh-fam-member-gifts');
      const draw=()=>{
        const days=period==='daily'?daily:
          Object.values(daily.reduce((acc,x)=>{
            const d=new Date(x.day+'T00:00:00Z'),key=period==='weekly'?
              new Date(d.getTime()-((d.getUTCDay()+6)%7)*86400000).toISOString().slice(0,10):
              x.day.slice(0,7);
            const ref=acc[key]||(acc[key]={day:key,diamonds:0,gift_count:0});
            ref.diamonds+=Number(x.diamonds)||0;ref.gift_count+=Number(x.gift_count)||0;return acc;
          },{})).sort((a,b)=>b.day.localeCompare(a.day));
        dailyHost.innerHTML=days.length?days.slice(0,90).map(x=>
          '<button type="button" data-fam-day="'+famEsc(x.day)+'" aria-selected="'+String(selected===x.day)+'">'+
          '<span>💎 '+famEsc(x.day)+'</span><strong>'+famAmount(x.diamonds)+' Diamonds</strong></button>').join(''):
          '<p class="sh-fam-note">No verified gifts in this period.</p>';
        const matches=events.filter(x=>period==='daily'?x.day===selected:
          period==='monthly'?x.day.slice(0,7)===selected:
          x.day>=selected&&x.day<=new Date(new Date(selected+'T00:00:00Z').getTime()+6*86400000).toISOString().slice(0,10));
        host.querySelector('#sh-fam-member-date').textContent='Selected '+selected+' · '+period+' · UTC';
        giftsHost.innerHTML=matches.length?matches.map((x,i)=>
          '<div class="sh-fam-v2-seller-row"><div><b>'+famEsc(x.gift_name)+' ×'+famAmount(x.quantity)+
          '</b><small>'+famEsc(x.created_at)+'</small></div><strong>💎 '+famAmount(x.diamonds)+'</strong></div>').join(''):
          '<p class="sh-fam-note">No gifts recorded for this date.</p>';
        dailyHost.querySelectorAll('[data-fam-day]').forEach(button=>button.onclick=()=>{
          selected=button.dataset.famDay;draw();
        });
      };
      host.querySelectorAll('[data-fam-report-period]').forEach(button=>button.onclick=()=>{
        period=button.dataset.famReportPeriod;
        host.querySelectorAll('[data-fam-report-period]').forEach(x=>x.setAttribute('aria-selected',String(x===button)));
        selected=period==='monthly'?today.slice(0,7):today;
        const available=period==='daily'?daily:
          daily.map(x=>({day:period==='monthly'?x.day.slice(0,7):x.day}));
        if(!available.some(x=>x.day===selected))selected=available[0]?.day||selected;
        draw();
      });
      draw();
    }catch(error){
      host.innerHTML='<button id="sh-fam-member-back" type="button">‹ Family Dashboard</button>'+
        '<p class="sh-fam-status">Member report unavailable: '+famEsc(errText(error))+'</p>';
      host.querySelector('#sh-fam-member-back').onclick=famViewBack;
    }
  }
  async function showFamilySellerDirectory(data){
    const host=document.querySelector('#sh-family-panel #sh-fam-body');
    if(!host)return;
    host.innerHTML='<p role="status">Loading verified Coin Sellers…</p>';
    try{
      const result=await api('GET','/sellers');
      if(!host.isConnected)return;
      const sellers=result.sellers||[],policy=data.policy||{},wallet=data.wallet||{};
      let selected=sellers[0]?.public_id||'';
      host.innerHTML=famTopLabel('FAMILY CENTER · CRYSTAL TRANSFER')+
        '<button id="sh-fam-sellers-back" type="button">‹ Family Dashboard</button>'+
        '<h2 class="sh-fam-v2-title">👑 COIN SELLERS</h2>'+
        '<section class="sh-fam-card sh-fam-v2-detail-card">'+
        '<div class="sh-fam-v2-stat"><span class="sh-fam-v2-ico">💎</span><div>'+
        '<small>Available Crystal</small><b>'+famCrystals(wallet.available_units)+'</b><em>Crystal</em></div></div>'+
        '<label>Search Seller ID<input type="search" id="sh-fam-seller-search" placeholder="Search seller name or ID"></label>'+
        '<div id="sh-fam-seller-list"></div></section>'+
        '<section class="sh-fam-card sh-fam-v2-detail-card"><h3>💎 Exchange Request</h3>'+
        '<p class="sh-fam-v2-hint" id="sh-fam-selected-seller"></p>'+
        '<label>Amount to Send (whole Crystals)<input id="sh-fam-seller-amount" inputmode="numeric" type="number" min="1" max="1000000"></label>'+
        '<p class="sh-fam-v2-hint">Rate: '+famAmount(policy.coins_per_crystal)+
        ' coins per Crystal · Admin-configured.</p>'+
        '<button type="button" id="sh-fam-seller-send">Send Transfer Request</button>'+
        '<p class="sh-fam-v2-pending">⚠ Transfer reserves Crystals until approval. No coins are settled before the required authorization.</p></section>';
      host.querySelector('#sh-fam-sellers-back').onclick=famViewBack;
      const list=host.querySelector('#sh-fam-seller-list');
      const search=host.querySelector('#sh-fam-seller-search');
      const paint=()=>{
        const q=String(search.value||'').trim().toLowerCase();
        const filtered=sellers.filter(s=>String(s.public_id).includes(q)||String(s.name||'').toLowerCase().includes(q));
        list.innerHTML=filtered.length?filtered.map(s=>
          '<div class="sh-fam-v2-seller-row" aria-selected="'+String(selected===s.public_id)+'">'+
          '<div><b>'+famEsc(s.name)+'</b><small>Verified · ID '+famEsc(s.public_id)+
          ' · '+(s.unlimited_stock?'Unlimited Stock':s.available_coins==null?'Coins: ask seller':'Available: '+formatCompactCoins(s.available_coins)+' Coins')+
          '</small></div><button type="button" data-fam-seller="'+famEsc(s.public_id)+'">Select</button></div>').join(''):
          '<p class="sh-fam-note">No matching approved sellers.</p>';
        const picked=sellers.find(s=>s.public_id===selected);
        host.querySelector('#sh-fam-selected-seller').textContent=picked?
          'Selected: '+picked.name+' · '+picked.public_id:'Choose a seller';
        list.querySelectorAll('[data-fam-seller]').forEach(btn=>btn.onclick=()=>{
          selected=btn.dataset.famSeller;paint();
        });
      };
      search.oninput=paint;paint();
      host.querySelector('#sh-fam-seller-send').onclick=async()=>{
        const crystals=Number(host.querySelector('#sh-fam-seller-amount').value);
        if(!selected||!Number.isSafeInteger(crystals)||crystals<1||
          crystals>1000000||crystals>Number(wallet.available_units||0)/10000)
          return familyNotice('Select a seller and enter an available whole-Crystal amount.');
        if(!window.confirm('Request transfer of '+crystals+' Crystal to seller '+selected+'?'))return;
        const button=host.querySelector('#sh-fam-seller-send');button.disabled=true;
        familyNotice('Submitting verified request…');
        try{
          const response=await api('POST','/family/crystal/transfer',{
            seller_public_id:selected,crystals,request_id:'crystal:'+crypto.randomUUID()
          });
          familyNotice('Request #'+response.transfer_id+' is '+response.status+
            '. Crystal is reserved until the server-authorized decision.');
          button.textContent='Request Submitted ✓';
          setTimeout(()=>{if(button.isConnected){button.disabled=false;button.textContent='Send Transfer Request';}},2500);
        }catch(error){familyNotice('Transfer failed: '+errText(error));button.disabled=false;}
      };
    }catch(error){
      host.innerHTML='<button id="sh-fam-sellers-back" type="button">‹ Family Dashboard</button>'+
        '<p class="sh-fam-status">Seller directory unavailable: '+famEsc(errText(error))+'</p>';
      host.querySelector('#sh-fam-sellers-back').onclick=famViewBack;
    }
  }
  const renderRoyalFamilyLegacy=renderRoyalFamily;
  renderRoyalFamily=function(data){
    renderRoyalFamilyLegacy(data);
    const host=document.querySelector('#sh-family-panel #sh-fam-body');
    if(!host)return;
    if(!data.family){
      host.querySelectorAll('details').forEach(x=>{
        if(x.querySelector('summary')?.textContent.includes('BD Family Grant'))x.remove();
      });
      return;
    }
    const family=data.family,progress=data.target_progress||{},wallet=data.wallet||{};
    const members=family.members||[];
    const original=document.createElement('div');
    while(host.firstChild)original.appendChild(host.firstChild);
    original.querySelectorAll('.sh-fam-card').forEach(x=>{
      if(x.querySelector('h3')?.textContent.includes('BD Family Grant'))x.remove();
    });
    const advanced=document.createElement('details');
    advanced.className='sh-fam-v2-advanced';
    advanced.innerHTML='<summary>⚙ Family Management, Invitations & Verified Ledger</summary>';
    advanced.appendChild(original);
    host.classList.add('sh-fam-v2-dashboard');
    const dashboard=document.createElement('div');
    dashboard.innerHTML='<header class="sh-fam-v2-hero">'+
      '<small class="sh-fam-v2-kicker">SHARIKA · FAMILY CENTER</small>'+
      '<h2><img class="sh-fam-v2-crown" src="profile-crown.webp" alt="">ROYAL FAMILY</h2>'+
      '<small class="sh-fam-note">'+famEsc(family.name)+' · Level '+famEsc(family.level)+'</small></header>'+
      '<div class="sh-fam-v2-stats">'+
      '<div class="sh-fam-v2-stat"><span class="sh-fam-v2-ico">💠</span><div><small>Crystal Wallet</small><b>'+
      famCrystals(wallet.available_units)+'</b><em>Crystal</em></div></div>'+
      '<div class="sh-fam-v2-stat"><span class="sh-fam-v2-ico">👥</span><div><small>Family Members</small><b>'+
      famAmount(family.member_count)+'</b><em>Members</em></div></div>'+
      '<div class="sh-fam-v2-stat"><span class="sh-fam-v2-ico">💎</span><div><small id="sh-fam-v2-period-label">Verified Gift Total</small><b id="sh-fam-v2-gift-value">'+
      famAmount(progress.lifetime)+'</b><em>Diamonds</em></div></div>'+
      '<div class="sh-fam-v2-stat"><span class="sh-fam-v2-ico">🪙</span><div><small>Family Salary</small><b>Not set</b><em>Coins · awaiting policy</em></div></div>'+
      '</div><div class="sh-fam-v2-tabs" role="tablist" aria-label="Family activity range">'+
      '<button type="button" data-fam-stat-period="today" aria-selected="true">Today</button>'+
      '<button type="button" data-fam-stat-period="week" aria-selected="false">Week</button>'+
      '<button type="button" data-fam-stat-period="month" aria-selected="false">Month</button></div>'+
      '<section class="sh-fam-card sh-fam-v2-members"><h3>👥 Family Members <small>'+
      famAmount(members.length)+' Members</small></h3>'+
      members.map((m,i)=>'<button type="button" class="sh-fam-v2-member" data-fam-v2-member="'+famEsc(m.public_id)+'">'+
        '<span class="sh-fam-v2-member-num">'+String(i+1).padStart(2,'0')+'</span>'+
        famPic(m.name,m.pic)+'<span class="sh-fam-v2-member-copy"><b>'+famEsc(m.name)+
        '</b><small>ID: '+famEsc(m.public_id)+' · '+famEsc(m.role)+'</small></span>'+
        '<span class="sh-fam-v2-member-total">💎 '+famAmount(m.total_diamonds)+' ›</span></button>').join('')+
      '</section>'+
      '<div class="sh-fam-v2-actions"><button type="button" id="sh-fam-v2-ledger" class="sh-fam-v2-action">💎 Crystal Ledger</button>'+
      '<button type="button" id="sh-fam-v2-sellers" class="sh-fam-v2-action">🪙 Find Coin Seller</button></div>';
    host.appendChild(dashboard);
    host.appendChild(advanced);
    dashboard.querySelectorAll('[data-fam-stat-period]').forEach(button=>button.onclick=()=>{
      const range=button.dataset.famStatPeriod;
      dashboard.querySelectorAll('[data-fam-stat-period]').forEach(x=>x.setAttribute('aria-selected',String(x===button)));
      dashboard.querySelector('#sh-fam-v2-gift-value').textContent=
        famAmount(progress[range]||0);
      dashboard.querySelector('#sh-fam-v2-period-label').textContent=
        (range==='today'?'Today':range==='week'?'This Week':'This Month')+' Gift Total';
    });
    dashboard.querySelector('[data-fam-stat-period="today"]')?.click();
    dashboard.querySelectorAll('[data-fam-v2-member]').forEach(button=>button.onclick=()=>{
      const id=button.dataset.famV2Member;
      if(family.role!=='leader'&&id!==profile?.public_id)
        return familyNotice('Only the Family Owner can view another member’s private report.');
      showFamilyMemberReport(id,data);
    });
    dashboard.querySelector('#sh-fam-v2-ledger').onclick=()=>{
      advanced.open=true;
      const ledger=advanced.querySelector('#sh-fam-ledger');
      if(ledger){ledger.click();advanced.scrollIntoView({behavior:'smooth'});}
    };
    dashboard.querySelector('#sh-fam-v2-sellers').onclick=()=>{
      if(data.policy?.conversion_enabled)showFamilySellerDirectory(data);
      else familyNotice('Crystal conversion is currently disabled by Admin.');
    };
  };
  async function openRoyalBD(){
    if(!session){window.showAuth('welcome');return;}
    await openRoyalFamily();
    const layer=document.getElementById('sh-family-panel');
    const data=familyCache;
    if(!layer||!data)return;
    const host=layer.querySelector('#sh-fam-body');
    layer.dataset.mode='bd';
    layer.querySelector('.sh-fam-head small').textContent='SHARIKA · BD CENTER';
    layer.querySelector('h2').textContent='💼 BD CENTER';
    if(!data.bd?.active||!data.bd?.can_grant){
      host.innerHTML='<p class="sh-fam-status">BD permissions are required.</p>';return;
    }
    host.innerHTML=famTopLabel('SEPARATE BD MANAGEMENT')+
      '<section class="sh-fam-card sh-fam-v2-bd"><h3>💼 BD Family Grant</h3>'+
      '<p class="sh-fam-v2-hint">BD commission: '+famEsc(data.policy?.bd_percent)+
      '% of eligible Family gifts. This dashboard is independent of your own Family.</p>'+
      '<label>Owner 8-digit ID<input id="sh-bd-v2-owner" maxlength="8" inputmode="numeric"></label>'+
      '<label>Family Name<input id="sh-bd-v2-name" maxlength="40"></label>'+
      '<button type="button" id="sh-bd-v2-grant">Grant Family</button>'+
      '<button type="button" id="sh-bd-v2-list">My Granted Families</button>'+
      '<div id="sh-bd-v2-result"></div></section>';
    host.querySelector('#sh-bd-v2-grant').onclick=async()=>{
      const id=host.querySelector('#sh-bd-v2-owner').value.trim();
      const name=host.querySelector('#sh-bd-v2-name').value.trim();
      if(!/^[0-9]{8}$/.test(id)||name.length<3)return familyNotice('Enter valid owner ID and Family name.');
      if(!window.confirm('Grant Family '+name+' to '+id+'?'))return;
      try{
        await api('POST','/family/bd/grant',{owner_public_id:id,name,
          request_id:'family:'+crypto.randomUUID()});
        familyNotice('BD Family Grant verified ✓');
        host.querySelector('#sh-bd-v2-name').value='';
      }catch(error){familyNotice('Grant failed: '+errText(error));}
    };
    host.querySelector('#sh-bd-v2-list').onclick=async()=>{
      const target=host.querySelector('#sh-bd-v2-result');target.textContent='Loading…';
      try{
        const result=await api('GET','/family/bd/families');
        target.innerHTML=(result.families||[]).map(x=>
          '<div class="sh-fam-v2-seller-row"><div><b>'+famEsc(x.name)+'</b>'+
          '<small>Owner '+famEsc(x.owner_id)+' · '+famAmount(x.member_count)+
          ' members · '+famEsc(x.status)+'</small></div></div>').join('')||
          '<p class="sh-fam-note">No BD grants yet.</p>';
      }catch(error){target.textContent='Unavailable: '+errText(error);}
    };
  }

  window.sharikaOpenRoyalFamily=openRoyalFamily;


  // A real, separate Settings Center replaces the inherited small settings sheet.
  // Existing profile identity, balances and backend permissions are unchanged.
  const royalSettingsCss=document.createElement('style');
  royalSettingsCss.id='sh-royal-settings-css';
  royalSettingsCss.textContent=[
    '#sh-settings-page[hidden]{display:none!important}',
    '#sh-settings-page{position:fixed;z-index:2147483550;inset:0;overflow:auto;',
    'background:radial-gradient(circle at 50% -12%,#65459b 0%,#21143f 45%,#0c0618 100%);',
    'color:#fef0ca;padding:calc(18px + env(safe-area-inset-top,0px)) 16px calc(26px + env(safe-area-inset-bottom,0px))}',
    '#sh-settings-page .sh-set-wrap{max-width:640px;margin:auto}',
    '#sh-settings-page .sh-set-head{display:flex;align-items:center;gap:12px;margin-bottom:20px}',
    '#sh-settings-page .sh-set-back{min-width:44px;height:44px;border-radius:15px;background:#251638;color:#ffe3a0;',
    'border:1px solid #d9aa53;font-size:26px}',
    '#sh-settings-page .sh-set-title{font-size:23px;font-weight:900;color:#ffe8a7}',
    '#sh-settings-page .sh-set-intro{font-size:13px;opacity:.88;line-height:1.5;margin:2px 0 20px}',
    '#sh-settings-page .sh-set-card{background:linear-gradient(142deg,#4d3158,#201532);',
    'border:1px solid #c59a58;border-radius:20px;padding:16px;margin:12px 0;',
    'box-shadow:inset 0 1px #fff4,0 8px 24px #05020e77}',
    '#sh-settings-page .sh-set-card h3{color:#ffe1a1;font-size:17px;margin:0 0 12px}',
    '#sh-settings-page .sh-set-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;',
    'padding:15px 12px;margin:6px 0;color:#fff1d1;border:1px solid #ae8553;border-radius:14px;',
    'background:linear-gradient(105deg,#4c2a5d,#241633);font-size:15px;font-weight:750}',
    '#sh-settings-page .sh-set-row .sh-set-ico{font-size:23px;min-width:32px;text-align:center}',
    '#sh-settings-page .sh-set-row small{display:block;font-weight:450;font-size:11px;opacity:.85;margin-top:3px}',
    '#sh-settings-page .sh-set-row b:last-child{margin-left:auto;font-size:20px;color:#e1b971}',
    '#sh-settings-page .sh-set-note{font-size:13px;line-height:1.6;opacity:.94}',
    '#sh-settings-page .sh-set-field{display:block;width:100%;box-sizing:border-box;margin:10px 0;',
    'border:1px solid #b59562;border-radius:12px;background:#140f25;color:#fff;padding:13px;font-size:15px}',
    '#sh-settings-page .sh-set-cta{width:100%;padding:14px;margin-top:10px;border:1px solid #f5d58a;',
    'border-radius:14px;background:linear-gradient(#fff1b2,#ce984a);color:#2e173a;font-weight:900;font-size:15px}',
    '#sh-settings-page .sh-set-cta:disabled{opacity:.55}',
    '#sh-settings-page .sh-set-error{color:#ffc0c0;min-height:20px;margin:8px 0;font-size:13px}',
    '#sh-settings-page .sh-set-policy h4{color:#ffe2a8;margin:18px 0 7px}',
    '#sh-settings-page .sh-set-policy p{white-space:pre-wrap;line-height:1.58;font-size:13px}',
    '#sh-settings-page button:focus-visible,#sh-settings-page input:focus-visible,',
    '#sh-settings-page textarea:focus-visible{outline:2px solid #ffe9a8;outline-offset:3px}'
  ].join('');
  document.head.appendChild(royalSettingsCss);
  let settingsPageView='home';
  function sharikaCloseSettings(){
    const page=document.getElementById('sh-settings-page');
    if(page)page.hidden=true;
  }
  function sharikaSettingsBack(){
    const page=document.getElementById('sh-settings-page');
    if(!page||page.hidden)return false;
    if(settingsPageView==='home')sharikaCloseSettings();
    else showSettingsView('home');
    return true;
  }
  window.sharikaSettingsBack=sharikaSettingsBack;
  function settingActionButton(label,icon,sub,route){
    return '<button type="button" class="sh-set-row" data-sh-settings-route="'+route+'">'+
      '<span class="sh-set-ico" aria-hidden="true">'+icon+'</span><span>'+label+
      '<small>'+sub+'</small></span><b aria-hidden="true">›</b></button>';
  }
  function showSettingsView(view){
    const page=document.getElementById('sh-settings-page');
    if(!page)return;
    settingsPageView=view;
    page.querySelector('.sh-set-title').textContent=({
      home:'Settings',safety:'Safety Center',policies:'Privacy & Policies',
      privacy:'Privacy Policy',terms:'Terms & Conditions',
      community:'Community Rules',account:'Account & Support',
      voice:'Voice & Notifications',report:'Report a User',deletion:'Delete Account Request'
    })[view]||'Settings';
    const body=page.querySelector('.sh-set-body');body.textContent='';
    let html='';
    if(view==='home')html=
      '<p class="sh-set-intro">Your account, safety, privacy and community policies in one place.</p>'+
      settingActionButton('Safety Center','🛡️','Report users • room moderation • community rules','safety')+
      settingActionButton('Privacy & Policies','🔒','Privacy Policy • Terms & Conditions','policies')+
      settingActionButton('Account & Support','👤','Country • customer support • deletion request','account')+
      settingActionButton('Voice & Notifications','🎙️','Microphone check • phone alerts','voice');
    if(view==='safety')html=
      '<div class="sh-set-card"><h3>Stay safe in Sharika</h3><p class="sh-set-note">Do not share passwords, verification codes or private information. Report abuse to customer support. Room owners and assigned admins can kick or block users from their own rooms using Room Safety.</p></div>'+
      settingActionButton('Report a User','🚩','Send a verified abuse report to Sharika support','report')+
      settingActionButton('Community Rules','📜','Abuse, harassment, fraud and unsafe content','community')+
      '<div class="sh-set-card"><h3>Room controls</h3><p class="sh-set-note">Open the room management button while in your room to use Kick (10 min), Block and Unblock. Only the owner or a granted room admin has those permissions.</p></div>';
    if(view==='policies')html=
      settingActionButton('Privacy Policy','🔒','What Sharika collects and why','privacy')+
      settingActionButton('Terms & Conditions','📄','Accounts • coins • gifts • community','terms')+
      settingActionButton('Community Rules','🛡️','How to report unsafe behavior','community');
    if(view==='account')html=
      '<div class="sh-set-card"><h3>My account</h3><p class="sh-set-note" id="sh-set-account-summary"></p></div>'+
      '<button class="sh-set-row" data-sh-settings-action="country"><span class="sh-set-ico">🌍</span><span>Country / Location<small>Choose manually • GPS is not required</small></span><b>›</b></button>'+
      settingActionButton('Request Account Deletion','🗑️','Verified support request • review required','deletion')+
      '<button class="sh-set-row" data-sh-settings-action="support"><span class="sh-set-ico">🎧</span><span>Customer Service<small>See your support conversation</small></span><b>›</b></button>'+
      '<button class="sh-set-row" data-sh-settings-action="logout"><span class="sh-set-ico">🚪</span><span>Sign out<small>Leave this device signed out</small></span><b>›</b></button>';
    if(view==='voice')html=
      '<div class="sh-set-card"><h3>Voice quality</h3><p class="sh-set-note">Sharika requests echo cancellation, noise suppression and automatic gain control when starting the room microphone. Use wired headphones in a noisy place, and check your Internet connection if speech drops. No voice recording is saved by this test.</p>'+
      '<button class="sh-set-cta" data-sh-settings-action="microphone">🎙️ Check my microphone permission</button><p class="sh-set-error" role="status"></p></div>'+
      '<button class="sh-set-row" data-sh-settings-action="enablepush"><span class="sh-set-ico">🔔</span><span>Enable phone alerts<small>Notification permission is requested only when you tap here</small></span><b>›</b></button>';
    if(view==='report')html=
      '<div class="sh-set-card"><h3>Report a user</h3><p class="sh-set-note">Reports go to Sharika Customer Service for review. Reporting does not instantly block the user.</p>'+
      '<input class="sh-set-field" id="sh-set-report-id" inputmode="numeric" maxlength="10" placeholder="User ID (1–10 digits)" aria-label="User ID">'+
      '<textarea class="sh-set-field" id="sh-set-report-reason" maxlength="600" rows="4" placeholder="Describe what happened (at least 10 characters)" aria-label="Report reason"></textarea>'+
      '<button class="sh-set-cta" data-sh-settings-action="report">Send report</button><p class="sh-set-error" role="status"></p></div>';
    if(view==='deletion')html=
      '<div class="sh-set-card"><h3>Request deletion of your Sharika account</h3>'+
      '<p class="sh-set-note">This submits an authenticated request to Customer Service. Your account is NOT automatically deleted. Sharika must verify ownership and review balances, transactions and any records that must legally be retained. Support will respond in your Customer Service thread.</p>'+
      '<label class="sh-set-note"><input type="checkbox" id="sh-set-delete-confirm"> I understand my account and associated app data may be permanently deleted after verification.</label>'+
      '<button class="sh-set-cta" data-sh-settings-action="delete">Submit deletion request</button><p class="sh-set-error" role="status"></p></div>';
    if(view==='community')html='<div class="sh-set-card sh-set-policy"><h3>Sharika Community Rules</h3>'+
      '<p>No harassment, threats, bullying, hate speech, sexual exploitation, violence, illegal content, fraud, impersonation, spam, or exposing others’ private information. Do not share another user’s voice or images without their permission.</p>'+
      '<p>Report users and incidents through Safety Center. Room owners and room admins may moderate their own room. Customer Service reviews reports and may restrict accounts under the Terms.</p></div>';
    if(view==='privacy'||view==='terms'){
      const data=window.POLD?.[view];
      if(data&&Array.isArray(data[1])){
        const panel=document.createElement('div');panel.className='sh-set-card sh-set-policy';
        for(const entry of data[1]){
          const title=document.createElement('h4');title.textContent=entry[0];
          const para=document.createElement('p');para.textContent=entry[1];panel.append(title,para);
        }
        body.appendChild(panel);
      }else html='<div class="sh-set-card">This policy is temporarily unavailable. Contact Customer Service.</div>';
    }
    if(html)body.innerHTML=html;
    const summary=body.querySelector('#sh-set-account-summary');
    if(summary)summary.textContent='ID: '+String(profile?.display_id||profile?.public_id||'')+
      ' • Country: '+String(profile?.country||'Not set')+
      ' • Login: '+String(session?.user?.email||'Verified account');
    page.scrollTop=0;
    page.querySelector('.sh-set-back')?.focus({preventScroll:true});
  }
  function sharikaOpenSettings(){
    if(!session){window.showAuth('welcome');return;}
    let page=document.getElementById('sh-settings-page');
    if(!page){
      page=document.createElement('section');page.id='sh-settings-page';
      page.setAttribute('role','dialog');page.setAttribute('aria-modal','true');
      page.setAttribute('aria-label','Settings Center');
      page.innerHTML='<div class="sh-set-wrap"><header class="sh-set-head">'+
        '<button type="button" class="sh-set-back" aria-label="Back">‹</button>'+
        '<span class="sh-set-title">Settings</span></header><main class="sh-set-body"></main></div>';
      document.body.appendChild(page);
      page.querySelector('.sh-set-back').onclick=sharikaSettingsBack;
      page.addEventListener('click',async event=>{
        const route=event.target.closest?.('[data-sh-settings-route]');
        if(route){showSettingsView(route.dataset.shSettingsRoute);return;}
        const button=event.target.closest?.('[data-sh-settings-action]');
        if(!button)return;
        const action=button.dataset.shSettingsAction;
        if(action==='country'){sharikaCloseSettings();openManualCountryPicker();return;}
        if(action==='support'){sharikaCloseSettings();openSupportThread();return;}
        if(action==='logout'){sharikaCloseSettings();window.logout();return;}
        const status=page.querySelector('.sh-set-error');
        if(action==='report'||action==='delete'){
          let message='';
          if(action==='report'){
            const id=page.querySelector('#sh-set-report-id')?.value.trim()||'';
            const reason=page.querySelector('#sh-set-report-reason')?.value.trim()||'';
            if(!/^[0-9]{1,10}$/.test(id)||reason.length<10){
              if(status)status.textContent='Enter a valid ID and at least 10 characters of detail.';
              return;
            }
            message='[Safety report] User ID: '+id+'\\nDetails: '+reason;
          }else{
            if(!page.querySelector('#sh-set-delete-confirm')?.checked){
              if(status)status.textContent='Please confirm you understand the deletion request.';
              return;
            }
            message='[ACCOUNT DELETION REQUEST] Verified user '+String(profile?.public_id||'')+
              ' requests deletion of their Sharika account and associated data. Verify ownership, applicable retention and reply to this support thread.';
          }
          button.disabled=true;
          if(status)status.textContent='Submitting verified request…';
          try{
            await api('POST','/support/messages',{
              body:message,request_id:'settings:'+Date.now().toString(36)+':'+
                Math.random().toString(36).slice(2,14)
            });
            if(status)status.textContent='Request received by Customer Service. You can follow up in your support conversation.';
            button.textContent='Request submitted ✓';
          }catch(error){
            if(status)status.textContent='Could not submit: '+errText(error);
            button.disabled=false;
          }
          return;
        }
        if(action==='microphone'){
          button.disabled=true;
          if(status)status.textContent='Checking microphone permission…';
          let stream=null;
          try{
            stream=await navigator.mediaDevices.getUserMedia({
              audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false
            });
            if(status)status.textContent=stream.getAudioTracks().some(track=>track.readyState==='live')?
              'Microphone permission is working. Test finished; no audio was recorded or uploaded.':
              'Microphone track unavailable. Check Android app permissions.';
          }catch(error){
            if(status)status.textContent='Microphone unavailable: '+errText(error);
          }finally{
            if(stream)stream.getTracks().forEach(track=>track.stop());
            button.disabled=false;
          }
        }
        if(action==='enablepush'){
          button.disabled=true;
          try{
            const enabled=await registerPushDevice(true);
            if(status)status.textContent=enabled?'Phone alerts enabled.':'Permission not granted or push service unavailable.';
            toast(enabled?'Phone alerts enabled':'Phone alerts not enabled');
          }catch(error){toast('Notifications: '+errText(error));}
          finally{button.disabled=false;}
        }
      });
    }
    page.hidden=false;
    showSettingsView('home');
  }
  // Original profile header and its Account & Features row both enter this page.
  window.settingsSheet=sharikaOpenSettings;
  window.sharikaOpenSettings=sharikaOpenSettings;
  document.getElementById('v-me')?.addEventListener('click',event=>{
    const target=event.target.closest?.('#mtopset,[data-m="set"]');
    if(!target||!target.closest('#v-me'))return;
    event.preventDefault();event.stopImmediatePropagation();
    sharikaOpenSettings();
  },true);
  window.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&sharikaSettingsBack())event.preventDefault();
  });

  const priorRenderMe=window.renderMe;
  let mainProfileStatsRequest=0;

  // SHARIKA_ROYAL_LEVEL_20261107: 1–100 visual levels, preserving verified legacy XP.
  // Raw wealth_level/charm_level are also used by premium policy: never rewrite them.
  const SHARIKA_ROYAL_LEVEL_GOAL=1000000000;
  const SHARIKA_ROYAL_LEVEL_BASE=1000;
  const SHARIKA_ROYAL_LEVEL_LOG=Math.log10(1+SHARIKA_ROYAL_LEVEL_GOAL/SHARIKA_ROYAL_LEVEL_BASE);
  function royalProgressLevel(amount){
    const coins=Math.max(0,Number.isFinite(Number(amount))?Number(amount):0);
    const normalized=Math.min(1,Math.log10(1+coins/SHARIKA_ROYAL_LEVEL_BASE)/SHARIKA_ROYAL_LEVEL_LOG);
    const total=normalized*99;
    const level=Math.max(1,Math.min(100,1+Math.floor(total)));
    const next=level>=100?SHARIKA_ROYAL_LEVEL_GOAL:
      Math.ceil(SHARIKA_ROYAL_LEVEL_BASE*(Math.pow(10,SHARIKA_ROYAL_LEVEL_LOG*level/99)-1));
    return {level,progress:level===100?100:Math.min(99,Math.max(0,Math.round((total-Math.floor(total))*100))),next,coins};
  }
  function royalLevelCoins(raw,verified){
    // Legacy awards may precede the gift-ledger summary: always retain their earned XP.
    const legacy=Math.max(0,(Number(raw)||1)-1)*1000;
    return Math.max(legacy,Number.isFinite(Number(verified))?Number(verified):0);
  }
  function royalCoinsShort(value){
    const n=Math.max(0,Number(value)||0);
    if(n>=1000000000)return (n/1000000000).toFixed(1).replace(/\.0$/,'')+'B';
    if(n>=1000000)return (n/1000000).toFixed(1).replace(/\.0$/,'')+'M';
    if(n>=1000)return (n/1000).toFixed(1).replace(/\.0$/,'')+'K';
    return String(Math.round(n));
  }
  // Level 1 -> 2 costs 1M gifts; 2 -> 3 costs 5M; later steps
  // rise by 5M. Never spend or debit the wallet to gain a level.
  function royalLevelCost(fromLevel){
    const n=Math.max(1,Math.min(99,Math.floor(Number(fromLevel)||1)));
    return n===1?1000000:(n-1)*5000000;
  }
  function royalProgressV2(kind,raw,verified,policy){
    if(!policy||!Number.isFinite(Number(verified)))return null;
    const sent=kind==='wealth';
    const baseline=Math.max(0,Number(policy[sent?'sent_baseline_coins':'received_baseline_coins'])||0);
    const originalRaw=Number(policy[sent?'old_wealth_level':'old_charm_level'])||1;
    const startingLevel=royalProgressLevel(royalLevelCoins(originalRaw,baseline)).level;
    let remaining=Math.max(0,Number(verified)-baseline),level=startingLevel;
    while(level<100&&remaining>=royalLevelCost(level)){
      remaining-=royalLevelCost(level);
      level++;
    }
    const next=level<100?royalLevelCost(level):0;
    return {level,next,coins:remaining,
      progress:level===100?100:Math.min(99,Math.floor(100*remaining/next)),
      lifetime:Math.max(0,Number(verified)),baseline,startingLevel};
  }
  function openRoyalLevelRoadmap(card){
    if(typeof window.openSheet!=='function')return;
    const level=Number(card.dataset.shRoyalLevel||1);
    const paid=Number(card.dataset.shRoyalProgress||0);
    const next=royalLevelCost(level);
    const kind=card.dataset.shRoyalKind==='charm'?'Received':'Sent';
    window.openSheet('<h3>👑 '+kind+' Level Roadmap</h3>'+
      '<div class="sh-royal-level-roadmap" id="sh-royal-level-roadmap"></div>');
    const area=document.getElementById('sh-royal-level-roadmap');
    if(!area)return;
    const summary=document.createElement('div');summary.className='sh-royal-level-summary';
    summary.textContent=level>=100?'Level 100 · Maximum level achieved':
      'Level '+level+' → '+(level+1)+' · '+royalCoinsShort(paid)+' / '+
      royalCoinsShort(next)+' gift coins · '+royalCoinsShort(Math.max(0,next-paid))+' remaining';
    area.appendChild(summary);
    const help=document.createElement('p');
    help.textContent='Levels increase from gifts sent or received, not wallet balance. Existing earned levels are protected. Each new level needs progressively more gift coins.';
    area.appendChild(help);
    const list=document.createElement('div');list.className='sh-royal-level-costs';
    for(let from=1;from<100;from++){
      const row=document.createElement('div');
      row.className='sh-royal-level-row'+(from===level?' is-current':'');
      const name=document.createElement('span');name.textContent='Lv '+from+' → '+(from+1);
      const cost=document.createElement('b');cost.textContent=royalCoinsShort(royalLevelCost(from))+' gift coins';
      row.append(name,cost);list.appendChild(row);
    }
    area.appendChild(list);
    const active=list.querySelector('.is-current');
    if(active)active.scrollIntoView({block:'center',behavior:'auto'});
  }
  function paintRoyalLevelCard(card,kind,raw,verified,policy){
    if(!card)return;
    const level=royalProgressV2(kind,raw,verified,policy)||
      royalProgressLevel(royalLevelCoins(raw,verified));
    const label=card.querySelector('[data-profile-level="'+kind+'"]')||card.querySelector('.big3');
    if(label)label.textContent=String(level.level);
    const meter=card.querySelector('.sh-level-meter>i')||card.querySelector('.lvb>i');
    if(meter)meter.style.width=level.progress+'%';
    const next=card.querySelector('.sh-level-next')||card.querySelector('small');
    if(next)next.textContent=level.level>=100?'MAX LEVEL · Royal Legend':
      royalCoinsShort(level.coins)+' / '+royalCoinsShort(level.next)+' gift coins';
    card.dataset.shRoyalLevel=String(level.level);
    card.dataset.shRoyalKind=kind;
    card.dataset.shRoyalProgress=String(level.coins);
    card.setAttribute('role','button');card.tabIndex=0;
    if(!card.dataset.shRoyalInteractive){
      card.dataset.shRoyalInteractive='1';
      card.addEventListener('click',()=>openRoyalLevelRoadmap(card));
      card.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){event.preventDefault();openRoyalLevelRoadmap(card);}
      });
    }
  }
  function paintRoyalPublicLevels(root,person,record){
    if(!root||!person)return;
    for(const [kind,selector,levelKey,totalKey] of [
      ['wealth','.lvs .lvc.w','wealth_level','gift_value_sent'],
      ['charm','.lvs .lvc.c','charm_level','gift_value_received']
    ]){
      const card=root.querySelector(selector);
      if(!card)continue;
      const heading=card.querySelector('b');
      if(heading)heading.textContent=kind==='wealth'?'💝 Sent Level':'💎 Received Level';
      let bar=card.querySelector('.lvb');
      if(!bar){bar=document.createElement('div');bar.className='lvb';
        const fill=document.createElement('i');bar.appendChild(fill);
        const title=card.querySelector('.big3');
        if(title)title.insertAdjacentElement('afterend',bar);
        else card.appendChild(bar);
      }else bar.style.display='';
      let note=card.querySelector('small');
      if(!note){note=document.createElement('small');card.appendChild(note);}
      paintRoyalLevelCard(card,kind,person[levelKey],record?.[totalKey],record?.level_progress_v2);
    }
  }
  function prepareRoyalLevelCards(root){
    if(!root)return;
    for(const [kind,selector,title] of [
      ['wealth','.lps .lp.s','💝 Sent Level'],['charm','.lps .lp.r','💎 Received Level']
    ]){
      const card=root.querySelector(selector);
      if(!card||card.querySelector('.sh-level-meter'))continue;
      const caption=document.createElement('span');caption.className='sh-level-caption';
      caption.textContent=title;
      const number=document.createElement('b');number.className='sh-level-value';
      number.dataset.profileLevel=kind;number.textContent='1';
      const meter=document.createElement('span');meter.className='sh-level-meter';
      const fill=document.createElement('i');fill.style.width='0%';meter.appendChild(fill);
      const next=document.createElement('small');next.className='sh-level-next';
      next.textContent='Loading verified gifts…';
      card.replaceChildren(caption,number,meter,next);
    }
  }
  async function renderVerifiedMainProfileStats(){
    const anchor=document.querySelector('#v-me .mid');
    const id=profile?.public_id;
    const requestNo=++mainProfileStatsRequest;
    if(!anchor||!session||!/^[0-9]{8}$/.test(String(id||'')))return;
    for(const [kind,key] of [['wealth','wealth_level'],['charm','charm_level']]){
      const value=Number(profile[key]);
      const card=document.querySelector('#v-me .lps .lp.'+(kind==='wealth'?'s':'r'));
      if(card&&Number.isSafeInteger(value)&&value>=1)
        paintRoyalLevelCard(card,kind,value,null);
    }
    try{
      const data=await api('GET','/bonds/profile/'+id);
      if(requestNo!==mainProfileStatsRequest||profile?.public_id!==id||!anchor.isConnected)return;
      for(const [kind,key,coins] of [
        ['wealth','wealth_level','gift_value_sent'],
        ['charm','charm_level','gift_value_received']
      ]){
        const card=document.querySelector('#v-me .lps .lp.'+(kind==='wealth'?'s':'r'));
        if(card)paintRoyalLevelCard(card,kind,profile[key],data[coins],data.level_progress_v2);
      }
      for(const key of ['followers','following','visitors']){
        const el=document.querySelector('#v-me [data-profile-stat="'+key+'"]');
        const count=Number(data[key]);
        if(el&&Number.isSafeInteger(count)&&count>=0)
          el.textContent=count.toLocaleString('en-US');
      }
    }catch(error){console.warn('Verified profile counters unavailable:',errText(error));}
  }
  let appearanceRefreshBusy=false,lastAppearanceRefresh=0;
  async function refreshVerifiedAppearance(){
    if(appearanceRefreshBusy||!session||!profile?.public_id)return;
    if(Date.now()-lastAppearanceRefresh<10000)return;
    lastAppearanceRefresh=Date.now();appearanceRefreshBusy=true;
    const account=session.user?.id,canonical=profile.public_id;
    try{
      const latest=await api('GET','/me');
      if(session?.user?.id!==account||latest.public_id!==canonical)return;
      const keys=['pic','frame_style','entry_style','medal_style','name_tag_style','svip_level',
        'special_id','display_id','special_frame'];
      const changed=keys.some(key=>(latest[key]||'')!==(profile[key]||''));
      if(!changed)return;
      profile=latest;
      if(window.A){
        window.A.pic=latest.pic||null;
        window.A.name=latest.name||window.A.name;
        window.A.frame=latest.frame_style||'';
        window.A.entry=latest.entry_style||'';
        window.A.cosmeticMedal=latest.medal_style||'';
        window.A.cosmeticTag=latest.name_tag_style||'';
        window.A.frameImg=null;
        if(typeof window.saveA==='function')window.saveA();
      }
      if(typeof window.renderMe==='function')window.renderMe();
      const roomFrame=document.getElementById('roomFrame')?.contentWindow;
      if(roomFrame&&typeof roomFrame.render==='function')roomFrame.render();
    }catch(error){
      console.warn('Verified profile appearance refresh unavailable:',errText(error));
    }finally{appearanceRefreshBusy=false;}
  }
  if(typeof priorRenderMe==='function')window.renderMe=function(){
    const result=priorRenderMe.apply(this,arguments);
    prepareRoyalLevelCards(document.getElementById('v-me'));
    renderVerifiedIdentity();
    applyProfileLayout('main',document.getElementById('v-me'));
    refreshGlobalProfileLayouts().catch(()=>{});
    renderVerifiedMainProfileStats().catch(()=>{});
    mountPremiumProfileEntry().catch(()=>{});
    mountFamilyTiles();
    refreshVerifiedAppearance().catch(()=>{});
    return result;
  };
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)refreshVerifiedAppearance().catch(()=>{});
  });
  window.addEventListener('focus',()=>refreshVerifiedAppearance().catch(()=>{}));
  // Admin grants are server-authoritative; refresh visible profile ornaments
  // without requiring sign-out, reinstall, or a room rejoin.
  setInterval(()=>{
    if(!document.hidden&&document.querySelector('#v-me .mid'))
      refreshVerifiedAppearance().catch(()=>{});
  },20000);
  // Main profile screenshot: these tiles open the existing, verified features.
  // Capture early so the old placeholder "coming soon" handler never fires.
  document.addEventListener('click',event=>{
    const tile=event.target.closest?.('#v-me [data-m="store"],#v-me #mbd,#v-me [data-m="cp"]');
    if(!tile)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(tile.dataset.m==='cp'){
      if(profile?.public_id)openVerifiedRankProfile(profile.public_id);
      return;
    }
    if(tile.id==='mbd'){
      styleSelectionSheet('medal_style').catch(error=>toast(errText(error)));
      return;
    }
    openRoyalMarket('shop');
  },true);
  // Screenshot-matched main profile shortcuts use the existing verified
  // destinations. Do not fall through to the original demo placeholder menu.
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('#v-me [data-sh-profile-action]');
    if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    switch(button.dataset.shProfileAction){
      case 'wallet':
        document.querySelector('#v-me #wr')?.click();
        break;
      case 'details':
      case 'level':
        if(profile?.public_id)openVerifiedRankProfile(profile.public_id);
        else toast('Sign in to open your verified profile');
        break;
      case 'backpack':
        openRoyalMarket('backpack');
        break;
      case 'language':
        sharikaOpenSettings();
        break;
      case 'feedback':
        openSupportThread();
        break;
    }
  },true);
  // Both the old SVIP shortcut and the new profile badge open the one verified
  // membership screen. No localStorage coin minting or demo tier changes.
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-m="svip"]');
    if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    // The SVIP Club tile opens the new eight-level collection. Preserve the
    // existing premium badge route to VIP/Noble purchasing and bonus controls.
    if(button.classList.contains('profile-svip-badge'))
      showPremiumSheet().catch(error=>toast(errText(error)));
    else showSvipRoyalSheet().catch(error=>toast(errText(error)));
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
  // Only authenticated Cloudflare STUN/TURN endpoints may enter WebRTC config.
  // Credentials stay in memory for this room; never persist them in localStorage.
  const SHARIKA_CLOUD_ICE=/^(?:stun:stun\.cloudflare\.com:3478|turn:turn\.cloudflare\.com:(?:3478|443|80)\?transport=(?:udp|tcp)|turns:turn\.cloudflare\.com:(?:5349|443)\?transport=tcp)$/;
  function verifiedIceConfig(config){
    const iceServers=[];
    for(const item of Array.isArray(config?.iceServers)?config.iceServers.slice(0,5):[]){
      const urls=(Array.isArray(item?.urls)?item.urls:[item?.urls])
        .filter(url=>typeof url==='string'&&SHARIKA_CLOUD_ICE.test(url)).slice(0,8);
      if(!urls.length)continue;
      if(urls.some(url=>url.startsWith('turn'))){
        if(typeof item.username!=='string'||!item.username||item.username.length>256||
          typeof item.credential!=='string'||!item.credential||
          item.credential.length>256)continue;
        iceServers.push({urls,username:item.username,credential:item.credential});
      }else iceServers.push({urls});
    }
    return {iceServers:iceServers.some(item=>item.username)?
      iceServers:SHARIKA_ICE_CONFIG.iceServers};
  }
  let sfuState = null;
  // Animate the actual occupied mic seats, never a timer-driven fake speaker.
  // One room can have several simultaneous talkers.
  const activeVoiceSpeakers={roomId:null,ids:new Set()};
  function paintVoiceSpeakers(roomId,frame) {
    if(!frame?.seats)return;
    const ids=activeVoiceSpeakers.roomId===roomId?activeVoiceSpeakers.ids:new Set();
    const ownerOnMic=frame.seats.some(seat=>seat?.owner_mic_seat);
    for(const seat of frame.seats){
      if(!seat||seat.empty||seat.lock)continue;
      const speaking=!!seat.user_id&&!seat.muted&&ids.has(seat.user_id)&&
        !(ownerOnMic&&seat.i===0);
      seat.talk=speaking;
      const el=frame.seatEl?.(seat.i);
      if(el)el.classList.toggle('talk',speaking);
    }
  }
  function paintVerifiedMicCount(frame) {
    if(!frame?.seats)return;
    const people=new Set(frame.seats.filter(seat=>seat&&!seat.empty&&!seat.lock)
      .map(seat=>seat.user_id||'seat:'+seat.i));
    const count=frame.$?.('mstat');
    if(count)count.innerHTML='🎤 <i>'+people.size+'</i>/'+frame.seats.length;
  }
  function setVoiceSpeakers(roomId,userIds) {
    if(wantedVoiceRoom!==roomId)return;
    const ids=new Set([...userIds].filter(id=>typeof id==='string'&&id.length>0));
    if(activeVoiceSpeakers.roomId===roomId&&ids.size===activeVoiceSpeakers.ids.size&&
       [...ids].every(id=>activeVoiceSpeakers.ids.has(id)))return;
    activeVoiceSpeakers.roomId=roomId;
    activeVoiceSpeakers.ids=ids;
    if(window.cur?.id===roomId)
      paintVoiceSpeakers(roomId,document.getElementById('rf')?.contentWindow);
  }
  function clearVoiceSpeakers() {
    const roomId=activeVoiceSpeakers.roomId;
    activeVoiceSpeakers.roomId=null;
    activeVoiceSpeakers.ids=new Set();
    if(roomId&&window.cur?.id===roomId)
      paintVoiceSpeakers(roomId,document.getElementById('rf')?.contentWindow);
  }
  // Android WebView may block a remote track's first autoplay attempt.
  // A later genuine room tap must retry playback synchronously in that gesture.
  function resumeRoomAudio() {
    if(typeof musicPlayer!=='undefined'&&typeof musicState!=='undefined'&&
       musicPlayer?.src&&musicPlayer.paused&&musicState?.mode==='library')
      musicPlayer.play().catch(()=>{});
    if(sfuState && !sfuState.closed) {
      if(sfuState.speakingContext?.state==='suspended')
        sfuState.speakingContext.resume().catch(()=>{});
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
  // Android background/foreground transitions may pause remote WebRTC audio
  // while leaving the receiving peer connection itself connected.
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)resumeRoomAudio();
  });
  window.addEventListener('pageshow',resumeRoomAudio);
  const roomAudioFrame=document.getElementById('rf');
  if(roomAudioFrame) {
    roomAudioFrame.addEventListener('load',()=>{
      try{bindRoomAudioGesture(roomAudioFrame.contentDocument);}catch(_){}
    });
    try{bindRoomAudioGesture(roomAudioFrame.contentDocument);}catch(_){}
  }
  let voiceRecoveryRoom=null,voiceRecoveryAttempts=0,voiceRetryTimer=null;
  let voiceRelayWarningRoom=null;
  let voiceRetryNoticeAt=0;
  // Preserve a manual mute when media reconnects; new rooms start unmuted.
  let micPreferenceRoom=null,micPreferenceEnabled=true;
  function microphoneWanted(roomId) {
    if(micPreferenceRoom!==roomId) {
      micPreferenceRoom=roomId;
      micPreferenceEnabled=true;
    }
    return micPreferenceEnabled;
  }
  function sfuTransportHealthy(state) {
    const local=state.media?.getAudioTracks()[0];
    const outgoing=!state.canPublish ||
      (state.readyPublication && local?.readyState==='live' &&
       state.publishPC?.connectionState==='connected');
    const incoming=!state.subscribed.size ||
      state.receivePC?.connectionState==='connected';
    return outgoing && incoming;
  }
  function scheduleVoiceRetry(roomId,reason,force=false) {
    if(wantedVoiceRoom!==roomId||voiceRetryTimer)return;
    if(voiceRecoveryRoom!==roomId){voiceRecoveryRoom=roomId;voiceRecoveryAttempts=0;}
    // Keep retrying after the first three attempts. The previous terminal
    // state left users permanently silent on a briefly unstable mobile link.
    // During an ISP outage hundreds of rooms can reconnect at once. Spread
    // the attempts instead of sending a synchronized burst to the SFU/API.
    const backoff=[500,1200,2500,5000,10000,20000,30000][
      Math.min(voiceRecoveryAttempts++,6)];
    const delay=Math.min(30000,Math.round(backoff*(0.7+Math.random()*0.6)));
    console.warn('Sharika voice reconnect scheduled:',reason,'in',delay,'ms');
    if(Date.now()-voiceRetryNoticeAt>20000 &&
       document.getElementById('rf')?.contentWindow){
      voiceRetryNoticeAt=Date.now();
      document.getElementById('rf').contentWindow.toast?.(
        'Voice connection interrupted. Reconnecting automatically…');
    }
    voiceRetryTimer=setTimeout(()=>{
      voiceRetryTimer=null;
      if(wantedVoiceRoom!==roomId)return;
      if(!force&&sfuState?.roomId===roomId&&!sfuState.closed&&
         sfuTransportHealthy(sfuState))return;
      connectVoice(roomId).catch(error=>{
        console.warn('Sharika voice reconnect:',errText(error));
        // connectVoice itself requeues on signaling/setup failures.
      });
    },delay);
  }
  function recoverSfuPublication(state,reason,force=false) {
    if(state.closed||sfuState!==state||wantedVoiceRoom!==state.roomId)return;
    scheduleVoiceRetry(state.roomId,reason,force);
  }
  async function waitVoiceConnected(peer) {
    if(peer.connectionState==='connected')return;
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>finish(new Error('Voice connection did not establish')),9000);
      function finish(error){
        clearTimeout(timeout);
        peer.removeEventListener('connectionstatechange',changed);
        peer.removeEventListener('iceconnectionstatechange',changed);
        if(error)reject(error);else resolve();
      }
      function changed(){
        if(peer.connectionState==='connected')finish();
        else if(peer.connectionState==='failed'||peer.connectionState==='closed'||
          peer.iceConnectionState==='failed')finish(new Error('Voice network failed'));
      }
      peer.addEventListener('connectionstatechange',changed);
      peer.addEventListener('iceconnectionstatechange',changed);
      changed();
    });
  }
  // Some Android carriers block one of Cloudflare TURN's alternate TCP ports.
  // Their ICE gathering can remain "gathering" for a long time even after a
  // usable srflx/relay candidate has already arrived. SFU does not use
  // trickle ICE, so wait briefly for useful candidates, but do not discard a
  // viable SDP solely because another optional port never finishes probing.
  function localIceCandidates(peer) {
    const sdp=peer.localDescription?.sdp||'';
    const lines=sdp.match(/^a=candidate:[^\r\n]+/gm)||[];
    return {
      count:lines.length,
      relay:lines.some(line=>/\btyp relay(?:\s|$)/.test(line)),
      srflx:lines.some(line=>/\btyp srflx(?:\s|$)/.test(line))
    };
  }
  async function waitIce(peer,phase='voice') {
    await new Promise((resolve,reject)=>{
      let settled=false;
      let fast,relayGrace,deadline;
      const expectsRelay=!!peer.getConfiguration?.().iceServers?.some(server=>
        !!server.username && [server.urls].flat().some(url=>
          typeof url==='string'&&url.startsWith('turn')));
      function cleanup(){
        clearTimeout(fast);clearTimeout(relayGrace);clearTimeout(deadline);
        peer.removeEventListener('icegatheringstatechange',changed);
        peer.removeEventListener('icecandidate',candidateReady);
      }
      function finish(error){
        if(settled)return;
        settled=true;cleanup();
        if(error)reject(error);else resolve();
      }
      function changed(){
        if(peer.iceGatheringState==='complete'){
          const available=localIceCandidates(peer);
          if(available.count)finish();
          else finish(new Error('Voice has no ICE network candidates ('+phase+')'));
        }
      }
      function candidateReady(event){
        // A usable TURN relay means the non-trickle SFU offer can go now.
        // Waiting for unrelated blocked TCP candidate probes added seconds
        // of avoidable delay every time a new speaker was subscribed.
        if(event.candidate?.candidate?.includes('typ relay')&&
           localIceCandidates(peer).relay)finish();
      }
      peer.addEventListener('icegatheringstatechange',changed);
      peer.addEventListener('icecandidate',candidateReady);
      // Without trickle ICE, sending only a server-reflexive candidate can
      // strand mobile users behind restrictive NAT even while TURN is available.
      // Prefer a real relay before finalizing the SDP, without waiting forever
      // for optional blocked TCP ports.
      fast=setTimeout(()=>{
        const available=localIceCandidates(peer);
        if(available.relay||(!expectsRelay&&available.srflx))finish();
      },900);
      relayGrace=setTimeout(()=>{
        const available=localIceCandidates(peer);
        if(available.relay||available.srflx)finish();
      },4000);
      // A partially gathered SDP with candidates is more useful than a
      // guaranteed 12-second failure on a blocked optional TURN endpoint.
      deadline=setTimeout(()=>{
        const available=localIceCandidates(peer);
        if(available.count){
          console.warn('Sharika voice ICE gathering incomplete:',phase,
            'candidates='+available.count,'relay='+available.relay);
          finish();
        }else finish(new Error('Voice has no ICE network candidates ('+phase+')'));
      },8000);
      changed();
    });
  }
  async function disconnectSfu() {
    const state=sfuState;
    if(!state)return;
    if(musicLocal?.state===state){
      const broadcastingRoom=musicLocal.roomId;
      releasePhoneMusic();
      api('PUT','/rooms/'+broadcastingRoom+'/music',{action:'stop_self'}).catch(()=>{});
    }
    sfuState=null;
    state.closed=true;
    if(state.timer)clearInterval(state.timer);
    if(state.publicationTimer)clearInterval(state.publicationTimer);
    if(state.speakingTimer)clearInterval(state.speakingTimer);
    for(const meter of state.speakingMeters.values())
      meter.source.disconnect();
    state.speakingMeters.clear();
    if(state.speakingContext)state.speakingContext.close().catch(()=>{});
    clearVoiceSpeakers();
    if(state.recoveryTimer)clearTimeout(state.recoveryTimer);
    for(const timer of state.bootstrapTimers||[])clearTimeout(timer);
    for(const element of state.audioElements){element.pause();element.srcObject=null;element.remove();}
    if(state.media)for(const track of state.media.getTracks())track.stop();
    for(const pc of [state.publishPC,state.receivePC])if(pc)pc.close();
    if(state.sessionIds.length) {
      try {await api('POST','/rooms/'+state.roomId+'/voice/leave',{sessionIds:state.sessionIds});}
      catch (_) { /* stale sessions expire in the coordinator */ }
    }
  }
  // A light-weight, audio-only voice activity meter. The WebAudio sources
  // connect only to analysers: microphone audio is never played back locally.
  // Sample every 250ms to conserve WebView CPU while keeping a live voice ring.
  function sampleSfuSpeaking(state) {
    if(state.closed||sfuState!==state||
      (typeof document!=='undefined'&&document.hidden))return;
    const now=Date.now(),speaking=new Set();
    for(const [track,meter] of state.speakingMeters){
      if(track.readyState!=='live'||!track.enabled||track.muted){
        meter.lastActiveAt=0;
        continue;
      }
      if(meter.local&&state.publishPC?.connectionState!=='connected')continue;
      try {
        meter.analyser.getByteTimeDomainData(meter.samples);
        let power=0,peak=0;
        for(const byte of meter.samples){
          const sample=(byte-128)/128;
          power+=sample*sample;
          peak=Math.max(peak,Math.abs(sample));
        }
        const rms=Math.sqrt(power/meter.samples.length);
        if(rms>.018||(rms>.008&&peak>.05))meter.lastActiveAt=now;
        if(now-meter.lastActiveAt<480){
          speaking.add(meter.userId);
          if(meter.local)state.lastLocalSpeechAt=now;
        }
      }catch(_){/* Individual tracks can end during audio renegotiation. */}
    }
    setVoiceSpeakers(state.roomId,speaking);
  }
  function watchSfuSpeaking(state,track,userId,local=false) {
    if(!track||!userId||state.closed||state.speakingMeters.has(track))return;
    try {
      if(!state.speakingContext){
        const Context=window.AudioContext||window.webkitAudioContext;
        if(!Context)return;
        state.speakingContext=new Context();
      }
      const source=state.speakingContext.createMediaStreamSource(
        new MediaStream([track]));
      const analyser=state.speakingContext.createAnalyser();
      analyser.fftSize=512;
      source.connect(analyser);
      state.speakingMeters.set(track,{userId,local,source,analyser,
        samples:new Uint8Array(analyser.fftSize),lastActiveAt:0});
      if(state.speakingContext.state==='suspended')
        state.speakingContext.resume().catch(()=>{});
      if(!state.speakingTimer)
        state.speakingTimer=setInterval(()=>sampleSfuSpeaking(state),250);
    }catch(error){console.warn('Voice activity meter unavailable:',errText(error));}
  }
  function unwatchSfuSpeaking(state,track) {
    const meter=state.speakingMeters.get(track);
    if(!meter)return;
    meter.source.disconnect();
    state.speakingMeters.delete(track);
    sampleSfuSpeaking(state);
  }
  // A connected ICE transport is not proof that audio RTP is moving. Read
  // actual media packet counters locally; never upload SDP, voice, or tokens.
  function audioRtpCounters(report,type) {
    let packets=0,bytes=0,packetsLost=0;
    for(const stat of report.values()){
      if(stat.type!==type ||
         (stat.kind&&stat.kind!=='audio') ||
         (stat.mediaType&&stat.mediaType!=='audio'))continue;
      packets+=Number(stat.packetsSent??stat.packetsReceived)||0;
      bytes+=Number(stat.bytesSent??stat.bytesReceived)||0;
      packetsLost+=Math.max(0,Number(stat.packetsLost)||0);
    }
    return {packets,bytes,packetsLost};
  }
  function selectedIcePath(report) {
    if(!report)return 'unknown';
    let pair=null;
    for(const stat of report.values()){
      if(stat.type==='transport'&&stat.selectedCandidatePairId){
        pair=report.get(stat.selectedCandidatePairId);break;
      }
    }
    if(!pair){
      for(const stat of report.values()){
        if(stat.type==='candidate-pair'&&stat.nominated&&stat.state==='succeeded'){
          pair=stat;break;
        }
      }
    }
    const local=pair?.localCandidateId?report.get(pair.localCandidateId):null;
    return ['relay','srflx','host','prflx'].includes(local?.candidateType)
      ?local.candidateType:'unknown';
  }
  async function inspectSfuAudio(state) {
    if(state.closed||sfuState!==state||state.statsInFlight)return;
    state.statsInFlight=true;
    try {
      const [sendReport,receiveReport]=await Promise.all([
        state.publishPC?.getStats?.()||null,
        state.receivePC?.getStats?.()||null
      ]);
      if(state.closed||sfuState!==state)return;
      const outgoing=sendReport?audioRtpCounters(sendReport,'outbound-rtp'):null;
      const incoming=receiveReport?audioRtpCounters(receiveReport,'inbound-rtp'):null;
      const last=state.lastMediaStats;
      const mic=state.media?.getAudioTracks()[0];
      if(last?.outgoing&&outgoing&&state.readyPublication&&mic?.enabled&&
         state.publishPC?.connectionState==='connected'&&
         state.lastLocalSpeechAt&&Date.now()-state.lastLocalSpeechAt<9000&&
         outgoing.packets<=last.outgoing.packets){
        state.outgoingStalls=(state.outgoingStalls||0)+1;
        if(state.outgoingStalls>=2){
          console.warn('Sharika voice: microphone active but RTP stopped');
          recoverSfuPublication(state,'microphone RTP stalled',true);
          state.outgoingStalls=0;
        }
      }else state.outgoingStalls=0;
      if(incoming?.packets && state.audioElements.size &&
         [...state.audioElements].some(element=>element.paused))resumeRoomAudio();
      // Packet loss is an early warning before the receiver fully drops.
      // Never mute a member or restart a healthy connection solely for loss:
      // reconnect storms can make a busy room much worse.
      if(incoming&&last?.incoming){
        const received=Math.max(0,incoming.packets-last.incoming.packets);
        const lost=Math.max(0,incoming.packetsLost-last.incoming.packetsLost);
        const poor=received+lost>=50 && lost/(received+lost)>=0.12;
        state.poorQualitySamples=poor?(state.poorQualitySamples||0)+1:0;
        if(state.poorQualitySamples>=2 &&
           Date.now()-(state.lastQualityWarningAt||0)>60000){
          state.lastQualityWarningAt=Date.now();
          console.warn('Sharika voice: high incoming packet loss');
          if(typeof document!=='undefined')
            document.getElementById('rf')?.contentWindow?.toast?.(
              'Voice network is unstable. Audio may break up; monitoring connection.');
        }
      }
      // No incoming bytes can also mean remote users are intentionally silent.
      // Do not tear down a connected subscriber on that signal alone.
      state.lastMediaStats={outgoing,incoming,
        outgoingRoute:selectedIcePath(sendReport),
        incomingRoute:selectedIcePath(receiveReport),checkedAt:Date.now()};
    }catch(error){
      console.warn('Sharika voice statistics unavailable:',errText(error));
    }finally{state.statsInFlight=false;}
  }
  function addAudioTrack(state,event) {
    if(state.closed)return;
    const remoteId=state.remoteMids?.get(String(event.transceiver?.mid||''));
    if(remoteId&&typeof watchSfuSpeaking==='function')
      watchSfuSpeaking(state,event.track,remoteId);
    const audio=document.createElement('audio');
    audio.autoplay=true;
    audio.playsInline=true;
    audio.muted=false;
    audio.volume=1;
    audio.dataset.sharikaVoice='true';
    audio.srcObject=new MediaStream([event.track]);
    document.body.appendChild(audio);
    state.audioElements.add(audio);
    // Android WebView can receive an SFU track before its first audio packet.
    // Retry when that track becomes audible, in addition to room-tap unlocks.
    const startPlayback=()=>{
      if(state.closed||!audio.isConnected||!audio.srcObject)return;
      audio.play().catch(error=>{
        if(error?.name==='NotAllowedError' && !state.audioUnlockPrompted) {
          state.audioUnlockPrompted=true;
          document.getElementById('rf')?.contentWindow?.toast?.(
            'Tap anywhere in the room to hear other speakers.');
        }
      });
    };
    event.track.addEventListener('unmute',startPlayback);
    startPlayback();
    event.track.addEventListener('ended',()=>{
      unwatchSfuSpeaking(state,event.track);
      state.audioElements.delete(audio);audio.pause();audio.remove();
    },{once:true});
  }
  async function subscribeSfu(state) {
    if(state.closed || state.syncing)return;
    state.syncing=true;
    try {
      const data=await api('GET','/rooms/'+state.roomId+'/voice/publications');
      const live=new Set((data.publications||[]).map(x=>x.sessionId+':'+x.trackName));
      for(const key of state.failedPublications.keys())
        if(!live.has(key))state.failedPublications.delete(key);
      const upcoming=(data.publications||[]).filter(x=>x &&
        !state.subscribed.has(x.sessionId+':'+x.trackName) &&
        (state.failedPublications.get(x.sessionId+':'+x.trackName)||0)<Date.now());
      if(!upcoming.length)return;
      // Never put multiple publishers in one tracks/new call. A stale session
      // from a crashed phone must not reject subscriptions to live speakers.
      for(const publication of upcoming) {
        if(state.closed)return;
        const batch=[publication];
        let negotiationStarted=false;
        try {
          const response=await api('POST','/rooms/'+state.roomId+'/voice/subscribe',{
            sessionId:state.subscribeId,
            publications:batch.map(x=>({sessionId:x.sessionId,trackName:x.trackName}))
          });
          negotiationStarted=true;
        // The publications list carries authenticated user IDs from our
        // room coordinator. The SFU subscribe response does not echo those
        // IDs: match its verified session IDs to the original publications.
        // Never trust a client-supplied speaker identity.
          const verifiedSpeakerIds=new Map(batch.map(item=>
            [item.sessionId,item.userId||'']));
          for(const track of response.tracks||[]) {
            state.remoteMids.set(String(track.mid),
              verifiedSpeakerIds.get(track.sessionId)||'');
          }
          await state.receivePC.setRemoteDescription(response.sessionDescription);
          const answer=await state.receivePC.createAnswer();
          await state.receivePC.setLocalDescription(answer);
          await waitIce(state.receivePC,'receive');
          await api('PUT','/rooms/'+state.roomId+'/voice/renegotiate',{
            sessionId:state.subscribeId,sessionDescription:state.receivePC.localDescription
          });
          state.subscribed.add(publication.sessionId+':'+publication.trackName);
          if(!state.firstSubscriptionAt)state.firstSubscriptionAt=Date.now();
          state.subscriptionFailures=0;
        }catch(error){
          console.warn('Sharika voice subscriber:',errText(error));
          if(state.closed)return;
          if(negotiationStarted){
            // An offer was allocated: continuing on this SFU session without
            // an accepted answer risks an invalid renegotiation state.
            recoverSfuPublication(state,'incoming voice negotiation failed',true);
            return;
          }
          // The SFU refused this individual remote track. Back off THIS
          // publication, not the whole room's receiving connection.
          state.failedPublications.set(
            publication.sessionId+':'+publication.trackName,Date.now()+12000);
        }
      }
    }catch(error) {
      if(!state.closed) {
        state.subscriptionFailures++;
        console.warn('Sharika voice subscriptions:',errText(error));
        // After failed SDP negotiation, SFU may retain a track allocation.
        // New sessions are safer than repeating tracks/new forever.
        if(state.subscriptionFailures>=2)
          recoverSfuPublication(state,'incoming voice negotiation failed',true);
      }
    }finally {state.syncing=false;}
  }
  // The receiving SFU session does not need microphone permission or a
  // completed publishing handshake. Start it immediately for fast listening.
  async function startSfuReceiving(state) {
    const roomId=state.roomId;
    const joined=await api('POST','/rooms/'+roomId+'/voice/session',{mode:'subscribe'});
    if(state.closed||wantedVoiceRoom!==roomId)
      throw new Error('Voice room changed');
    state.subscribeId=joined.sessionId;
    state.sessionIds.push(joined.sessionId);
    state.receivePC=new RTCPeerConnection(state.iceConfig||SHARIKA_ICE_CONFIG);
    state.receivePC.ontrack=event=>addAudioTrack(state,event);
    state.receivePC.addEventListener('connectionstatechange',()=>{
      if(!state.closed&&sfuState===state&&state.receivePC.connectionState==='failed')
        recoverSfuPublication(state,'remote receiver failed');
    });
    await subscribeSfu(state);
    // Rapidly discover nearby joins, then fall back to the regular 8s poll.
    for(const delay of [1200,3000,5500]) {
      state.bootstrapTimers.push(setTimeout(()=>{
        if(!state.closed&&sfuState===state)
          subscribeSfu(state).catch(()=>{});
      },delay));
    }
  }
  // Promoting a listener onto a mic seat must retain the existing receiver.
  // Rebuilding both PeerConnections here interrupts every incoming speaker.
  async function startSfuPublishing(state) {
    if(state.closed||sfuState!==state)throw new Error('Voice room changed');
    const roomId=state.roomId,priorSessions=new Set(state.sessionIds);
    state.startedAt=Date.now();
    try {
      state.media=await navigator.mediaDevices.getUserMedia({
        audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false
      });
      if(state.closed||sfuState!==state||wantedVoiceRoom!==roomId)
        throw new Error('Voice room changed');
      state.publishPC=new RTCPeerConnection(state.iceConfig||SHARIKA_ICE_CONFIG);
      const local=state.media.getAudioTracks()[0];
      local.enabled=microphoneWanted(roomId);
      watchSfuSpeaking(state,local,session?.user?.id,true);
      const transceiver=state.publishPC.addTransceiver(local,{direction:'sendonly'});
      // Voice is audio-only. Cap the outgoing Opus stream to a speech-friendly
      // bitrate so a weak cellular uplink is less likely to stall every other
      // room request. Older Android WebViews may lack writable RTP encodings;
      // a failed optimization must never prevent the microphone from joining.
      try{
        const sender=transceiver.sender;
        const parameters=sender?.getParameters?.();
        if(parameters?.encodings?.length){
          parameters.encodings[0].maxBitrate=32000;
          await sender.setParameters(parameters);
        }
      }catch(error){
        console.warn('Voice bandwidth preference unavailable:',errText(error));
      }
      const offer=await state.publishPC.createOffer();
      await state.publishPC.setLocalDescription(offer);
      await waitIce(state.publishPC,'publish');
      const published=await api('POST','/rooms/'+roomId+'/voice/session',{
        mode:'publish',readiness:'connected-v1'
      });
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
      const publisher=state.publishPC;
      const checkPublisher=()=>{
        if(state.closed||sfuState!==state||!state.canPublish||
           state.publishPC!==publisher)return;
        const status=publisher.connectionState;
        if(status==='connected'){
          if(state.recoveryTimer&&sfuTransportHealthy(state)&&
             !state.subscriptionFailures&&!state.heartbeatFailures){
            clearTimeout(state.recoveryTimer);state.recoveryTimer=null;
          }
          state.disconnectedAt=0;
          markLocalMicrophone(state.readyPublication&&local.readyState==='live'&&local.enabled);
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
        if(!state.closed&&state.canPublish)
          recoverSfuPublication(state,'microphone track ended');
      },{once:true});
      if(state.closed||sfuState!==state||wantedVoiceRoom!==roomId)
        throw new Error('Voice room changed');
      state.canPublish=true;
      // Do not hold room navigation while ICE connects. SFU publication
      // discovery is activated only after this peer REALLY connects.
      waitVoiceConnected(publisher).then(async()=>{
        if(state.closed||sfuState!==state||wantedVoiceRoom!==roomId)return;
        await api('POST','/rooms/'+roomId+'/voice/ready',{
          sessionId:published.sessionId
        });
        if(state.closed||sfuState!==state||wantedVoiceRoom!==roomId)return;
        state.readyPublication=true;
        markLocalMicrophone(local.readyState==='live'&&local.enabled);
        document.getElementById('rf')?.contentWindow?.toast?.('🎙️ Voice connected');
      }).catch(error=>{
        if(!state.closed&&sfuState===state){
          console.warn('Sharika microphone connection:',errText(error));
          recoverSfuPublication(state,'microphone did not connect',true);
        }
      });
      checkPublisher();
    }catch(error){
      const newlyRegistered=state.sessionIds.filter(id=>!priorSessions.has(id));
      state.sessionIds=state.sessionIds.filter(id=>priorSessions.has(id));
      for(const id of newlyRegistered)
        api('POST','/rooms/'+roomId+'/voice/leave',{sessionIds:[id]}).catch(()=>{});
      // Preserve the healthy listener even if microphone setup fails.
      state.canPublish=false;
      const failedMedia=state.media,failedPublisher=state.publishPC;
      state.media=null;state.publishPC=null;
      if(failedMedia)for(const track of failedMedia.getTracks()){
        unwatchSfuSpeaking(state,track);
        track.stop();
      }
      if(failedPublisher)failedPublisher.close();
      throw error;
    }
  }
  async function connectSfu(roomId,canPublish,iceConfig=SHARIKA_ICE_CONFIG) {
    const state={
      roomId,closed:false,iceConfig,sessionIds:[],publishPC:null,receivePC:null,
      media:null,audioElements:new Set(),remoteMids:new Map(),
      speakingContext:null,speakingMeters:new Map(),speakingTimer:null,
      subscribed:new Set(),failedPublications:new Map(),subscribeId:null,timer:null,publicationTimer:null,
      syncing:false,
      canPublish,readyPublication:false,subscriptionFailures:0,heartbeatFailures:0,bootstrapTimers:[],
      firstSubscriptionAt:0,receiveDisconnectedAt:0,
      startedAt:Date.now(),disconnectedAt:0,recoveryTimer:null,recoveryExhausted:false
    };
    sfuState=state;
    // Convert errors to a result immediately so a fast receive failure
    // cannot become an unhandled rejection while mic capture is pending.
    const receiving=startSfuReceiving(state).then(()=>null,error=>error);
    try {
      if(canPublish){
        try{await startSfuPublishing(state);}
        catch(error){
          // Mic permission/device failure must never tear down the receiving
          // connection. The listener can still hear other room members and
          // retry capture from the mic control.
          console.warn('Sharika microphone not ready:',errText(error));
          document.getElementById('rf')?.contentWindow?.toast?.(
            'Mic unavailable. Tap the microphone to retry.');
        }
      }
      if(wantedVoiceRoom!==roomId)throw new Error('Voice room changed');
      const receiveError=await receiving;
      if(receiveError)throw receiveError;
      // New microphones must become audible promptly after a seat change.
      // Publication discovery runs independently of the 8s heartbeat.
      state.publicationTimer=setInterval(()=>{
        if(!state.closed)subscribeSfu(state).catch(()=>{});
      },1500);
      state.timer=setInterval(()=>{
        if(state.closed)return;
        inspectSfuAudio(state).catch(()=>{});
        api('POST','/rooms/'+roomId+'/voice/heartbeat',{sessionIds:state.sessionIds})
          .then(()=>{state.heartbeatFailures=0;})
          .catch(()=>{
            if(++state.heartbeatFailures>=3)
              recoverSfuPublication(state,'voice session heartbeat lost',true);
          });
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
        // Receiving other speakers uses a separate WebRTC transport.
        // Recreate stale subscriber sessions even if our own mic is healthy.
        if(state.receivePC && state.subscribed.size){
          const pc=state.receivePC,connection=pc.connectionState;
          if(connection==='disconnected'&&!state.receiveDisconnectedAt)
            state.receiveDisconnectedAt=Date.now();
          if(connection==='connected')state.receiveDisconnectedAt=0;
          const lost=connection==='failed'||pc.iceConnectionState==='failed'||
            (connection==='disconnected'&&state.receiveDisconnectedAt&&
              Date.now()-state.receiveDisconnectedAt>12000)||
            (connection!=='connected'&&state.firstSubscriptionAt&&
              Date.now()-state.firstSubscriptionAt>30000);
          if(lost)recoverSfuPublication(state,'incoming audio path unavailable');
        }
        // Reset the retry budget only after a connection stays healthy.
        if(sfuTransportHealthy(state)&&!state.subscriptionFailures&&
           Date.now()-state.startedAt>30000)voiceRecoveryAttempts=0;
      },8000);
      return {publishing:!!state.readyPublication};
    }catch(error){
      await receiving; // Ensure any in-flight receiver has finished before cleanup.
      await disconnectSfu();
      throw error;
    }
  }

  // Sharika staging uses the first-party Cloudflare SFU. The retired LiveKit
  // fallback dynamically loaded third-party JavaScript inside the privileged
  // Android WebView; never reintroduce that remote-code path.
  async function disconnectVoice() {
    clearVoiceSpeakers();
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
    if(voiceRetryTimer){clearTimeout(voiceRetryTimer);voiceRetryTimer=null;}
    // A new room entry, including returning to the same room, is a fresh
    // attempt. Do not carry an exhausted retry budget across visits.
    voiceRecoveryRoom=null;voiceRecoveryAttempts=0;
    voiceRelayWarningRoom=null;
    voiceRetryNoticeAt=0;
    clearVoiceSpeakers();
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
      const iceConfig=verifiedIceConfig(config);
      if(config.provider==='cloudflare_sfu'&&!config.relayAvailable&&
         voiceRelayWarningRoom!==roomId){
        voiceRelayWarningRoom=roomId;
        document.getElementById('rf')?.contentWindow?.toast?.(
          'Voice relay unavailable. Trying direct connection.');
      }
      // When a normal connection has failed, prefer Cloudflare TURN relays
      // for the next attempt. Never force relay without valid credentials;
      // a subsequent retry may use the standard direct+relay ICE policy.
      if(voiceRecoveryAttempts%2===1 &&
         iceConfig.iceServers.some(server=>server.username))
        iceConfig.iceTransportPolicy='relay';
      // A listener's receiver remains connected when they take their first mic
      // seat. Upgrade only the outbound microphone instead of dropping all audio.
      const current=sfuState;
      if(config.provider==='cloudflare_sfu'&&config.publish&&current&&
         current.roomId===roomId&&!current.closed&&current.receivePC&&
         current.receivePC.connectionState!=='failed'&&!current.canPublish){
        current.iceConfig=iceConfig;
        await startSfuPublishing(current);
        return {publishing:!!current.readyPublication};
      }
      await disconnectVoice();
      if(wantedVoiceRoom!==roomId)return {publishing:false,stale:true};
      if(config.provider==='cloudflare_sfu') {
        voiceBackend='cloudflare_sfu';
        return connectSfu(roomId,!!config.publish,iceConfig);
      }
      throw new Error('Unsupported voice provider; verified Cloudflare SFU required');
    });
    voiceOperation=task;
    pendingVoice={roomId,promise:task};
    try {
      const result=await task;
      if(!result.stale && wantedVoiceRoom===roomId) {
        const track=sfuState?.roomId===roomId?sfuState.media?.getAudioTracks()[0]:null;
        const enabled=!!result.publishing && (track?
          track.readyState==='live'&&track.enabled &&
          sfuState?.publishPC?.connectionState==='connected' :
          voiceRoomId===roomId&&!!voiceRoom?.localParticipant.isMicrophoneEnabled);
        markLocalMicrophone(enabled);
      }
      return result;
    } catch(error) {
      if(wantedVoiceRoom===roomId)
        scheduleVoiceRetry(roomId,'voice negotiation failed',true);
      throw error;
    } finally {
      if(pendingVoice?.promise===task)pendingVoice=null;
    }
  }
  window.addEventListener('online',()=>{
    const roomId=wantedVoiceRoom;
    if(!roomId || (sfuState?.roomId===roomId&&sfuTransportHealthy(sfuState)))return;
    if(voiceRetryTimer){clearTimeout(voiceRetryTimer);voiceRetryTimer=null;}
    voiceRecoveryAttempts=0;
    scheduleVoiceRetry(roomId,'network restored',true);
  });
  // Frame cosmetics cannot restart a voice transport already in progress.
  function ensureVoiceConnected(roomId) {
    if(pendingVoice?.roomId===roomId)return pendingVoice.promise;
    if(sfuState?.roomId===roomId&&!sfuState.closed&&sfuState.receivePC&&
       !sfuState.recoveryExhausted&&
       sfuState.receivePC.connectionState!=='failed')
      return Promise.resolve({publishing:!!sfuState.readyPublication});
    if(voiceRoom&&voiceRoomId===roomId)
      return Promise.resolve({publishing:!!voiceRoom.sharikaPublishAllowed});
    return connectVoice(roomId);
  }
  function setRoomScreenAwake(enabled) {
    native('roomScreenAwake',{enabled:!!enabled}).catch(error=>
      console.warn('Room screen-awake update:',errText(error)));
  }
  function markLocalMicrophone(enabled) {
    // WebView may reselect the earpiece when WebRTC starts capturing audio.
    if(enabled&&window.cur?.id===wantedVoiceRoom)
      native('roomScreenAwake',{enabled:true}).catch(()=>{});
    const frame=document.getElementById('rf')?.contentWindow;
    if(!frame||!Array.isArray(frame.seats))return;
    const localSeats=frame.seats.filter(slot=>slot?.user_id===session?.user?.id);
    if(localSeats.length) {
      // Rebuilding every avatar on repeated ICE/heartbeat status callbacks
      // makes the 20-seat grid visibly jump, even when mute state is the same.
      const changed=localSeats.some(seat=>seat.muted===!!enabled);
      for(const seat of localSeats)seat.muted=!enabled;
      if(changed&&typeof frame.render==='function'){
        frame.render();
        decorateRoomSeats(frame);
        paintVerifiedMicCount(frame);
        if(window.cur?.id===sfuState?.roomId)paintVoiceSpeakers(sfuState.roomId,frame);
      }
    }
    const mic=frame.$?.('mic');
    if(mic) {
      if(!mic.closest('.sh-tool'))mic.textContent=enabled?'🎤':'🔇';
      mic.classList.toggle('off',!enabled);
      mic.setAttribute('aria-pressed',String(enabled));
    }
  }
  async function restartMicrophone(roomId) {
    if(!roomId)throw new Error('Join a voice room first');
    const config=await api('GET','/rooms/'+roomId+'/voice/config');
    if(!config.publish)throw new Error('Take an unlocked mic seat first');
    voiceRecoveryAttempts=0;
    micPreferenceRoom=roomId;micPreferenceEnabled=true;
    const result=await connectVoice(roomId);
    if(!result.publishing && !sfuState?.canPublish)
      throw new Error('Microphone connection not ready; tap again');
    if(sfuState?.roomId===roomId){
      const track=sfuState.media?.getAudioTracks()[0];
      if(!track||track.readyState!=='live')throw new Error('Microphone capture unavailable');
      track.enabled=true;
    } else if(voiceRoomId===roomId&&voiceRoom){
      await voiceRoom.localParticipant.setMicrophoneEnabled(true);
    } else throw new Error('Microphone transport not available');
    markLocalMicrophone(!!sfuState?.readyPublication || voiceRoomId===roomId);
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
      micPreferenceRoom=sfuState.roomId;micPreferenceEnabled=track.enabled;
      markLocalMicrophone(track.enabled&&sfuState.readyPublication);
      return track.enabled;
    }
    if(!voiceRoom || !voiceRoomId)
      return restartMicrophone(window.cur?.id||wantedVoiceRoom);
    const currently=voiceRoom.localParticipant.isMicrophoneEnabled;
    await voiceRoom.localParticipant.setMicrophoneEnabled(!currently);
    micPreferenceRoom=voiceRoomId;micPreferenceEnabled=!currently;
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
        country: manualCountryLabel(current.country) || current.country || '',
        dob: current.birthdate || '',
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
    pollGlobalCelebrations().catch(()=>{});
    // A restored session can finish while Recharge is already visible.
    mountRechargeSellerWallet();
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
  function birthdateFromUi(yearValue,monthValue,dayValue) {
    const year=Number(yearValue),month=Number(monthValue),day=Number(dayValue);
    if(!yearValue||!monthValue||!dayValue)
      throw new Error('Select your birth year, month and day.');
    if(!Number.isInteger(year)||!Number.isInteger(month)||!Number.isInteger(day)||
       year<1900||month<1||month>12||day<1||day>31)
      throw new Error('Choose a valid birth date.');
    const birth=new Date(Date.UTC(year,month-1,day));
    if(birth.getUTCFullYear()!==year||birth.getUTCMonth()!==month-1||birth.getUTCDate()!==day)
      throw new Error('Choose a valid birth date.');
    const now=new Date();
    let age=now.getUTCFullYear()-year;
    if(now.getUTCMonth()<month-1||
       (now.getUTCMonth()===month-1&&now.getUTCDate()<day))age--;
    if(age<13)throw new Error('You must be at least 13 years old to create a Sharika account.');
    if(age>120)throw new Error('Please check your birth year.');
    return String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+
      String(day).padStart(2,'0');
  }
  function birthYearOptions(){
    let options='<option value="">Year</option>';
    const year=new Date().getUTCFullYear();
    for(let y=year;y>=year-120;y--)
      options+='<option value="'+y+'">'+y+'</option>';
    return options;
  }
  function birthMonthOptions(){
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return '<option value="">Month</option>'+months.map((name,index)=>
      '<option value="'+(index+1)+'">'+name+'</option>').join('');
  }
  function birthDayOptions(year,month,selected){
    const max=year&&month?new Date(Date.UTC(Number(year),Number(month),0)).getUTCDate():31;
    let options='<option value="">Day</option>';
    for(let day=1;day<=max;day++)
      options+='<option value="'+day+'"'+(Number(selected)===day?' selected':'')+'>'+day+'</option>';
    return options;
  }
  function manualCountryCode(value){
    const code=window.SharikaDiscovery?.countryCode(value)||
      (/^[A-Za-z]{2}$/.test(String(value||''))?String(value).toUpperCase():'');
    return /^[A-Z]{2}$/.test(code)?code:'';
  }
  function manualCountryLabel(value){
    const code=manualCountryCode(value);
    if(!code)return '';
    const flag=window.SharikaDiscovery?.flagForCountry(code)||'🌍';
    let name=code;
    if(typeof Intl.DisplayNames==='function'){
      try{name=new Intl.DisplayNames(['en'],{type:'region'}).of(code)||code;}
      catch(_error){}
    }
    return flag+' '+name;
  }
  function manualCountryOptions(){
    const choices=Array.isArray(window.CTRY)?window.CTRY:[];
    return '<option value="">Choose your country</option>'+choices.map(item=>{
      const code=manualCountryCode(item[2]||item[0]+' '+item[1]);
      return code?'<option value="'+code+'">'+item[0]+' '+item[1]+'</option>':'';
    }).join('');
  }
  function profileForm(account) {
    return new Promise((resolve, reject) => {
      const layer = document.createElement('div');
      layer.id = 'sharika-stage-profile-setup';
      layer.style.cssText = 'position:fixed;z-index:2147483646;inset:0;background:#0c0920f5;display:flex;align-items:center;justify-content:center;padding:22px;color:white;font-family:inherit';
      layer.innerHTML = '<form style="width:min(100%,410px);max-height:90vh;overflow-y:auto;background:linear-gradient(160deg,#2d2158,#131530);border:1px solid #6754c0;border-radius:24px;padding:24px;box-shadow:0 15px 45px #0008">' +
        '<h2 style="margin:0 0 8px">Finish your Sharika profile</h2>' +
        '<p style="font-size:13px;opacity:.8">A real name and birth date are needed for the new staging account. Existing accounts are not imported.</p>' +
        '<label>Name<input name="name" maxlength="80" required style="box-sizing:border-box;width:100%;margin:8px 0 16px;padding:13px;border-radius:10px;background:#fff;color:#161121;border:0" value=""></label>' +
        '<fieldset style="border:0;padding:0;margin:0 0 16px;min-width:0"><legend style="padding:0">Birth date</legend>'+
        '<div style="display:flex;gap:7px;margin-top:8px">'+
        '<select name="birth_year" aria-label="Birth year" required style="box-sizing:border-box;width:40%;min-width:0;padding:13px 7px;border-radius:10px;background:#fff;color:#161121;border:0">'+birthYearOptions()+'</select>'+
        '<select name="birth_month" aria-label="Birth month" required style="box-sizing:border-box;width:32%;min-width:0;padding:13px 7px;border-radius:10px;background:#fff;color:#161121;border:0">'+birthMonthOptions()+'</select>'+
        '<select name="birth_day" aria-label="Birth day" required style="box-sizing:border-box;width:28%;min-width:0;padding:13px 7px;border-radius:10px;background:#fff;color:#161121;border:0">'+birthDayOptions()+'</select>'+
        '</div><small style="display:block;margin-top:7px;color:#d8caff">Choose your real birth date. Minimum signup age: 13.</small></fieldset>'+
        '<label>Country (you choose; no GPS)<select name="country" required style="box-sizing:border-box;width:100%;margin:8px 0 16px;padding:13px;border-radius:10px;background:#fff;color:#161121;border:0">'+
        manualCountryOptions()+'</select></label>' +
        '<label>Invite code (optional)<input name="invite_code" maxlength="8" inputmode="numeric" placeholder="8-digit inviter ID" style="box-sizing:border-box;width:100%;margin:8px 0 16px;padding:13px;border-radius:10px;background:#fff;color:#161121;border:0"></label>' +
        '<div id="stage-profile-error" style="color:#ffb4b4;font-size:13px"></div>' +
        '<button type="submit" style="width:100%;padding:15px;border:0;border-radius:14px;background:#8e72f6;color:#fff;font-weight:700">Create staging profile</button>' +
        '<button type="button" id="stage-profile-cancel" style="width:100%;padding:13px;border:0;background:transparent;color:#ddd">Cancel</button></form>';
      document.body.appendChild(layer);
      const name = layer.querySelector('[name="name"]');
      name.value = account.displayName || '';
      const yearSelect=layer.querySelector('[name="birth_year"]');
      const monthSelect=layer.querySelector('[name="birth_month"]');
      const daySelect=layer.querySelector('[name="birth_day"]');
      const refreshDays=()=>{
        const chosen=daySelect.value;
        daySelect.innerHTML=birthDayOptions(yearSelect.value,monthSelect.value,chosen);
        if(chosen&&daySelect.querySelector('option[value="'+chosen+'"]'))daySelect.value=chosen;
      };
      yearSelect.addEventListener('change',refreshDays);
      monthSelect.addEventListener('change',refreshDays);
      const inviteField=layer.querySelector('[name="invite_code"]');
      playModeReady.then(()=>{
        if(playStoreMode!==false){inviteField.closest('label').hidden=true;inviteField.value='';}
        else inviteField.value=cachedSignup(account.email)?.invite_code||deferredInviteCode;
      });
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
            birthdate:birthdateFromUi(form.elements.birth_year.value,
              form.elements.birth_month.value,form.elements.birth_day.value),
            country:manualCountryCode(form.elements.country.value),
            invite_code:playStoreMode===false?form.elements.invite_code.value.trim():''
          };
          const saved = await api('POST','/me',data);
          if(saved.invite_bonused)clearIncomingInvite();
          close(); resolve(saved);
        } catch (error) {
          const message=errText(error);
          layer.querySelector('#stage-profile-error').textContent = message==='invalid_profile'
            ?'Please check your name and birth date. You must be at least 13 years old.'
            :message;
          button.disabled = false;
        }
      };
    });
  }
  async function openManualCountryPicker(){
    if(!session){window.showAuth('welcome');return;}
    document.getElementById('sh-country-picker')?.remove();
    const layer=document.createElement('section');
    layer.id='sh-country-picker';
    layer.style.cssText='position:fixed;z-index:2147483500;inset:0;display:grid;place-items:center;'+
      'padding:20px;background:#0b071deE;color:#ffe2a0;font-family:inherit';
    layer.innerHTML='<form style="width:min(100%,420px);padding:25px;border:1px solid #f1c46b;'+
      'border-radius:24px;background:linear-gradient(155deg,#332049,#170e2b);'+
      'box-shadow:0 20px 60px #0009">'+
      '<h2 style="margin:0 0 10px">🌍 Country / Location</h2>'+
      '<p style="font-size:13px;line-height:1.5">Select your country yourself. It appears on your profile and room card. No GPS permission is used.</p>'+
      '<select name="country" required style="width:100%;margin:14px 0;padding:13px;'+
      'border-radius:12px;background:#fff;color:#161121">'+manualCountryOptions()+'</select>'+
      '<div id="sh-country-error" style="min-height:18px;color:#ffb7b7;font-size:12px"></div>'+
      '<button type="submit" style="width:100%;padding:13px;border-radius:12px;'+
      'background:linear-gradient(130deg,#f9d77c,#bf7d16);color:#24112d;font-weight:900">Save Country</button>'+
      '<button type="button" id="sh-country-cancel" style="width:100%;padding:12px;'+
      'background:transparent;color:#ffde9a;border:0">Cancel</button></form>';
    document.body.appendChild(layer);
    const select=layer.querySelector('[name="country"]');
    select.value=manualCountryCode(profile?.country);
    layer.querySelector('#sh-country-cancel').onclick=()=>layer.remove();
    layer.querySelector('form').onsubmit=async event=>{
      event.preventDefault();
      const code=manualCountryCode(select.value);
      if(!code)return;
      const button=layer.querySelector('[type="submit"]');
      button.disabled=true;
      try{
        const saved=await api('PATCH','/me',{country:code});
        profile={...profile,...saved};
        if(window.A)window.A.country=manualCountryLabel(code);
        if(typeof window.saveA==='function')window.saveA();
        layer.remove();
        if(typeof window.renderMe==='function')window.renderMe();
        await reloadRooms();
        toast('Country saved to your profile and room card');
      }catch(error){
        button.disabled=false;
        layer.querySelector('#sh-country-error').textContent=errText(error);
      }
    };
  }
  async function ensureProfile(account, form) {
    try { return await api('GET', '/me'); }
    catch (error) {
      if (errText(error) !== 'profile_not_found') throw error;
      // Wait for Play Install Referrer before first registration, not on normal login.
      await invitePendingReady;
      await playModeReady;
      const cached = form || cachedSignup(account.email);
      if (cached && cached.name && cached.dob && manualCountryCode(cached.country)) {
        try{
          const saved = await api('POST','/me',{
            name:cached.name,birthdate:cached.dob,country:manualCountryCode(cached.country),
            invite_code:playStoreMode===false?(deferredInviteCode||cached.invite_code):''
          });
          if(saved.invite_bonused)clearIncomingInvite();
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
  async function authenticated(account, form, expectedAttempt=authAttemptId) {
    await playModeReady;
    if (!account.signedIn || (!account.emailVerified && !playVirtualIdentityAllowed))
      throw new Error('Check your email verification link, then sign in again');
    const current = await ensureProfile(account, form);
    if (expectedAttempt!==authAttemptId) throw new Error('sign_in_superseded');
    const local = remember(account, current);
    // A link reopened after profile creation is redeemed without blocking home.
    if(deferredInviteCode)
      Promise.resolve().then(claimPendingInviteAfterLogin).catch(()=>{});
    // Ask for the featured person as soon as Firebase identity and profile
    // are verified. Waiting for wallet + room lists used to leave the first
    // splash on screen and then show a second opening much later.
    const openingTask=openingOnLaunch();
    refreshNotifications(false);refreshMessagesBadge();registerPushDevice();
    // Real profile identity is sufficient to open home. Load wallet and
    // rooms in the background; neither endpoint may hold the login screen.
    Promise.allSettled([reloadWallet(), reloadRooms()]).catch(error=>
      console.warn('Home refresh deferred:',errText(error)));
    // Room list renders as it arrives. Avoid copying the prior account's
    // room card onto a newly authenticated member.
    local.p.myRoom = null;
    local.state = {...balance};
    try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify([local])); } catch (_) {}
    // Show the real new-member referral offer after the authenticated home loads.
    // The referral newcomer offer follows the one-person 10-second opening,
    // never obscures the featured user or triggers an extra opening request.
    openingTask.finally(()=>setTimeout(maybeShowNewUserInviteWelcome,400));
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
    if(deferredInviteCode)auth.querySelector('#stage-invite-code').value=deferredInviteCode;
    playModeReady.then(()=>{
      if(playStoreMode!==false){
        const input=auth.querySelector('#stage-invite-code');
        if(input){input.previousElementSibling?.remove();input.remove();}
      }
    });
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
    const attempt=++authAttemptId;
    try {
      await playModeReady;
      const result = await native('emailSignUp', {email:form.key.trim(), password:form.pw});
      try {
        localStorage.setItem(META_KEY, JSON.stringify({
          email:form.key.trim(), name:form.name, dob:form.dob,
          country:manualCountryCode(form.country),
          invite_code:document.getElementById('stage-invite-code')?.value.trim()||deferredInviteCode
        }));
      } catch (_) {}
      if(playVirtualIdentityAllowed){
        const local=await authenticated(result,form,attempt);
        if(attempt!==authAttemptId)return {ok:false,msg:'Newer sign-in in progress'};
        return {ok:true,acct:local};
      }
      return { ok:false, msg:result.verificationSent ?
        'Account created. Verify your email, then log in.' :
        'Account created. Verification email could not be sent; try again later.' };
    } catch (error) { return { ok:false, msg:errText(error) }; }
  };
  function showConnectionRecovery(error) {
    // The Firebase account remains signed in. A temporary /me or network
    // failure is not a reason to sign out or show the Google picker again.
    let layer=document.getElementById('sh-login-recovery');
    if(!layer){
      layer=document.createElement('section');
      layer.id='sh-login-recovery';
      layer.setAttribute('role','alertdialog');
      layer.setAttribute('aria-modal','true');
      layer.style.cssText='position:fixed;inset:0;z-index:2147483645;display:grid;place-items:center;padding:22px;background:linear-gradient(160deg,#180e30,#060314);color:#fff;font-family:inherit';
      const panel=document.createElement('div');
      panel.style.cssText='width:min(100%,430px);border:2px solid #d5ae57;border-radius:22px;padding:24px;text-align:center;background:linear-gradient(145deg,#2b1942,#160f28);box-shadow:0 20px 60px #0009';
      const title=document.createElement('h2');
      title.textContent='Sharika connection is slow';
      title.style.cssText='color:#ffe09a;margin:0 0 12px;font-size:22px';
      const status=document.createElement('p');
      status.setAttribute('data-sh-login-status','');
      status.style.cssText='font-size:15px;line-height:1.5;overflow-wrap:anywhere';
      const retry=document.createElement('button');
      retry.type='button';retry.textContent='Retry connection';
      retry.style.cssText='width:100%;padding:14px;margin:14px 0 8px;border:1px solid #f3ca6a;border-radius:16px;background:#e8bd63;color:#220e38;font-weight:800;font-size:16px';
      retry.onclick=()=>{layer.remove();restore();};
      const signout=document.createElement('button');
      signout.type='button';signout.textContent='Sign out';
      signout.style.cssText='width:100%;padding:12px;border:1px solid #806a9d;border-radius:14px;background:#29133f;color:white';
      signout.onclick=()=>window.logout();
      panel.append(title,status,retry,signout);
      layer.appendChild(panel);document.body.appendChild(layer);
    }
    layer.querySelector('[data-sh-login-status]').textContent=
      'Your saved Firebase session was not erased. The connection did not finish: '+
      errText(error)+'. You can retry without creating a new account.';
    document.getElementById('sp')?.classList.remove('sharika-opening-pending');
    window.hideAuth();
  }

  window.API.login = async function (identity, password) {
    if (!identity.includes('@')) return {ok:false,msg:'Sign in using your email address'};
    const attempt=++authAttemptId;
    let account=null;
    try {
      try {
        account = await native('emailSignIn',{email:identity.trim(),password});
      } catch (error) {
        // A slow Firebase callback may arrive after the bridge timer while
        // Android has already committed a valid session. Recover that session
        // without asking the member to enter their password again.
        if (!/Request timed out/i.test(errText(error))) throw error;
        const restored=await native('session',{}).catch(()=>null);
        if (!restored?.signedIn ||
            String(restored.email||'').toLowerCase()!==identity.trim().toLowerCase())
          throw new Error('Sign-in connection timed out. Check your internet and try again.');
        account=restored;
      }
      if(attempt!==authAttemptId)return {ok:false,msg:'Newer sign-in in progress'};
      const local = await authenticated(account,undefined,attempt);
      if(attempt!==authAttemptId)return {ok:false,msg:'Newer sign-in in progress'};
      document.getElementById('sh-login-recovery')?.remove();
      return {ok:true,acct:local};
    } catch (error) {
      if(attempt===authAttemptId && account?.signedIn &&
         (account.emailVerified || playVirtualIdentityAllowed))
        showConnectionRecovery(error);
      const message = errText(error);
      if (/supplied auth credential|invalid.credential|wrong.password|invalid.login.credentials/i.test(message))
        return {ok:false,msg:'Email or password did not match. If you signed up with Google, use Google sign-in. Otherwise tap Forgot password.'};
      return {ok:false,msg:message};
    }
  };
  let googleLoginBusy = false;
  function googleLoginError(error) {
    const message=errText(error);
    if(message==='google_sign_in_timed_out')
      return 'Google account picker did not respond. Close any Google popup and tap Continue with Google again.';
    if(message==='google_sign_in_in_progress')
      return 'Google sign-in is already opening. Please wait for the account picker or retry shortly.';
    if(message==='google_sign_in_picker_retry')
      return 'Google sign-in could not finish. Tap Continue with Google again to try another account picker.';
    if(message==='google_sign_in_cancelled'||/GetCredentialCancellationException/i.test(message))
      return 'Google account selection closed without signing in. Tap Continue with Google to retry.';
    if(message==='google_account_not_available'||/NoCredentialException/i.test(message))
      return 'No Google account available. Add an account in Android settings and try again.';
    if(/Request timed out/i.test(message))
      return 'Google sign-in timed out. Check your internet connection and try again.';
    if(/developer.error|developer_error|ApiException:\s*10|configuration|misconfigured/i.test(message))
      return 'Google sign-in configuration needs updating. Contact the Sharika tester.';
    return message;
  }
  async function googleLogin() {
    if(googleLoginBusy)return;
    googleLoginBusy=true;
    const attempt=++authAttemptId;
    let account=null;
    const button=document.getElementById('wg');
    document.getElementById('sh-google-login-error')?.remove();
    if(button)button.disabled=true;
    try {
      toast('Opening Google account picker…');
      account=await native('googleSignIn');
      if(attempt!==authAttemptId)return;
      const local=await authenticated(account,undefined,attempt);
      if(attempt!==authAttemptId)return;
      document.getElementById('sh-login-recovery')?.remove();
      window.enter(local,'Signed in to Sharika staging');
      finishVerifiedStartup();
    } catch (error) {
      if(attempt!==authAttemptId)return;
      if(account?.signedIn && (account.emailVerified || playVirtualIdentityAllowed))
        showConnectionRecovery(error);
      else {
        const message=googleLoginError(error);
        toast(message);
        const googleButton=document.getElementById('wg');
        if(googleButton){
          const note=document.createElement('p');
          note.id='sh-google-login-error';
          note.setAttribute('role','alert');
          note.style.cssText='margin:10px 5px;color:#ffe3aa;font-size:13px;line-height:1.4;text-align:center;overflow-wrap:anywhere';
          note.textContent='Google login: '+message;
          googleButton.insertAdjacentElement('afterend',note);
        }
      }
    } finally{
      googleLoginBusy=false;
      const currentButton=document.getElementById('wg');
      if(currentButton)currentButton.disabled=false;
    }
  }

  // Keep original login imagery, forms, colors, and navigation.
  const previousAuthRender = window.authRender;
  window.authRender = function () {
    previousAuthRender();
    const google = document.getElementById('wg');
    if (google) google.onclick = googleLogin;
    const reset = document.getElementById('af');
    if (reset) reset.onclick = async function () {
      if (reset.disabled) return;
      const field = document.getElementById('aid');
      const status = document.getElementById('ae');
      const email = String(field?.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (status) status.textContent = 'Enter your email address above to reset your password.';
        return;
      }
      reset.disabled = true;
      try {
        await native('passwordReset', {email});
        if (status) status.textContent =
          'If this email has a password account, Firebase will send a reset link. Check your inbox and spam.';
      } catch (error) {
        if (status) status.textContent =
          'Password reset is temporarily unavailable. Try again later.';
      } finally {
        reset.disabled = false;
      }
    };
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
    const accountId=session?.user?.id;
    if(!accountId)return null;
    const wallet = await api('GET','/wallet');
    if(session?.user?.id!==accountId)return null;
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
  let lastRoomsRenderSignature=null;
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
      const discovery=window.SharikaDiscovery;
      window.CFG.viewerCountry=typeof profile==='undefined'?'':profile?.country||'';
      window.CFG.roomHistoryIds=discovery?discovery.readHistory(window.localStorage,userId):[];
      window.CFG.rooms = rows.filter(r => r.owner_id !== userId).map((r,i)=>({
        id:r.id,name:r.name,emoji:r.emoji || '🎙️',n:Number(r.online_count)||0,host:'Room owner',
        tag:'Voice Room',mics:[],c:COLORS[i%COLORS.length],
        th:r.theme || 'mid',owner_id:r.owner_id,seat_count:r.seat_count,
        seat_frame_style:r.seat_frame_style||'grad',cover_url:r.cover_url||null,
        access_locked:Number(r.access_locked)===1?1:0,
        owner_country:r.owner_country||'',owner_display_id:r.owner_display_id||r.id,
        created_at:r.created_at||''
      }));
      window.A.myRoom = own ? {
        id:own.id,name:own.name,emoji:own.emoji,th:own.theme,
        c:COLORS[0],owner_id:own.owner_id,seat_count:own.seat_count,
        seat_frame_style:own.seat_frame_style||'grad',
        n:Number(own.online_count)||0,cover_url:own.cover_url||null,
        access_locked:Number(own.access_locked)===1?1:0,
        owner_country:own.owner_country||window.CFG.viewerCountry||'',
        owner_display_id:own.owner_display_id||own.id,
        created_at:own.created_at||''
      } : null;
      // Quiet background refresh: changing identical room cards restarts every
      // CSS animation and drops touch/scroll state on slower Android WebViews.
      const renderSignature=JSON.stringify([userId,rows,window.CFG.viewerCountry,
        window.CFG.roomHistoryIds]);
      if(renderSignature!==lastRoomsRenderSignature){
        lastRoomsRenderSignature=renderSignature;
        window.renderRooms();
      }
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
      /^https:\/\/sharika-api-staging\.soverixnet\.workers\.dev\/api\/v1\/(?:rooms\/[0-9]{8}\/(?:cover|theme-image)|room-themes\/[1-9][0-9]{0,8}\/image)\?v=[0-9]+$/.test(value)
      ?value:null;
  }
  async function jpegRoomPreview(file,highDefinition=false,legacy=false){
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
    if(highDefinition&&Math.min(sourceWidth,sourceHeight)<720)
        throw new Error('For a clear room theme, choose a photo at least 720 px on its shorter side');
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      if(!ctx)throw new Error('Image editor is unavailable');
      const sides=legacy?[900,720,600,480,360,280]:
        highDefinition?[1920,1600,1440,1280,1080,900]:
        [1800,1600,1440,1280,1080,900,720,600];
      const qualities=legacy?[.76,.60,.45]:
        highDefinition?[.90,.82,.74,.64]:[.86,.78,.70,.62];
      const maxLength=legacy?120023:highDefinition?600023:320023;
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
        if(useAsTheme){
          // A room wallpaper and the small room-card photo are independent.
          // Never upload to /cover when selecting a wallpaper.
          const hd_image_data=await jpegRoomPreview(file,true);
          await api('PUT','/rooms/'+room.id+'/theme-image',{image_data:hd_image_data});
          const result=await api('PATCH','/rooms/'+room.id,{theme:'photo'});
          if(result.room?.theme!=='photo')
            throw new Error('Shared room background was not confirmed');
          room.th='photo';
          if(frame?.S&&window.cur?.id===room.id)
            await syncFrame(room,frame).catch(error=>
              console.warn('Theme saved; room refresh delayed:',errText(error)));
          if(frame?.$?.('sheet')?.querySelector('h3')?.textContent?.includes('Room theme'))
            frame.themeSheet();
          toast('Room background saved for everyone · card photo unchanged ✓');
          return;
        }
        // Cover editing must never overwrite the wallpaper, including when
        // the room currently uses a personal photo as its theme.
        const image_data=await jpegRoomPreview(file);
        let saved,standardQualityOnly=false;
        try{
          saved=await api('PUT','/rooms/'+room.id+'/cover',{image_data});
        }catch(error){
          if(errText(error)!=='room_cover_too_large')throw error;
          // An older staging Worker still only accepts 90 KB JPEGs.
          // Do not break room-photo editing while its HD rollout is pending.
          const compatible=await jpegRoomPreview(file,false,true);
          saved=await api('PUT','/rooms/'+room.id+'/cover',{image_data:compatible});
          standardQualityOnly=true;
        }
        room.cover_url=verifiedCoverUrl(saved.cover_url);
        if(frame?.S)frame.S.pic=room.cover_url;
        const preview=frame?.$?.('pbig');
        if(preview&&room.cover_url){
          preview.style.backgroundImage='url("'+room.cover_url+'")';
          preview.style.backgroundSize='cover';
          preview.textContent='';
        }
        await reloadRooms().catch(error=>
          console.warn('Room photo saved; card refresh delayed:',errText(error)));
        toast(standardQualityOnly?'Room saved at standard quality · HD server update pending':
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
      // The canonical room/user ID stays in API routing. Public room cards
      // display the owner's active Special ID, if one exists.
      const displayId=String(room.owner_display_id||room.id);
      const summary=card.querySelector('.info small');
      if(summary&&/^[0-9]{1,10}$/.test(displayId))
        summary.textContent='ID '+displayId+' · 🔥 '+(Number(room.n)||0);
      // Show only broad, user-supplied account country, not GPS or street data.
      // The old top-right Edit photo button belongs inside owner settings.
      card.querySelector('.sh-room-cover-edit')?.remove();
      card.querySelector('.room-country')?.remove();
      const storedCountry=String(room.owner_country||'').trim();
      const code=window.SharikaDiscovery?.countryCode(storedCountry)||'';
      const flag=window.SharikaDiscovery?.flagForCountry(storedCountry)||'';
      let countryName=storedCountry;
      if(code&&typeof Intl.DisplayNames==='function'){
        try{countryName=new Intl.DisplayNames(['en'],{type:'region'}).of(code)||storedCountry;}
        catch(_error){countryName=storedCountry||code;}
      }
      const title=code&&countryName?flag+' '+countryName:'🌍 Location not set';
      let location=card.querySelector('.sh-room-country-label');
      if(!location){
        location=document.createElement('span');
        location.className='sh-room-country-label';
        location.style.cssText='position:absolute;z-index:22;top:8px;right:8px;'+
          'max-width:68%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'+
          'border:1px solid #f3d68e;border-radius:13px;'+
          'background:linear-gradient(125deg,#372018ed,#150e2ce8);'+
          'box-shadow:0 4px 12px #13082288;color:#ffe8a3;'+
          'padding:5px 9px;font-size:11px;font-weight:800;pointer-events:none';
        card.style.position='relative';
        card.appendChild(location);
      }
      location.textContent=title;
      location.title=code?'Account country: '+countryName:'Account country not set';
      location.setAttribute('aria-label',location.title);
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
  // Weak mobile connections can take longer than the eight-second member poll.
  // A second poll must never invalidate an unfinished, otherwise valid first
  // snapshot: doing so left the loading overlay visible indefinitely. Coalesce
  // passive polls and allow a single fresh fetch after explicit seat/admin edits.
  function syncFrame(room,frame,passive=false) {
    if(!frame?.seats || window.cur?.id!==room.id || frame.__sharikaSeatMovePending)
      return Promise.resolve();
    const active=frame.__sharikaSeatSyncInFlight;
    if(active){
      if(passive)return active;
      if(!frame.__sharikaSeatSyncRefresh){
        const refresh=active.catch(()=>{}).then(()=>syncFrame(room,frame,true));
        frame.__sharikaSeatSyncRefresh=refresh;
        refresh.finally(()=>{
          if(frame.__sharikaSeatSyncRefresh===refresh)
            frame.__sharikaSeatSyncRefresh=null;
        }).catch(()=>{});
      }
      return frame.__sharikaSeatSyncRefresh;
    }
    const work=syncFrameOnce(room,frame);
    const tracked=work.finally(()=>{
      if(frame.__sharikaSeatSyncInFlight===tracked)
        frame.__sharikaSeatSyncInFlight=null;
    });
    frame.__sharikaSeatSyncInFlight=tracked;
    return tracked;
  }
  async function syncFrameOnce(room,frame) {
    if (!frame || !frame.seats || !window.cur || window.cur.id !== room.id) return;
    // Out-of-order room polls cannot restore stale seats or old cosmetics.
    if(frame.__sharikaSeatMovePending)return;
    const requestNo=(frame.__sharikaSeatSyncNo||0)+1;
    frame.__sharikaSeatSyncNo=requestNo;
    const userId=session?.user?.id;
    // An optional owner profile/medal lookup must never hold the entire voice
    // room behind a second HTTP request. The member snapshot is authoritative
    // for seats and contains the active owner's verified display information.
    // Refresh the extra owner artwork in the background at most once/minute.
    if(!room.__sharikaOwnerFetch &&
       (!room.__sharikaOwnerFetchedAt ||
        Date.now()-room.__sharikaOwnerFetchedAt>60000)) {
      room.__sharikaOwnerFetchedAt=Date.now();
      const ownerFetch=api('GET','/users/'+room.id).then(owner=>{
        if(String(owner?.id||owner?.public_id||'')===String(room.id))
          room.__sharikaVerifiedOwner=owner;
      }).catch(error=>console.warn('Room owner artwork delayed:',errText(error)));
      room.__sharikaOwnerFetch=ownerFetch;
      ownerFetch.finally(()=>{
        if(room.__sharikaOwnerFetch===ownerFetch)room.__sharikaOwnerFetch=null;
      }).catch(()=>{});
    }
    const data = await api('GET','/rooms/'+room.id+'/members');
    // Older deployed Workers can incorrectly answer 200 + [] when their
    // presence coordinator is temporarily unavailable. After a verified
    // /join, this device itself must appear in the roster; an empty snapshot
    // is therefore inconsistent, not proof that every seat became vacant.
    // Preserve only the LAST verified UI, never render unverified D1 rows.
    if(!Array.isArray(data.members)||data.members.length===0){
      if(!frame.__sharikaPresenceRetryAt ||
         Date.now()-frame.__sharikaPresenceRetryAt>20000){
        frame.__sharikaPresenceRetryAt=Date.now();
        heartbeatPresence(room.id);
      }
      throw new Error('room_presence_temporarily_unavailable');
    }
    frame.__sharikaPresenceRetryAt=0;
    const ownerMember=(data.members||[]).find(member=>member.user_id===room.owner_id);
    const verifiedMemberOwner=ownerMember?.sharika_users||{};
    const owner=room.__sharikaVerifiedOwner||{
      public_id:verifiedMemberOwner.public_id||room.id,
      name:verifiedMemberOwner.name||'Room Owner',
      pic:verifiedMemberOwner.pic||null,
      special_id:verifiedMemberOwner.special_id||null,
      display_id:verifiedMemberOwner.display_id||room.id,
      svip_level:verifiedMemberOwner.svip_level||0,
      frame_style:verifiedMemberOwner.frame_style||'',
      entry_style:verifiedMemberOwner.entry_style||'',
      medal_style:verifiedMemberOwner.medal_style||'',
      name_tag_style:verifiedMemberOwner.name_tag_style||''
    };
    if(frame.__sharikaSeatSyncNo!==requestNo ||
       !session || session.user.id!==userId || window.cur?.id!==room.id ||
       document.getElementById('rf')?.contentWindow!==frame)return;
    // The room header displays the owner's active Special ID while all
    // calls, membership actions and room navigation keep the canonical ID.
    const visibleOwnerId=String(owner.special_id||owner.display_id||room.id);
    const roomHeaderId=frame.$?.('rid');
    if(roomHeaderId&&/^[0-9]{1,10}$/.test(visibleOwnerId))
      roomHeaderId.textContent=visibleOwnerId;
    const self=(data.members||[]).find(m=>m.user_id===session?.user?.id);
    // The verified self-state is separate from the public presence roster.
    // A lost heartbeat must not revoke Room Admin controls or auto-mute mic.
    const selfState=data.self_state||null;
    frame.__sharikaRoomRole=room.owner_id===session?.user?.id?'owner':
      (selfState?.role==='admin'||(!selfState&&self?.role==='admin'))?'admin':'member';
    frame.__sharikaRoomLocked=!!data.access_locked;
    room.access_locked=frame.__sharikaRoomLocked?1:0;
    if(frame.document?.querySelector){
      let accessBadge=frame.document.getElementById('sh-room-access-badge');
      if(!accessBadge){
        accessBadge=frame.document.createElement('span');
        accessBadge.id='sh-room-access-badge';
        accessBadge.setAttribute('aria-live','polite');
        accessBadge.style.cssText='padding:4px 8px;border:1px solid #e4bf70;'+
          'border-radius:11px;background:#14251f;color:#ffe5a3;font-size:11px;'+
          'font-weight:750;white-space:nowrap';
        frame.document.querySelector('.stats')?.appendChild(accessBadge);
      }
      accessBadge.textContent=frame.__sharikaRoomLocked?'🔒 Room locked':'';
      accessBadge.style.display=frame.__sharikaRoomLocked?'inline-flex':'none';
    }
    const safetyButton=frame.$?.('bOwn');
    if(safetyButton)safetyButton.style.display=
      ['owner','admin'].includes(frame.__sharikaRoomRole)?'':'none';
    frame.__sharikaMemberRoles=new Map((data.members||[]).map(m=>
      [String(m.sharika_users?.public_id||''),String(m.role||'member')]));
    // No reserved Owner mic: listening starts on entry, publishing only
    // after that Owner/guest deliberately takes an unlocked microphone seat.
    const eligible=selfState
      ?Number.isInteger(selfState.seat_no)&&selfState.seat_no>0&&!selfState.muted
      :!!self && self.seat_no!==null && !self.muted;
    if(sfuState?.roomId===room.id && sfuState.canPublish!==!!eligible)
      connectVoice(room.id).catch(error=>frame.toast('Voice update: '+errText(error)));
    if(voiceRoomId===room.id && voiceRoom &&
       voiceRoom.sharikaPublishAllowed!==!!eligible)
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
    // Room cards and the in-room header must use the same versioned, verified
    // cover. A changed version refreshes guests who never leave the room.
    const roomCover=verifiedCoverUrl(data.cover_url);
    const coverChanged=frame.S.pic!==roomCover;
    room.cover_url=roomCover;
    frame.S.pic=roomCover;
    // Theme is authoritative in the shared room snapshot. Neither the
    // owner's phone nor a guest's stale localStorage may override it.
    const chosenTheme=['mid','gold','ocean','rose','forest','sunset','photo']
      .includes(data.theme)||/^catalog:[1-9][0-9]{0,8}$/.test(String(data.theme||''))
      ?data.theme:'mid';
    const sharedImage=(chosenTheme==='photo'||chosenTheme.startsWith('catalog:'))
      ?verifiedThemeUrl(data.theme_background_url):null;
    const palette=(chosenTheme==='photo'||chosenTheme.startsWith('catalog:'))
      ?'mid':chosenTheme;
    const themeChanged=room.th!==chosenTheme||frame.S.theme!==palette||
      frame.S.bg!==sharedImage||frame.S.frame!==chosenSeatFrame;
    room.th=chosenTheme;
    frame.S.theme=palette;
    frame.S.bg=sharedImage;
    frame.S.frame=chosenSeatFrame;
    const roomApp=frame.$?.('app');
    if(roomApp){
      // Keep the verified, shared wallpaper in a sharp image layer rather
      // than enlarging a compressed thumbnail behind heavy dark overlays.
      roomApp.classList.toggle('sharika-hd-room-bg',!!sharedImage);
      // Agency/Family badges belong on verified profiles, never as a floating
      // name over the voice-room header and online member avatars.
      roomApp.querySelector('#sh-room-owner-family-badge')?.remove();
      if(sharedImage)
        roomApp.style.setProperty('--sharika-shared-wallpaper','url("'+sharedImage+'")');
      else roomApp.style.removeProperty('--sharika-shared-wallpaper');
    }
    if((themeChanged||coverChanged)&&typeof frame.applyTheme==='function')
      frame.applyTheme();
    const slots = Array.from({length: Math.max(2,Number(room.seat_count||12)+1)},
      (_,i)=>({empty:1,i}));
    const ownerSeat={n:owner.name,e:'👑',pic:verifiedAvatarUrl(owner.pic),i:0,
      user_id:room.owner_id,public_id:owner.public_id||room.id,
      room_role:'owner',
      special_id:owner.special_id||null,
      display_id:owner.special_id||owner.display_id||owner.public_id||room.id,
      muted:room.owner_id===session?.user?.id&&localMic===false,talk:false,
      svip_level:Number(owner.svip_level)||0,
      frame_style:owner.frame_style||'',entry_style:owner.entry_style||'',
      medal_style:owner.medal_style||'',name_tag_style:owner.name_tag_style||''};
    // The owner has a permanent room, NOT a permanent occupied seat. Keep
    // the crown-only throne empty until they deliberately select a mic seat.
    slots[0]={empty:1,i:0,owner_throne:true};
    const audience=[];
    for(const member of data.members || []) {
      const user=member.sharika_users;
      if(!user)continue;
      if(member.user_id===room.owner_id){
        // An owner only occupies a numbered mic seat after a real seat tap.
        if(Number.isInteger(member.seat_no)&&member.seat_no>0&&
           member.seat_no<slots.length){
          slots[member.seat_no]={...ownerSeat,i:member.seat_no,
            owner_mic_seat:true,muted:!!member.muted||
              (member.user_id===session?.user?.id&&localMic===false)};
          slots[0].owner_mic_seat_no=member.seat_no;
        }else{
          audience.push({n:user.name,e:'👑',id:user.special_id||user.display_id||user.public_id,
            canonical_id:user.public_id,room_role:'owner',special_id:user.special_id||null,
            pic:verifiedAvatarUrl(user.pic),lv:user.wealth_level,
            svip_level:Number(user.svip_level)||0,
            frame_style:user.frame_style||'',entry_style:user.entry_style||'',
            medal_style:user.medal_style||'',name_tag_style:user.name_tag_style||''});
        }
        continue;
      }
      if(Number.isInteger(member.seat_no) && member.seat_no>0 && member.seat_no<slots.length)
        slots[member.seat_no]={
          n:user.name,e:'👤',pic:verifiedAvatarUrl(user.pic),i:member.seat_no,
          user_id:member.user_id,public_id:user.public_id,room_role:member.role,
          special_id:user.special_id||null,
          display_id:user.special_id||user.display_id||user.public_id,
          muted:!!member.muted||(member.user_id===session?.user?.id&&localMic===false),talk:false,
          svip_level:Number(user.svip_level)||0,
          frame_style:user.frame_style||'',entry_style:user.entry_style||'',
          medal_style:user.medal_style||'',name_tag_style:user.name_tag_style||''
        };
      else audience.push({n:user.name,e:'👤',id:user.special_id||user.display_id||user.public_id,
         canonical_id:user.public_id,room_role:member.role,
         special_id:user.special_id||null,
        pic:verifiedAvatarUrl(user.pic),lv:user.wealth_level,
        svip_level:Number(user.svip_level)||0,
        frame_style:user.frame_style||'',entry_style:user.entry_style||'',
        medal_style:user.medal_style||'',name_tag_style:user.name_tag_style||''});
    }
    for(const seatNo of data.locked_seats||[]) {
      if(Number.isInteger(seatNo)&&seatNo>0&&seatNo<slots.length&&slots[seatNo].empty)
        slots[seatNo]={lock:1,i:seatNo};
    }
    // A steady room used to rebuild every seat, avatar, overlay and touch
    // handler every 8 seconds even when the authoritative snapshot was equal.
    // Keep live speaking indicators responsive without repainting stable DOM.
    // CSS handles viewport changes; the Android keyboard must not tear down
    // all seat DOM nodes just because WebView reports a new innerHeight.
    const renderSignature=JSON.stringify([slots,audience,palette,sharedImage,roomCover,
      chosenSeatFrame,balance.coins,balance.xp,data.bond_pairs||[]]);
    const snapshotChanged=frame.__sharikaRoomRenderSignature!==renderSignature;
    frame.seats=slots;
    if(typeof paintVoiceSpeakers==='function')paintVoiceSpeakers(room.id,frame);
    frame.U=audience;
    frame.S.coins=balance.coins;
    frame.S.xp=balance.xp;
    frame.S.n=slots.length;
    // Server-verified members, owner and room rewards drive the premium
    // header. The iframe is the visual layer; all authoritative state stays
    // with this authenticated D1/LiveKit adapter.
    if(typeof frame.SharikaRoomPremium?.sync==='function'){
      const liveMembers=(data.members||[])
        .filter(m=>m.user_id&&m.sharika_users?.public_id)
        .sort((a,b)=>{
          if(a.user_id===room.owner_id)return -1;
          if(b.user_id===room.owner_id)return 1;
          const sa=Number.isInteger(a.seat_no)?a.seat_no:999;
          const sb=Number.isInteger(b.seat_no)?b.seat_no:999;
          return sa-sb;
        })
        .map(m=>({
          name:String(m.sharika_users.name||'Member'),
          pic:verifiedAvatarUrl(m.sharika_users.pic),
          publicId:String(m.sharika_users.public_id),
          displayId:String(m.sharika_users.special_id||
            m.sharika_users.display_id||m.sharika_users.public_id),
          seatNo:Number.isInteger(m.seat_no)?m.seat_no:null,
          role:String(m.role||'member')
        }));
      frame.SharikaRoomPremium.sync({
        roomId:room.id,isOwner:room.owner_id===session?.user?.id,
        owner:{
          name:String(owner.name||'Room Owner'),
          pic:verifiedAvatarUrl(owner.pic),
          displayId:String(owner.special_id||owner.display_id||
            owner.public_id||room.id)
        },
        members:liveMembers,
        openProfile:member=>frame.__sharikaOpenQuickProfile?.(member),
        loadRewards:()=>api('GET','/rooms/'+room.id+'/rewards'),
        loadAnnouncement:()=>api('GET','/rooms/'+room.id+'/announcement'),
        saveAnnouncement:text=>api('PUT','/rooms/'+room.id+'/announcement',{text}),
        loadRankings:period=>api('GET','/rooms/'+room.id+
          '/contributors?period='+encodeURIComponent(period)).then(result=>({
            ...result,leaders:(result.leaders||[]).map(item=>({
              ...item,pic:verifiedAvatarUrl(item.pic)
            }))
          }))
      });
    }
    if(!snapshotChanged){
      revealVerifiedRoom(room,frame);
      return;
    }
    frame.__sharikaRoomRenderSignature=renderSignature;
    frame.render();
    if(typeof paintVerifiedMicCount==='function')paintVerifiedMicCount(frame);
    if(typeof paintVoiceSpeakers==='function')paintVoiceSpeakers(room.id,frame);
    decorateRoomPeople(frame);
    decorateRoomChat(frame);
    if(typeof decorateBondSeatOverlay==='function')
      decorateBondSeatOverlay(frame,data.bond_pairs);
    // Arrival effects come from the coordinator's short, verified event
    // history, not the 15-second seat/member snapshot that misses guests.
    frame.__soveraSeenMembers=new Set((data.members||[]).map(m=>m.user_id));
    // Never expose the bundled demo seats while the authenticated room
    // snapshot is still loading. Reveal the complete real room in one frame.
    revealVerifiedRoom(room,frame);
  }
  function revealVerifiedRoom(room,frame){
    const iframe=document.getElementById('rf');
    if(window.cur?.id!==room.id || iframe?.contentWindow!==frame ||
       !frame.__sharikaRoomRenderSignature)return;
    document.getElementById('rw')?.classList?.remove('sh-room-awaiting');
    if(typeof hideRoomJoining==='function')hideRoomJoining();
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
    root.querySelector('.pf')?.classList.add('sh-ranked-profile','sh-room-royal');
    const meta=root.querySelector('.pfh .meta');
    if(meta){
      meta.replaceChildren();
      const idLine=document.createElement('div');
      idLine.className='sh-royal-idline';
      const idLabel=document.createElement('span');
      idLabel.className='sh-royal-user-id';
      idLabel.textContent='ID: '+String(member.special_id||member.display_id||member.id);
      idLine.appendChild(idLabel);
      const roomRole=frame?.__sharikaMemberRoles?.get(String(member.id));
      if(roomRole==='owner'||roomRole==='admin'){
        const roomTag=document.createElement('span');
        roomTag.className='sh-royal-role-tag sh-royal-room-admin';
        roomTag.textContent=roomRole==='owner'?'👑 ROOM OWNER':'🛡 ROOM ADMIN';
        idLine.appendChild(roomTag);
      }
      for(const [yes,label,kind] of [
        [member.bd_active,'✦ BD','sh-royal-bd'],
        [member.seller_active,'✦ Seller','sh-royal-seller']
      ]){
        if(!yes)continue;
        const badge=document.createElement('span');
        badge.className='sh-royal-role-tag '+kind;
        badge.textContent=label;idLine.appendChild(badge);
      }
      meta.appendChild(idLine);
      if(member.country){
        const country=document.createElement('span');
        country.textContent='🌍 '+String(member.country);
        meta.appendChild(country);
      }
      if(member.family?.status==='active'){
        const tag=document.createElement('span');
        tag.className='sh-royal-room-family-link';
        tag.textContent='👑 Agency · '+String(member.family.name);
        meta.appendChild(tag);
      }
    }
    const bio=root.querySelector('.pfh .bio');
    if(bio)bio.textContent='Verified Sharika member';
    paintRoyalPublicLevels(root,member,null);
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
  // Room music is separate from chat and gift history. A licensed HTTPS file
  // from the Admin catalogue is rendered by each listener; a phone MP3 stays
  // on its owner's device and enters the existing room SFU microphone uplink.
  let musicState=null,musicStateRoom=null,musicPlaybackKey='',musicLocal=null;
  let musicPlayer=null,musicVolume=.6,musicHeartbeat=null,musicSyncPending=false;
  function moderatorCanPlayMusic(){
    const role=document.getElementById('rf')?.contentWindow?.__sharikaRoomRole;
    return role==='owner'||role==='admin';
  }
  function validRoomMusicUrl(url){
    try{
      const parsed=new URL(String(url));
      return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&
        /\.(mp3|m4a|aac|ogg|wav)$/i.test(parsed.pathname);
    }catch(_){return false;}
  }
  function roomMusicPlayer(){
    if(!musicPlayer){
      musicPlayer=document.createElement('audio');
      musicPlayer.id='sharika-room-music-audio';
      musicPlayer.preload='auto';musicPlayer.playsInline=true;
      musicPlayer.volume=musicVolume;
      musicPlayer.style.display='none';
      document.body.appendChild(musicPlayer);
    }
    return musicPlayer;
  }
  function closeRoomMusicAudio(){
    if(musicPlayer){musicPlayer.pause();musicPlayer.removeAttribute('src');musicPlayer.load();}
  }
  function releasePhoneMusic(){
    const local=musicLocal;
    if(!local)return;
    musicLocal=null;
    if(musicHeartbeat){clearInterval(musicHeartbeat);musicHeartbeat=null;}
    // Undo replaceTrack before stopping its MediaStreamTrack. During a room
    // disconnect the sender may already be closed; no track is leaked.
    if(local.sender&&local.state===sfuState&&
       local.original?.readyState==='live')
      local.sender.replaceTrack(local.original).catch(()=>{});
    try{local.audio.pause();local.audio.src='';local.audio.load();}catch(_){}
    try{local.micSource.disconnect();local.songSource.disconnect();}catch(_){}
    try{for(const track of local.destination.stream.getTracks())track.stop();}catch(_){}
    local.context.close().catch(()=>{});
    URL.revokeObjectURL(local.blobUrl);
  }
  function resetRoomMusic(){
    if(musicPoll){clearInterval(musicPoll);musicPoll=null;}
    if(musicHeartbeat){clearInterval(musicHeartbeat);musicHeartbeat=null;}
    document.getElementById('sharika-room-music-panel')?.remove();
    releasePhoneMusic();closeRoomMusicAudio();
    musicStateRoom=null;musicState=null;musicPlaybackKey='';
  }
  function playbackForMusicState(roomId,state){
    if(window.cur?.id!==roomId)return;
    const nextKey=String(state?.revision||0)+':'+String(state?.mode||'off');
    if(musicPlaybackKey===nextKey)return;
    musicPlaybackKey=nextKey;
    if(musicLocal&&(state?.mode!=='local'||
       Number(state.revision)!==Number(musicLocal.revision)))releasePhoneMusic();
    if(state?.mode==='library'&&validRoomMusicUrl(state.url)){
      const player=roomMusicPlayer();
      player.pause();player.src=state.url;player.volume=musicVolume;
      const seek=()=>{
        if(window.cur?.id!==roomId||musicPlaybackKey!==nextKey)return;
        const seconds=Math.max(0,(Date.now()-Number(state.started_at_ms||Date.now()))/1000);
        if(Number.isFinite(player.duration)&&player.duration>0)
          player.currentTime=Math.min(seconds,Math.max(0,player.duration-.1));
        else if(seconds<3600)try{player.currentTime=seconds;}catch(_){}
        player.play().catch(error=>console.warn('Room library playback:',errText(error)));
      };
      if(player.readyState>=1)seek();
      else player.addEventListener('loadedmetadata',seek,{once:true});
    }else closeRoomMusicAudio();
  }
  async function pollRoomMusic(roomId){
    if(musicSyncPending||!session||window.cur?.id!==roomId)return;
    musicSyncPending=true;
    try{
      const next=await api('GET','/rooms/'+roomId+'/music');
      if(window.cur?.id!==roomId)return;
      musicStateRoom=roomId;musicState=next;
      playbackForMusicState(roomId,next);
      const label=document.getElementById('sharika-music-now-playing');
      if(label)label.textContent=next.mode==='off'?'No song playing':
        (next.mode==='local'?'📱 Phone MP3':'🎼 Music Library')+' · '+next.title;
    }catch(error){console.warn('Room music state:',errText(error));}
    finally{musicSyncPending=false;}
  }
  function startRoomMusicPoll(roomId){
    if(musicPoll)clearInterval(musicPoll);
    musicStateRoom=roomId;musicState=null;musicPlaybackKey='';
    pollRoomMusic(roomId).catch(()=>{});
    musicPoll=setInterval(()=>{if(window.cur?.id===roomId)pollRoomMusic(roomId);},3500);
  }
  async function selectLibrarySong(roomId,trackId){
    await api('PUT','/rooms/'+roomId+'/music',{action:'library',track_id:trackId});
    await pollRoomMusic(roomId);
    toast('🎼 Playing Music Library song in this room');
  }
  async function stopRoomMusic(roomId){
    await api('PUT','/rooms/'+roomId+'/music',{action:'stop'});
    releasePhoneMusic();closeRoomMusicAudio();
    await pollRoomMusic(roomId);
  }
  async function streamPhoneMusic(roomId,file){
    if(!moderatorCanPlayMusic())throw new Error('Only Room Owner or Room Admin can play music');
    if(!file||!(/^(audio\/)/i.test(file.type)||/\.(mp3|m4a|aac|ogg|wav)$/i.test(file.name)))
      throw new Error('Choose an MP3 or another supported audio file');
    if(file.size>50*1024*1024)throw new Error('Please choose a file smaller than 50 MB');
    if(musicLocal)await stopRoomMusic(roomId);
    const state=sfuState;
    const mic=state?.media?.getAudioTracks()[0];
    if(!state||state.roomId!==roomId||!state.canPublish||
       !state.readyPublication||!mic||mic.readyState!=='live')
      throw new Error('Take an unlocked mic seat and connect voice before sharing phone MP3');
    if(typeof AudioContext==='undefined'&&typeof webkitAudioContext==='undefined')
      throw new Error('This device does not support phone MP3 broadcast');
    const sender=state.publishPC?.getSenders()?.find(item=>item.track===mic);
    if(!sender)throw new Error('Room microphone uplink unavailable; please reconnect');
    const context=new (window.AudioContext||window.webkitAudioContext)();
    let blobUrl=null;
    try{
      blobUrl=URL.createObjectURL(file);
      const audio=new Audio(blobUrl);audio.loop=false;
      const micSource=context.createMediaStreamSource(state.media);
      const songSource=context.createMediaElementSource(audio);
      const destination=context.createMediaStreamDestination();
      micSource.connect(destination);songSource.connect(destination);
      await context.resume();
      // Reserve the room controller first; no file is uploaded to Cloudflare.
      const current=await api('PUT','/rooms/'+roomId+'/music',{
        action:'local',title:file.name.slice(0,100)
      });
      if(window.cur?.id!==roomId)throw new Error('Room changed');
      const mixed=destination.stream.getAudioTracks()[0];
      await sender.replaceTrack(mixed);
      musicLocal={roomId,revision:current.revision,original:mic,state,sender,context,audio,micSource,
        songSource,destination,blobUrl};
      await audio.play();
      musicState=current;musicStateRoom=roomId;
      closeRoomMusicAudio();
      musicPlaybackKey=String(current.revision)+':local';
      if(musicHeartbeat)clearInterval(musicHeartbeat);
      musicHeartbeat=setInterval(()=>{
        if(musicLocal?.roomId===roomId&&window.cur?.id===roomId)
          api('PUT','/rooms/'+roomId+'/music',{action:'heartbeat'})
            .catch(()=>{releasePhoneMusic();toast('Phone MP3 sharing stopped');});
      },8000);
      audio.addEventListener('ended',()=>{
        if(musicLocal?.audio===audio)stopRoomMusic(roomId).catch(()=>releasePhoneMusic());
      },{once:true});
      toast('📱 Phone MP3 is broadcasting over the room voice connection');
    }catch(error){
      if(musicLocal?.blobUrl===blobUrl)releasePhoneMusic();
      else {
        if(blobUrl)URL.revokeObjectURL(blobUrl);
        context.close().catch(()=>{});
      }
      api('PUT','/rooms/'+roomId+'/music',{action:'stop_self'}).catch(()=>{});
      throw error;
    }
  }
  async function openRoomMusic(){
    const roomId=window.cur?.id;
    if(!roomId){toast('Join a room to use Music');return;}
    document.getElementById('sharika-room-music-panel')?.remove();
    const overlay=document.createElement('div');
    overlay.id='sharika-room-music-panel';
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483000;'+
      'display:flex;align-items:flex-end;justify-content:center;'+
      'background:#090415d9;padding:12px;box-sizing:border-box;color:#fff1ce';
    const panel=document.createElement('div');
    panel.style.cssText='width:min(100%,520px);max-height:80vh;overflow-y:auto;'+
      'border:2px solid #f2cb75;border-radius:26px;padding:20px;'+
      'background:linear-gradient(155deg,#583070,#201035 40%,#110c24);'+
      'box-shadow:inset 0 3px 6px #ffef9a66,inset 0 -6px 16px #080217,0 18px 45px #000a';
    overlay.appendChild(panel);document.body.appendChild(overlay);
    overlay.onclick=e=>{if(e.target===overlay)overlay.remove();};
    const header=document.createElement('div');
    header.style.cssText='display:flex;justify-content:space-between;align-items:center';
    const title=document.createElement('h2');title.textContent='🎵 Royal Room Music';
    title.style.cssText='font-size:22px;margin:0 0 8px;color:#ffe39a';
    const close=document.createElement('button');close.textContent='✕ Close';
    close.style.cssText='background:#281337;color:#ffe4af;border:1px solid #d7a653;border-radius:12px;padding:9px';
    close.onclick=()=>overlay.remove();header.append(title,close);panel.appendChild(header);
    const now=document.createElement('p');now.id='sharika-music-now-playing';
    now.textContent=musicState?.mode&&musicState.mode!=='off'?
      '🎼 '+musicState.title:'No song playing';
    now.style.cssText='font-weight:700;padding:12px;border:1px solid #c59152;border-radius:15px;background:#1a1028';
    panel.appendChild(now);
    const volumeLabel=document.createElement('label');
    volumeLabel.textContent='🔊 Music volume (this phone)';
    volumeLabel.style.cssText='display:block;font-size:13px;margin:12px 0 6px';
    const volume=document.createElement('input');volume.type='range';volume.min='0';volume.max='100';
    volume.value=String(Math.round(musicVolume*100));volume.style.width='100%';
    volume.oninput=()=>{musicVolume=Number(volume.value)/100;if(musicPlayer)musicPlayer.volume=musicVolume;};
    panel.append(volumeLabel,volume);
    const status=document.createElement('p');
    status.style.cssText='font-size:13px;min-height:18px;color:#ffe29b';
    panel.appendChild(status);
    if(moderatorCanPlayMusic()){
      const stop=document.createElement('button');
      stop.textContent='■ Stop music for everyone';
      stop.style.cssText='display:block;width:100%;padding:13px;border:1px solid #f6ce7b;'+
        'border-radius:16px;background:linear-gradient(145deg,#a94a5b,#54233f);color:#fff;font-weight:800;margin:12px 0';
      stop.onclick=async()=>{
        stop.disabled=true;
        try{await stopRoomMusic(roomId);status.textContent='Room music stopped';}
        catch(e){status.textContent='Could not stop: '+errText(e);}
        finally{stop.disabled=false;}
      };
      panel.appendChild(stop);
      const uploadLabel=document.createElement('label');
      uploadLabel.textContent='📱 Broadcast MP3 from your phone (mic seat required)';
      uploadLabel.style.cssText='display:block;font-weight:700;margin:15px 0 6px';
      const input=document.createElement('input');input.type='file';input.accept='audio/*,.mp3,.m4a,.aac,.ogg,.wav';
      input.style.cssText='display:block;width:100%;max-width:100%;padding:9px;border:1px solid #d2a45a;border-radius:12px;box-sizing:border-box';
      input.onchange=async()=>{
        if(!input.files?.[0])return;
        input.disabled=true;status.textContent='Connecting phone music to room voice…';
        try{await streamPhoneMusic(roomId,input.files[0]);status.textContent='Phone MP3 broadcasting ✓';}
        catch(e){status.textContent='MP3 unavailable: '+errText(e);}
        finally{input.disabled=false;input.value='';}
      };
      panel.append(uploadLabel,input);
    }else{
      const label=document.createElement('p');
      label.textContent='Only Room Owner / Room Admin can choose or stop songs. Everyone can listen.';
      label.style.cssText='font-size:13px;opacity:.9';panel.appendChild(label);
    }
    const heading=document.createElement('h3');heading.textContent='🎼 Admin Music Library';
    heading.style.cssText='font-size:16px;margin:18px 0 8px;color:#ffdc87';panel.appendChild(heading);
    const list=document.createElement('div');list.textContent='Loading library…';panel.appendChild(list);
    try{
      const catalogue=await api('GET','/music-library');
      if(!overlay.isConnected)return;
      list.replaceChildren();
      if(!catalogue.tracks?.length)list.textContent='No songs yet. Super Admin can add licensed HTTPS MP3 links in Admin Panel.';
      for(const track of catalogue.tracks||[]){
        const item=document.createElement('div');
        item.style.cssText='display:flex;gap:10px;align-items:center;justify-content:space-between;'+
          'padding:10px 4px;border-bottom:1px solid #b99b6f66';
        const name=document.createElement('span');name.textContent='♪ '+track.title;
        name.style.cssText='font-size:14px;min-width:0;overflow-wrap:anywhere';item.appendChild(name);
        if(moderatorCanPlayMusic()){
          const play=document.createElement('button');play.textContent='▶ Play';
          play.style.cssText='border:1px solid #ffe3a1;border-radius:14px;'+
            'background:linear-gradient(#ffdf91,#a66f23);color:#241128;font-weight:900;padding:9px 13px';
          play.onclick=async()=>{
            play.disabled=true;status.textContent='Starting shared song…';
            try{await selectLibrarySong(roomId,Number(track.id));status.textContent='Now playing: '+track.title;}
            catch(e){status.textContent='Song unavailable: '+errText(e);}
            finally{play.disabled=false;}
          };
          item.appendChild(play);
        }
        list.appendChild(item);
      }
    }catch(error){list.textContent='Library unavailable: '+errText(error);}
    pollRoomMusic(roomId).catch(()=>{});
  }
  window.SharikaRoomMusic=Object.freeze({open:openRoomMusic});
  // A dedicated, scrollable theme gallery is separate from Room Settings
  // and never edits the room cover/profile picture. Guests may browse all
  // published artwork; the verified room owner alone may apply a wallpaper.
  async function showRoomThemeGallery(room,frame){
    const doc=frame?.document;
    if(!doc||!room||window.cur?.id!==room.id)return;
    doc.getElementById('sh-theme-gallery-page')?.remove();
    frame.$?.('bg')?.classList.remove('on');
    const owner=room.owner_id===session?.user?.id;
    const panel=doc.createElement('section');
    panel.id='sh-theme-gallery-page';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-modal','true');
    panel.setAttribute('aria-label','Room Theme Gallery');
    panel.style.cssText='position:fixed;inset:0;z-index:2147483500;overflow-y:auto;'+
      'background:linear-gradient(165deg,#291a0d,#071d15 40%,#03120c);'+
      'color:#fff0ca;padding:calc(16px + env(safe-area-inset-top,0px)) 14px 28px;'+
      'font:14px/1.4 system-ui,sans-serif;overscroll-behavior:contain';
    const header=doc.createElement('div');
    header.style.cssText='display:flex;align-items:center;gap:11px;margin-bottom:12px';
    const back=doc.createElement('button');
    back.type='button';back.textContent='‹';back.setAttribute('aria-label','Back to room');
    back.style.cssText='width:43px;height:43px;border:1px solid #bd9759;border-radius:13px;'+
      'background:#1b2f25;color:#ffe2a1;font-size:31px';
    back.onclick=()=>panel.remove();
    const heading=doc.createElement('div');
    const title=doc.createElement('h2');title.textContent='🎨 Room Theme Gallery';
    title.style.cssText='font-size:20px;margin:0;color:#f5d487';
    const subtitle=doc.createElement('div');
    subtitle.textContent='Theme changes only the room background · profile photo stays the same';
    subtitle.style.cssText='font-size:11px;color:#c7d2c7;max-width:300px';
    heading.append(title,subtitle);header.append(back,heading);
    const status=doc.createElement('p');
    status.setAttribute('role','status');
    status.style.cssText='font-size:12px;color:#bedbc8;margin:8px 2px 15px';
    status.textContent=owner?'Choose a design for everyone in this room.':
      'Only the room owner can select a theme. You can preview every design.';
    const grid=doc.createElement('div');
    grid.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));'+
      'gap:12px;padding-bottom:20px';
    panel.append(header,status,grid);doc.body.appendChild(panel);
    const builtins=[
      {id:'mid',name:'Midnight Royal',bg:'linear-gradient(145deg,#402582,#140c27,#b545c2)'},
      {id:'gold',name:'Royal Gold',bg:'linear-gradient(145deg,#ab7a27,#24180e,#e6b95d)'},
      {id:'ocean',name:'Ocean Crown',bg:'linear-gradient(145deg,#127ba4,#071a42,#4fc1db)'},
      {id:'rose',name:'Rose Palace',bg:'linear-gradient(145deg,#ac387d,#301330,#f8a5bc)'},
      {id:'forest',name:'Emerald Garden',bg:'linear-gradient(145deg,#136e48,#041e1a,#8acc81)'},
      {id:'sunset',name:'Sunset Royal',bg:'linear-gradient(145deg,#e98141,#442052,#df84bf)'}
    ];
    let saving=false;
    async function saveTheme(id){
      if(!owner||saving)return;
      saving=true;status.textContent='Saving theme for everyone…';
      grid.querySelectorAll('button').forEach(b=>{b.disabled=true;});
      try{
        const saved=await api('PATCH','/rooms/'+room.id,{theme:id});
        if(saved.room?.theme!==id)throw Error('Theme not confirmed by server');
        room.th=id;
        if(window.cur?.id===room.id)await syncFrame(room,frame);
        await reloadRooms().catch(()=>{});
        status.textContent='Theme saved ✓ All room members can see it.';
        grid.querySelectorAll('button[data-theme-id]').forEach(b=>{
          b.setAttribute('aria-pressed',String(b.dataset.themeId===id));
          b.style.borderColor=b.dataset.themeId===id?'#ffe09a':'#836b48';
        });
      }catch(error){
        status.textContent='Unable to save: '+errText(error);
      }finally{
        saving=false;
        grid.querySelectorAll('button').forEach(b=>{b.disabled=!owner;});
      }
    }
    function themeCard(id,name,bg){
      const button=doc.createElement('button');
      button.type='button';button.dataset.themeId=id;
      button.setAttribute('aria-pressed',String(room.th===id));
      button.setAttribute('aria-label','Theme: '+name);
      button.disabled=!owner;
      button.style.cssText='position:relative;display:flex;flex-direction:column;'+
        'align-items:stretch;justify-content:flex-end;height:156px;overflow:hidden;'+
        'border:2px solid '+(room.th===id?'#ffe09a':'#836b48')+';'+
        'border-radius:18px;padding:0;background:#173428;'+
        'box-shadow:inset 0 2px #fff4,0 7px 14px #0008;text-align:left;'+
        'color:#fff;opacity:'+(owner?'1':'.82');
      const photo=doc.createElement('div');
      photo.style.cssText='position:absolute;inset:0;background-position:center;'+
        'background-size:cover;'+(bg.startsWith('https:')
          ?'background-image:url("'+bg+'")':'background-image:'+bg);
      const namebar=doc.createElement('strong');namebar.textContent=name;
      namebar.style.cssText='position:relative;background:#03140cdd;padding:9px;'+
        'font-size:12px;text-shadow:0 1px #000';
      button.append(photo,namebar);button.onclick=()=>saveTheme(id);
      grid.appendChild(button);
    }
    for(const item of builtins)themeCard(item.id,item.name,item.bg);
    if(owner){
      const custom=doc.createElement('button');custom.type='button';
      custom.textContent='＋ Upload My HD Background';
      custom.style.cssText='grid-column:1 / -1;padding:16px;'+
        'border:1px dashed #e1bc76;border-radius:15px;background:#263b2a;color:#ffe7a9';
      custom.onclick=()=>{panel.remove();pickRoomCover(room,frame,true);};
      grid.appendChild(custom);
    }
    const published=doc.createElement('h3');
    published.textContent='✨ Official Themes';
    published.style.cssText='grid-column:1 / -1;margin:8px 0 0;font-size:17px;color:#f3d387';
    grid.appendChild(published);
    try{
      const listing=await api('GET','/room-themes');
      if(!panel.isConnected)return;
      const themes=Array.isArray(listing.themes)?listing.themes:[];
      if(!themes.length){
        const empty=doc.createElement('p');
        empty.style.cssText='grid-column:1 / -1;color:#c3cebf;font-size:12px';
        empty.textContent='Official themes will appear here when published by the admin.';
        grid.appendChild(empty);
      }
      for(const item of themes){
        const url=verifiedThemeUrl(item?.image_url);
        if(url&&Number.isSafeInteger(item?.id)&&item.id>0)
          themeCard('catalog:'+item.id,String(item.name||'Official Theme'),url);
      }
    }catch(error){
      if(panel.isConnected){
        const note=doc.createElement('p');
        note.style.cssText='grid-column:1 / -1;color:#f7c2a0;font-size:12px';
        note.textContent='Official themes unavailable: '+errText(error);
        grid.appendChild(note);
      }
    }
  }
  async function attachFrame(room) {
    const frame=document.getElementById('rf')?.contentWindow;
    if (frame && frame.document) fitAndroidViewport(frame.document, true);
    if(!frame || !frame.seats || !window.cur || window.cur.id!==room.id) return;
    // The bundled offline room artwork contains demo greetings. A new room
    // visit starts with an empty verified transcript, including after reentry.
    frame.$?.('chat')?.replaceChildren();
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
        '.seat.talk .av{filter:drop-shadow(0 0 14px rgba(255,207,92,.9))}',
        '.seat.talk .wave{border-color:#ffe18f;box-shadow:0 0 10px rgba(255,196,64,.58)}',
        '.seat.talk .face{border-color:#fff0b9;box-shadow:0 0 0 3px rgba(255,195,71,.5),0 0 22px rgba(255,202,78,.72)}',
        '.seat:active .av{transform:translateY(2px) scale(.96)}',
        '.seat:focus-visible .av{outline:2px solid #ffe08b;outline-offset:6px}',
        '.step button{background:linear-gradient(145deg,rgba(255,255,255,.27),rgba(75,44,152,.85));box-shadow:inset 0 2px 0 rgba(255,255,255,.32),0 4px 0 rgba(20,9,63,.6)}',
        '.fr button{background:linear-gradient(160deg,rgba(255,255,255,.19),rgba(51,31,109,.82));box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 3px 0 rgba(17,9,57,.5)}',
        '.fr button.sel{box-shadow:0 0 13px rgba(255,215,123,.38),inset 0 1px 0 rgba(255,255,255,.3)}',
        '@media (prefers-reduced-motion:reduce){.seat .av{transition:none}}'
      ].join('');
      frame.document.head.appendChild(seatStyle);
    }
    frame.themeSheet=()=>showRoomThemeGallery(room,frame);
    // The legacy Settings row binds its local themeSheet function directly.
    frame.document.addEventListener('click',event=>{
      if(!event.target.closest?.('#rTh'))return;
      event.preventDefault();event.stopImmediatePropagation();
      showRoomThemeGallery(room,frame);
    },true);
    frame.tick=function(){};
    frame.U=[];
    frame.G=[];
    frame.sendGift=function(){ frame.toast('Use the verified gift box Send button'); };
    // The room list displays the active Special ID, but actions use the
    // immutable canonical ID after verifying the same room member.
    frame.sid=function(seat){
      const canonical=String(seat?.public_id||'');
      if(!/^[0-9]{8}$/.test(canonical))return '';
      const display=String(seat?.special_id||seat?.display_id||canonical);
      return /^[0-9]{1,10}$/.test(display)?display:canonical;
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
    // A gift receipt is a lasting chat row, separate from the short animation.
    const shownGiftChatIds=new Set();
    let lastChatId=0,chatPollInFlight=null,chatSendBusy=false;
    let pendingChatMessage=null;
    let lastEntryEventId=0,entryPollInFlight=null;
    const recentJoinNames=new Map();
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
        // The bundled room giftSheet() refuses to open when no guest is on a
        // microphone. A real catalog must remain browseable in an empty room;
        // never invent a recipient just to make the old modal render.
        const hasMicRecipients=(frame.seats||[]).some(seat=>
          Number(seat?.i)>0&&!seat.empty&&!seat.lock&&seat.public_id);
        function showGiftCatalogWithoutMic(){
          frame.rec=[];
          frame.qty=1;
          const target=directGiftTarget
            ?'🎁 Send to '+htmlSafe(directGiftTarget.name)+' · ID '+htmlSafe(directGiftTarget.id)
            :'Select an occupied microphone seat to send a gift. You can browse the catalog now.';
          const tabs=[{tab:0,label:'🎁 Gifts'},{tab:1,label:'👑 Luxury'},
            {tab:2,label:'🍀 Lucky'}].filter(item=>gifts.some(g=>g.tab===item.tab));
          frame.open('<h3>🎁 Virtual gifts</h3><div class="row">'+target+'</div>'+
            '<div class="gtabs">'+tabs.map(item=>'<button type="button" data-gt="'+
              item.tab+'" class="sh-verified-gift-category">'+item.label+'</button>').join('')+
            '</div><div class="gifts"></div><div class="gbar">'+
            '<div class="qty"><button type="button" class="sel" data-q="1">x1</button>'+
            '<button type="button" data-q="5">x5</button>'+
            '<button type="button" data-q="10">x10</button></div>'+
            '<button type="button" class="send" id="snd"'+
            (directGiftTarget?'':' disabled')+'>Send 🚀</button></div>');
          const sheet=frame.$('sheet');
          const grid=sheet?.querySelector('.gifts');
          if(!sheet||!grid)return;
          const renderGifts=()=>{
            if(!gifts.some(g=>g.tab===frame.gtab))frame.gtab=tabs[0].tab;
            if(gifts[frame.gsel]?.tab!==frame.gtab)
              frame.gsel=gifts.findIndex(g=>g.tab===frame.gtab);
            grid.className='gifts c'+frame.gtab;
            grid.innerHTML=gifts.map((gift,index)=>gift.tab!==frame.gtab?'':
              '<button type="button" class="gf'+(index===frame.gsel?' sel':'')+'" data-k="'+
              index+'"><span>'+(imageSafe(gift.image_url)
                ?'<img src="'+imageSafe(gift.image_url)+'" alt="" width="46" height="46">'
                :htmlSafe(gift.emoji||'🎁'))+'</span><b>'+htmlSafe(gift.name)+'</b>🪙 '+
              Number(gift.price_coins).toLocaleString('en-US')+'</button>').join('');
            sheet.querySelectorAll('.sh-verified-gift-category').forEach(button=>
              button.classList.toggle('sel',Number(button.dataset.gt)===frame.gtab));
            grid.querySelectorAll('.gf').forEach(button=>{
              button.onclick=()=>{frame.gsel=Number(button.dataset.k);renderGifts();};
            });
          };
          sheet.querySelectorAll('.sh-verified-gift-category').forEach(button=>{
            button.onclick=()=>{frame.gtab=Number(button.dataset.gt);renderGifts();};
          });
          sheet.querySelectorAll('.qty button').forEach(button=>{
            button.onclick=()=>{
              frame.qty=Number(button.dataset.q);
              sheet.querySelectorAll('.qty button').forEach(other=>
                other.classList.toggle('sel',other===button));
            };
          });
          renderGifts();
        }
        if(typeof originalGiftOpen==='function'||!hasMicRecipients) {
          if(hasMicRecipients&&typeof originalGiftOpen==='function')
            originalGiftOpen.call(giftButton);
          else showGiftCatalogWithoutMic();
          decorateGiftRecipients(frame);
          if(directGiftTarget&&hasMicRecipients) {
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
    function appendGiftChatReceipt(event){
      const id=Number(event?.id);
      if(!Number.isSafeInteger(id)||id<=0||shownGiftChatIds.has(id)||
         typeof frame.msg!=='function')return;
      const chat=frame.$?.('chat');
      if(!chat)return;
      const sender=String(event.sender_name||'Member');
      const recipient=String(event.recipient_name||'Member');
      const caption='sent '+String(event.emoji||'🎁')+' '+
        String(event.name||'Gift')+' ×'+String(event.quantity||1)+
        ' to '+recipient+' (ID '+String(event.recipient_id||'')+')'+
        ' · 🪙 '+giftEventValue(event).toLocaleString('en-US');
      // Reuse the existing chat renderer, whose bubbles remain in the
      // scrollable transcript after the timed gift banner disappears.
      frame.msg(sender,'🎁',caption,{gf:true,lv:1});
      const row=chat.querySelector('.msg:last-child');
      if(!row)return;
      shownGiftChatIds.add(id);
      if(shownGiftChatIds.size>200)
        shownGiftChatIds.delete(shownGiftChatIds.values().next().value);
      row.classList.add('sh-room-gift-receipt');
      row.dataset.shGiftId=String(id);
      row.dataset.shSenderId=String(event.sender_id||'');
      const badge=row.querySelector('.lv');
      if(badge)badge.textContent='GIFT';
      const senderPhoto=event.sender_pic||
        roomAvatarForPublicId(frame,event.sender_id);
      paintVerifiedAvatar(row.querySelector('.mav'),senderPhoto,frame.document);
    }
    function presentVerifiedGift(event){
      const id=Number(event.id);
      if(!Number.isSafeInteger(id))return;
      appendGiftChatReceipt(event);
      if(shownGiftEvents.has(id))return;
      shownGiftEvents.add(id);
      if(shownGiftEvents.size>100)shownGiftEvents.clear();
      queueGiftPresentation(frame,event);
      if(Number(event.tab)===FEATURED_GIFT_TAB||isVideoMedia(verifiedMediaUrl(event.animation_url)))
        queueGiftPresentation(frame,event,true);
    }
    async function pollGiftEvents(ownTransactionId=null){
      const data=await api('GET','/rooms/'+room.id+'/gifts');
      const events=data.events||[];
      const latest=Math.max(0,...events.map(e=>Number(e.id)||0));
      if(lastGiftEventId===null){
        lastGiftEventId=latest;
        // The Worker now returns only receipts generated since THIS visit's
        // join boundary. Show all of them, including ones sent during load.
        for(const event of events)presentVerifiedGift(event);
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
    async function setRoomAdmin(publicId,makeAdmin){
      if(room.owner_id!==session?.user?.id)throw new Error('Room owner only');
      if(!/^[0-9]{8}$/.test(String(publicId||''))||
         frame.__sharikaMemberRoles?.get(String(publicId))==='owner')
        throw new Error('Choose another verified room member');
      const result=await api('POST','/rooms/'+room.id+'/admins',{
        action:makeAdmin?'grant':'revoke',target_public_id:String(publicId)
      });
      frame.close();
      await syncFrame(room,frame);
      frame.toast(makeAdmin?'🛡 Room Admin assigned':'Room Admin removed');
      return result;
    }
    async function moderateSeat(action,seat) {
      if(room.owner_id!==session?.user?.id&&
         frame.__sharikaRoomRole!=='admin')throw new Error('Room admin only');
      const target=frame.seats?.[seat];
      if(!target||target.empty||!target.public_id||
         target.user_id===room.owner_id||
         (frame.__sharikaRoomRole==='admin'&&target.room_role==='admin'))
        throw new Error('Cannot moderate Owner or another Admin');
      const result=await api('POST','/rooms/'+room.id+'/moderate',{
        action,target_public_id:target.public_id
      });
      frame.close();
      await syncFrame(room,frame);
      frame.toast(action==='kick'?'Guest removed for 10 minutes':
        action==='remove_seat'?'Guest removed from mic':'Guest '+action+'d');
      return result;
    }
    // A seat assignment does not require rebuilding an existing voice call.
    let directSeatBusy=false;
    async function moveSelfToSeat(seat) {
      if(directSeatBusy)return;
      const uid=session?.user?.id;
      const owner=room.owner_id===uid;
      const target=frame.seats?.[seat];
      if(!uid||!target?.empty||seat<1||seat>room.seat_count)
        throw new Error('Choose an unlocked empty seat');
      directSeatBusy=true;
      frame.__sharikaSeatMovePending=true;
      frame.__sharikaSeatSyncNo=(frame.__sharikaSeatSyncNo||0)+1;
      const before=frame.seats.map(slot=>slot?{...slot}:slot);
      const previous=frame.seats.find(slot=>slot?.i>0&&slot.user_id===uid);
      const source=previous||{
        n:profile?.name||'Member',e:owner?'👑':'👤',pic:verifiedAvatarUrl(profile?.pic),
        user_id:uid,public_id:profile?.public_id,
        display_id:profile?.display_id||profile?.public_id,
        special_id:profile?.special_id||null,svip_level:Number(profile?.svip_level)||0,
        frame_style:profile?.frame_style||'',entry_style:profile?.entry_style||'',
        medal_style:profile?.medal_style||'',name_tag_style:profile?.name_tag_style||'',
        muted:false,talk:false
      };
      if(previous)frame.seats[previous.i]={empty:1,i:previous.i};
      frame.seats[seat]={...source,i:seat,owner_mic_seat:owner};
      frame.render();
      decorateRoomSeats(frame);
      paintVerifiedMicCount(frame);
      paintVoiceSpeakers(room.id,frame);
      frame.seatEl?.(seat)?.classList.add('sh-seat-pending');
      frame.close();
      frame.toast('Moving to seat '+seat+'…');
      try {
        await api('PUT','/rooms/'+room.id+'/seat',{seat_no:seat});
        frame.toast('Seat '+seat+' selected');
      }catch(error) {
        if(window.cur?.id===room.id){
          frame.seats=before;
          frame.render();
          decorateRoomSeats(frame);
          paintVerifiedMicCount(frame);
          paintVoiceSpeakers(room.id,frame);
        }
        throw error;
      }finally{
        frame.__sharikaSeatMovePending=false;
        directSeatBusy=false;
      }
      if(window.cur?.id!==room.id)return;
      const publishingAlready=
        (sfuState?.roomId===room.id&&sfuState.canPublish)||
        (voiceRoomId===room.id&&!!voiceRoom?.sharikaPublishAllowed);
      const voice=publishingAlready?ensureVoiceConnected(room.id):connectVoice(room.id);
      voice.then(result=>{
        if(window.cur?.id===room.id&&!result.stale)
          frame.toast(result.publishing?'Microphone ready':'Listening to room');
      }).catch(error=>frame.toast('Voice reconnect: '+errText(error)));
      syncFrame(room,frame).catch(error=>
        frame.toast('Seat refresh: '+errText(error)));
    }
    frame.roomLockSheet=async function(){
      if(!['owner','admin'].includes(frame.__sharikaRoomRole)){
        frame.toast('Only the Room Owner or Room Admin can lock this room');
        return;
      }
      try{
        const state=await api('GET','/rooms/'+room.id+'/access-lock');
        if(window.cur?.id!==room.id)return;
        const locked=!!state.locked;
        frame.open('<h3>🔒 Room Access</h3>'+
          '<div class="row">'+(locked
            ?'Room is locked. Existing members stay; new guests cannot enter.'
            :'Room is open. Anyone eligible can enter.')+'</div>'+
          '<div class="row">Only the verified Owner or Room Admin can change this setting.</div>'+
          '<button class="big" id="sh-room-lock-toggle">'+
          (locked?'🔓 Unlock Room':'🔒 Lock Room')+'</button>');
        const button=frame.$('sh-room-lock-toggle');
        if(!button)return;
        button.onclick=async()=>{
          if(button.disabled)return;
          button.disabled=true;
          try{
            const saved=await api('PUT','/rooms/'+room.id+'/access-lock',{locked:!locked});
            room.access_locked=saved.locked?1:0;
            frame.__sharikaRoomLocked=!!saved.locked;
            frame.close();
            frame.toast(saved.locked?'🔒 Room locked for new guests':'🔓 Room open to guests');
            await reloadRooms();
            await syncFrame(room,frame);
          }catch(error){
            button.disabled=false;
            frame.toast('Room lock: '+errText(error));
          }
        };
      }catch(error){frame.toast('Room access unavailable: '+errText(error));}
    };
    frame.act=async function(action,seat) {
      try {
        const target=frame.seats?.[seat];
        const isSelf=target?.user_id===session?.user?.id;
        const owner=room.owner_id===session?.user?.id;
        const moderator=owner||frame.__sharikaRoomRole==='admin';
        if(action==='lock_all'||action==='unlock_all') {
          if(!moderator)throw new Error('Room admin only');
          const result=await api('PUT','/rooms/'+room.id+'/locks/all',{
            locked:action==='lock_all'
          });
          frame.close();
          await syncFrame(room,frame);
          const skipped=result.skipped_occupied?.length||0;
          frame.toast(action==='lock_all'
            ? 'Locked '+(result.locked_seats?.length||0)+' seats'+
              (skipped?' ('+skipped+' occupied seats unchanged)':'')
            : 'All mic seats unlocked');
        } else if((action==='lock'||action==='unlock')&&seat>0) {
          if(!moderator)throw new Error('Room admin only');
          await api('PUT','/rooms/'+room.id+'/locks',{
            seat_no:seat,locked:action==='lock'
          });
          frame.close();
          await syncFrame(room,frame);
          frame.toast(action==='lock'?'Seat locked':'Seat unlocked');
        } else if((action==='inv'||action==='invite') && seat>0) {
          if(!moderator)throw new Error('Only Room Owner or Room Admin may invite members');
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
              ' · ID '+(listener.sharika_users.display_id||listener.sharika_users.public_id);
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
          await moveSelfToSeat(seat);
        } else if(action==='down' && seat>0) {
          if(!isSelf && moderator && target?.user_id) {
            await moderateSeat('remove_seat',seat);
          } else if(isSelf) {
            await api('PUT','/rooms/'+room.id+'/seat',{seat_no:null});
            frame.close(); await syncFrame(room,frame);
            await connectVoice(room.id);
            frame.toast('Seat released; listening only');
          } else throw new Error('You can only leave your own seat');
        } else if(action==='mute' && seat>=0) {
          if(moderator && target?.user_id && !isSelf)
            await moderateSeat(target.muted?'unmute':'mute',seat);
          else if(isSelf) {
            const enabled=await toggleVoice();
            frame.close();
            frame.toast(enabled?'Microphone on':'Microphone off');
          } else throw new Error('Only a Room Admin can mute another user');
        } else if(action==='kick' && seat>0) {
          await moderateSeat('kick',seat);
        } else if(action==='admin_toggle' && owner && target?.public_id && !isSelf) {
          await setRoomAdmin(target.public_id,target.room_role!=='admin');
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
    // The old room theme aborts empty/locked seat menus before server actions.
    // These must bypass its demo handler entirely.
    function verifiedSeatMenu(index,selected,owner){
      const doc=frame.document;
      doc.getElementById('sh-seat-action-overlay')?.remove();
      if(!doc.getElementById('sh-seat-action-css')){
        const css=doc.createElement('style');
        css.id='sh-seat-action-css';
        css.textContent=[
          '#sh-seat-action-overlay{position:fixed;inset:0;z-index:2147483000;',
          'display:flex;align-items:center;justify-content:center;box-sizing:border-box;',
          'padding:18px;background:rgba(4,6,20,.72)}',
          '#sh-seat-action-overlay .sh-seat-action-card{width:min(100%,440px);',
          'max-height:90vh;overflow-y:auto;box-sizing:border-box;border-radius:30px;',
          'padding:clamp(22px,6vw,42px) clamp(20px,6vw,40px);',
          'background:linear-gradient(110deg,#fa3093 0%,#ff7360 50%,#ffb923 100%);',
          'box-shadow:0 18px 60px rgba(0,0,0,.45)}',
          '#sh-seat-action-overlay h3{color:white;text-align:center;',
          'font:600 clamp(23px,5vw,34px)/1.2 Georgia,serif;margin:0 0 26px}',
          '#sh-seat-action-overlay .sh-seat-action-list{display:grid;gap:17px}',
          '#sh-seat-action-overlay button{width:100%;border:0;min-height:65px;',
          'border-radius:999px;background:#fff;color:#3479fa;padding:10px 14px;',
          'font:600 clamp(21px,5vw,30px)/1.2 Georgia,serif;cursor:pointer}',
          '#sh-seat-action-overlay button.lock{color:#f72f91}',
          '#sh-seat-action-overlay button.all{color:#7545fa}',
          '#sh-seat-action-overlay button.cancel{color:#fff;',
          'background:rgba(255,255,255,.23)}',
          '@media(max-height:640px){#sh-seat-action-overlay .sh-seat-action-card{',
          'padding:18px 22px}#sh-seat-action-overlay .sh-seat-action-list{gap:10px}',
          '#sh-seat-action-overlay button{min-height:50px}}'
        ].join('');
        doc.head.appendChild(css);
      }
      const overlay=doc.createElement('div');
      overlay.id='sh-seat-action-overlay';
      const card=doc.createElement('section');
      card.className='sh-seat-action-card';
      card.setAttribute('role','dialog');
      card.setAttribute('aria-modal','true');
      card.setAttribute('aria-label','Mic seat actions');
      const title=doc.createElement('h3');
      title.textContent=index===0?'Owner throne':
        selected.lock&&!owner?'Seat locked':'Please select an action';
      const buttons=doc.createElement('div');
      buttons.className='sh-seat-action-list';
      card.append(title,buttons);
      overlay.appendChild(card);
      const close=()=>overlay.remove();
      overlay.onclick=e=>{if(e.target===overlay)close();};
      overlay.onkeydown=e=>{
        if(e.key==='Escape'||e.key==='Backspace'){e.preventDefault();close();}
      };
      const options=index===0?[]:selected.lock?
        (owner?[['unlock','Unlock seat','lock'],['unlock_all','Unlock all','all']]:[]):
        (owner?[['take','Sit here','take'],['invite','Invite to mic','invite'],['lock','Lock seat','lock'],
          ['lock_all','Lock all','all']]:[['take','Take Mic','take']]);
      for(const [action,label,kind] of options){
        const button=doc.createElement('button');
        button.type='button';
        button.className=kind==='take'?'':kind;
        button.textContent=label;
        button.onclick=()=>{close();frame.act(action,index);};
        buttons.appendChild(button);
      }
      const cancel=doc.createElement('button');
      cancel.type='button';cancel.className='cancel';
      cancel.textContent='Cancel';cancel.onclick=close;
      buttons.appendChild(cancel);
      doc.body.appendChild(overlay);
      (buttons.querySelector?.('button')||cancel).focus?.();
    }
    function renderMemberHalfProfile(hero,selected,index=null){
      const doc=frame.document;
      const publicId=String(selected.public_id||'');
      hero.classList.add('sh-member-half');
      hero.replaceChildren();
      hero.setAttribute('role','group');
      hero.setAttribute('aria-label','Member preview; tap to open full profile');
      const portrait=doc.createElement('button');
      portrait.type='button';portrait.className='sh-member-portrait';
      portrait.setAttribute('aria-label','Open full member profile');
      const avatar=doc.createElement('div');
      avatar.className='sh-sovera-preview';
      paintVerifiedAvatar(avatar,selected.pic,doc);
      const art=frameArt(selected.frame_style);
      if(art){
        const decoration=doc.createElement('i');
        decoration.className='fxr sh-sovera-frame';
        decoration.style.backgroundImage='url('+cosmeticMedia(art)+')';
        decoration.setAttribute('aria-hidden','true');avatar.append(decoration);
      }
      portrait.append(avatar);
      const pair=doc.createElement('div');pair.className='sh-member-cp-pair';
      pair.append(portrait);
      const name=doc.createElement('button');
      name.type='button';name.className='sh-member-title';
      name.textContent=String(selected.n||'Member');
      const meta=doc.createElement('span');
      meta.className='sh-member-meta';
      meta.textContent='ID '+String(selected.special_id||selected.display_id||publicId)+
        ' · '+(Number.isInteger(index)?'Mic '+index:'In the room');
      const tags=doc.createElement('div');tags.className='sh-member-labels';
      for(const badgeName of [
        selected.room_role==='owner'?'Room Owner':
          selected.room_role==='admin'?'Room Admin':null,
        Number(selected.svip_level)>0?'SVIP '+selected.svip_level:null,
        selected.muted?'Mic muted':null
      ]){
        if(!badgeName)continue;
        const badge=doc.createElement('span');badge.textContent=badgeName;
        tags.append(badge);
      }
      const levels=doc.createElement('div');levels.className='sh-member-levels';
      for(const kind of ['Wealth','Charm','SVIP']){
        const cell=doc.createElement('span');
        const value=doc.createElement('b');
        value.textContent=kind==='SVIP'?String(Number(selected.svip_level)||0):'…';
        cell.append(value,doc.createTextNode(kind));
        cell.dataset.level=kind.toLowerCase();levels.append(cell);
      }
      const viewFull=()=>{
        if(Number.isInteger(index)){frame.act('prof',index);return;}
        frame.close();
        openVerifiedRoomMemberProfile(publicId,room.id).catch(error=>frame.toast(errText(error)));
      };
      hero.onclick=viewFull;
      hero.onkeydown=event=>{
        if(event.target===hero&&(event.key==='Enter'||event.key===' ')){
          event.preventDefault();viewFull();
        }
      };
      hero.append(pair,name,meta,tags,levels);
      if(!/^[0-9]{8}$/.test(publicId))return;
      api('GET','/users/'+publicId).then(member=>{
        if(!levels.isConnected||String(member.id)!==publicId)return;
        const wealth=levels.querySelector('[data-level="wealth"] b');
        const charm=levels.querySelector('[data-level="charm"] b');
        if(wealth)wealth.textContent=String(Number(member.wealth_level)||0);
        if(charm)charm.textContent=String(Number(member.charm_level)||0);
      }).catch(()=>{
        levels.querySelectorAll('[data-level="wealth"] b,[data-level="charm"] b')
          .forEach(label=>{label.textContent='–';});
      });
      // The partner image is shown only for a verified, active CP link.
      // Never infer a CP from local seats or render a previous member's link.
      api('GET','/bonds/profile/'+publicId).then(bond=>{
        const partner=bond?.cp?.partner;
        if(String(bond?.public_id)!==publicId||!pair.isConnected||
           !frame.$('sheet')?.contains(pair)||window.cur?.id!==room.id||
           !/^[0-9]{8}$/.test(String(partner?.id||''))||
           String(partner.id)===publicId)return;
        const heart=doc.createElement('span');
        heart.className='sh-member-cp-heart';heart.textContent='💞';
        heart.setAttribute('aria-label','Active CP');
        const partnerButton=doc.createElement('button');
        partnerButton.type='button';partnerButton.className='sh-member-cp-partner';
        partnerButton.setAttribute('aria-label','Open CP partner '+String(partner.name||''));
        const partnerAvatar=doc.createElement('div');
        partnerAvatar.className='sh-sovera-preview';
        paintVerifiedAvatar(partnerAvatar,partner.pic,doc);
        const partnerArt=frameArt(partner.frame_style);
        if(partnerArt){
          const decoration=doc.createElement('i');
          decoration.className='fxr sh-sovera-frame';
          decoration.style.backgroundImage='url('+cosmeticMedia(partnerArt)+')';
          decoration.setAttribute('aria-hidden','true');partnerAvatar.append(decoration);
        }
        const partnerName=doc.createElement('small');
        partnerName.textContent=String(partner.name||'CP partner');
        partnerButton.append(partnerAvatar,partnerName);
        partnerButton.onclick=event=>{
          event.stopPropagation();frame.close();
          openVerifiedRoomMemberProfile(String(partner.id),room.id)
            .catch(error=>frame.toast(errText(error)));
        };
        pair.append(heart,partnerButton);
        pair.classList.add('has-cp');
      }).catch(error=>console.warn('Verified room CP unavailable:',errText(error)));
    }
    // Top-row portraits, online list and mic-seat avatars use the same
    // first-tap mini profile. The second tap opens the full verified profile.
    frame.__sharikaOpenQuickProfile=async member=>{
      const publicId=String(member?.publicId||'');
      if(!/^[0-9]{8}$/.test(publicId)||window.cur?.id!==room.id)
        throw new Error('Verified member unavailable');
      const seat=Number.isInteger(member.seatNo)?member.seatNo:null;
      if(seat!==null && String(frame.seats?.[seat]?.public_id||'')===publicId){
        frame.seatSheet(seat);return;
      }
      if(!frame.__sharikaMemberRoles?.has(publicId)){
        await openVerifiedRoomMemberProfile(publicId,room.id);return;
      }
      const fresh=await api('GET','/users/'+publicId);
      if(String(fresh.id)!==publicId||window.cur?.id!==room.id)
        throw new Error('Room member identity changed');
      frame.open('<div class="who"></div><div class="acts"></div>');
      const hero=frame.$('sheet')?.querySelector('.who');
      const actions=frame.$('sheet')?.querySelector('.acts');
      if(!hero||!actions)return;
      renderMemberHalfProfile(hero,{
        public_id:publicId,n:fresh.name,pic:verifiedAvatarUrl(fresh.pic),
        display_id:fresh.special_id||fresh.display_id||publicId,
        special_id:fresh.special_id||null,room_role:frame.__sharikaMemberRoles.get(publicId),
        svip_level:fresh.svip_level,frame_style:fresh.frame_style
      });
      for(const [label,icon,callback] of [
        ['Profile','👤',()=>{frame.close();return openVerifiedRoomMemberProfile(publicId,room.id);}],
        ['Gift','🎁',()=>openVerifiedGiftBox({id:publicId,name:String(fresh.name||'Member')})]
      ]){
        const button=frame.document.createElement('button');button.className='act';
        const picture=frame.document.createElement('span');picture.textContent=icon;
        button.append(picture,frame.document.createTextNode(label));
        button.onclick=()=>Promise.resolve(callback()).catch(error=>frame.toast(errText(error)));
        actions.append(button);
      }
    };
    frame.seatSheet=function(index){
      const selected=frame.seats?.[index];
      if(!selected)return;
      const owner=room.owner_id===session?.user?.id;
      const moderator=owner||frame.__sharikaRoomRole==='admin';
      if(selected.empty||selected.lock){
        verifiedSeatMenu(index,selected,moderator);
        return;
      }
      const result=originalSeatSheet(index);
      const self=selected.user_id===session?.user?.id;
      const actions=frame.$('sheet')?.querySelector('.acts');
      const detail=frame.$('sheet')?.querySelector('.who small');
      if(detail)detail.textContent=index===0?'Room owner':'Mic seat '+index;
      if(detail&&selected.room_role==='admin')
        detail.textContent='Room Admin · Mic seat '+index;
      if(!actions)return result;
      actions.replaceChildren();
      const hero=frame.$('sheet')?.querySelector('.who');
      if(hero)renderMemberHalfProfile(hero,selected,index);
      const options=[['prof','👤','Profile'],['gift','🎁','Gift']];
      if(self)options.push(['mute',selected.muted?'🔊':'🔇',
        selected.muted?'Unmute':'Mute']);
      if(self&&index>0)options.push(['down','⬇️','Leave mic']);
      if(owner&&index===0)options.push(['own','⚙️','Manage']);
      if(moderator&&index>0&&!self&&
         (owner||selected.room_role!=='admin'))options.push(
        ['mute',selected.muted?'🔊':'🔇',selected.muted?'Unmute':'Mute'],
        ['down','⬇️','Remove from mic'],['kick','🚫','Kick out']);
      if(owner&&index>0&&!self)options.push(
        ['admin_toggle','🛡',selected.room_role==='admin'
          ?'Remove Room Admin':'Make Room Admin']);
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
      const mine=frame.seats?.find(slot=>slot?.i>0&&
        slot.user_id===session?.user?.id)||
        frame.seats?.find(slot=>slot?.user_id===session?.user?.id);
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
    // A moderator's tap opens the verified seat-management sheet, so entering
    // their room never automatically seats the Owner or Room Admin. Guests may
    // still take an unlocked mic seat with one deliberate tap.
    frame.document.addEventListener('click',event=>{
      const moderator=room.owner_id===session?.user?.id||
        frame.__sharikaRoomRole==='admin';
      const button=event.target.closest?.(moderator?
        '#grid .seat[data-i]':'.seat.empty[data-i]');
      if(!button||!frame.document.querySelector('#grid')?.contains(button))return;
      const seat=Number(button.dataset.i);
      if(!Number.isInteger(seat)||seat<1||seat>room.seat_count)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(moderator){frame.seatSheet(seat);return;}
      moveSelfToSeat(seat).catch(error=>
        frame.toast('Unable to change seat: '+errText(error)));
    },true);
    frame.document.addEventListener('contextmenu',event=>{
      if(room.owner_id!==session?.user?.id&&frame.__sharikaRoomRole!=='admin')return;
      const button=event.target.closest?.('#grid .seat[data-i]');
      if(!button)return;
      const seat=Number(button.dataset.i);
      if(!Number.isInteger(seat)||seat<1||seat>room.seat_count)return;
      event.preventDefault();event.stopImmediatePropagation();
      frame.seatSheet(seat);
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
      const verifiedId=String(user?.seat!=null?
        frame.seats?.[user.seat]?.public_id:frame.U?.[user?.k]?.canonical_id||'');
      const verified=/^[0-9]{8}$/.test(verifiedId);
      const selectedRole=frame.__sharikaMemberRoles?.get(verifiedId)||'member';
      const roleLabel=sheet?.querySelector('.who small');
      if(roleLabel&&selectedRole==='admin')
        roleLabel.textContent='🛡 Room Admin';
      if(verified){
        const active=user?.seat!=null?frame.seats?.[user.seat]:frame.U?.[user?.k];
        if(active&&sheet?.querySelector('.who'))renderMemberHalfProfile(sheet.querySelector('.who'),{
          n:active.n,public_id:verifiedId,pic:active.pic,
          special_id:active.special_id||null,
          display_id:active.display_id||active.id||verifiedId,
          room_role:selectedRole,frame_style:active.frame_style,
          svip_level:active.svip_level,muted:active.muted
        },Number.isInteger(user?.seat)?user.seat:null);
      }
      const profileButton=sheet?.querySelector('button.act[data-a="pf"]');
      if(profileButton)profileButton.onclick=async()=>{
        if(!verified){frame.toast('Verified member ID unavailable');return;}
        if(profileButton.disabled)return;
        profileButton.disabled=true;
        try {
          frame.close();
          await openVerifiedRoomMemberProfile(verifiedId,room.id,
            Number.isInteger(user?.seat)?user.seat:null);
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
      if(verified&&room.owner_id===session?.user?.id&&
         selectedRole!=='owner'){
        const adminButton=frame.document.createElement('button');
        adminButton.type='button';
        adminButton.className='act';
        adminButton.textContent=selectedRole==='admin'
          ?'🛡 Remove Room Admin':'🛡 Make Room Admin';
        sheet?.querySelector('.acts')?.appendChild(adminButton);
        adminButton.onclick=async()=>{
          if(adminButton.disabled)return;
          adminButton.disabled=true;
          try{await setRoomAdmin(verifiedId,selectedRole!=='admin');}
          catch(error){
            if(adminButton.isConnected)adminButton.disabled=false;
            frame.toast('Room Admin: '+errText(error));
          }
        };
      }
      const inviteButton=sheet?.querySelector('button.act[data-a="iv"]');
      if(inviteButton)inviteButton.onclick=async()=>{
        if(inviteButton.disabled)return;
        if(!verified){frame.toast('Verified member ID unavailable');return;}
        if(room.owner_id!==session?.user?.id&&frame.__sharikaRoomRole!=='admin') {
          frame.toast('Only Room Owner or Room Admin can invite');return;
        }
        const seat=frame.seats.findIndex((item,index)=>
          index>0&&item?.empty&&!item?.lock
        );
        if(seat<1){frame.toast('No open mic seats');return;}
        inviteButton.disabled=true;
        try {
          await api('POST','/rooms/'+room.id+'/invitations',{
            seat_no:seat,target_public_id:verifiedId
          });
          frame.close();
          frame.toast('Invitation sent to ID '+verifiedId);
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
          if(!isSelf&&room.owner_id!==session?.user?.id&&
             frame.__sharikaRoomRole!=='admin'){
            frame.toast('Room Admin only');return;
          }
          if(!isSelf&&frame.__sharikaRoomRole==='admin'&&
             selectedRole==='admin'){
            frame.toast('Room Admin cannot moderate another Admin');return;
          }
          button.disabled=true;
          try {
            if(isSelf && action==='remove_seat') {
              await api('PUT','/rooms/'+room.id+'/seat',{seat_no:null});
              frame.close();await syncFrame(room,frame);await connectVoice(room.id);
            }else if(onSeat)await moderateSeat(action,user.seat);
            else if(action==='kick') {
              await api('POST','/rooms/'+room.id+'/moderate',{
                action,target_public_id:verifiedId
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
    const originalSeatArrangement=frame.seatSet;
    if(typeof originalSeatArrangement==='function')frame.seatSet=function(...args){
      const result=originalSeatArrangement.apply(this,args);
      const sheet=frame.$('sheet');
      if(sheet?.querySelector('h3')?.textContent?.includes('Seat arrangement')){
        const label=sheet.querySelector('.lbl');
        if(label)label.textContent='Microphone seats · Owner can use any seat';
        const count=frame.$('cnt');
        if(count)count.textContent=String(room.seat_count);
      }
      return result;
    };
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
        frame.toast('Choose between 4 and 20 mic seats');return;
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
        if(frame.$('cnt'))frame.$('cnt').textContent=String(room.seat_count);
        if(note.isConnected)note.textContent='Saved ✓ '+String(room.seat_count)+' mic seats';
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
    // Room Settings is a separate full-height, server-backed screen, rather
    // than the template's small demo settings popup. All changes go through
    // the authenticated room owner/moderator endpoints.
    function openRoomSettingsPage() {
      const doc=frame.document;
      const owner=room.owner_id===session?.user?.id;
      const moderator=owner||frame.__sharikaRoomRole==='admin';
      doc.getElementById('sh-room-settings-page')?.remove();
      const page=doc.createElement('section');
      page.id='sh-room-settings-page';
      page.setAttribute('role','region');
      page.setAttribute('aria-label','Room Settings');
      const header=doc.createElement('header');header.className='sh-room-settings-top';
      const back=doc.createElement('button');back.type='button';
      back.className='sh-room-settings-back';back.textContent='‹';
      back.setAttribute('aria-label','Back to room');back.onclick=()=>page.remove();
      const heading=doc.createElement('h2');heading.textContent='Room Settings';
      header.append(back,heading);page.append(header);
      const body=doc.createElement('div');body.className='sh-room-settings-body';
      page.append(body);
      function section(title){
        const node=doc.createElement('div');node.className='sh-room-settings-group';
        const label=doc.createElement('h3');label.textContent=title;
        node.append(label);body.append(node);return node;
      }
      function row(parent,label,value,handler){
        const button=doc.createElement('button');button.type='button';
        button.className='sh-room-settings-row';
        const text=doc.createElement('span');text.textContent=label;
        const trail=doc.createElement('small');trail.textContent=String(value||'');
        button.append(text,trail);
        if(handler){const arrow=doc.createElement('b');arrow.textContent='›';button.append(arrow);
          button.onclick=()=>Promise.resolve(handler()).catch(error=>
            frame.toast('Settings: '+errText(error)));
        }else {button.disabled=true;button.setAttribute('aria-disabled','true');}
        parent.append(button);return {button,trail};
      }
      function subpage(title){
        body.replaceChildren();
        const subhead=doc.createElement('div');subhead.className='sh-room-settings-subhead';
        const goBack=doc.createElement('button');goBack.type='button';goBack.textContent='‹ Settings';
        goBack.onclick=()=>openRoomSettingsPage();
        const label=doc.createElement('h3');label.textContent=title;
        subhead.append(goBack,label);body.append(subhead);
        return body;
      }
      function status(parent){
        const node=doc.createElement('div');node.className='sh-room-settings-status';
        node.setAttribute('role','status');parent.append(node);return node;
      }
      function editText(title,current,maxLength,save){
        const panel=subpage(title);
        const input=doc.createElement('textarea');input.className='sh-room-settings-input';
        input.rows=title==='Announcement'?5:2;input.maxLength=maxLength;
        input.value=String(current||'');input.setAttribute('aria-label',title);
        const state=status(panel);
        const button=doc.createElement('button');button.className='sh-room-settings-primary';
        button.type='button';button.textContent='Save changes';
        button.onclick=async()=>{
          if(button.disabled)return;
          button.disabled=true;state.textContent='Saving…';
          try{await save(input.value.trim());state.textContent='Saved ✓';
            await new Promise(resolve=>setTimeout(resolve,450));
            if(page.isConnected)openRoomSettingsPage();
          }catch(error){state.textContent='Not saved: '+errText(error);}
          finally{button.disabled=false;}
        };
        panel.append(input,button);
      }
      const policyLabels={anyone:'Anyone',admins:'Room Admins',owner:'Owner only'};
      const currentPolicy=frame.__sharikaRoomPolicy||{};
      async function updatePolicy(change){
        const updated=await api('PUT','/rooms/'+room.id+'/policy',change);
        frame.__sharikaRoomPolicy=updated;
        if(page.isConnected)openRoomSettingsPage();
        syncFrame(room,frame).catch(error=>
          console.warn('Room policy saved; voice refresh pending:',errText(error)));
        frame.toast('Room policy saved ✓');
      }
      function policyModePage(title,key){
        const panel=subpage(title);const state=status(panel);
        state.textContent='Choose who may '+(key==='chat_mode'?'send room messages':'take a mic seat')+'.';
        const options=doc.createElement('div');options.className='sh-room-settings-seat-options';
        for(const [value,label] of Object.entries(policyLabels)){
          const button=doc.createElement('button');button.type='button';
          button.className=currentPolicy[key]===value?'selected':'';
          button.textContent=label;
          button.onclick=async()=>{
            if(button.disabled)return;
            options.querySelectorAll('button').forEach(item=>item.disabled=true);
            state.textContent='Saving…';
            try{await updatePolicy({[key]:value});}
            catch(error){state.textContent='Not saved: '+errText(error);
              options.querySelectorAll('button').forEach(item=>item.disabled=false);}
          };
          options.append(button);
        }
        panel.append(options);
      }
      function passwordPolicyPage(){
        const panel=subpage('Room Password');const state=status(panel);
        state.textContent='Use a 4–12 digit PIN. New visitors must enter it before joining. ' +
          'Existing members and the owner stay connected.';
        const input=doc.createElement('input');input.type='password';
        input.className='sh-room-settings-input';input.inputMode='numeric';
        input.autocomplete='new-password';input.maxLength=12;
        input.placeholder='4–12 digit PIN';input.setAttribute('aria-label','New room password');
        const save=doc.createElement('button');save.type='button';
        save.className='sh-room-settings-primary';save.textContent='Set room password';
        save.onclick=async()=>{
          if(!/^[0-9]{4,12}$/.test(input.value)){
            state.textContent='Enter 4–12 digits';return;
          }
          save.disabled=true;state.textContent='Saving protected password…';
          try{await updatePolicy({password_action:'set',password:input.value});
            input.value='';}
          catch(error){state.textContent='Not saved: '+errText(error);save.disabled=false;}
        };
        panel.append(input,save);
        if(currentPolicy.password_required){
          const clear=doc.createElement('button');clear.type='button';
          clear.className='sh-room-settings-primary';clear.textContent='Remove room password';
          clear.onclick=async()=>{
            clear.disabled=true;
            try{await updatePolicy({password_action:'clear'});}
            catch(error){state.textContent='Not removed: '+errText(error);clear.disabled=false;}
          };
          panel.append(clear);
        }
      }
      async function adminsPanel(){
        const panel=subpage('Room Admins');const state=status(panel);
        const draw=async()=>{
          state.textContent='Loading verified admins…';
          const result=await api('GET','/rooms/'+room.id+'/admins');
          if(!panel.isConnected)return;
          const list=doc.createElement('div');list.className='sh-room-settings-list';
          for(const admin of result.admins||[]){
            const item=row(list,admin.name||'Member',
              'ID '+String(admin.display_id||admin.public_id),async()=>{
                if(!owner)return;
                if(!window.confirm('Remove '+(admin.name||'member')+' from Room Admins?'))return;
                await setRoomAdmin(admin.public_id,false);await adminsPanel();
              });
            if(!owner)item.button.disabled=true;
          }
          state.textContent=(result.admins||[]).length+' Room Admin(s) appointed';
          panel.querySelector('.sh-room-settings-list')?.remove();
          panel.append(list);
          if(!owner)return;
          const members=await api('GET','/rooms/'+room.id+'/members');
          if(!panel.isConnected)return;
          const available=(members.members||[]).filter(member=>
            member.role==='member'&&member.sharika_users?.public_id&&
            member.user_id!==room.owner_id);
          if(available.length){
            const addTitle=doc.createElement('h3');addTitle.textContent='Appoint a member';
            panel.append(addTitle);
            const choices=doc.createElement('div');choices.className='sh-room-settings-list';
            for(const member of available){
              const user=member.sharika_users;
              row(choices,user.name||'Member','ID '+
                String(user.special_id||user.public_id),async()=>{
                  await setRoomAdmin(user.public_id,true);await adminsPanel();
                });
            }
            panel.append(choices);
          }
        };
        await draw();
      }
      async function bansPanel(){
        const panel=subpage('Blocked List');const state=status(panel);
        state.textContent='Loading blocked members…';
        const result=await api('GET','/rooms/'+room.id+'/bans');
        if(!panel.isConnected)return;
        state.textContent=(result.bans||[]).length+' blocked member(s)';
        for(const ban of result.bans||[]){
          row(panel,ban.name||'Member','ID '+ban.public_id+' · Tap to unblock',async()=>{
            await api('POST','/rooms/'+room.id+'/moderate',{
              action:'unblock',target_public_id:ban.public_id
            });
            await bansPanel();
          });
        }
      }
      async function kicksPanel(){
        const panel=subpage('Kick History');const state=status(panel);
        state.textContent='Loading room moderation history…';
        const result=await api('GET','/rooms/'+room.id+'/kick-history');
        if(!panel.isConnected)return;
        state.textContent=(result.history||[]).length+' recent kick(s)';
        for(const entry of result.history||[]){
          const item=doc.createElement('div');item.className='sh-room-settings-history';
          const name=doc.createElement('b');name.textContent=entry.target_name||'Member';
          const meta=doc.createElement('small');
          meta.textContent='ID '+entry.target_public_id+' · by '+
            (entry.actor_name||'Moderator')+' · '+entry.created_at;
          item.append(name,meta);panel.append(item);
        }
      }
      const roomGroup=section('Room');
      row(roomGroup,'Profile photo','Edit cover',owner?()=>pickRoomCover(room,frame):null);
      row(roomGroup,'Room Name',room.name,owner?()=>editText('Room Name',room.name,100,
        async value=>{if(!value)throw new Error('Room name required');
          const result=await api('PATCH','/rooms/'+room.id,{name:value});
          room.name=result.room.name;await syncFrame(room,frame);await reloadRooms();}):null);
      row(roomGroup,'Announcement','Edit notice',owner?async()=>{
        const data=await api('GET','/rooms/'+room.id+'/announcement');
        editText('Announcement',data.announcement,300,async value=>{
          await api('PUT','/rooms/'+room.id+'/announcement',{announcement:value});
          frame.SharikaRoomPremium?.refreshAnnouncement?.();
        });
      }:null);
      const micGroup=section('Chat & Microphones');
      const chatPolicyRow=row(micGroup,'Who Can Send Room Chat',
        policyLabels[currentPolicy.chat_mode]||'Loading…',
        owner?()=>policyModePage('Who Can Send Room Chat','chat_mode'):null);
      const micPolicyRow=row(micGroup,'Who Can Take The Mic',
        policyLabels[currentPolicy.mic_mode]||'Loading…',
        owner?()=>policyModePage('Who Can Take The Mic','mic_mode'):null);
      row(micGroup,'Number of Mic',String(Number(room.seat_count)||0),owner?()=>{
        const panel=subpage('Number of Mic');const state=status(panel);
        const selector=doc.createElement('div');selector.className='sh-room-settings-seat-options';
        for(let count=4;count<=20;count++){
          const button=doc.createElement('button');button.type='button';
          button.className=count===room.seat_count?'selected':'';
          button.textContent=String(count);button.setAttribute('aria-label',count+' microphones');
          button.onclick=async()=>{
            if(button.disabled)return;
            selector.querySelectorAll('button').forEach(node=>node.disabled=true);
            state.textContent='Saving seat count…';
            try{const result=await api('PATCH','/rooms/'+room.id,{seat_count:count});
              room.seat_count=result.room.seat_count;
              await syncFrame(room,frame);await reloadRooms();
              if(page.isConnected)openRoomSettingsPage();
              frame.toast('Mic count saved ✓');
            }catch(error){state.textContent='Not saved: '+errText(error);
              selector.querySelectorAll('button').forEach(node=>node.disabled=false);}
          };selector.append(button);
        }
        panel.append(selector);
      }:null);
      const passwordRow=row(micGroup,'Room Password',
        currentPolicy.password_required?'On':'Off',owner?passwordPolicyPage:null);
      const superRow=row(micGroup,'Super Mic',
        currentPolicy.super_mic===false?'Off':'On',owner?async()=>{
          await updatePolicy({super_mic:currentPolicy.super_mic===false});
        }:null);
      if(!currentPolicy.chat_mode){
        api('GET','/rooms/'+room.id+'/policy').then(policy=>{
          Object.assign(currentPolicy,policy);
          frame.__sharikaRoomPolicy=policy;
          if(!page.isConnected)return;
          chatPolicyRow.trail.textContent=policyLabels[policy.chat_mode]||'Anyone';
          micPolicyRow.trail.textContent=policyLabels[policy.mic_mode]||'Anyone';
          passwordRow.trail.textContent=policy.password_required?'On':'Off';
          superRow.trail.textContent=policy.super_mic?'On':'Off';
        }).catch(error=>{
          if(page.isConnected)frame.toast('Room policy loading: '+errText(error));
        });
      }
      row(micGroup,'Room Theme','Golden / Premium',owner?()=>{
        page.remove();frame.themeSheet();
      }:null);
      const modGroup=section('Moderation');
      const adminRow=row(modGroup,'Admins',owner?'Loading count…':'Owner only',
        owner?adminsPanel:null);
      if(owner)api('GET','/rooms/'+room.id+'/admins').then(data=>{
        if(adminRow.trail.isConnected)
          adminRow.trail.textContent=(data.admins||[]).length+' appointed';
      }).catch(()=>{
        if(adminRow.trail.isConnected)adminRow.trail.textContent='Unavailable';
      });
      row(modGroup,'Blocked List','Manage blocks',moderator?bansPanel:null);
      row(modGroup,'Kick History','View recent actions',moderator?kicksPanel:null);
      const footer=doc.createElement('p');footer.className='sh-room-settings-footnote';
      footer.textContent='Room changes are saved and enforced by Sharika server. '+
        'Super Mic allows the owner to speak from the throne without a numbered mic seat.';
      body.append(footer);
      doc.body.append(page);
    }
    frame.settings=openRoomSettingsPage;
    // The top cog and the menu icon open the same full settings page.
    const roomButton=frame.$ && frame.$('roomBtn');
    if(roomButton){
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
        openRoomSettingsPage();
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
        frame.toast('Please choose 4–20 mic seats');return;
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
        frame.open('<div class="sh-invite-preview" role="dialog" aria-label="Mic seat invitation">'+
          '<div id="sh-invite-owner-photo" class="sh-sovera-preview"></div>'+
          '<p id="sh-invite-message"></p>'+
          '<div class="sh-invite-actions">'+
          '<button id="sh-decline-invite">Cancel</button>'+
          '<button id="sh-accept-invite">Confirm</button></div></div>');
        const actualOwner=frame.seats?.find(slot=>
          slot?.user_id===room.owner_id&&!slot.empty&&!slot.lock);
        const ownerName=String(actualOwner?.n||'Room Owner');
        const message=frame.$('sh-invite-message');
        if(message){
          const ownerText=frame.document.createElement('strong');
          ownerText.textContent=ownerName;
          message.append(ownerText,frame.document.createTextNode(
            ' is inviting you to take microphone seat '+seat+'.'));
        }
        paintVerifiedAvatar(frame.$('sh-invite-owner-photo'),
          actualOwner?.pic,frame.document);
        const ownerFrame=frameArt(actualOwner?.frame_style);
        if(ownerFrame){
          const frameDecoration=frame.document.createElement('i');
          frameDecoration.className='fxr sh-sovera-frame';
          frameDecoration.style.backgroundImage='url('+cosmeticMedia(ownerFrame)+')';
          frame.$('sh-invite-owner-photo')?.append(frameDecoration);
        }
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
      const policy=frame.__sharikaRoomPolicy||{};
      const role=frame.__sharikaRoomRole;
      if((policy.chat_mode==='owner'&&role!=='owner')||
         (policy.chat_mode==='admins'&&!['owner','admin'].includes(role))){
        frame.toast('Room chat is restricted by the owner');return;
      }
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
        if(messageSend)messageSend.disabled=!!messageInput?.disabled;
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
    // On actual phones there is no DevTools console. Long-press the mic to
    // display a private, packet-based voice check without changing its state.
    if(mic){
      let diagnosisTimer=null,diagnosisShown=false;
      mic.addEventListener('pointerdown',()=>{
        clearTimeout(diagnosisTimer);
        diagnosisTimer=setTimeout(async()=>{
          diagnosisShown=true;
          const state=sfuState?.roomId===room.id?sfuState:null;
          if(state)await inspectSfuAudio(state);
          const report=state?.lastMediaStats;
          const micTrack=state?.media?.getAudioTracks()[0];
          frame.toast('Voice check: mic '+(micTrack?.enabled?'on':'off')+
            ', uplink '+(state?.publishPC?.connectionState||'none')+
            ', downlink '+(state?.receivePC?.connectionState||'none')+
            ', TX '+(report?.outgoing?.packets??'-')+
            ', RX '+(report?.incoming?.packets??'-')+
            ', path '+(report?.outgoingRoute||'unknown'));
        },750);
      });
      for(const event of ['pointerup','pointercancel','pointerleave'])
        mic.addEventListener(event,()=>clearTimeout(diagnosisTimer));
      mic.addEventListener('click',event=>{
        if(diagnosisShown){
          diagnosisShown=false;
          event.preventDefault();event.stopImmediatePropagation();
        }
      },true);
    }
    if(mic) mic.onclick=async ()=>{
      try {
        const enabled=await toggleVoice();
        if(!mic.closest('.sh-tool'))mic.textContent=enabled?'🎤':'🔇';
        mic.classList.toggle('off',!enabled);
        mic.setAttribute('aria-pressed',String(enabled));
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
    async function showRoomSafetyPanel(){
      const owner=room.owner_id===session?.user?.id;
      if(!owner&&frame.__sharikaRoomRole!=='admin'){
        frame.toast('Room Admin only');return;
      }
      frame.open('<h3>🛡 Room Safety</h3>'+
        '<p class="row">Kick: 10-minute removal. Block: cannot rejoin until unblocked.</p>'+
        '<div id="sh-room-safety-list" class="row">Loading verified members…</div>');
      const host=frame.$('sh-room-safety-list');
      if(!host)return;
      try{
        const [snapshot,blocked]=await Promise.all([
          api('GET','/rooms/'+room.id+'/members'),
          api('GET','/rooms/'+room.id+'/bans')
        ]);
        if(!host.isConnected)return;
        host.replaceChildren();
        const addTitle=text=>{
          const heading=frame.document.createElement('h4');
          heading.textContent=text;heading.style.cssText='color:#ffe5a1;margin:14px 0 8px';
          host.appendChild(heading);
        };
        const addButton=(container,label,action,publicId)=>{
          const button=frame.document.createElement('button');
          button.type='button';button.className='act';
          button.style.cssText='margin:5px;padding:9px 11px;border-radius:12px';
          button.textContent=label;
          button.onclick=async()=>{
            const verb=action==='kick'?'kick for 10 minutes':action==='block'?'block until unblocked':'unblock';
            if(!window.confirm('Confirm '+verb+' for ID '+publicId+'?'))return;
            button.disabled=true;
            try{
              await api('POST','/rooms/'+room.id+'/moderate',{
                action,target_public_id:publicId
              });
              await syncFrame(room,frame);
              await showRoomSafetyPanel();
              frame.toast('Room '+action+' completed');
            }catch(error){
              button.disabled=false;frame.toast('Room '+action+': '+errText(error));
            }
          };
          container.appendChild(button);
        };
        addTitle('Members in this room');
        const guests=(snapshot.members||[]).filter(member=>
          member.user_id!==session?.user?.id &&
          member.role!=='owner' && (owner||member.role!=='admin') &&
          /^[0-9]{8}$/.test(String(member.sharika_users?.public_id||'')));
        if(!guests.length){
          const empty=frame.document.createElement('p');empty.textContent='No guests available for moderation.';
          host.appendChild(empty);
        }
        for(const member of guests){
          const row=frame.document.createElement('div');row.className='row';
          const display=member.sharika_users?.display_id||member.sharika_users?.public_id;
          const title=frame.document.createElement('strong');
          title.textContent=String(member.sharika_users?.name||'Guest')+' · ID '+display;
          row.appendChild(title);
          addButton(row,'🚪 Kick 10m','kick',member.sharika_users.public_id);
          addButton(row,'🚫 Block','block',member.sharika_users.public_id);
          host.appendChild(row);
        }
        addTitle('Blocked users');
        const bans=blocked.bans||[];
        if(!bans.length){
          const empty=frame.document.createElement('p');empty.textContent='No users are currently blocked.';
          host.appendChild(empty);
        }
        for(const item of bans){
          const row=frame.document.createElement('div');row.className='row';
          const title=frame.document.createElement('strong');
          title.textContent=String(item.name||'User')+' · ID '+item.public_id+
            (item.blocked_until_unblocked?' · Blocked':' · Temporary kick');
          row.appendChild(title);
          addButton(row,'✅ Unblock','unblock',item.public_id);
          host.appendChild(row);
        }
      }catch(error){
        if(host.isConnected)host.textContent='Room Safety unavailable: '+errText(error);
      }
    }
    const ownerButton=frame.$ && frame.$('bOwn');
    if(ownerButton) {
      const canModerate=room.owner_id===session?.user?.id||
        frame.__sharikaRoomRole==='admin';
      ownerButton.style.display=canModerate?'':'none';
      ownerButton.title='Room Safety: kick, block, unblock';
      ownerButton.onclick=showRoomSafetyPanel;
    }
    const roomGameButton=frame.$ && frame.$('bGame');
    if(roomGameButton)roomGameButton.onclick=()=>showGameCard(document,true,toast);
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
          amount.textContent='🪙 '+formatCompactCoins(item.total);
          row.append(label,amount);
          target.appendChild(row);
        }
      }catch(error){
        if(target.isConnected)target.textContent='Room ranking unavailable: '+errText(error);
      }
    };
    wireSoveraRoomFrames(frame);
    // Catalogue artwork is optional. Do not hold verified seats, mic controls,
    // or the room's first paint behind a slow /cosmetics request.
    loadVerifiedCosmetics().then(()=>{
      if(window.cur?.id!==room.id ||
         document.getElementById('rf')?.contentWindow!==frame)return;
      decorateRoomSeats(frame);
      decorateRoomPeople(frame);
    }).catch(error=>console.warn('Cosmetic art:',errText(error)));
    try {
      await syncFrame(room,frame);
    } catch(error) {
      if(errText(error)==='join_room_first'){
        window.leaveRoom();
        toast('Room membership expired. Please join again.');
        return;
      }
      // First-load network errors must not prevent the 8-second sync loop
      // from starting. The room design and member faces recover on retry.
      showRoomJoinIssue(room,'Seat connection failed: '+errText(error));
      frame.toast('Room details reconnecting automatically…');
    }
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
          // A transient mobile reconnect can produce two genuine coordinator
          // events for one member in a few seconds. Preserve the event cursor,
          // but show only one arrival banner and animation for that burst.
          const memberId=String(event.user_id||'');
          const now=Date.now();
          for(const [key,seenAt] of recentJoinNames)
            if(now-seenAt>10000)recentJoinNames.delete(key);
          if(memberId&&recentJoinNames.has(memberId))continue;
          if(memberId)recentJoinNames.set(memberId,now);
          // Arrival comes from the room coordinator and verified Firebase identity.
          // Show the name in the existing chat feed, not a fabricated local user.
          const verifiedName=String(event.name||'Member').trim().slice(0,80);
          const chat=frame.document.getElementById('chat');
          if(chat&&verifiedName){
            const entry=frame.document.createElement('div');
            entry.className='sh-verified-room-join';
            entry.textContent='👋 '+verifiedName+' joined the room';
            entry.setAttribute('role','status');
            chat.appendChild(entry);
            const notices=chat.querySelectorAll('.sh-verified-room-join');
            if(notices.length>20)notices[0].remove();
            chat.scrollTop=chat.scrollHeight;
          }
          const levelMatch=/^svip-entry-0([1-8])$/.exec(String(event.entry_style||''));
          if(levelMatch){
            playSvipRoomEntry(frame.document,Number(levelMatch[1]),event.name);
            continue;
          }
          if(!entryArt(event.entry_style))
            await loadVerifiedCosmetics().catch(()=>{});
          if(entryArt(event.entry_style))
            playSoveraEntry(frame.document,event.entry_style);
          else playStandardRoomEntry(frame.document,event);
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
    startRoomMusicPoll(room.id);
    // Voice and visual room refresh are independent. A slow ICE/TURN join
    // must never block member faces, the header, announcement or room polling.
    ensureVoiceConnected(room.id).then(voice=>{
      if(window.cur?.id===room.id)
        frame.toast(voice.publishing?'Voice connected, microphone on':'Listening to room');
    }).catch(error=>{
      if(window.cur?.id===room.id)frame.toast('Voice pending: '+errText(error));
    });
    if(framePoll) clearInterval(framePoll);
    framePoll=setInterval(()=>{
      if(window.cur?.id!==room.id)return;
      syncFrame(room,frame,true).catch(error=>{
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
    // The retired room template creates 121 fictitious audience accounts
    // and a 1.6-second speaking simulator. Verified D1 member snapshots
    // supersede both, so do not allocate or schedule them in Android.
    window.ROOM_HTML=window.ROOM_HTML.replace(
      /for\(var ui=0;ui<121;ui\+\+\)U\.push\([^\n]*\);/,'');
    window.ROOM_HTML=window.ROOM_HTML.replace(
      'setInterval(function(){tick(false)},1600);','');
    window.ROOM_HTML=window.ROOM_HTML.replace(
      'function others(){return seats.filter(function(s){return s.i>0&&!s.empty&&!s.lock})}',
      'function others(){return seats.filter(function(s){return !s.empty&&!s.lock})}');
    window.ROOM_HTML=window.ROOM_HTML.replace(
      /setInterval\(function\(\)\{var o=others\(\);[\s\S]*?\},9000\);/,'');
    window.ROOM_HTML=window.ROOM_HTML.replace(
      'msg("Rafi","🧑‍🎤","Greetings to everyone 👋",{ci:1,lv:16});'+
      'msg("Nusrat","👩‍🦰","Will sing tonight 🎶",{ci:2,lv:19});','');
  }
  // A FREE reward box, never the paid Lucky Gift betting tab.
  let freeBoxTimer=null,freeBoxOpening=false;
  async function openVerifiedLuckyBox(){
    if(!session){window.showAuth('welcome');return;}
    let state;
    try{state=await api('GET','/lucky-box');}
    catch(error){toast('Lucky Box unavailable: '+errText(error));return;}
    if(freeBoxTimer){clearInterval(freeBoxTimer);freeBoxTimer=null;}
    window.openSheet('<h3>🎁 Royal Lucky Box</h3>'+
      '<p style="text-align:center;color:#ffe49d">Open a free box every 2 hours! Win 200 coins, a 24-hour Frame, an Entry Effect, or an Empty Box.</p>'+
      '<div style="text-align:center;font-size:64px;filter:drop-shadow(0 5px 10px #b57c4d);margin:10px 0">🎁</div>'+
      '<p id="sh-free-box-countdown" class="lbl" style="text-align:center;color:#ffdc91;font-weight:800"></p>'+
      '<button id="sh-free-box-open" type="button" class="act" style="width:100%;min-height:48px;background:linear-gradient(135deg,#b97827,#54206f);color:white;border:1.5px solid #ffdc8e;border-radius:15px;font-weight:900">Open Lucky Box</button>'+
      '<p id="sh-free-box-result" class="lbl" role="status" style="text-align:center;font-weight:700;margin:14px 0"></p>'+
      '<p class="lbl" style="text-align:center">Temporary rewards stay in My Backpack for 24 hours. No reward is given until the box is opened.</p>');
    const countdown=document.getElementById('sh-free-box-countdown');
    const button=document.getElementById('sh-free-box-open');
    const result=document.getElementById('sh-free-box-result');
    if(!countdown||!button||!result)return;
    let nextAt=Number(state.next_open_at_ms)||0;
    function tick(){
      if(!countdown.isConnected){clearInterval(freeBoxTimer);freeBoxTimer=null;return;}
      const remaining=Math.max(0,nextAt-Date.now());
      if(!remaining){
        countdown.textContent='✨ Your next free box is ready';
        button.disabled=freeBoxOpening||!state.enabled;
      }else{
        const secs=Math.ceil(remaining/1000);
        const hh=String(Math.floor(secs/3600)).padStart(2,'0');
        const mm=String(Math.floor((secs%3600)/60)).padStart(2,'0');
        const ss=String(secs%60).padStart(2,'0');
        countdown.textContent='Next box in '+hh+':'+mm+':'+ss;
        button.disabled=true;
      }
    }
    tick();freeBoxTimer=setInterval(tick,1000);
    button.onclick=async()=>{
      if(freeBoxOpening||Date.now()<nextAt)return;
      freeBoxOpening=true;button.disabled=true;
      result.textContent='✨ Opening your box…';
      const claimId='box-'+(crypto.randomUUID?.()||
        Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''));
      try{
        const reward=await api('POST','/lucky-box/open',{request_id:claimId});
        if(!result.isConnected)return;
        nextAt=Number(reward.next_open_at_ms)||Date.now()+7200000;
        if(reward.reward==='coins'){
          result.textContent='🪙 Congratulations! +'+Number(reward.coins).toLocaleString('en-US')+' coins added to your wallet.';
          await refreshWalletAfterConfirmedTransaction().catch(()=>{});
        }else if(reward.reward==='frame'||reward.reward==='entry'){
          const expiry=new Date(Number(reward.expires_at_ms));
          result.textContent=(reward.reward==='frame'?'🖼️ Frame: ':'✨ Entry Effect: ')+
            String(reward.item_name||reward.item_id||'Premium Item')+
            ' • in My Backpack until '+expiry.toLocaleString();
        }else result.textContent='📦 Empty box this time! Try again in 2 hours.';
      }catch(error){
        const reason=errText(error);
        if(reason==='lucky_box_cooldown'){
          const latest=await api('GET','/lucky-box').catch(()=>null);
          nextAt=Number(latest?.next_open_at_ms)||Date.now()+7200000;
          result.textContent='This box has already been opened. Wait for the timer.';
        }else{
          result.textContent='Connection interrupted. Reopen the box to check your confirmed reward history before trying again.';
        }
      }finally{freeBoxOpening=false;tick();}
    };
  }
  window.SharikaLuckyBox=Object.freeze({open:openVerifiedLuckyBox});

  function askRoomPassword(room,reason){
    return new Promise(resolve=>{
      document.getElementById('sh-room-password-prompt')?.remove();
      const overlay=document.createElement('div');overlay.id='sh-room-password-prompt';
      overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
      overlay.setAttribute('aria-label','Room password required');
      overlay.style.cssText='position:fixed;inset:0;z-index:999999;background:#08040bdc;'+
        'display:flex;align-items:center;justify-content:center;padding:24px';
      const panel=document.createElement('form');
      panel.style.cssText='width:min(100%,380px);border:1px solid #e9bf67;'+
        'border-radius:22px;padding:25px;background:linear-gradient(145deg,#29173a,#090514);'+
        'color:#ffedc4;box-shadow:0 18px 65px #000a';
      const heading=document.createElement('h2');heading.textContent='🔒 Private Room';
      heading.style.cssText='font-size:23px;margin:0 0 12px';
      const detail=document.createElement('p');
      detail.textContent=(room.name||'This room')+' requires a 4–12 digit PIN to join.';
      const error=document.createElement('p');error.setAttribute('role','status');
      error.style.cssText='font-size:13px;color:#ffb9c9;min-height:18px;margin:8px 0';
      error.textContent=reason==='room_password_incorrect'?'Incorrect PIN. Try again.':'';
      const input=document.createElement('input');input.type='password';
      input.inputMode='numeric';input.pattern='[0-9]{4,12}';
      input.maxLength=12;input.required=true;input.autocomplete='off';
      input.placeholder='Room PIN';input.setAttribute('aria-label','Room PIN');
      input.style.cssText='width:100%;box-sizing:border-box;padding:14px;border-radius:12px;'+
        'background:#fff;color:#171221;border:0;font-size:18px';
      const controls=document.createElement('div');
      controls.style.cssText='display:flex;gap:12px;margin-top:18px';
      const cancel=document.createElement('button');cancel.type='button';
      cancel.textContent='Cancel';
      const submit=document.createElement('button');submit.type='submit';
      submit.textContent='Join Room';
      for(const button of [cancel,submit])
        button.style.cssText='flex:1;padding:12px 6px;border:0;border-radius:14px;'+
          'font-weight:700;font-size:15px';
      cancel.style.background='#f9ecdf';submit.style.background='#e1b65e';
      const finish=value=>{overlay.remove();document.removeEventListener('keydown',onKey);resolve(value);};
      const onKey=event=>{if(event.key==='Escape'){event.preventDefault();finish(null);}};
      document.addEventListener('keydown',onKey);
      cancel.onclick=()=>finish(null);
      panel.onsubmit=event=>{
        event.preventDefault();
        if(!/^[0-9]{4,12}$/.test(input.value)){
          error.textContent='Enter a 4–12 digit PIN';return;
        }
        finish(input.value);
      };
      controls.append(cancel,submit);panel.append(heading,detail,error,input,controls);
      overlay.append(panel);document.body.append(overlay);input.focus();
    });
  }

  async function joinRoomWithPassword(room){
    let password=null;
    for(;;){
      try{
        await api('POST','/rooms/'+room.id+'/join',password===null?{}:{password});
        return true;
      }catch(error){
        const reason=errText(error);
        if(reason!=='room_password_required'&&reason!=='room_password_incorrect')throw error;
        password=await askRoomPassword(room,reason);
        if(password===null)return false;
      }
    }
  }

  // The first tap must give visible feedback immediately. Joining requires a
  // genuine server authorization, but previously no UI appeared during that
  // network round-trip and repeated taps launched overlapping join requests.
  let roomEntryBusyToken=null;
  let roomEntryToken=0;
  let roomJoiningWatchdog=null;
  function showRoomJoinIssue(room,message){
    const card=document.getElementById('sh-room-joining-card');
    if(!card || (window.cur?.id!==room.id && roomEntryBusyToken===null))return;
    const status=card.querySelector('small');
    if(status)status.textContent=message;
    const retry=card.querySelector('[data-sh-room-retry]');
    if(retry)retry.hidden=window.cur?.id!==room.id;
  }
  function showRoomJoining(room){
    const wrap=document.getElementById('rw');
    if(!wrap)return;
    if(roomJoiningWatchdog)clearTimeout(roomJoiningWatchdog);
    wrap.classList.add('on','sh-room-awaiting','sh-room-joining');
    wrap.querySelector('#sh-room-joining-card')?.remove();
    const card=document.createElement('section');
    card.id='sh-room-joining-card';
    card.setAttribute('role','status');
    card.setAttribute('aria-live','polite');
    const spinner=document.createElement('span');
    spinner.className='sh-room-join-spinner';
    spinner.setAttribute('aria-hidden','true');
    const title=document.createElement('strong');
    title.textContent=String(room.name||'Voice room');
    const progress=document.createElement('small');
    progress.textContent='Connecting to the room…';
    const leave=document.createElement('button');
    leave.type='button';leave.textContent='Back to rooms';
    leave.onclick=()=>window.leaveRoom?.();
    const retry=document.createElement('button');
    retry.type='button';retry.textContent='Retry room connection';
    retry.dataset.shRoomRetry='';
    retry.hidden=true;
    retry.onclick=async()=>{
      if(retry.disabled||window.cur?.id!==room.id)return;
      retry.disabled=true;
      progress.textContent='Retrying verified seats…';
      const iframe=document.getElementById('rf');
      const frame=iframe?.contentWindow;
      try{
        if(!frame?.seats){
          // The embedded room itself has not initialized. Reload its local
          // artwork only; membership stays server-authoritative.
          if(iframe?.src)iframe.src=iframe.src;
          progress.textContent='Reloading room view…';
        }else{
          await syncFrame(room,frame);
          if(!frame.__sharikaRoomRenderSignature)
            throw new Error('No verified seat snapshot yet');
        }
      }catch(error){showRoomJoinIssue(room,'Retry failed: '+errText(error));}
      finally{retry.disabled=false;}
    };
    card.append(spinner,title,progress,retry,leave);
    wrap.append(card);
    roomJoiningWatchdog=setTimeout(()=>{
      roomJoiningWatchdog=null;
      showRoomJoinIssue(room,'Connection is slow. You can retry or return to rooms.');
    },12000);
  }
  function hideRoomJoining(){
    if(roomJoiningWatchdog){clearTimeout(roomJoiningWatchdog);roomJoiningWatchdog=null;}
    const wrap=document.getElementById('rw');
    wrap?.classList.remove('sh-room-joining');
    wrap?.querySelector('#sh-room-joining-card')?.remove();
  }
  const originalOpenRoom=window.openRoom;
  window.openRoom=async function(room) {
    if(!session){ window.showAuth('welcome'); return; }
    if(roomEntryBusyToken!==null)return;
    const currentToken=++roomEntryToken;
    roomEntryBusyToken=currentToken;
    let roomOpened=false;
    let oldRoomLeft=false;
    try {
      const prior=window.cur;
      if(prior?.id===room.id) {
        document.getElementById('rw')?.classList.add('on');
        document.getElementById('mini')?.classList.remove('on');
        setRoomScreenAwake(true);
        resumeRoomAudio();
        roomOpened=true;
        return;
      }
      showRoomJoining(room);
      // Room-to-room navigation must release old seats, membership and audio.
      if(prior && prior.id!==room.id) {
        window.__sharikaRoomGameClose?.();
        resetRoomMusic();
        if(framePoll){clearInterval(framePoll);framePoll=null;}
        if(giftPoll){clearInterval(giftPoll);giftPoll=null;}
        if(chatPoll){clearInterval(chatPoll);chatPoll=null;}
        if(entryPoll){clearInterval(entryPoll);entryPoll=null;}
        if(reactionPoll){clearInterval(reactionPoll);reactionPoll=null;}
        if(invitePoll){clearInterval(invitePoll);invitePoll=null;}
        await releaseVoice();
        await api('POST','/rooms/'+prior.id+'/leave',{});
        oldRoomLeft=true;
      }
      const joined=await joinRoomWithPassword(room);
      if(currentToken!==roomEntryToken){
        if(joined)api('POST','/rooms/'+room.id+'/leave',{}).catch(()=>{});
        return;
      }
      if(!joined)return;
      // Start media immediately after verified join, while the room iframe
      // and decorative assets continue loading independently.
      ensureVoiceConnected(room.id).catch(error=>{
        if(window.cur?.id===room.id)
          toast('Voice connecting: '+errText(error));
      });
      setRoomScreenAwake(true);
      // Record only confirmed joins; keep History private to this verified
      // account on this device (a failed join must not appear in History).
      if(window.SharikaDiscovery){
        window.CFG.roomHistoryIds=window.SharikaDiscovery.recordVisit(
          window.localStorage,session.user.id,room.id);
        window.renderRooms();
      }
      heartbeatPresence(room.id);
      const iframe=document.getElementById('rf');
      // Bind Games independently of the optional room/voice data sync.
      iframe.onload=()=>{
        const inside=iframe.contentWindow?.document;
        const dock=inside?.querySelector('.dock');
        let games=inside?.getElementById('bGame');
        // Some older room templates omit bGame entirely. Keep the verified
        // original-games entry reachable without rebuilding the room or
        // replacing its existing microphone, gift and moderator controls.
        if(!games&&dock&&!inside.getElementById('sharika-room-games')){
          const shortcut=inside.createElement('button');
          shortcut.id='sharika-room-games';
          shortcut.type='button';
          shortcut.setAttribute('aria-label','Open room games');
          shortcut.textContent='🎮 Games';
          shortcut.style.cssText='position:absolute;left:13px;bottom:calc(100% + 9px);'+
            'z-index:30;border:1.5px solid #ffdf80;border-radius:18px;padding:7px 11px;'+
            'min-height:37px;background:linear-gradient(145deg,#6c318d,#271043);'+
            'color:#fff1ba;font-size:12px;font-weight:900;'+
            'box-shadow:inset 0 2px 2px #fff7,inset 0 -3px 5px #130423,'+
            '0 5px 0 #916323,0 8px 16px #11051c99';
          dock.appendChild(shortcut);
          games=shortcut;
        }
        if(games)games.onclick=()=>showGameCard(document,true,toast);
        attachFrame(room).catch(error=>toast(errText(error)));
      };
      // Keep the room list visible while the new iframe loads. Otherwise
      // WebView shows a black frame, followed by unverified demo seats,
      // before the real room snapshot and premium UI arrive.
      const roomWrap=document.getElementById('rw');
      roomWrap?.classList.add('sh-room-awaiting');
      const progress=roomWrap?.querySelector('#sh-room-joining-card small');
      if(progress)progress.textContent='Loading verified seats…';
      originalOpenRoom(room);
      roomOpened=true;
    } catch(error) {
      toast(errText(error)==='room_locked'
        ?'🔒 This room is locked. Ask the Owner or Room Admin to unlock it.'
        :'Could not join: '+errText(error));
    } finally {
      // A verified join must not permanently block every later room tap.
      // Leave/back invalidates the token, so an older request cannot clear
      // the busy state of a newer navigation attempt.
      if(roomEntryBusyToken===currentToken)roomEntryBusyToken=null;
      if(!roomOpened&&currentToken===roomEntryToken){
        hideRoomJoining();
        const wrap=document.getElementById('rw');
        wrap?.classList.remove('sh-room-awaiting');
        if(!window.cur)wrap?.classList.remove('on');
      }
    }
  };
  const originalLeaveRoom=window.leaveRoom;
  window.leaveRoom=function() {
    roomEntryToken++;
    roomEntryBusyToken=null;
    hideRoomJoining();
    window.__sharikaRoomGameClose?.();
    const current=window.cur;
    resetRoomMusic();
    if(framePoll){clearInterval(framePoll);framePoll=null;}
    if(giftPoll){clearInterval(giftPoll);giftPoll=null;}
    if(chatPoll){clearInterval(chatPoll);chatPoll=null;}
        if(entryPoll){clearInterval(entryPoll);entryPoll=null;}
    if(reactionPoll){clearInterval(reactionPoll);reactionPoll=null;}
        if(invitePoll){clearInterval(invitePoll);invitePoll=null;}
    releaseVoice().catch(()=>{});
    setRoomScreenAwake(false);
    if(current && session){
      // The Worker clears room presence and the mic seat atomically with the
      // exit flow. Do not race an app-level heartbeat against a new room join.
      api('POST','/rooms/'+current.id+'/leave',{}).then(()=>{
        if(!window.cur&&session)heartbeatPresence(null);
      }).catch(error=>console.warn('Sharika room leave:',errText(error)));
    }else if(session)heartbeatPresence(null);
    const iframe=document.getElementById('rf');
    if(iframe) iframe.onload=null;
    document.getElementById('rw')?.classList.remove('sh-room-awaiting');
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
  // The staging recharge/exchange route keeps its verified seller and exchange
  // handlers while adopting the gold-and-ivory reference layout. The Play
  // edition has a separate, Google-Play-only purchase screen below.
  const royalRechargeStyle=document.createElement('style');
  royalRechargeStyle.id='sharika-royal-recharge-style';
  royalRechargeStyle.textContent=[
    '#rcp.sh-recharge-reference{background:#f7f7f7!important;color:#333!important}',
    '#rcp.sh-recharge-reference .rcw{background:linear-gradient(140deg,#ffe79c,#ffae24)!important;',
    'padding-bottom:4px}',
    '#rcp.sh-recharge-reference .rcw button{background:#fff8e7;border:1px solid #f1b449;',
    'color:#8a5300;box-shadow:0 3px 12px #a86d1e25}',
    '#rcp.sh-recharge-reference .rch{min-height:171px;border-radius:0!important;',
    'background:radial-gradient(circle at 85% 35%,#fff1aa 0,#fff1aa00 35%),',
    'linear-gradient(155deg,#ffe59b,#ffc04c 54%,#ff9c07)!important;',
    'padding:10px 17px 58px;box-shadow:none!important}',
    '#rcp.sh-recharge-reference .rch .bk{background:#ffffff36;border-color:#fff8c3;',
    'color:#6b4004;font-weight:800}',
    '#rcp.sh-recharge-reference .rct{margin-top:8px}',
    '#rcp.sh-recharge-reference .rct button{color:#825817;font-size:19px}',
    '#rcp.sh-recharge-reference .rct button.on{color:#49300e}',
    '#rcp.sh-recharge-reference .rct button.on::after{background:#f58b00}',
    '#rcp.sh-recharge-reference .rcb{padding:0 16px 36px}',
    '#rcp.sh-recharge-reference .gc{position:relative;margin:-58px 4px 22px;',
    'border-radius:25px;padding:20px 12px;background:linear-gradient(#fffaf0,#fff5df)!important;',
    'border:1px solid #fff;box-shadow:0 6px 22px #bb7c1833!important;color:#a85b00!important}',
    '#rcp.sh-recharge-reference .gc small{font-size:14px;font-weight:700;color:#9b6a29}',
    '#rcp.sh-recharge-reference .gc b{font-size:33px;margin:8px 0;text-shadow:none}',
    '#rcp.sh-recharge-reference .gc i{color:#8c754e}',
    '#rcp.sh-recharge-reference .dm{padding:12px 15px;margin:0 0 20px;',
    'background:#fff4da;color:#8c5b12;border:1px solid #f1dcac;font-size:16px}',
    '#rcp.sh-recharge-reference .rh{gap:10px;margin:8px 0 14px}',
    '#rcp.sh-recharge-reference .rh h3{color:#3a352c!important;font-size:22px;margin:0}',
    '#rcp.sh-recharge-reference .rh span{background:#fff;border:1px solid #e7c795;',
    'color:#936521;border-radius:30px;padding:9px 12px;font-size:13px}',
    '#rcp.sh-recharge-reference .rcb>.pk:not([style]){display:grid;',
    'grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;',
    'background:#fff!important;border-radius:25px;padding:17px 13px;',
    'box-shadow:none!important;border:1px solid #eee}',
    '#rcp.sh-recharge-reference .rcb>.pk:not([style]) p{grid-column:1/-1;',
    'margin:0 0 4px;color:#746d62;font-size:14px}',
    '#rcp.sh-recharge-reference .rcb>.pk:not([style]) button{display:flex;',
    'flex-direction:column;justify-content:space-between;align-items:center;',
    'min-height:146px;min-width:0;margin:0;padding:22px 8px 0;',
    'border-radius:19px;border:2px solid #e7e2da;',
    'background:linear-gradient(#fff 72%,#efede8 72%)!important;',
    'color:#f18b00;font-size:17px;text-align:center;box-shadow:none!important}',
    '#rcp.sh-recharge-reference .rcb>.pk:not([style]) button span{overflow-wrap:anywhere}',
    '#rcp.sh-recharge-reference .rcb>.pk:not([style]) button em{display:block;',
    'width:calc(100% + 16px);padding:10px 0;color:#b46a00;font-size:20px;',
    'font-weight:900;font-style:normal}',
    '#rcp.sh-recharge-reference .rcb>.pk[style]{background:#fff9ee!important;',
    'border:1px solid #f1cf8a!important;box-shadow:none!important}',
    '#rcp.sh-recharge-reference .rcb>.pk[style] p{color:#806b4a!important}',
    '#rcp.sh-recharge-reference .rate{color:#796c58!important;font-weight:700}',
    '#rcp.sh-recharge-reference .cta{border-radius:40px;padding:17px;',
    'font-size:17px;box-shadow:none!important}',
    '#rcp.sh-recharge-reference .cta.or{background:#ff5c1c!important}',
    '#rcp.sh-recharge-reference .cta.bl{background:linear-gradient(#efa91f,#c88004)!important}',
    '#rcp.sh-recharge-reference .rk{background:#fff;border-color:#eee0c6}',
    '#rcp.sh-recharge-reference .rk summary{color:#6e4a13}',
    '@media(max-width:350px){#rcp.sh-recharge-reference .rcb>.pk:not([style]){gap:8px;',
    'padding:13px 9px}#rcp.sh-recharge-reference .rcb>.pk:not([style]) button{',
    'font-size:15px;padding:17px 5px 0}}'
  ].join('');
  document.head.appendChild(royalRechargeStyle);
  const playCoinsByProduct=Object.freeze({
    sharika_coins_500k:500000,sharika_coins_2500k:2500000,
    sharika_coins_5000k:5000000
  });
  let playCoinCheckoutBusy=false;
  async function claimOwnedPlayPurchases(purchases){
    let credited=0;
    for(const item of purchases||[]){
      if(!Object.prototype.hasOwnProperty.call(playCoinsByProduct,item.product_id) ||
         typeof item.purchase_token!=='string')continue;
      // A receipt is never proof of coins by itself. The server checks Google,
      // the Firebase account hash and its own immutable transaction ledger.
      const claimed=await api('POST','/play-billing/claim',{
        product_id:item.product_id,purchase_token:item.purchase_token
      });
      if(claimed.credited&&!claimed.duplicate)credited+=Number(claimed.coins)||0;
    }
    if(credited)await refreshWalletAfterConfirmedTransaction();
    return credited;
  }
  async function showPlayCoinShop(){
    if(!session){window.showAuth('welcome');return;}
    document.getElementById('sh-play-coin-shop')?.remove();
    const root=document.createElement('section');
    root.id='sh-play-coin-shop';
    root.setAttribute('role','dialog');
    root.setAttribute('aria-modal','true');
    root.setAttribute('aria-label','Buy Sharika Coins with Google Play');
    root.className='sh-play-recharge-screen';
    root.innerHTML='<div class="sh-play-recharge-content">'+
      '<header class="sh-play-recharge-hero">'+
      '<div class="sh-play-recharge-nav">'+
      '<button type="button" id="sh-play-close" aria-label="Back to profile">‹</button>'+
      '<h2>Recharge</h2><span>Google Play</span></div>'+
      '<div class="sh-play-recharge-balance"><small>My coins</small>'+
      '<strong id="sh-play-coin-balance">Loading…</strong>'+
      '<p>Verified Sharika virtual balance</p></div></header>'+
      '<section class="sh-play-recharge-body">'+
      '<div class="sh-play-payment-heading"><h3>Payment Method</h3>'+
      '<span>Secure checkout</span></div>'+
      '<div class="sh-play-payment-card">'+
      '<div class="sh-play-payment-tabs"><strong>Google Play</strong>'+
      '<span>Available packages</span></div>'+
      '<div class="sh-play-coin-packages" id="sh-play-coin-products" '+
      'aria-live="polite">Checking available packages…</div></div>'+
      '<p id="sh-play-coin-status" role="status" aria-live="polite"></p>'+
      '<div class="sh-play-recharge-actions">'+
      '<button type="button" id="sh-play-exchange">Diamond Exchange</button>'+
      '<button type="button" id="sh-play-wallet-open">My Wallet &amp; History</button>'+
      '</div><p class="sh-play-billing-note">Only Google Play handles payments. '+
      'Coins have no cash value and cannot be withdrawn or sold.</p>'+
      '</section></div>';
    document.body.append(root);
    root.querySelector('#sh-play-close').onclick=()=>{if(!playCoinCheckoutBusy)root.remove();};
    root.querySelector('#sh-play-exchange').onclick=()=>{
      if(playCoinCheckoutBusy)return;root.remove();window.rechargeSheet(1);
    };
    root.querySelector('#sh-play-wallet-open').onclick=()=>{
      if(playCoinCheckoutBusy)return;root.remove();
      if(typeof window.sharikaOpenPlayWallet==='function')window.sharikaOpenPlayWallet();
      else document.querySelector('#v-me #wr')?.click();
    };
    const list=root.querySelector('#sh-play-coin-products');
    const status=root.querySelector('#sh-play-coin-status');
    const refreshDisplayedBalance=async()=>{
      try {
        const wallet=await api('GET','/wallet');
        const amount=root.querySelector('#sh-play-coin-balance');
        if(amount?.isConnected)amount.textContent=formatCompactCoins(wallet.coins||0);
      } catch(error) {
        const amount=root.querySelector('#sh-play-coin-balance');
        if(amount?.isConnected)amount.textContent='Balance unavailable';
      }
    };
    try {
      refreshDisplayedBalance();
      const server=await api('GET','/play-billing/catalog');
      if(!server.enabled){
        list.textContent='Google Play coin purchases are temporarily unavailable.';return;
      }
      const store=await native('playBillingProducts',{});
      if(!root.isConnected)return;
      try {
        const credited=await claimOwnedPlayPurchases(store.purchases||[]);
        if(credited){
          status.textContent='Restored '+formatCompactCoins(credited)+' coins ✓';
          await refreshDisplayedBalance();
        }
      }catch(error){status.textContent='Previous payment check: '+errText(error);}
      list.replaceChildren();
      const available=new Set((server.products||[]).filter(p=>
        playCoinsByProduct[p.id]===Number(p.coins)).map(p=>p.id));
      for(const product of store.products||[]){
        if(!available.has(product.id)||typeof product.price!=='string')continue;
        const row=document.createElement('button');
        row.type='button';
        row.className='sh-play-ticket';
        const label=document.createElement('span');
        label.className='sh-play-ticket-coins';
        label.textContent='🪙 '+formatCompactCoins(playCoinsByProduct[product.id])+' coins';
        const price=document.createElement('span');
        price.className='sh-play-ticket-price';
        price.textContent=product.price;
        row.append(label,price);list.append(row);
        row.onclick=async()=>{
          if(playCoinCheckoutBusy)return;
          playCoinCheckoutBusy=true;
          root.querySelectorAll('button').forEach(button=>button.disabled=true);
          status.textContent='Opening Google Play…';
          try {
            const purchased=await native('playBillingPurchase',{product_id:product.id});
            status.textContent='Verifying payment with Google…';
            const total=await claimOwnedPlayPurchases(purchased.purchases);
            await refreshDisplayedBalance();
            if(total>0){
              status.textContent='Payment verified. Your wallet is updated ✓';
              toast('Coins received: '+formatCompactCoins(total));
            }else{
              status.textContent='No new coins credited. Check Wallet & History '+
                'for existing payments before trying again.';
            }
          }catch(error){
            status.textContent=errText(error)==='play_purchase_cancelled'
              ?'Payment cancelled; no coins deducted.'
              :'Payment not credited: '+errText(error)+
                '. Reopen the shop to restore a completed purchase.';
          }finally{
            playCoinCheckoutBusy=false;
            root.querySelectorAll('button').forEach(button=>button.disabled=false);
          }
        };
      }
      if(!list.childElementCount)list.textContent='No Google Play coin packages are available yet.';
    }catch(error){if(root.isConnected)list.textContent='Unable to load Google Play packages: '+errText(error);}
  }
  let verifiedRechargeFetch=null;
  async function refreshVerifiedRechargeRate(){
    await playModeReady;
    if(playStoreMode!==false)return;
    if(!session)return;
    if(verifiedRechargeFetch)return verifiedRechargeFetch;
    verifiedRechargeFetch=(async()=>{
      const result=await api('GET','/invites');
      const rate=Number(result.recharge_coins_per_usd);
      const bonus=Number(result.first_recharge_bonus_percent);
      if(!Number.isSafeInteger(rate)||rate<1000||rate>1000000||
         !Number.isSafeInteger(bonus)||bonus<0||bonus>100)return;
      window.SHARIKA_RECHARGE_COINS_PER_USD=rate;
      window.SHARIKA_FIRST_RECHARGE_BONUS_PERCENT=bonus;
      window.SHARIKA_VERIFIED_RECHARGE_RATE=true;
      if(document.getElementById('rcp')?.classList.contains('on')&&
         window.RCT===0&&typeof window.renderRcp==='function')window.renderRcp();
    })();
    try{return await verifiedRechargeFetch;}finally{verifiedRechargeFetch=null;}
  }
  if(typeof originalRechargeSheet==='function')window.rechargeSheet=function(...args){
    if(args[0]!==1){
      if(playStoreMode===true){showPlayCoinShop();return;}
      if(playStoreMode===null){playModeReady.then(()=>window.rechargeSheet(...args));return;}
    }
    const value=originalRechargeSheet.apply(this,args);
    document.getElementById('rcp')?.classList.add('sh-recharge-reference');
    if(args[0]===1)refreshVerifiedExchangeRate().catch(error=>toast(errText(error)));
    else refreshVerifiedRechargeRate().catch(error=>toast('Recharge rates unavailable: '+errText(error)));
    return value;
  };
  document.addEventListener('click',event=>{
    if(playStoreMode!==true)return;
    if(event.target.closest?.('#pc,#rcl2,#sharika-recharge-seller-wallet,'+
        '#sh-invite-open-withdraw,[data-sh-invite-withdraw]')){
      event.preventDefault();event.stopImmediatePropagation();
      toast('This option is not available in the Google Play edition.');
    }
  },true);
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
      const presets=[100,500,1000,5000].map(n=>Math.max(unit,Math.ceil(n/unit)*unit));
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
    style.textContent += "\n#sharika-seller-content{color:#ffe8b8}\n#sharika-seller-content .shw-hero{border:1px solid #d9a35d;background:linear-gradient(125deg,#61331c 0%,#4d2637 50%,#30132d 100%);box-shadow:inset 0 2px 1px #fff0bb55,0 10px 22px #0c041455}\n#sharika-seller-content .shw-hero:after{background:radial-gradient(circle,#ffcc6759 0%,transparent 70%)}\n#sharika-seller-content .shw-eyebrow{color:#ffdf9c}\n#sharika-seller-content .shw-stock{color:#ffe7ad;text-shadow:0 1px 8px #e7a93e88;font-family:Georgia,serif}\n#sharika-seller-content .shw-stock small{color:#ffc75c}\n#sharika-seller-content .shw-id{border-color:#c69659;background:#2e1439;color:#ffe2ac}\n#sharika-seller-content .shw-section{background:linear-gradient(155deg,#563042,#2e1934 75%);border:1px solid #c59558;box-shadow:inset 0 1px #ffe3b438,0 8px 22px #08040b88}\n#sharika-seller-content .shw-title{color:#ffe0a2;font-family:Georgia,serif}\n#sharika-seller-content .shw-sub{color:#edd2b5}\n#sharika-seller-content .shw-label{color:#f8deb8}\n#sharika-seller-content .shw-input{background:#24152b!important;color:#fff0ce!important;border:1px solid #d2a45e!important}\n#sharika-seller-content .shw-input::placeholder{color:#bba4a8}\n#sharika-seller-content .shw-mini{background:#4d2c40;border-color:#efc46f;color:#ffdea3}\n#sharika-seller-content .shw-chip{background:#4d2d44;border:1px solid #c28d56;color:#ffdc9b}\n#sharika-seller-content .shw-submit{background:linear-gradient(175deg,#ffedac,#eebd62 65%,#bc883e);border:1px solid #ffe1a5;color:#432307;box-shadow:inset 0 1px #fff6c1b8,0 8px 18px #08020955;transition:transform .2s ease,filter .2s ease}\n#sharika-seller-content .shw-submit:active{transform:perspective(500px) rotateX(5deg) scale(.98)}\n#sharika-seller-content .shw-details{background:#3c2034;border:1px solid #966b4b}\n#sharika-seller-content .shw-details summary{color:#ffdfa7}\n#sharika-seller-content .shw-entry{background:#563547;border:1px solid #8c5a6b;color:#efdbbf}\n#sharika-seller-content .shw-entry strong{color:#ffe3aa}\n#sharika-seller-content .shw-tag{background:#326d493d;color:#92efb5}\n#sharika-seller-content .shw-empty{color:#e6c8b0}\n@media(prefers-reduced-motion:reduce){#sharika-seller-content .shw-submit{transition:none!important}}\n";
    document.head.appendChild(style);
  }
  async function showVerifiedCoinSellers({walletOnly=false,targetId=''}={}){
    if(playStoreMode!==false){toast('Seller recharge is unavailable in the Google Play edition.');return;}
    if(walletOnly)ensureSellerWalletStyle();
    window.openSheet('<h3>🪙 '+(walletOnly?'Seller Wallet':'Coin sellers')+
      '</h3><div id="sharika-seller-content">Loading verified seller data…</div>');
    const root=document.getElementById('sharika-seller-content');
    if(!root)return;
    try{
      if(!walletOnly){
        // Public seller exchange inventory is read-only; private allocations,
        // transfer receipts and recharge controls remain seller-only.
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
            sellerEscape(s.public_id)+'</div><small style="color:#ffe0a8">'+
            (s.unlimited_stock?'Unlimited Coins':
            'Available '+formatCompactCoins(s.available_coins||0)+' Coins')+'</small></div>'+
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
      const [mine,transfers,allocations,salaryIncoming]=await Promise.all([
        api('GET','/sellers/me'),api('GET','/sellers/transfers'),
        api('GET','/sellers/allocations'),api('GET','/sellers/salary-incoming')
      ]);
      if(!root.isConnected)return;
      const self=mine.seller;
      const unlimited=!!self?.unlimited_stock;
      root.classList.add('sharika-seller-wallet');
      if(!self?.active){
        root.innerHTML='<div class="shw-section">Seller Wallet is available only to approved coin sellers.</div>';
        return;
      }
      const coinsText=value=>formatCompactCoins(value);
      const exactCoins=value=>Number(value||0).toLocaleString('en-US');
      const visibleSellerId=value=>String(value||'')===profile?.public_id?
        (profile?.special_id||profile?.display_id||value):value;
      const transferEntries=rows=>(rows||[]).slice(0,30).map(t=>{
        const isSelf=t.sender_public_id===t.recipient_public_id;
        return '<div class="shw-entry"><strong>🪙 '+coinsText(t.coins)+' coins'+
          (isSelf?'<span class="shw-tag">SELF</span>':'')+'</strong>'+
          'Transfer #'+sellerEscape(t.id)+' · ID '+
          sellerEscape(visibleSellerId(t.sender_public_id))+
          ' → '+sellerEscape(visibleSellerId(t.recipient_public_id))+
          (t.created_at?' · '+sellerEscape(t.created_at):'')+'</div>';
      }).join('')||'<div class="shw-empty">No transfers yet.</div>';
      const allocationEntries=(allocations.allocations||[]).slice(0,30).map(a=>
        '<div class="shw-entry"><strong>✨ +'+coinsText(a.coins)+' stock coins</strong>'+
        'Allocation #'+sellerEscape(a.id)+' · Admin '+sellerEscape(visibleSellerId(a.sender_public_id))+
        ' → Seller '+sellerEscape(visibleSellerId(a.seller_public_id))+
        (a.created_at?' · '+sellerEscape(a.created_at):'')+'</div>'
      ).join('')||'<div class="shw-empty">No stock allocations yet.</div>';
      const salaryEntries=(salaryIncoming.transfers||[]).slice(0,30).map(t=>
        '<div class="shw-entry"><strong>💼 +'+coinsText(t.credited_coins)+
        ' Seller stock coins</strong>'+sellerEscape(t.sender_name)+
        ' · Salary Wallet ID '+sellerEscape(t.sender_public_id)+
        ' · Transfer #'+sellerEscape(t.id)+
        (t.created_at?' · '+sellerEscape(t.created_at):'')+'</div>'
      ).join('')||'<div class="shw-empty">No salary transfers received.</div>';
      root.innerHTML=
        '<section class="shw-hero">'+
          '<div class="shw-eyebrow">🪙 '+(unlimited?'Unlimited seller stock':'Available seller stock')+'</div>'+
          '<div class="shw-stock"><span id="sharika-seller-stock">'+
            (unlimited?'∞':coinsText(self.available_coins))+'</span> <small>'+(unlimited?'Admin approved':'coins')+'</small></div>'+
          '<div class="shw-id">✓ Verified seller · ID '+
            sellerEscape(visibleSellerId(self.public_id))+'</div>'+
        '</section>'+
        '<section class="shw-section">'+
          '<h4 class="shw-title">✨ Recharge my ID or another user</h4>'+
          '<p class="shw-sub">Recharge any active Sharika ID, including your own. '+
             (unlimited?'Admin-approved unlimited stock: transfers remain recorded and audited.':
             'Coins are deducted from your assigned seller stock.')+'</p>'+
          '<label class="shw-label" for="sharika-seller-target">Recipient user ID</label>'+
          '<div class="shw-control-row">'+
            '<input class="shw-input" id="sharika-seller-target" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="Member or Special ID" aria-label="Recipient user ID">'+
            '<button class="shw-mini" id="sharika-seller-my-id" type="button">My ID</button>'+
          '</div>'+
          '<label class="shw-label" for="sharika-seller-amount">Amount in coins</label>'+
          '<input class="shw-input" id="sharika-seller-amount" inputmode="numeric" autocomplete="off" placeholder="Enter coin amount" aria-label="Coins to recharge">'+
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
          allocationEntries+'</details>'+
        '<details class="shw-details"><summary>💼 Salary Wallet transfers received ('+
          (salaryIncoming.transfers||[]).length+')</summary>'+
          salaryEntries+'</details>';
      const targetField=document.getElementById('sharika-seller-target');
      const amountField=document.getElementById('sharika-seller-amount');
      const note=document.getElementById('sharika-seller-note');
      const send=document.getElementById('sharika-seller-send');
      // A seller's own verified ID is the default recipient. Other users
      // remain reachable by entering their eight-digit ID explicitly.
      if(targetField)targetField.value=/^[0-9]{1,10}$/.test(targetId)
        ?targetId:visibleSellerId(self.public_id);
      document.getElementById('sharika-seller-my-id')?.addEventListener('click',()=>{
        if(targetField){targetField.value=visibleSellerId(self.public_id);targetField.focus();}
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
        const entered=targetField?.value.trim()||'';
        const raw=amountField?.value.trim()||'';
        const amount=Number(raw);
        if(!/^[0-9]{1,10}$/.test(entered)||!/^[0-9]+$/.test(raw)||
          !Number.isSafeInteger(amount)||amount<1||amount>1000000000000){
          showNote('Enter a member or Special ID and a positive whole coin amount (wallet maximum 1 trillion).','error');
          return;
        }
        if(!unlimited&&amount>Number(self.available_coins)){
          showNote('Insufficient seller stock for this amount.','error');
          return;
        }
        send.disabled=true;
        let transferCommitted=false;
        try{
          showNote('Verifying recipient…','info');
          const verified=await api('GET','/users/'+entered);
          const recipient=String(verified.id||'');
          if(!/^[0-9]{8}$/.test(recipient))throw Error('Recipient verification failed');
          const visibleRecipient=String(verified.display_id||entered);
          const isSelf=recipient===self.public_id;
          const message=isSelf?
            'Recharge your own ID '+visibleRecipient+' with '+exactCoins(amount)+
               (unlimited?' coins using unlimited seller stock?':' coins from seller stock?'):
            'Send '+exactCoins(amount)+' coins to '+String(verified.name||'User')+' (ID '+visibleRecipient+')?';
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
          if(stockLabel)stockLabel.textContent=result.unlimited_stock?'∞':coinsText(result.available_coins);
          if(amountField)amountField.value='';
          showNote((result.duplicate?'Already recorded: ':'Success! ')+
            (result.self_recharge?'Your own wallet':'Recipient ID '+visibleRecipient)+
            ' received '+exactCoins(amount)+' coins. Transfer #'+result.transfer_id+
            (Number(result.first_recharge_bonus_coins)>0?
              '. 🎁 First recharge bonus +'+exactCoins(result.first_recharge_bonus_coins)+' coins':'')+
            (result.unlimited_stock?'. Unlimited seller mode audited.':
               '. Remaining stock: '+exactCoins(result.available_coins)+'.'),'success');
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
    // Unknown bridge mode is treated as Play until positively identified as
    // staging; never flash a Seller Wallet shortcut during startup.
    if(playStoreMode!==false)return;
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
    }).catch(()=>{}).finally(()=>{
      sellerWalletButtonCheck=false;
      // Switching Recharge/Exchange replaces the button while the seller
      // check is pending. Recheck the latest screen instead of losing the
      // wallet entry until the user manually opens Recharge again.
      if(document.querySelector('#rcp #rcl2')!==listButton)
        mountRechargeSellerWallet();
    });
  }
  const rechargeRoot=document.getElementById('rcp');
  if(rechargeRoot){
    new MutationObserver(mountRechargeSellerWallet).observe(rechargeRoot,{
      childList:true,subtree:false
    });
  }


  // Public banner metadata is populated by verified Super-Admin D1 records.
  // Keep the original 3D carousel/scroll behavior and never show demo offers.
  function verifiedBannerImageUrl(value,bannerId){
    const match=typeof value==='string'&&
      /^https:\/\/sharika-api-staging\.soverixnet\.workers\.dev\/api\/v1\/banners\/([1-9][0-9]{0,8})\/image\?v=[1-9][0-9]*$/.exec(value);
    return match&&Number(match[1])===Number(bannerId)?value:null;
  }
  let lastVerifiedBannerSignature='';
  function renderVerifiedBanners(list,eventList){
    const approved=Array.isArray(list)?list.filter(row=>row&&
      typeof row.title==='string'&&row.title.length<=80&&
      /^#[0-9a-fA-F]{6}$/.test(row.color_a||'')&&
      /^#[0-9a-fA-F]{6}$/.test(row.color_b||'')&&
      ['none','daily','recharge','rank','invite','apply'].includes(row.action)&&
      // Older seller/third-party recharge artwork is for private staging.
      // Do not advertise it in the Play edition, even during startup.
      (playStoreMode===false ||
       (row.action!=='recharge' &&
        !/\b(?:coin seller|recharge|salary|cash.?out|withdraw|commission|cash reward|money transfer|payout|earn money)\b/i.test(
          row.title+' '+String(row.subtitle||''))))).slice(0,10):[];
    const cards=approved.map(row=>({
      t:row.title,s:String(row.subtitle||'').slice(0,160),
      e:String(row.emoji||'🎉').slice(0,12),
      c:row.color_a+','+row.color_b,a:row.action,
      img:verifiedBannerImageUrl(row.image_url,row.id)
    }));
    // An event is discoverable only from a currently published home banner.
    // Draft, cancelled and expired campaigns are never advertised here.
    const campaigns=Array.isArray(eventList)?eventList.filter(event=>
      event&&event.published&&['live','scheduled'].includes(event.status)&&
      (playStoreMode===false || event.kind!=='game_tournament')&&
      Number.isSafeInteger(event.id)&&event.id>0).slice(0,6):[];
    for(const event of campaigns){
      const imagePath=typeof event.banner_image_url==='string'?
        /^\/api\/v1\/banners\/([1-9]\d*)\/image\?v=([1-9]\d*)$/.exec(event.banner_image_url):null;
      const image=imagePath&&Number(imagePath[1])===Number(event.banner_id)?
        verifiedBannerImageUrl('https://sharika-api-staging.soverixnet.workers.dev'+
          event.banner_image_url,event.banner_id):null;
      cards.unshift({t:String(event.title).slice(0,80),
        s:event.status==='live'?'🔴 Live now · Tap for event ranking and rewards':
          '⏰ Coming soon · Tap for gift list and rewards',
        e:'🏆',c:'#4b1959,#c99138',a:'event',event_id:event.id,img:image});
    }
    cards.splice(10);
    if(!cards.length)cards.push({t:'Welcome to Sharika',
      s:'Talk with friends in voice rooms',e:'🎙️',c:'#9b4dff,#0ea5e9',a:'none'});
    const signature=JSON.stringify(cards);
    if(signature===lastVerifiedBannerSignature)return;
    lastVerifiedBannerSignature=signature;
    window.CFG.banners=cards;
    const slide=document.getElementById('ban'),dots=document.getElementById('dots');
    if(slide)slide.innerHTML=cards.map((row,i)=>{
      // Uploaded artwork may already contain its own lettering. Show it in
      // full, without a dark gradient or a second headline/subtitle layer.
      if(row.img)return '<div class="slide slide--image" data-i="'+i+
        '" role="button" tabindex="0" aria-label="'+sellerEscape(row.t)+
        '"><img class="banner-art" src="'+sellerEscape(row.img)+
        '" alt="'+sellerEscape(row.t)+'" loading="eager" decoding="async"></div>';
      return '<div class="slide" data-i="'+i+'" role="button" tabindex="0" style="background:linear-gradient(135deg,'+
        row.c+')"><b>'+sellerEscape(row.t)+'</b><small>'+sellerEscape(row.s)+
        '</small><i>'+sellerEscape(row.e)+'</i></div>';
    }).join('');
    if(dots)dots.innerHTML=cards.map((_,i)=>'<u'+(!i?' class="on"':'')+'></u>').join('');
    window.bi=0;
  }
  async function refreshVerifiedBanners(){
    if(!session)return;
    const [bannerResult,eventResult]=await Promise.allSettled([
      api('GET','/banners'),api('GET','/events')]);
    if(session)renderVerifiedBanners(bannerResult.status==='fulfilled'?bannerResult.value.banners:[],
      eventResult.status==='fulfilled'?eventResult.value.events:[]);
  }
  renderVerifiedBanners([]);
  playModeReady.then(()=>refreshVerifiedBanners()).catch(()=>{});
  setInterval(()=>{
    if(session&&document.getElementById('v-home')?.classList.contains('on'))
      refreshVerifiedBanners().catch(error=>console.warn('Event banner refresh:',errText(error)));
  },60000);

  // SHARIKA_VERIFIED_RECRUITMENT_20261108: a banner application is a request
  // for human review; it never creates a staff login or grants a role.
  window.sharikaOpenRoleApplication=async function(initialRole='manager'){
    if(!session){window.showAuth('welcome');return;}
    document.getElementById('sh-recruit-overlay')?.remove();
    const page=document.createElement('div');page.id='sh-recruit-overlay';
    page.style.cssText='position:fixed;inset:0;z-index:2147483095;overflow:auto;'+
      'background:#061a17;color:#f9e6b8;font-family:system-ui,sans-serif;'+
      'padding:22px 15px 55px';
    page.innerHTML='<div style="max-width:520px;margin:auto">'+
      '<button id="sh-recruit-back" style="border:1px solid #f3d48c;border-radius:14px;'+
      'background:#142e2a;color:#ffe6af;padding:12px 18px">‹ Back</button>'+
      '<h1 style="font-size:26px;color:#ffdf94">👑 Sharika Global Recruitment</h1>'+
      '<p style="font-size:13px;line-height:1.6">Apply for official Manager, BD, Admin, '+
      'Super Admin or Coin Seller review. Applications do not provide access. '+
      'Only a verified Super Admin can grant permissions separately.</p>'+
      '<form id="sh-recruit-form" style="display:grid;gap:12px">'+
      '<label>Position<select id="sh-recruit-role" required></select></label>'+
      '<label>Country<input id="sh-recruit-country" required minlength="2" maxlength="60" '+
      'placeholder="Your country"></label>'+
      '<label>Contact email or messaging handle<input id="sh-recruit-contact" required '+
      'minlength="5" maxlength="120" autocomplete="email" '+
      'placeholder="How can the team contact you?"></label>'+
      '<label>Your experience and reasons for applying<textarea id="sh-recruit-experience" '+
      'required minlength="20" maxlength="500" rows="5" '+
      'placeholder="Tell us about your experience"></textarea></label>'+
      '<p style="font-size:11px;color:#b9d5d0">Never include passwords, OTPs, '+
      'identity documents, payment details or API keys.</p>'+
      '<button id="sh-recruit-submit" type="submit" style="padding:13px;'+
      'border:2px solid #ffe3aa;border-radius:15px;background:#d5a747;color:#19352a;'+
      'font-weight:900">Submit application</button></form>'+
      '<p id="sh-recruit-message" role="status" style="min-height:25px;margin-top:13px"></p>'+
      '<h2 style="font-size:16px">My applications</h2><div id="sh-recruit-history">Loading…</div></div>';
    document.body.appendChild(page);
    page.querySelectorAll('input,textarea,select').forEach(el=>{
      el.style.cssText='display:block;box-sizing:border-box;width:100%;margin-top:5px;'+
        'padding:11px;border:1px solid #c6a25f;border-radius:10px;'+
        'background:#122f29;color:#fff;font:inherit';
    });
    page.querySelector('#sh-recruit-back').onclick=()=>page.remove();
    const choice=page.querySelector('#sh-recruit-role');
    const labels=[['manager','Global Manager'],['bd','BD'],['admin','Admin'],
      ['super','Super Admin'],['coin_seller','Coin Seller']];
    for(const [value,label] of labels){const option=document.createElement('option');
      option.value=value;option.textContent=label;choice.appendChild(option);}
    choice.value=labels.some(([id])=>id===initialRole)?initialRole:'manager';
    const message=page.querySelector('#sh-recruit-message');
    const history=page.querySelector('#sh-recruit-history');
    const load=async()=>{
      const response=await api('GET','/role-applications');
      if(!page.isConnected)return;
      history.replaceChildren();
      if(!response.applications?.length){history.textContent='No applications submitted yet.';return;}
      for(const item of response.applications){const line=document.createElement('p');
        const label=labels.find(([id])=>id===item.requested_role)?.[1]||'Role';
        line.textContent=label+' · '+item.status+' · '+item.created_at;
        history.appendChild(line);}
    };
    load().catch(error=>{if(page.isConnected)history.textContent=errText(error);});
    page.querySelector('#sh-recruit-form').onsubmit=async event=>{
      event.preventDefault();const button=page.querySelector('#sh-recruit-submit');
      if(button.disabled)return;
      button.disabled=true;message.textContent='Submitting for official review…';
      try{
        const body={requested_role:choice.value,
          country:page.querySelector('#sh-recruit-country').value.trim(),
          contact:page.querySelector('#sh-recruit-contact').value.trim(),
          experience:page.querySelector('#sh-recruit-experience').value.trim()};
        await api('POST','/role-applications',body);
        message.textContent='✓ Application submitted. No access is granted until reviewed.';
        page.querySelector('#sh-recruit-form').reset();
        await load();
      }catch(error){message.textContent='Application not submitted: '+errText(error);}
      finally{if(button.isConnected)button.disabled=false;}
    };
  };

  // Banner-only event destination: its ranking and rewards are independent
  // from Daily/Weekly/Monthly Sharika Rankings. No client-side score writes.
  const eventRoyalStyle=document.createElement('style');
  eventRoyalStyle.id='sh-banner-events-style';
  eventRoyalStyle.textContent=[
    '#sh-banner-event{position:fixed;inset:0;z-index:2147483100;overflow-y:auto;'+
      'overscroll-behavior:contain;background:radial-gradient(ellipse at 50% 0%,#662475,#200b37 55%,#10091e);'+
      'color:#fbe7b6;font-family:system-ui,-apple-system,sans-serif}',
    '#sh-banner-event *{box-sizing:border-box}',
    '#sh-banner-event .she-wrap{max-width:630px;margin:auto;padding:18px 13px 50px}',
    '#sh-banner-event .she-top{display:flex;align-items:center;gap:12px;'+
      'margin:0 0 16px;padding:8px 0;border-bottom:1px solid #fad7878a}',
    '#sh-banner-event .she-back{width:43px;height:43px;flex:none;border:2px solid #f9d78a;'+
      'border-radius:13px;color:#ffe8a9;background:#36134c;font-size:23px}',
    '#sh-banner-event .she-brand{min-width:0;font:900 25px Georgia,serif;color:#ffe6a4}',
    '#sh-banner-event .she-hero{position:relative;min-height:174px;border:2px solid #f9d47b;'+
      'border-radius:22px;overflow:hidden;background:linear-gradient(135deg,#92308e,#d49b3f 80%);'+
      'box-shadow:0 7px 0 #6e3681,0 14px 28px #080211aa;display:flex;align-items:end}',
    '#sh-banner-event .she-hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}',
    '#sh-banner-event .she-hero.has-img{background:#23152d}',
    '#sh-banner-event .she-title{position:relative;z-index:1;width:100%;padding:16px;'+
      'background:linear-gradient(0deg,#14051bd9,transparent);text-shadow:0 2px 7px #000}',
    '#sh-banner-event .she-hero.has-img .she-title{background:#130823c9;padding:8px 14px}',
    '#sh-banner-event .she-title h1{font:900 clamp(22px,7vw,33px) Georgia,serif;margin:3px 0}',
    '#sh-banner-event .she-status{display:inline-block;padding:6px 10px;border-radius:99px;'+
      'background:#e8bb5b;color:#3c1d25;font-size:11px;font-weight:900;letter-spacing:.8px}',
    '#sh-banner-event .she-info{margin:19px 0 14px;text-align:center}',
    '#sh-banner-event .she-info b{display:block;font-size:17px;color:#ffe79f}',
    '#sh-banner-event .she-info p{font-size:12px;line-height:1.55;color:#efdbec;white-space:pre-wrap}',
    '#sh-banner-event .she-box{margin:16px 0;border:1.5px solid #eab65b;border-radius:21px;'+
      'background:linear-gradient(155deg,#58255e,#281331 72%);'+
      'box-shadow:inset 0 2px 0 #ffeab52b,0 6px 0 #120b1f;padding:13px}',
    '#sh-banner-event .she-box h2{margin:1px 0 12px;color:#ffdda0;'+
      'font:900 20px Georgia,serif;text-align:center}',
    '#sh-banner-event .she-gifts{display:flex;gap:9px;overflow-x:auto;padding:5px 1px 10px}',
    '#sh-banner-event .she-gift{flex:0 0 100px;border-radius:14px;padding:9px 6px;'+
      'border:1px solid #e4bb72;background:#271a3c;text-align:center}',
    '#sh-banner-event .she-gift span{font-size:30px;display:block;margin:2px 0 5px}',
    '#sh-banner-event .she-gift b{display:block;word-break:break-word;font-size:11px;color:#fff}',
    '#sh-banner-event .she-gift small{font-size:11px;color:#fcd475}',
    '#sh-banner-event .she-top3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}',
    '#sh-banner-event .she-podium{min-width:0;text-align:center;border-radius:16px;padding:13px 5px;'+
      'background:linear-gradient(160deg,#74438c,#291834);border:1px solid #edbc61}',
    '#sh-banner-event .she-podium.first{border:2px solid #fff2b4;'+
      'background:linear-gradient(160deg,#aa6b39,#5b2646);box-shadow:0 0 18px #ffd37b36}',
    '#sh-banner-event .she-podium img{width:52px;height:52px;border-radius:50%;'+
      'border:2px solid #f0d07b;object-fit:cover;background:#3a2d49}',
    '#sh-banner-event .she-podium b{display:block;font-size:12px;overflow:hidden;'+
      'text-overflow:ellipsis;white-space:nowrap;color:#fff7df}',
    '#sh-banner-event .she-podium small{display:block;color:#f7cc84;font-size:11px;margin-top:4px}',
    '#sh-banner-event .she-entry{display:flex;align-items:center;gap:10px;padding:10px;'+
      'border-bottom:1px solid #f5d17e38}',
    '#sh-banner-event .she-entry img{width:37px;height:37px;object-fit:cover;'+
      'border-radius:50%;border:1px solid #d8b774}',
    '#sh-banner-event .she-entry strong{flex:1;min-width:0;overflow:hidden;'+
      'text-overflow:ellipsis;white-space:nowrap;font-size:12px}',
    '#sh-banner-event .she-entry small{display:block;font-size:10px;font-weight:500}',
    '#sh-banner-event .she-entry em{font-size:12px;color:#ffdd80;font-style:normal;font-weight:900}',
    '#sh-banner-event .she-rewards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}',
    '#sh-banner-event .she-reward{border:1px solid #f7d07c;border-radius:14px;'+
      'padding:12px 9px;background:linear-gradient(140deg,#67356c,#321d47)}',
    '#sh-banner-event .she-reward b{display:block;color:#ffdb83;font-size:15px}',
    '#sh-banner-event .she-reward span{display:block;color:#fff;font-size:12px;'+
      'word-break:break-word;margin-top:5px}',
    '#sh-banner-event .she-foot{text-align:center;margin-top:18px;color:#e7d0e1;'+
      'font-size:11px;line-height:1.5}',
    '@media(max-width:360px){#sh-banner-event .she-wrap{padding:10px 8px 45px}'+
      '#sh-banner-event .she-podium img{width:43px;height:43px}}'
  ].join('');
  document.head.appendChild(eventRoyalStyle);

  window.showSharikaEvent=async function(eventId){
    if(!session){window.showAuth('welcome');return;}
    const id=Number(eventId);
    if(!Number.isSafeInteger(id)||id<1)return;
    document.getElementById('sh-banner-event')?.remove();
    const page=document.createElement('div');
    page.id='sh-banner-event';
    page.innerHTML='<div class="she-wrap"><div class="she-top">'+
      '<button type="button" class="she-back" aria-label="Back to home">‹</button>'+
      '<div class="she-brand">👑 Sharika Events</div></div>'+
      '<p style="text-align:center;padding:25px">Loading verified event…</p></div>';
    document.body.appendChild(page);
    const close=()=>{page.remove();};
    page.addEventListener('click',click=>{
      if(click.target.closest('.she-back'))close();
      const user=click.target.closest('[data-she-user]');
      if(user&&/^[0-9]{1,10}$/.test(user.dataset.sheUser||'')){
        const target=user.dataset.sheUser;
        close();window.openProfile?.({id:target});
      }
    });
    page.addEventListener('keydown',key=>{
      if((key.key==='Enter'||key.key===' ')&&key.target.closest('[data-she-user]')){
        key.preventDefault();key.target.click();
      }
    });
    let eventClock=null;
    try{
      const [eventResult,rankingResult,giftResult]=await Promise.all([
        api('GET','/events'),api('GET','/events/'+id+'/ranking'),api('GET','/gifts')]);
      if(!page.isConnected)return;
      const event=(eventResult.events||[]).find(e=>e.id===id&&e.published);
      if(!event){page.querySelector('.she-wrap').innerHTML='<button class="she-back">‹</button>'+
        '<p>This event is no longer available.</p>';return;}
      const rank=Array.isArray(rankingResult.ranking)?rankingResult.ranking:[];
      const gifts=Array.isArray(giftResult.gifts)?giftResult.gifts:[];
      const rankName=r=>r?sellerEscape(r.name):'Waiting for entries';
      const rankPicture=r=>{
        const url=verifiedAvatarUrl(r?.pic);
        return url?'<img src="'+sellerEscape(url)+'" alt="User portrait" loading="lazy">':
          '<span style="display:block;font-size:40px">👤</span>';
      };
      const status=event.status==='live'?'🔴 LIVE EVENT':event.status==='scheduled'?
        '⏰ UPCOMING':'🏁 COMPLETED';
      const banner=typeof event.banner_image_url==='string'&&
        /^\/api\/v1\/banners\/[1-9]\d*\/image\?v=[1-9]\d*$/.test(event.banner_image_url)?
        'https://sharika-api-staging.soverixnet.workers.dev'+event.banner_image_url:null;
      const date=iso=>new Date(iso).toLocaleString('en-US',{
        month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
      const start=date(event.starts_at),end=date(event.ends_at);
      const podium=[rank[1],rank[0],rank[2]].map((r,i)=>
        '<div class="she-podium'+(i===1?' first':'')+'"'+
        (r?' role="button" tabindex="0" data-she-user="'+sellerEscape(r.public_id)+'"':'')+'>'+
        '<div style="font-size:23px">'+['🥈','🥇','🥉'][i]+'</div>'+rankPicture(r)+
        '<b>'+rankName(r)+'</b><small>'+(r?'ID '+sellerEscape(r.public_id):'—')+'</small>'+
        '<small>'+(r?formatCompactCoins(r.points)+' points':'No score')+'</small></div>').join('');
      const allRanks=rank.map(r=>'<div class="she-entry" role="button" tabindex="0" '+
        'data-she-user="'+sellerEscape(r.public_id)+'"><b>#'+Number(r.rank)+'</b>'+
        rankPicture(r)+'<strong>'+sellerEscape(r.name)+
        '<small>ID '+sellerEscape(r.public_id)+' · '+Number(r.gift_count)+' gifts</small></strong>'+
        '<em>'+formatCompactCoins(r.points)+' pts</em></div>').join('');
      const rewardCards=Array.from({length:7},(_,i)=>{
        const coins=Number(event.prizes?.[i]||0);
        const label=String(event.reward_labels?.[i]||'').trim();
        return '<div class="she-reward"><b>'+['🥇','🥈','🥉','🏅','🏅','🏅','🏅'][i]+
          ' Top '+(i+1)+'</b><span>'+(coins?formatCompactCoins(coins)+' coins':'')+
          (coins&&label?' + ':'')+(label?sellerEscape(label):coins?'':'Reward not announced')+
          '</span></div>';
      }).join('');
      page.querySelector('.she-wrap').innerHTML='<div class="she-top">'+
        '<button type="button" class="she-back" aria-label="Back to home">‹</button>'+
        '<div class="she-brand">👑 Sharika Events</div></div>'+
        '<section class="she-hero'+(banner?' has-img':'')+'">'+
        (banner?'<img src="'+sellerEscape(banner)+'" alt="'+sellerEscape(event.title)+'">':'')+
        '<div class="she-title"><span class="she-status">'+status+'</span>'+
        '<h1>'+sellerEscape(event.title)+'</h1></div></section>'+
        '<div id="sh-ev-clock" style="margin:19px 0 0;text-align:center;font-weight:900;'+
        'color:#ffe5a1;font-size:17px" aria-live="off"></div>'+
        '<div class="she-info"><b>📆 '+sellerEscape(start)+' — '+sellerEscape(end)+'</b>'+
        '<p>'+sellerEscape(event.description||'Official Sharika event')+'</p></div>'+
        '<section class="she-box"><h2>🎁 Eligible Event Gifts</h2><div class="she-gifts">'+
        ((event.gift_rules||[]).length?event.gift_rules.map(rule=>{
          const gift=gifts.find(g=>Number(g.id)===Number(rule.gift_id));
          return '<div class="she-gift"><span>'+sellerEscape(gift?.emoji||'🎁')+'</span>'+
            '<b>'+sellerEscape(gift?.name||'Gift #'+rule.gift_id)+'</b>'+
            '<small>+'+formatCompactCoins(Number(rule.points))+' pts</small></div>';
        }).join(''):'<p>No eligible gifts have been announced.</p>')+'</div></section>'+
        '<section class="she-box"><h2>🏆 Event Champions</h2><div class="she-top3">'+podium+'</div>'+
        '<h2 style="margin-top:19px">📊 Event Ranking · Top 100</h2>'+
        (allRanks||'<p style="text-align:center">No verified event gifts sent yet.</p>')+
        '</section><section class="she-box"><h2>🎖️ Event Rewards · Top 1–7</h2>'+
        '<div class="she-rewards">'+rewardCards+'</div>'+
        ((event.awards||[]).length?'<h2 style="margin-top:17px">✅ Verified Previous Winners</h2>'+
          event.awards.map(a=>'<p style="margin:8px 0;padding:9px;background:#302045;'+
            'border-radius:12px;font-size:12px">Rank #'+Number(a.rank)+' · '+
            sellerEscape(a.name)+' · ID '+sellerEscape(a.public_id)+' · '+
            formatCompactCoins(a.coins)+' coins credited</p>').join(''):'')+'</section>'+
        '<p class="she-foot">Scores come only from server-settled selected gifts within the event window. '+
        'Reward labels are announcements, not automatic wallet or item grants. '+
        'After the event ends, administrators verify and issue eligible coin awards.</p>';
      const tick=()=>{
        const clock=page.querySelector('#sh-ev-clock');
        if(!clock?.isConnected){clearInterval(eventClock);return;}
        const now=Date.now();
        const endMs=Date.parse(event.ends_at),startMs=Date.parse(event.starts_at);
        const remaining=Math.max(0,Math.ceil(((now<startMs?startMs:endMs)-now)/1000));
        const d=Math.floor(remaining/86400),h=Math.floor(remaining%86400/3600);
        const m=Math.floor(remaining%3600/60),s=remaining%60;
        clock.textContent=now>=endMs?'🏁 This event has ended':
          (now<startMs?'⏳ Starts in ':'⏳ Ends in ')+d+'d '+h+'h '+
          String(m).padStart(2,'0')+'m '+String(s).padStart(2,'0')+'s';
      };
      tick();eventClock=setInterval(tick,1000);
    }catch(error){
      if(page.isConnected)page.querySelector('.she-wrap').innerHTML=
        '<button type="button" class="she-back">‹</button><p>Could not load event: '+
        sellerEscape(errText(error))+'</p>';
    }
  };

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
          '<span class="sh-day-coins">'+formatCompactCoins(coins)+'</span></div>';
      }).join('');
      const claim=data.claimed_today?
        '<button class="big" id="cl" disabled>✓ Today’s check-in claimed</button>':
        '<button class="big" id="cl">🪙 Claim '+formatCompactCoins(data.rewards?.[data.next_day-1])+' coins</button>';
      const tasks=(data.tasks||[]).filter(t=>['follow','gift'].includes(t.key)).map(t=>{
        const claimLabel=t.claimed?'Collected ✓':t.completed?'Claim':'Pending';
        return '<div class="sh-task-card"><span class="sh-task-icon">'+
          (t.key==='follow'?'🤝':'🎁')+'</span><div class="sh-task-text"><strong>'+
          sellerEscape(t.title)+'</strong><small>'+
          (t.claimed?'Today’s coins received':t.completed?'Completed · reward ready':'Complete this task to unlock')+
          ' · 🪙 '+formatCompactCoins(t.reward_coins)+'</small></div>'+
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
            (['🥇','🥈','🥉'][i]||'🏅')+' '+formatCompactCoins(coins)+' coins</span>':'').join(' ');
          const winners=(e.awards||[]).map(a=>'<div style="font-size:13px;padding:5px 0;'+
            'color:#d9ffdf">✓ Rank '+Number(a.rank)+' · '+sellerEscape(a.name)+
            ' (ID '+sellerEscape(a.public_id)+') received '+formatCompactCoins(a.coins)+
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
      '#sh-invite-page .sh-invite-royal-banner{position:relative;overflow:hidden;',
      'min-height:285px;border:2px solid #f8d57c;border-radius:24px;margin:2px 0 16px;',
      'background:#23083c url("main-profile-bg.jpg") center top/100% auto no-repeat;',
      'box-shadow:inset 0 0 0 3px #622a76,0 8px 19px #0a0414aa;',
      'display:flex;flex-direction:column;justify-content:flex-end;align-items:center;',
      'text-align:center;padding:15px 12px 17px}',
      '#sh-invite-page .sh-invite-chest{width:min(100%,245px);height:175px;',
      'display:flex;align-items:center;justify-content:center;',
      'filter:drop-shadow(0 7px 9px #1b0029aa)}',
      '#sh-invite-page .sh-invite-chest img{max-width:100%;max-height:100%;',
      'width:auto;height:auto;object-fit:contain;display:block}',
      '#sh-invite-page .sh-invite-royal-banner h2{font-size:clamp(23px,6vw,32px);',
      'line-height:1.1;margin:0;color:#ffefb1;text-shadow:0 3px 5px #260026,0 0 12px #e4ad55}',
      '#sh-invite-page .sh-invite-royal-banner p{margin:7px 0 0;font-size:12px;',
      'color:#fff1dc;text-shadow:0 1px 4px #16051c}',
      '#sh-invite-page .sh-invite-royal-banner .sh-invite-royal-mark{font-size:10px;',
      'color:#ffe08b;font-weight:900;letter-spacing:2px;margin-bottom:6px}',
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
      '#sh-invite-page [hidden]{display:none!important}',
      '#sh-invite-page .sh-invite-withdraw-trigger{display:block;width:100%;margin:12px 0 5px}',
      '#sh-invite-page .sh-invite-withdraw-hint{font-size:11px;color:#f0d9ff;',
      'line-height:1.5;text-align:center;margin:6px 2px 12px}',
      '#sh-invite-page .sh-invite-withdraw-form{margin:14px 0 0;padding:14px 12px;',
      'border:2px solid #e5b950;border-radius:19px;background:#240e41}',
      '#sh-invite-page .sh-invite-withdraw-form h3{text-align:center;',
      'font-size:16px;margin:0 0 9px;color:#ffe3a0}',
      '#sh-invite-page .sh-invite-withdraw-form label{display:block;font-size:12px;',
      'color:#f6e0ff;margin-top:8px}',
      '#sh-invite-page .sh-invite-withdraw-form .sh-invite-entry{margin:4px 0 8px}',
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
      '#sh-invite-newbie .sh-invite-welcome-art{width:min(100%,235px);height:auto;',
      'max-height:210px;object-fit:contain;margin:0 auto;display:block;',
      'filter:drop-shadow(0 7px 14px #10001bc7)}',
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
    clearIncomingInvite();
    await reloadWallet();
    return result;
  }
  function bindInviteRedeem(root){
    const button=root.querySelector('#sh-invite-redeem');
    const field=root.querySelector('#sh-invite-redeem-code');
    const status=root.querySelector('#sh-invite-redeem-status');
    if(!button||!field)return;
    if(deferredInviteCode&&!field.value)field.value=deferredInviteCode;
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
    const open=root.querySelector('#sh-invite-open-withdraw');
    const form=root.querySelector('#sh-invite-withdraw-form');
    if(open&&form){
      open.setAttribute('aria-expanded','false');
      open.onclick=()=>{
        if(open.disabled)return;
        const reveal=form.hidden;
        form.hidden=!reveal;
        open.setAttribute('aria-expanded',String(reveal));
        if(reveal){
          form.querySelector('input')?.focus({preventScroll:true});
          form.scrollIntoView({block:'nearest',behavior:'auto'});
        }
      };
      form.querySelector('#sh-invite-withdraw-cancel')?.addEventListener('click',()=>{
        form.hidden=true;
        open.setAttribute('aria-expanded','false');
        open.focus({preventScroll:true});
      });
    }
    const buttons=[...root.querySelectorAll('[data-sh-invite-withdraw]')];
    for(const button of buttons){
      button.onclick=async()=>{
        if(button.disabled||!form||form.hidden)return;
        const amount=Number(button.dataset.shInviteWithdraw);
        if(!Number.isSafeInteger(amount)||amount<1000)return;
        const status=root.querySelector('#sh-invite-withdraw-status');
        const getValue=id=>root.querySelector('#sh-withdraw-'+id)?.value.trim()||'';
        const bank_name=getValue('bank');
        const account_holder=getValue('holder');
        const account_number=getValue('number');
        const branch=getValue('branch');
        if(!bank_name||!account_holder||!account_number||!branch){
          if(status)status.textContent='Enter your bank, account holder, account number and branch first.';
          return;
        }
        for(const item of buttons)item.disabled=true;
        if(status)status.textContent='Submitting your $'+(amount/100)+' withdrawal request…';
        try{
          const result=await api('POST','/invites/withdrawals',{
            amount_cents:amount,request_id:nextWalletRequestId('invite-withdraw'),
            payout_method:'bank',bank_name,account_holder,account_number,branch
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
    await playModeReady;
    if(playStoreMode===true)return;
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
      '<img class="sh-invite-welcome-art" src="invite-royal-chest.webp" alt="">'+
      '<p>Welcome to Sharika! New members can unlock a one-time invite reward '+
      'through a verified friend.</p>'+
      '<div style="color:#ffe27b;font-size:28px;font-weight:900">🪙 '+
      Number(info.signup_invitee_reward||0).toLocaleString('en-US')+'</div>'+
      '<p>Total starting coins with a valid friend invite</p>'+
      '<div style="border:2px solid #ffe4a2;border-radius:19px;padding:10px;'+
      'background:#3d135c;margin:12px 0">'+
      '<div style="font-weight:900;color:#ffdf8c">🎁 FIRST RECHARGE CHEST</div>'+
      '<div style="font-size:23px;color:#fff6b7;font-weight:900">'+
      Number(info.recharge_coins_per_usd||500000).toLocaleString('en-US')+' + '+
      Math.floor(Number(info.recharge_coins_per_usd||500000)*
        Number(info.first_recharge_bonus_percent??40)/100).toLocaleString('en-US')+'</div>'+
      '<p>For the first verified $1-equivalent recharge, unlock '+
      Number(info.first_recharge_bonus_percent??40)+'% extra coins once.</p></div>'+
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
  async function showPlayInviteSheet(){
    if(!session){window.showAuth('welcome');return;}
    verifiedInviteStyles();
    document.getElementById('sh-invite-page')?.remove();
    const root=document.createElement('section');
    root.id='sh-invite-page';
    root.innerHTML='<div class="sh-invite-head">'+
      '<button class="sh-invite-back" type="button" aria-label="Close invites">‹</button>'+
      '<div><div class="sh-invite-kicker">✦ SHARIKA ✦</div><h1>👑 Virtual-only edition</h1></div></div>'+
      '<div class="sh-invite-panel">'+
      '<h2 class="sh-invite-title">No cash or referral rewards</h2>'+
      '<p class="sh-invite-sub">This edition does not provide invite bonuses, cash commissions, withdrawals or seller transfers. You can still enjoy social rooms and virtual gifts.</p></div>';
    document.body.append(root);
    root.querySelector('.sh-invite-back').onclick=()=>root.remove();
  }
  async function showVerifiedInviteSheet(){
    await playModeReady;
    if(playStoreMode===true)return showPlayInviteSheet();
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
      // Bind eligible existing accounts to their first official Android
      // installation before sharing; the server enforces uniqueness.
      let deviceStatus=null;
      try{deviceStatus=await api('POST','/invites/device',{});}catch(_){/* old client */}
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
      const withdrawalChoices=[...new Set((result.withdrawal_options_cents||[5000,10000])
        .map(Number).filter(n=>Number.isSafeInteger(n)&&n>=1000))].sort((a,b)=>a-b);
      const minimumWithdrawal=withdrawalChoices[0]||5000;
      const canWithdraw=!profile?.minor&&withdrawable>=minimumWithdrawal;
      const newUserBonus=Math.floor(Number(result.recharge_coins_per_usd||500000)*
        Number(result.first_recharge_bonus_percent||40)/100);
      const history=(result.referrals||[]).slice(0,50).map(r=>
        '<div class="sh-invite-rankrow"><span>✓</span><b>'+
        sellerEscape(r.name||'Member')+'<small>ID '+sellerEscape(r.public_id)+
        '</small></b><em>Joined</em></div>').join('');
      panel.innerHTML='<div class="sh-invite-royal-banner">'+
        '<div class="sh-invite-chest"><img src="invite-royal-chest.webp" alt=""></div>'+
        '<div class="sh-invite-royal-mark">✦ SHARIKA ROYAL INVITATION ✦</div>'+
        '<h2>Invite Friends<br>Earn Royal Rewards</h2>'+
        '<p>One friend · Two coin bonuses · Real reward tracking</p></div>'+
        '<h2 class="sh-invite-title">✨ Invite once, earn together</h2>'+
        '<p class="sh-invite-sub">Each eligible invite earns '+inviteReward+
        ' coins for you and '+newcomerReward+' coins for your friend. Your '+
        money(result.invite_usd_cents_per_verified_user??0)+
        ' cash earning is tracked as Pending until reviewed.</p>'+
        (deviceStatus&&!deviceStatus.invite_eligible?'<p class="sh-invite-alert">'+
        '⚠️ This device is not eligible for invitation earnings: '+
        sellerEscape(deviceStatus.reason||'verification required')+'</p>':'')+
        '<div class="sh-invite-rewards">'+
        '<div class="sh-invite-reward"><span>🪙</span><strong>'+inviteReward+
        '</strong><small>You get per invited friend</small></div>'+
        '<div class="sh-invite-reward"><span>💝</span><strong>'+newcomerReward+
        '</strong><small>Friend gets with valid invite</small></div>'+
        '<div class="sh-invite-reward"><span>💵</span><strong>'+
        money(result.invite_usd_cents_per_verified_user??0)+
        '</strong><small>USD per verified invite · review first</small></div></div>'+
        '<div class="sh-invite-code"><div><small>YOUR INVITE CODE</small>'+
        '<strong>'+sellerEscape(invite)+'</strong></div>'+
        '<button class="sh-invite-gold" id="sharika-copy-invite" type="button">COPY LINK</button></div>'+
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
        '<p class="sh-invite-sub">Earn '+
        money(result.invite_usd_cents_per_verified_user??0)+
        ' for each eligible first-device referral. Cash reward requires anti-fraud review.</p>'+
        '<div class="sh-invite-stats">'+
        '<div class="sh-invite-stat"><strong>'+money(cash.pending_cents)+
        '</strong><small>Pending review</small></div>'+
        '<div class="sh-invite-stat"><strong>'+money(withdrawable)+
        '</strong><small>Available to request</small></div></div>'+
        '<button type="button" id="sh-invite-open-withdraw" class="sh-invite-gold '+
        'sh-invite-withdraw-trigger" aria-controls="sh-invite-withdraw-form" '+
        (canWithdraw?'':'disabled')+'>Withdraw</button>'+
        '<p class="sh-invite-withdraw-hint">'+
        (profile?.minor?'Cash withdrawal is not available for minor accounts.':
        canWithdraw?'Choose an available amount after opening Withdraw.':
        'Withdraw unlocks at '+money(minimumWithdrawal)+
        ' approved USD. Your pending earnings are not withdrawable yet.')+'</p>'+
        '<div id="sh-invite-withdraw-form" class="sh-invite-withdraw-form" hidden>'+
        '<h3>🏦 Bank transfer request</h3>'+
        '<p class="sh-invite-sub">Your bank details are sent privately to the finance '+
        'admin after you submit a withdrawal request. Payout is manual.</p>'+
        '<label for="sh-withdraw-bank">Bank name</label>'+
        '<input id="sh-withdraw-bank" class="sh-invite-entry" maxlength="100" autocomplete="organization" placeholder="Bank name">'+
        '<label for="sh-withdraw-holder">Account holder name</label>'+
        '<input id="sh-withdraw-holder" class="sh-invite-entry" maxlength="100" autocomplete="name" placeholder="Name on bank account">'+
        '<label for="sh-withdraw-number">Bank account number</label>'+
        '<input id="sh-withdraw-number" class="sh-invite-entry" maxlength="40" inputmode="numeric" autocomplete="off" placeholder="Bank account number">'+
        '<label for="sh-withdraw-branch">Bank branch</label>'+
        '<input id="sh-withdraw-branch" class="sh-invite-entry" maxlength="100" autocomplete="off" placeholder="Bank branch">'+
        '<p class="sh-invite-sub">Select the amount to request:</p>'+
        '<div class="sh-invite-cash-grid">'+withdrawalChoices.map(amount=>
          '<button type="button" data-sh-invite-withdraw="'+amount+
          '" class="sh-invite-gold" '+
          (withdrawable<amount?'disabled':'')+'>Request '+money(amount)+'</button>'
        ).join('')+'</div>'+
        '<p id="sh-invite-withdraw-status" class="sh-invite-alert" role="status">'+
        'Requests are checked by finance before any manual bank transfer.</p>'+
        '<button type="button" class="sh-invite-gold" id="sh-invite-withdraw-cancel" '+
        'style="width:100%;margin-top:9px">Cancel</button></div>'+
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
        '<div class="sh-invite-rewards"><div class="sh-invite-reward"><span>💳</span><strong>'+
        fmt(result.recharge_coins_per_usd||500000)+'</strong><small>Recharge coins</small></div>'+
        '<div class="sh-invite-reward"><span>🎊</span><strong>'+fmt(newUserBonus)+
        '</strong><small>Bonus coins</small></div>'+
        '<div class="sh-invite-reward"><span>👑</span><strong>'+percent+
        '%</strong><small>Inviter recharge reward</small></div></div>'+
        '<p class="sh-invite-alert">First recharge is counted only after approved '+
        'seller or finance verification; seller self-recharges do not qualify.</p></div>'+
        '<h2 class="sh-invite-title">How invitation works</h2>'+
        '<div class="sh-invite-rule">① Share your personal HTTPS invitation link.</div>'+
        '<div class="sh-invite-rule">② Your friend opens the link and installs Sharika.</div>'+
        '<div class="sh-invite-rule">③ The link is connected automatically during signup. '+
        'No code entry is needed. Test APK users reopen the link after installing.</div>'+
        '<div class="sh-invite-rule">④ After verification, one-time referral rewards are '+
        'recorded in the actual coin wallets.</div>'+
        '<div class="sh-invite-rule">⑤ The inviter receives '+percent+
        '% of eligible verified recharge coins and '+
        money(result.invite_usd_cents_per_verified_user??0)+
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
        'per-referral USD earnings and have not been configured.</p></div>';
      root.querySelector('#sharika-copy-invite').onclick=async()=>{
        try{await native('copyInviteLink',{code:invite});toast('Invite link copied ✓');}
        catch(error){toast('Copy unavailable: '+errText(error));}
      };
      root.querySelector('#sharika-share-invite').onclick=async()=>{
        const text='Join me on Sharika Voice Chat! Open this invite link to create '+
          'your account without entering a code: '+PUBLIC_INVITE_URL+invite;
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
      // New rooms use the reference screenshot's 5 × 4 seat arrangement.
      // Existing rooms keep their server-stored owner-adjustable capacity.
      await api('POST','/rooms',{name,emoji:chosen?.textContent?.trim() || '🎙️',theme:'mid',seat_count:20});
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
      refreshMessagesBadge();
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
  async function openPrivateThread(publicId,name,displayId=publicId){
    if(!session){window.showAuth('welcome');return;}
    if(!/^[0-9]{8}$/.test(String(publicId))){toast('Invalid 8-digit user ID');return;}
    const epoch=++messageThreadEpoch;
    activePrivateId=String(publicId);canSendPrivate=false;
    clearMessageDraft();
    const guardedSend=document.getElementById('ts');if(guardedSend)guardedSend.disabled=true;
    document.getElementById('th')?.classList.add('on');
    document.getElementById('thn').textContent='💬 '+name+' · '+displayId;
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
    notificationBadges();
    if(!session){view.innerHTML='<div class="empty">Sign in to view your conversations.</div>';return;}
    view.innerHTML='<div class="chatrow" id="verified-support-chat">'+
      '<div class="av">🎧</div><div><b>Customer service</b>'+
      '<small>Verified Sharika support conversation</small></div><time>›</time></div>'+
      '<div class="row"><input class="field" id="find-user-id" inputmode="numeric" '+
      'maxlength="10" placeholder="Real or Special ID" aria-label="Find user by real or special ID">'+
      '<button class="btn" type="button" id="find-user-button">Find</button></div>'+
      '<div id="real-inbox">Loading messages…</div>';
    document.getElementById('verified-support-chat').onclick=openSupportThread;
    const find=async()=>{
      const value=document.getElementById('find-user-id').value.trim();
      if(!/^[0-9]{1,10}$/.test(value)){toast('Enter a 1–10 digit Sharika ID');return;}
      try{
        const user=await api('GET','/users/'+encodeURIComponent(value));
        await openPrivateThread(user.id,user.name,user.display_id||user.id);
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
      messageUnread=Number(inbox.unread_total)||0;
      notificationBadges();
      const byId=new Set(conv.map(c=>c.public_id));
      const rows=conv.map(c=>'<div class="chatrow" data-private-id="'+safeMessageHTML(c.public_id)+
        '" data-private-display="'+safeMessageHTML(c.display_id||c.public_id)+
        '" data-private-name="'+safeMessageHTML(c.name)+'"><div class="av">💬</div><div><b>'+
        safeMessageHTML(c.name)+'</b>'+(Number(c.unread_count)>0?
        '<span style="margin-left:6px;color:#f6d37f;font-weight:800">● '+Number(c.unread_count)+'</span>':'')+
        '<small>'+safeMessageHTML(c.last_body||'')+
        '</small></div><time>'+safeMessageHTML(c.display_id||c.public_id)+'</time></div>');
      for(const f of following){
        if(byId.has(f.public_id))continue;
        rows.push('<div class="chatrow" data-private-id="'+safeMessageHTML(f.public_id)+
          '" data-private-display="'+safeMessageHTML(f.display_id||f.public_id)+
          '" data-private-name="'+safeMessageHTML(f.name)+'"><div class="av">👤</div><div><b>'+
          safeMessageHTML(f.name)+'</b><small>'+(f.follows_me?'Mutual follow · Chat ready':
          'Following · Waiting for follow back')+'</small></div><time>'+
          safeMessageHTML(f.display_id||f.public_id)+'</time></div>');
      }
      for(const f of followers){
        if(known.has(f.public_id)||byId.has(f.public_id))continue;
        rows.push('<div class="chatrow" data-private-id="'+safeMessageHTML(f.public_id)+
          '" data-private-display="'+safeMessageHTML(f.display_id||f.public_id)+
          '" data-private-name="'+safeMessageHTML(f.name)+'"><div class="av">➕</div><div><b>'+
          safeMessageHTML(f.name)+'</b><small>Follows you · Follow back to chat</small></div><time>'+
          safeMessageHTML(f.display_id||f.public_id)+'</time></div>');
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
        if(row)openPrivateThread(row.dataset.privateId,row.dataset.privateName,
          row.dataset.privateDisplay||row.dataset.privateId);
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
    // One fixed-size positioning context for the verified photo and every
    // cosmetic overlay. Flex profile layouts must not shift the photo alone.
    '#pfo .sh-ranked-profile .pfh>.pavw{position:relative!important;',
    'display:block!important;flex:0 0 118px!important;width:118px!important;',
    'height:118px!important;min-width:118px!important;min-height:118px!important;',
    'max-width:118px!important;max-height:118px!important;',
    'box-sizing:border-box!important;margin-left:auto!important;margin-right:auto!important;',
    'isolation:isolate!important;overflow:visible!important}',
    '#pfo .sh-ranked-profile .pfh>.pavw .pav3{position:absolute!important;',
    'inset:0!important;width:100%!important;height:100%!important;',
    'margin:0!important;box-sizing:border-box!important;transform:none!important;',
    'z-index:2!important}',
    '#pfo .sh-ranked-profile .pfh>.pavw .pav3>.sh-verified-avatar-image{',
    'position:absolute!important;inset:0!important;width:100%!important;',
    'height:100%!important;max-width:100%!important;max-height:100%!important;',
    'display:block!important;object-fit:cover!important;',
    'object-position:center 32%!important;border-radius:50%!important;',
    'transform:none!important}',
    '#pfo .sh-ranked-profile .pfh .pavw>.sh-sovera-frame.fxr{',
    'position:absolute!important;top:50%!important;left:50%!important;',
    'right:auto!important;bottom:auto!important;transform:translate(-50%,-50%)!important;',
    'transform-origin:center center!important;background-position:center center!important}',
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
  // The selected Champions Podium theme is a separate, removable visual
  // layer. The original ranking buttons, server results and profiles remain.
  const royalRankingV2=document.createElement('link');
  royalRankingV2.rel='stylesheet';
  royalRankingV2.href='./royal-ranking-v2.css';
  document.head.appendChild(royalRankingV2);

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
        art.style.backgroundImage='url("'+cosmeticMedia(frame)+'")';
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
    root.querySelector('.sh-svip-public-badge')?.remove();
    const level=svipLevel(person.svip_level);
    if(level){const badge=makeSvipBadge(document,level,'sh-svip-public-badge');
      root.querySelector('.pfh h2')?.insertAdjacentElement('afterend',badge);}
    root.querySelector('.sh-royal-profile-effects')?.remove();
    root.querySelectorAll('.sh-layout-ornament').forEach(node=>node.remove());
    for(const [kind,item] of [
      ['medal',medalArt(person.medal_style)],
      ['tag',nameTagArt(person.name_tag_style)]
    ]){
      if(!item)continue;
      const ornament=document.createElement('div');
      ornament.className='sh-layout-ornament';
      ornament.dataset.shLayoutOrnament=kind;
      const img=document.createElement('img');
      img.src=cosmeticMedia(item);img.alt=item.name;
      ornament.appendChild(img);
      root.querySelector('.pfh')?.appendChild(ornament);
    }
    root.querySelector('.sh-neon-public-id')?.remove();
    const publicLabel=root.querySelector('.pfh .sh-royal-user-id')||
      root.querySelector('.pfh .meta span:first-child');
    if(publicLabel){
      publicLabel.classList.toggle('sh-neon-single-id',!!person.special_id);
      publicLabel.textContent='ID '+String(person.display_id||person.special_id||person.id);
    }
    applyProfileLayout('public',root);
    refreshGlobalProfileLayouts().catch(()=>{});
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
      '.sh-cp-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:12px 0}',
      '.sh-cp-tab{min-height:41px;border-radius:999px;border:2px solid #ffe5b1;color:#fff;font-size:12px;font-weight:900;background:linear-gradient(160deg,#9757d3,#5442bb 62%,#36246f);box-shadow:inset 0 2px #fff8,0 4px #17093e}',
      '.sh-cp-tab.active{color:#60334b;background:linear-gradient(160deg,#fff1b0,#ffb75b 70%,#d86d8d)}',
      '.sh-cp-timer{padding:9px 12px;text-align:center;color:#ffe0a9;font-weight:900;font-size:13px;letter-spacing:1px;border-radius:20px;background:#3e2570b8;margin:9px 0}',
      '.sh-cp-toplist{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0}',
      '.sh-cp-card{min-width:0;position:relative;border:2px solid #c7a8ff;border-radius:24px;padding:14px 7px 12px;text-align:center;background:radial-gradient(circle at 50% 0,#ffafd7ad,transparent 70%),linear-gradient(150deg,#6f47ac,#302364 65%,#2a1d57);box-shadow:inset 0 2px #fff9,0 8px 16px #140729b0}',
      '.sh-cp-card.champion{grid-column:1/-1;margin:3px 19px;border-color:#ffdd75;background:radial-gradient(circle at 50% 0,#fff0a5e0,transparent 65%),linear-gradient(150deg,#b44a92,#533296 70%,#2a1e66)}',
      '.sh-cp-rank-pill{display:inline-block;padding:4px 15px;margin-bottom:4px;border-radius:999px;background:linear-gradient(#ffe5ab,#e8953b);border:2px solid #fff4c2;color:#713134;font-weight:1000;font-size:14px;box-shadow:0 4px 6px #160b2f88}',
      '.sh-cp-card:not(.champion) .sh-cp-rank-pill{background:linear-gradient(#ffc7f5,#c95cad);color:#fff}',
      '.sh-cp-card .sh-bond-couple{grid-template-columns:minmax(0,1fr) 32px minmax(0,1fr)}',
      '.sh-cp-card .sh-bond-heart{font-size:25px}.sh-cp-card .sh-bond-avatar{width:50px;height:50px}',
      '.sh-cp-card.champion .sh-bond-avatar{width:70px;height:70px}',
      '.sh-cp-score{color:#ffebbd;font-size:12px;font-weight:900;margin:6px 0 0}',
      '.sh-cp-award{margin:10px 2px 0;padding:9px 7px;border:1px solid #fbe1aa9e;border-radius:13px;background:#251239b8;color:#ffebbd;text-align:center}',
      '.sh-cp-award strong{display:block;font-size:12px;line-height:1.35}',
      '.sh-cp-award small{display:block;margin-top:4px;color:#e8d0e8;font-size:10px;line-height:1.45;overflow-wrap:anywhere}',
      '.sh-cp-award.pending{border-color:#d5b7db66;background:#281c43a8}',
      '.sh-cp-reward-list{display:grid;gap:9px;margin:12px 0}',
      '.sh-cp-reward-item{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #f4c8fc;border-radius:18px;background:linear-gradient(110deg,#9a488b,#33226c)}',
      '.sh-cp-reward-item strong{display:block;color:#ffeaa2}.sh-cp-reward-item small{display:block;color:#f7dded;margin-top:3px}',
      '@media(prefers-reduced-motion:reduce){.sh-bond-heart{animation:none}}'
    ].join('');
    document.head.appendChild(sheet);
  }
  const bondFmt=n=>formatCompactCoins(n);
  let pendingBondInvite=null;
  function bondPerson(person,open=true){
    const button=document.createElement('button');button.type='button';button.className='sh-bond-person';
    const avatar=document.createElement('span');avatar.className='sh-bond-avatar';
    const img=verifiedAvatarUrl(person?.pic);
    if(img){const crop=document.createElement('span');crop.className='sh-bond-photo';
      const photo=document.createElement('img');photo.alt='';photo.src=img;
      crop.appendChild(photo);avatar.appendChild(crop);}
    else avatar.textContent='👤';
    const frame=frameArt(person?.frame_style);
    if(frame){const art=document.createElement('i');art.className='sh-sovera-frame';
      art.style.backgroundImage='url("'+cosmeticMedia(frame)+'")';avatar.appendChild(art);}
    const name=document.createElement('strong');name.textContent=person?.name||'No partner';
    const id=document.createElement('small');id.textContent=person?.id?
      'ID '+(person.display_id||person.id):'Awaiting invitation';
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
      input.inputMode='numeric';input.maxLength=10;
      input.placeholder='Enter member or Special ID';
      input.value=initialTarget?.display_id||initialTarget?.id||'';
      root.append(label,input);
      const frame=document.getElementById('rf')?.contentWindow;
      const suggestions=[...(frame?.seats||[])].filter(s=>s?.public_id&&s.public_id!==profile?.public_id);
      if(suggestions.length){
        const chooser=document.createElement('select');chooser.className='sh-bond-input';
        chooser.style.marginTop='7px';
        const blank=document.createElement('option');blank.value='';blank.textContent='Or choose a room member';
        chooser.appendChild(blank);
        for(const seat of suggestions){const option=document.createElement('option');
          option.value=seat.display_id||seat.public_id;
          option.textContent=seat.n+' · '+(seat.display_id||seat.public_id);
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
            const entered=input.value.trim();
            if(!/^[0-9]{1,10}$/.test(entered)){
              toast('Enter a valid member or Special ID');return;}
            send.disabled=true;
            try{
              // Resolve the visible alias to the immutable server account before
              // a financial transaction. Coin/gift idempotency stays canonical.
              const target=await api('GET','/users/'+entered);
              const id=String(target.id||'');
              if(!/^[0-9]{8}$/.test(id)||id===profile?.public_id)
                throw Error('Choose another member’s valid ID');
              const fingerprint=id+':'+gift.id;
              const requestId=pendingBondInvite?.fingerprint===fingerprint?
                pendingBondInvite.requestId:nextWalletRequestId('bond');
              pendingBondInvite={fingerprint,requestId};
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
  async function showBondRanking(type='cp',period='weekly',initialView='this'){
    bondStyles();
    window.openSheet('<h3>👑 Royal Relationship Ranking</h3><div class="sh-bond-sheet" id="sh-bond-rank">Loading ranking…</div>');
    const root=document.getElementById('sh-bond-rank');if(!root)return;
    let countdown=null;
    const render=async(kind,range,view='this')=>{
      if(countdown){clearInterval(countdown);countdown=null;}
      root.textContent='Loading verified pair ranking…';
      try{
        const weeklyCp=kind==='cp'&&range==='weekly';
        const board=weeklyCp?await api('GET','/bonds/rewards'):null;
        const result=(!weeklyCp||view==='this')?
          await api('GET','/bonds/rankings?type='+kind+'&period='+range):null;
        if(!root.isConnected)return;
        root.replaceChildren();
        const hero=document.createElement('div');hero.className='sh-bond-hero';
        hero.innerHTML='<div class="sh-bond-kicker">✦ ROYAL PAIR LEAGUE ✦</div>'+
          '<div class="sh-bond-title">'+(kind==='cp'?'👑 TOP CP':'🤝 Friendship Royalty')+'</div>'+
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
        if(weeklyCp){
          const tabs=document.createElement('div');tabs.className='sh-cp-tabs';
          for(const [mode,label] of [['this','This Week'],['last','Last Week'],['reward','🎁 Reward']]){
            const button=document.createElement('button');button.type='button';
            button.className='sh-cp-tab'+(mode===view?' active':'');button.textContent=label;
            button.setAttribute('aria-pressed',String(mode===view));
            button.onclick=()=>render(kind,range,mode);tabs.appendChild(button);
          }root.appendChild(tabs);
          if(view==='this'){
            const timer=document.createElement('div');timer.className='sh-cp-timer';
            timer.setAttribute('aria-label','Time until this CP ranking week ends');
            root.appendChild(timer);
            const skew=Number(board.server_time_ms)-Date.now();
            const tick=()=>{
              if(!timer.isConnected){clearInterval(countdown);countdown=null;return;}
              let left=Math.max(0,Math.floor((Number(board.next_reset_ms)-Date.now()-skew)/1000));
              const days=Math.floor(left/86400);left%=86400;
              const hours=Math.floor(left/3600);left%=3600;
              const minutes=Math.floor(left/60),seconds=left%60;
              timer.textContent='⏳ '+days+' Day · '+String(hours).padStart(2,'0')+' Hour · '+
                String(minutes).padStart(2,'0')+' Min · '+String(seconds).padStart(2,'0')+' Sec';
            };tick();countdown=setInterval(tick,1000);
          }
          if(view==='reward'){
            const status=document.createElement('p');status.className='sh-bond-muted';
            status.textContent=board.policy?.enabled?
              'Each partner receives the prize shown for their pair rank after the week is awarded.':
              'Rewards are not enabled yet. Super Admin will configure and activate them.';
            root.appendChild(status);
            const list=document.createElement('div');list.className='sh-cp-reward-list';
            for(const rule of board.rules||[]){
              const row=document.createElement('div');row.className='sh-cp-reward-item';
              const badge=document.createElement('span');badge.className='sh-cp-rank-pill';
              badge.textContent='TOP '+rule.rank;
              const info=document.createElement('div');
              const name=document.createElement('strong');name.textContent=
                '🪙 '+bondFmt(rule.coins_each)+' coins · each partner';
              const items=document.createElement('small');
              items.textContent='✨ '+(rule.frame_name||'No frame')+'  ·  🏅 '+
                (rule.medal_name||'No medal');
              info.append(name,items);row.append(badge,info);list.appendChild(row);
            }root.appendChild(list);return;
          }
          if(view==='last'){
            const status=document.createElement('p');status.className='sh-bond-muted';
            status.textContent=board.last_week?.awarded?
              '🏅 Verified award receipts · Last week’s prizes are paid and locked.':
              board.policy?.enabled?
                'Last week’s verified leaders · Prizes are not paid yet. Awaiting settlement.':
                'Last week’s verified leaders · Rewards are disabled; no prize has been paid.';
            root.appendChild(status);
          }
        }
        const leaders=weeklyCp&&view==='last'?(board.last_week?.leaders||[]):(result?.leaders||[]);
        if(!leaders.length){const empty=document.createElement('p');
          empty.className='sh-bond-muted';empty.textContent='No verified pairs have ranked in this period yet.';
          root.appendChild(empty);}
        if(weeklyCp&&leaders.length){
          const stage=document.createElement('div');stage.className='sh-cp-toplist';
          for(const pair of leaders.slice(0,7)){
            const card=document.createElement('div');card.className='sh-cp-card'+
              (pair.rank===1?' champion':'');
            const badge=document.createElement('div');badge.className='sh-cp-rank-pill';
            badge.textContent=pair.rank===1?'👑 TOP 1':'TOP '+pair.rank;
            const couple=document.createElement('div');couple.className='sh-bond-couple';
            couple.appendChild(bondPerson(pair.a));
            const heart=document.createElement('span');heart.className='sh-bond-heart';
            heart.textContent='💗';couple.appendChild(heart);
            couple.appendChild(bondPerson(pair.b));
            const score=document.createElement('p');score.className='sh-cp-score';
            score.textContent='🪙 '+bondFmt(pair.total)+' CP gift value';
            card.append(badge,couple,score);
            if(view==='last'){
              const paid=!!board.last_week?.awarded&&!!pair.reward;
              const award=document.createElement('div');
              award.className='sh-cp-award'+(paid?'':' pending');
              const reward=paid?pair.reward:null;
              const label=document.createElement('strong');
              label.textContent=paid&&reward?
                '✓ Awarded · '+bondFmt(reward.coins_each)+' coins each':
                '⏳ No prize awarded';
              const items=document.createElement('small');
              items.textContent=paid&&reward?
                'Frame: '+(reward.frame_name||'None')+' · Medal: '+
                  (reward.medal_name||'None'):
                'Ranking position only · Not a payment receipt';
              award.append(label,items);card.appendChild(award);
            }
            stage.appendChild(card);
          }root.appendChild(stage);
        }
        for(const pair of weeklyCp?leaders.slice(7):leaders){
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
    await render(type,period,initialView);
  }

  // SHARIKA_CP_HERO_20261107: show exactly the two verified, accepted CP identities.
  function mountRoyalCpHero(root,id,person,cp){
    const hero=root?.querySelector('.pfh');
    const original=hero?.querySelector('.pavw');
    const partner=cp?.partner;
    if(!hero||!original||!/^[0-9]{8}$/.test(String(partner?.id||''))||
       String(partner.id)===String(id))return false;
    const pair=document.createElement('section');
    pair.className='sh-royal-cp-profile-pair';
    pair.setAttribute('aria-label','Verified CP couple');
    const faces=document.createElement('div');faces.className='sh-royal-cp-faces';
    const owner=document.createElement('div');owner.className='sh-royal-cp-owner';
    owner.appendChild(original); // retain real avatar, frame, SVIP/medal ornaments
    const heart=document.createElement('span');heart.className='sh-royal-cp-heart';
    heart.textContent='💗';heart.setAttribute('aria-label','CP partner connection');
    const other=bondPerson(partner,true);other.classList.add('sh-royal-cp-partner');
    faces.append(owner,heart,other);
    // The profile's h2 is the only visible name: CP photos sit together
    // without repeating or exposing the other member's name in this header.
    pair.append(faces);
    hero.insertBefore(pair,hero.firstElementChild);
    root.querySelector('.pf')?.classList.add('sh-cp-linked');
    return true;
  }
  const publicCollections=[
    ['medal','Medals','🏅'],['vehicle','Vehicles','🏎️'],
    ['headwear','Frames','👑'],['gift','Gifts','🎁'],
    ['impression','Nameplates','✨']
  ];
  const publicSectionTitles={cp:'CP Partners',friends:'Friendship Palace',followers:'Followers',
    following:'Following',supporters:'Top Supporters',medal:'Medals',
    vehicle:'Vehicles & Entry Effects',headwear:'Frames & Headwear',
    gift:'Received Gifts',impression:'Nameplates & Impressions'};
  const publicEmpty={friends:'No accepted friendship gifts yet.',
    followers:'No followers yet.',following:'No followed members yet.',
    supporters:'No verified gifts received yet.',gift:'No received gifts yet.'};
  const showcaseImage=value=>{
    const src=String(value||'');
    return /^https:\/\/sharika-api-staging\.soverixnet\.workers\.dev\/api\/v1\/media\/[a-zA-Z0-9/_?=&.-]+$/.test(src)?src:null;
  };
  function royalShowcaseTile(item,section){
    const personSection=['friends','followers','following','supporters'].includes(section);
    const tile=document.createElement(personSection?'button':'div');
    tile.className='sh-public-collection-tile'+(personSection?' sh-public-person':'');
    if(personSection){
      tile.type='button';
      const circle=document.createElement('div');circle.className='sh-public-collection-avatar';
      const image=verifiedAvatarUrl(item.pic);
      if(image){const img=document.createElement('img');img.src=image;img.alt='';circle.appendChild(img);}
      else circle.textContent='👤';
      const info=document.createElement('span');info.className='sh-public-item-info';
      const name=document.createElement('strong');name.textContent=item.name||'Sharika member';
      const id=document.createElement('small');id.textContent='ID '+item.display_id;
      info.append(name,id);
      if(section==='supporters'){
        const amt=document.createElement('small');
        amt.textContent='🪙 '+bondFmt(item.coins)+' · '+bondFmt(item.quantity)+' gifts';
        info.appendChild(amt);
      }
      tile.append(circle,info);
      tile.onclick=()=>openVerifiedRankProfile(item.id);
    }else{
      const visual=document.createElement('div');visual.className='sh-public-item-image';
      const source=showcaseImage(item.image_url);
      if(source){const img=document.createElement('img');img.src=source;img.alt='';visual.appendChild(img);}
      else{
        const art=section==='medal'?medalArt(item.art_key):
          section==='headwear'?frameArt(item.art_key):
          section==='impression'?nameTagArt(item.art_key):null;
        const fallback=art?cosmeticMedia(art):null;
        if(fallback){const img=document.createElement('img');img.src=fallback;img.alt='';visual.appendChild(img);}
        else visual.textContent=section==='gift'?(item.emoji||'🎁'):
          section==='vehicle'?'🏎️':section==='medal'?'🏅':
          section==='headwear'?'👑':'✨';
      }
      const name=document.createElement('strong');name.textContent=item.name||'Sharika collectible';
      const state=document.createElement('small');
      if(section==='gift')state.textContent='× '+bondFmt(item.quantity)+' · 🪙'+bondFmt(item.coins);
      else state.textContent=item.expired?'Expired · '+(item.source||'owned'):
        (item.source==='purchase'?'Purchased':item.source==='admin_grant'?'Granted / free':'Owned')+
        (item.expires_at_ms?' · Until '+new Date(item.expires_at_ms).toLocaleDateString():'');
      tile.append(visual,name,state);
    }
    return tile;
  }
  async function readRoyalShowcase(id,section,offset=0){
    return api('GET','/users/'+id+'/showcase?section='+section+'&offset='+offset);
  }
  function openRoyalProfileMore(root,id,section,cpData){
    const home=root.querySelector('.pf.sh-ranked-profile');
    if(!home||!publicSectionTitles[section])return;
    root.querySelector('.sh-public-more-view')?.remove();
    home.hidden=true;
    const view=document.createElement('section');view.className='sh-public-more-view';
    const bar=document.createElement('div');bar.className='sh-public-more-header';
    const back=document.createElement('button');back.type='button';back.textContent='‹ Back';
    back.onclick=()=>{view.remove();home.hidden=false;document.getElementById('pfo').scrollTop=0;};
    const title=document.createElement('strong');title.textContent=publicSectionTitles[section];
    bar.append(back,title);
    const list=document.createElement('div');
    list.className=['friends','followers','following','supporters'].includes(section)?
      'sh-public-list-people':'sh-public-collection-grid';
    const status=document.createElement('p');status.className='sh-public-load-status';
    status.textContent='Loading verified profile items…';
    const more=document.createElement('button');more.className='sh-public-load-more';
    more.type='button';more.textContent='Load more';more.hidden=true;
    view.append(bar,list,status,more);root.appendChild(view);
    document.getElementById('pfo').scrollTop=0;
    if(section==='cp'){
      status.remove();
      const profilePerson=cpData?.person||{};
      const cpCard=document.createElement('section');cpCard.className='sh-public-showcase-card cp';
      const faces=document.createElement('div');faces.className='sh-public-cp-body';
      faces.appendChild(bondPerson({id,name:profilePerson.name,pic:profilePerson.pic,
        display_id:profilePerson.display_id,frame_style:profilePerson.frame_style},true));
      if(cpData?.cp?.partner){
        const heart=document.createElement('span');heart.className='sh-public-cp-heart';
        heart.textContent='💗';faces.append(heart,bondPerson(cpData.cp.partner,true));
        const date=document.createElement('p');date.className='sh-public-cp-date';
        date.textContent='Connected since '+new Date(cpData.cp.created_at_ms).toLocaleDateString();
        cpCard.append(faces,date);
      }else{
        faces.classList.add('single');cpCard.appendChild(faces);
        const empty=document.createElement('p');empty.className='sh-public-card-empty';
        empty.textContent='This member has no active CP partner.';cpCard.appendChild(empty);
      }
      list.replaceWith(cpCard);more.remove();return;
    }
    let offset=0,loading=false;
    const load=async()=>{
      if(loading)return;loading=true;more.disabled=true;
      try{
        const page=await readRoyalShowcase(id,section,offset);
        if(!view.isConnected)return;
        for(const item of page.items||[])list.appendChild(royalShowcaseTile(item,section));
        offset+=(page.items||[]).length;
        more.hidden=!page.has_more;
        status.textContent=offset?'Showing '+offset+' verified items':
          publicEmpty[section]||'No owned items in this collection yet.';
      }catch(error){if(view.isConnected)status.textContent='Unable to load: '+errText(error);}
      finally{loading=false;more.disabled=false;}
    };
    more.onclick=load;load();
  }
  async function mountRoyalProfileCollections(root,id,person,data,panel){
    const card=(title,theme,section)=>{
      const wrap=document.createElement('section');wrap.className='sh-public-showcase-card '+theme;
      const head=document.createElement('header');
      const heading=document.createElement('h3');heading.textContent=title;
      const more=document.createElement('button');more.type='button';more.textContent='More ›';
      more.onclick=()=>openRoyalProfileMore(root,id,section||'cp',
        section?null:{cp:data.cp,person});
      head.append(heading,more);wrap.appendChild(head);return wrap;
    };
    const cpCard=card('💗 CP Partners','cp');
    const cpBody=document.createElement('div');cpBody.className='sh-public-cp-body';
    const left=bondPerson({id,name:person.name,pic:person.pic,display_id:person.display_id,
      frame_style:person.frame_style},true);
    cpBody.appendChild(left);
    if(data.cp?.partner){
      const heart=document.createElement('span');heart.className='sh-public-cp-heart';
      heart.textContent='💗';cpBody.append(heart,bondPerson(data.cp.partner,true));
      const when=document.createElement('small');when.className='sh-public-cp-date';
      when.textContent='Together since '+new Date(data.cp.created_at_ms).toLocaleDateString();
      cpCard.append(cpBody,when);
    }else{
      cpBody.classList.add('single');cpCard.appendChild(cpBody);
      const empty=document.createElement('p');empty.className='sh-public-card-empty';
      empty.textContent='No CP linked · Your own picture stays visible.';
      cpCard.appendChild(empty);
    }
    panel.appendChild(cpCard);
    const friends=card('🤝 Friends','friends','friends');
    const friendPreview=document.createElement('div');friendPreview.className='sh-public-preview-faces';
    friends.appendChild(friendPreview);panel.appendChild(friends);
    const supporters=card('🏆 Top Supporters','supporters','supporters');
    const donors=document.createElement('div');donors.className='sh-public-preview-faces';
    supporters.appendChild(donors);panel.appendChild(supporters);
    for(const [section,container,max] of [['friends',friendPreview,4],['supporters',donors,5]]){
      try{
        const page=await readRoyalShowcase(id,section);
        if(!panel.isConnected)return;
        for(const [index,member] of (page.items||[]).slice(0,max).entries()){
          const personTile=royalShowcaseTile(member,section);
          personTile.classList.add('sh-public-preview-person');
          if(section==='supporters'){
            const badge=document.createElement('span');badge.className='sh-public-preview-rank';
            badge.textContent='#'+(index+1);personTile.prepend(badge);
          }
          container.appendChild(personTile);
        }
        if(!container.childElementCount){
          const empty=document.createElement('p');empty.className='sh-public-card-empty';
          empty.textContent=section==='friends'?'Friendship slots will appear here.':
            'People who send real gifts will appear here.';container.appendChild(empty);
        }
      }catch(error){if(container.isConnected)container.textContent='Unable to load verified '+section;}
    }
    const collection=document.createElement('section');collection.className='sh-public-collection';
    const title=document.createElement('h3');title.textContent='✦ Public Royal Collection';
    collection.appendChild(title);
    const tabs=document.createElement('div');tabs.className='sh-public-collection-tabs';
    const grid=document.createElement('div');grid.className='sh-public-collection-grid';
    const all=document.createElement('button');all.type='button';all.className='sh-public-view-all';
    all.textContent='View all ›';
    const empty=document.createElement('p');empty.className='sh-public-card-empty';
    let active='medal',serial=0;
    const load=async(section)=>{
      active=section;const ticket=++serial;
      for(const button of tabs.querySelectorAll('button'))
        button.classList.toggle('active',button.dataset.section===section);
      grid.textContent='';empty.textContent='Loading '+publicSectionTitles[section]+'…';
      all.onclick=()=>openRoyalProfileMore(root,id,section);
      try{
        const page=await readRoyalShowcase(id,section);
        if(ticket!==serial||!collection.isConnected)return;
        for(const item of (page.items||[]).slice(0,8))grid.appendChild(royalShowcaseTile(item,section));
        empty.textContent=grid.childElementCount?'':
          publicEmpty[section]||'No items earned or purchased in this category yet.';
      }catch(error){if(ticket===serial)empty.textContent='Collection unavailable: '+errText(error);}
    };
    for(const [section,label,emoji] of publicCollections){
      const tab=document.createElement('button');tab.type='button';tab.dataset.section=section;
      tab.textContent=emoji+' '+label;tab.onclick=()=>load(section);tabs.appendChild(tab);
    }
    collection.append(tabs,grid,empty,all);panel.appendChild(collection);
    load(active);
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
      intro.remove();
      paintRoyalPublicLevels(root,person,data);
      mountRoyalCpHero(root,id,person,data.cp);
      const followerLine=root.querySelector('.pfh .sh-royal-idline');
      if(followerLine&&!followerLine.querySelector('.sh-royal-follower-count')){
        const followers=document.createElement('span');
        followers.className='sh-royal-follower-count';
        followers.textContent=Number(data.followers||0).toLocaleString('en-US')+' Followers';
        followerLine.appendChild(followers);
      }
      const stats=document.createElement('div');stats.className='sh-bond-stats';
      for(const [value,label] of [
        [data.followers,'Followers'],[data.following,'Following'],[data.visitors,'Visitors'],
        [data.gifts_received,'Gifts received'],[data.gifts_sent,'Gifts sent'],
        [data.friendships?.length||0,'Friends']]){
        const stat=document.createElement('div');stat.className='sh-bond-stat';
        const count=document.createElement('strong');count.textContent=bondFmt(value);
        const text=document.createElement('span');text.textContent=label;
        stat.append(count,text);stats.appendChild(stat);
        const section=label==='Friends'?'friends':label==='Followers'?'followers':
          label==='Following'?'following':label==='Gifts received'?'gift':null;
        if(section){stat.tabIndex=0;stat.setAttribute('role','button');
          stat.onclick=()=>openRoyalProfileMore(root,id,section);
          stat.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){
            event.preventDefault();stat.click();}};}
      }panel.appendChild(stats);
      const giftTotals=document.createElement('p');giftTotals.className='sh-bond-muted';
      giftTotals.textContent='🎁 Received 🪙 '+bondFmt(data.gift_value_received)+
        '  ·  Sent 🪙 '+bondFmt(data.gift_value_sent);
      panel.appendChild(giftTotals);
      await mountRoyalProfileCollections(root,id,person,data,panel);
      const actions=document.createElement('div');actions.className='sh-bond-actions';
      const gift=document.createElement('button');gift.className='sh-bond-button';
      gift.textContent='🎁 CP / Friends Gifts';gift.onclick=()=>showBondGiftSheet(
        id===profile?.public_id?null:{id,display_id:person?.display_id,name:person?.name});
      // CP Ranking belongs in its dedicated ranking screen, not the public
      // profile action list. Keep CP gifts accessible for pairing.
      actions.append(gift);
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
    if(!/^[0-9]{1,10}$/.test(id)||!session){toast('Verified user ID unavailable');return;}
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
      if(String(person.id)!==id && String(person.special_id)!==id)
         throw new Error('Profile ID does not match');
       const canonicalId=String(person.id),displayId=String(person.display_id||person.id);
      const face=verifiedAvatarUrl(person.pic);
      const wealth=Math.max(0,Number(person.wealth_level)||0);
      const charm=Math.max(0,Number(person.charm_level)||0);
      root.innerHTML='<div class="pf sh-ranked-profile">'+
        '<div class="cov" aria-label="User profile cover photo">'+
        (canonicalId===profile?.public_id?'<button type="button" class="sh-public-cover-add" '+
          'aria-label="Change my profile background photo" title="Change cover photo">＋</button>':'')+
        '</div><div class="pfh"><div class="pavw">'+
        '<div class="pavr" style="--g1:#ffdc7b;--g2:#a06bff"></div>'+
        '<div class="pav3" id="sh-ranked-avatar" role="img" aria-label="Profile photo"></div>'+
        '</div><h2>'+sellerEscape(person.name||'User')+'</h2>'+
        '<div class="sh-royal-idline"><span class="sh-royal-user-id">ID: '+sellerEscape(displayId)+'</span>'+        (person.bd_active?'<span class="sh-royal-role-tag sh-royal-bd">✦ BD</span>':'')+        (person.seller_active?'<span class="sh-royal-role-tag sh-royal-seller">✦ Seller</span>':'')+        '</div><div class="meta">'+
        (person.country?'<span>🌍 '+sellerEscape(person.country)+'</span>':'')+
        (person.family?.status==='active'?'<span style="color:#f9d48b">👑 Agency · '+sellerEscape(person.family.name)+'</span>':'')+
        '</div></div><div class="lvs">'+
        '<div class="lvc w"><b>💰 Wealth level</b><div class="big3">'+
        wealth+'</div><small>Verified profile level</small></div>'+
        '<div class="lvc c"><b>💗 Charm level</b><div class="big3">'+
        charm+'</div><small>Verified profile level</small></div></div>'+
        '<div class="sh-profile-note">This is the real Sharika profile for ID '+sellerEscape(displayId)+
        '. Only server-verified details are shown.</div>'+
        (person.family?.status==='active'?'<div class="sh-profile-note" style="border:1px solid #cc9d4b;border-radius:14px;padding:12px">'+
          '👑 Agency · '+sellerEscape(person.family.name)+' · #'+sellerEscape(person.family.id)+
          '</div>':'')+
        '<div class="pbtn"><button id="sh-ranked-follow" type="button" disabled>'+
        'Loading follow status…</button></div>'+
        '</div>';
      const avatar=root.querySelector('#sh-ranked-avatar');
      if(face)avatar.style.backgroundImage='url("'+face+'")';
      else avatar.textContent='👤';
      const cover=root.querySelector('.cov');
      const savedCover=verifiedCoverUrl(person.cover);
      if(savedCover)cover.style.setProperty('background-image',
        'linear-gradient(180deg,#07131c24,#04110d70),url("'+savedCover+'")','important');
      const addCover=cover.querySelector('.sh-public-cover-add');
      if(addCover){
        addCover.onclick=async()=>{
          if(addCover.disabled)return;
          addCover.disabled=true;
          try{
            toast('Choose your new Sharika cover from the gallery…');
            const chosen=await native('pickProfilePhoto');
            if(requestNo!==rankProfileRequest||canonicalId!==profile?.public_id||
              !chosen?.image_data?.startsWith('data:image/jpeg;base64,'))
              throw new Error('Profile changed or picture was not selected');
            const saved=await api('PUT','/me/cover-image',{image_data:chosen.image_data});
            const newCover=verifiedCoverUrl(saved.cover);
            if(!newCover)throw new Error('Cover image could not be verified');
            profile.cover=saved.cover;
            if(requestNo===rankProfileRequest&&cover.isConnected)
              cover.style.setProperty('background-image',
                'linear-gradient(180deg,#07131c24,#04110d70),url("'+newCover+'")','important');
            toast('Profile background saved ✓');
          }catch(error){toast('Cover upload: '+errText(error));}
          finally{if(addCover.isConnected)addCover.disabled=false;}
        };
      }
      decorateVerifiedPublicProfile(root,person);
      paintRoyalPublicLevels(root,person,null);
      mountBondDetails(root,canonicalId,person).catch(error=>
        console.warn('Ranked ID bond details:',errText(error)));
      const follow=root.querySelector('#sh-ranked-follow');
      async function loadFollowing(){
        const data=await api('GET','/users/'+canonicalId+'/follow');
        if(requestNo!==rankProfileRequest||!follow.isConnected)return;
        const following=!!data.following;
        follow.disabled=false;
        follow.textContent=following?'✓ Following':'＋ Follow';
        follow.onclick=async()=>{
          follow.disabled=true;
          try{
            await api(following?'DELETE':'PUT','/users/'+canonicalId+'/follow');
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

  // Room seats, messages and member cards use the same verified D1 profile,
  // instead of the legacy HTML's fabricated "otherModel" profile identities.
  window.openProfile=function(member){
    const target=String(member?.id||member?.public_id||'');
    if(/^[0-9]{1,10}$/.test(target))return openVerifiedRankProfile(target);
    toast('This member has no verified Sharika ID yet');
  };

  function mountSharikaSearchAndCp(){
    const header=document.querySelector('#v-home .hd');
    const shortcuts=document.querySelector('#v-home .qa');
    if(!header||!shortcuts||document.getElementById('sh-search-button'))return;
    const search=document.createElement('button');
    search.id='sh-search-button';search.type='button';
    search.textContent='🔍';search.title='Find members and voice rooms';
    search.setAttribute('aria-label','Search members and rooms');
    header.appendChild(search);
    const cp=document.createElement('button');cp.id='sh-cp-home';cp.type='button';
    cp.innerHTML='<span class="home-icon hi-cp" aria-hidden="true"></span>CP';
    cp.onclick=()=>openSharikaCpCenter();shortcuts.appendChild(cp);
    const panel=document.createElement('section');panel.id='sh-global-search';
    panel.hidden=true;panel.setAttribute('aria-label','Search Sharika members and rooms');
    panel.innerHTML='<div class="sh-search-head"><button type="button" id="sh-search-back" '+
      'aria-label="Back to home">‹</button><strong>🔍 Search Sharika</strong></div>'+
      '<label for="sh-search-query">Member ID, Special ID, room ID or room name</label>'+
      '<div class="sh-search-form"><input id="sh-search-query" type="search" '+
      'maxlength="60" autocomplete="off" placeholder="Enter an ID or room name">'+
      '<button type="button" id="sh-search-submit">Find</button></div>'+
      '<p id="sh-search-status" role="status" aria-live="polite"></p>'+
      '<div id="sh-search-results"></div>';
    document.body.appendChild(panel);
    let searchRequest=0;
    const input=panel.querySelector('#sh-search-query');
    const status=panel.querySelector('#sh-search-status');
    const results=panel.querySelector('#sh-search-results');
    const close=()=>{searchRequest++;panel.hidden=true;};
    panel.querySelector('#sh-search-back').onclick=close;
    const open=()=>{
      if(!session){window.showAuth('welcome');return;}
      panel.hidden=false;status.textContent='Search verified Sharika accounts and rooms.';
      results.replaceChildren();input.focus();
    };
    window.sharikaOpenSearch=open;
    search.onclick=open;
    async function find(){
      const query=input.value.trim();
      const isId=/^[0-9]{1,10}$/.test(query);
      if((query.length<2&&!isId)||query.length>60){
        status.textContent='Enter a member ID or at least 2 room-name characters.';return;
      }
      const requestNo=++searchRequest;
      status.textContent='Searching verified records…';results.replaceChildren();
      // RFC 3986-encode the full query so the native API allowlist can safely
      // distinguish a search value from a new path or arbitrary parameter.
      const encodedQuery=encodeURIComponent(query).replace(/[!'()*]/g,
        char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
      const [roomsResult,userResult]=await Promise.allSettled([
        query.length>=2?api('GET','/rooms/search?q='+encodedQuery):
          Promise.resolve({rooms:[]}),
        isId?api('GET','/users/'+query):Promise.resolve(null)
      ]);
      if(requestNo!==searchRequest||panel.hidden)return;
      const user=userResult.status==='fulfilled'?userResult.value:null;
      const rooms=roomsResult.status==='fulfilled'&&Array.isArray(roomsResult.value?.rooms)?
        roomsResult.value.rooms:[];
      if(user&&/^[0-9]{8}$/.test(String(user.id||''))){
        const row=document.createElement('button');row.type='button';
        row.className='sh-search-result';
        row.textContent='👤 '+String(user.name||'Member')+' · ID '+
          String(user.display_id||user.id)+'  ›';
        row.onclick=()=>{close();openVerifiedRankProfile(user.id);};
        results.appendChild(row);
      }
      for(const room of rooms){
        const row=document.createElement('button');row.type='button';
        row.className='sh-search-result';
        row.textContent=String(room.emoji||'🎙️')+' '+String(room.name||'Voice room')+
          ' · Room '+String(room.id)+'  ›';
        row.onclick=()=>{
          close();const saved=(window.CFG?.rooms||[]).find(r=>r.id===room.id);
          window.openRoom(saved||{...room,th:room.theme||'mid',n:0,c:'#704220,#d5a460'});
        };results.appendChild(row);
      }
      status.textContent=roomsResult.status==='rejected'?
        'Room search unavailable: '+errText(roomsResult.reason):
        results.children.length?results.children.length+' verified result(s)':'No matching member or room found.';
    }
    panel.querySelector('#sh-search-submit').onclick=find;
    input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();find();}};
    panel.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();close();}
    });
  }
  function openSharikaCpCenter(){
    if(!session){window.showAuth('welcome');return;}
    const center=document.createElement('section');center.id='sh-cp-center';
    center.innerHTML='<div class="sh-cp-center-head"><button type="button" '+
      'aria-label="Back to home" id="sh-cp-back">‹</button><strong>💗 CP Palace</strong></div>'+
      '<p>Verified partners, gifts, invitations and weekly rankings</p>'+
      '<div class="sh-cp-center-actions"></div>';
    document.getElementById('sh-cp-center')?.remove();document.body.appendChild(center);
    const close=()=>center.remove();
    center.querySelector('#sh-cp-back').onclick=close;
    for(const [label,action] of [
      ['💞 My CP Profile',()=>window.go('me')],
      ['🏆 CP Ranking',()=>showBondRanking('cp','weekly')],
      ['🎁 CP Gifts',()=>showBondGiftSheet(null,'cp')],
      ['💌 CP Invitations',showBondInbox],
      ['🤝 Friendship Ranking',()=>showBondRanking('friendship','weekly')]
    ]){
      const button=document.createElement('button');button.type='button';
      button.textContent=label;button.onclick=()=>{close();action();};
      center.querySelector('.sh-cp-center-actions').appendChild(button);
    }
    center.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  }
  mountSharikaSearchAndCp();

  function ensureRoyalRankNavigation(rankView){
    if(!rankView||rankView.dataset.shRankReady==='true')return;
    const top=rankView.querySelector('.rtop');
    const originalTabs=rankView.querySelector('#rt');
    const periodTabs=rankView.querySelector('#rp');
    if(!top||!originalTabs||!periodTabs)return;
    const brand=document.createElement('div');
    brand.className='sh-rank-brand';
    const title=document.createElement('strong');
    title.className='sh-rank-brand-title';title.textContent='Sharika';
    const divider=document.createElement('span');divider.className='sh-rank-brand-divider';
    const sub=document.createElement('span');
    sub.className='sh-rank-brand-sub';sub.textContent='🏆 Rankings';
    brand.append(title,divider,sub);
    top.appendChild(brand);
    // Restore all seven original category controls in one visible grid.
    // Keep their original click handlers, indices and verified server data.
    originalTabs.classList.add('sh-rank-categories');
    originalTabs.setAttribute('aria-label','All ranking categories');
    ['🎰 Lucky','🎁 Rich','💗 Charm','🎙️ Room','👑 Noble','🎮 Games',
      '🪙 Recharge'].forEach((label,index)=>{
      const button=originalTabs.querySelectorAll('button')[index];
      if(button)button.textContent=label;
    });
    rankView.insertBefore(originalTabs,periodTabs);
    const periodRow=document.createElement('div');periodRow.className='sh-rank-period-row';
    rankView.insertBefore(periodRow,periodTabs);
    periodRow.appendChild(periodTabs);
    const reward=document.createElement('button');reward.type='button';
    reward.id='sh-rank-reward-box';reward.className='sh-rank-reward-entry';
    reward.setAttribute('aria-label','Open previous week winners and this week rewards');
    reward.title='Royal ranking rewards';reward.textContent='🏆';
    reward.onclick=()=>openRoyalRankingRewardCenter();
    periodRow.appendChild(reward);
    rankView.dataset.shRankReady='true';
  }
  function formatRoyalWeek(startAt,endAt){
    const start=new Date(startAt),end=new Date(new Date(endAt).getTime()-86400000);
    if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime()))
      return 'Verified UTC week';
    const options={month:'short',day:'numeric',timeZone:'UTC'};
    const left=start.toLocaleDateString('en-US',options);
    const right=end.toLocaleDateString('en-US',options);
    return left+' – '+right+', '+end.getUTCFullYear();
  }
  let rankingRequest=0;
  function openRoyalRankingRewardCenter(){
    if(playStoreMode!==false)return toast('Prize rankings are not available in this edition.');
    if(!session){window.showAuth('welcome');return;}
    const kinds={0:'lucky',1:'rich',2:'charm',3:'room',4:'noble',5:'games',6:'recharge'};
    const kind=kinds[window.rtab];
    document.getElementById('sh-rank-reward-center')?.remove();
    const center=document.createElement('section');center.id='sh-rank-reward-center';
    center.setAttribute('role','dialog');center.setAttribute('aria-modal','true');
    center.setAttribute('aria-label','Weekly ranking champions and rewards');
    center.innerHTML='<header class="sh-rw-header"><button type="button" '+
      'id="sh-rw-back" aria-label="Back to rankings">‹</button>'+
      '<div><strong>👑 Royal Rewards</strong><small>SHARIKA CHAMPIONS LEAGUE</small></div></header>'+
      '<div class="sh-rw-banner">LAST WEEK HONORARY CHAMPIONS</div>'+
      '<p class="sh-rw-week" id="sh-rw-week">Loading verified winners…</p>'+
      '<div class="sh-rw-podium" id="sh-rw-podium" aria-live="polite"></div>'+
      '<div class="sh-rw-banner sh-rw-banner-prizes">THIS WEEK TOP 1–7 REWARDS</div>'+
      '<p class="sh-rw-note" id="sh-rw-note">Checking official reward rules…</p>'+
      '<div id="sh-rw-rules" class="sh-rw-rules" aria-live="polite"></div>'+
      '<p class="sh-rw-disclaimer">Ranking positions are verified server results. '+
      'Prize previews are not payout receipts; no coins or items are granted by this screen.</p>';
    document.body.appendChild(center);
    const close=()=>center.remove();center.querySelector('#sh-rw-back').onclick=close;
    center.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
    const winners=center.querySelector('#sh-rw-podium');
    const rulesHost=center.querySelector('#sh-rw-rules');
    if(!kind){
      center.querySelector('#sh-rw-week').textContent=
        'This leaderboard has no verified weekly winner service yet.';
      center.querySelector('#sh-rw-note').textContent=
        'Reward rules are not available for this ranking category.';
      return;
    }
    // Two independent reads: historic winners and current announced benefits.
    // The previous-week endpoint must have ended before this UTC week began.
    Promise.all([
      api('GET','/rankings?period=weekly&kind='+kind),
      api('GET','/rankings?period=weekly&kind='+kind+'&week_offset=1')
    ]).then(([current,previous])=>{
      if(!center.isConnected)return;
      const end=Date.parse(previous.end_at||'');
      const start=Date.parse(current.start_at||'');
      if(!Number.isFinite(end)||!Number.isFinite(start)||end>start)
        throw Error('Previous-week ranking period could not be verified');
      const leaders=Array.isArray(previous.leaders)?previous.leaders.slice(0,3):[];
      center.querySelector('#sh-rw-week').textContent=
        formatRoyalWeek(previous.start_at,previous.end_at)+' · Verified Top '+leaders.length;
      if(!leaders.length){
        winners.textContent='No verified champions for the previous week.';return;
      }
      const isRoom=kind==='room';
      for(const leader of leaders){
        const rank=Number(leader.rank);
        if(![1,2,3].includes(rank))continue;
        const card=document.createElement('article');card.className='sh-rw-winner rank-'+rank;
        const label=document.createElement('span');label.className='sh-rw-place';
        label.textContent='WEEK TOP '+rank;
        const avatar=royalRankAvatar(leader,isRoom);
        const name=document.createElement('strong');name.textContent=leader.name||'Champion';
        const id=document.createElement('small');
        id.textContent='ID '+String(isRoom?leader.room_id:
          leader.display_id||leader.public_id||'');
        const score=document.createElement('b');
        score.textContent='🪙 '+formatCompactCoins(leader.total);
        card.append(label,avatar,name,id,score);
        royalRankAction(card,leader,isRoom);
        // Keep the real routing UID private; Special ID is the sole visible
        // identity outside Invite, including accessibility metadata.
        if(!isRoom&&card.hasAttribute('role')){
          delete card.dataset.rankUser;
          card.setAttribute('aria-label','Open profile for '+String(leader.name||'champion')+
            ', ID '+String(leader.display_id||leader.public_id||''));
        }
        if(!isRoom)card.addEventListener('click',close);
        winners.appendChild(card);
      }
    }).catch(error=>{
      if(center.isConnected)center.querySelector('#sh-rw-week').textContent=
        'Previous winners unavailable: '+errText(error);
    });
    api('GET','/rankings/rewards?kind='+kind).then(preview=>{
      if(!center.isConnected)return;
      const active=!!preview.policy?.enabled;
      const configured=(preview.rules||[]).some(r=>r.coins>0||
        r.frame_name||r.medal_name||r.entry_name);
      center.querySelector('#sh-rw-note').textContent=active&&configured?
        'Admin-published benefits for this week · display only; not yet a payout':
        'This category has no active prize announcement yet. Admin can configure Top 1–7.';
      const days=n=>n+' day'+(n===1?'':'s');
      for(const rule of preview.rules||[]){
        const article=document.createElement('article');article.className='sh-rw-reward-card';
        if(!active)article.classList.add('not-active');
        const title=document.createElement('h3');title.textContent='✦ WEEK TOP '+rule.rank;
        const details=document.createElement('div');details.className='sh-rw-reward-tiles';
        for(const prize of [
          {kind:'frame',heading:'Exclusive Frame',name:rule.frame_name,
            detail:rule.frame_name?days(rule.display_days):'Not configured'},
          {kind:'medal',heading:'Royal Medal',name:rule.medal_name,
            detail:rule.medal_name?days(rule.display_days):'Not configured'},
          {kind:'entry',heading:'Entry Effect',name:rule.entry_name,
            detail:rule.entry_name?days(rule.display_days):'Not configured'},
          {kind:'coins',heading:'Coins',name:rule.coins>0?formatCompactCoins(rule.coins):'',
            detail:rule.coins>0?formatCompactCoins(rule.coins)+' coins':'Not configured'}]){
          const tile=document.createElement('div');tile.className='sh-rw-prize';
          const art=document.createElement('span');
          art.className='sh-rw-prize-art '+prize.kind;art.setAttribute('aria-hidden','true');
          const heading=document.createElement('strong');heading.textContent=prize.heading;
          const name=document.createElement('b');name.textContent=active&&prize.name?prize.name:'—';
          const detail=document.createElement('small');
          detail.textContent=active?prize.detail:'Not active';
          tile.append(art,heading,name,detail);details.appendChild(tile);
        }
        article.append(title,details);rulesHost.appendChild(article);
      }
    }).catch(error=>{
      if(center.isConnected)center.querySelector('#sh-rw-note').textContent=
        'Reward rules unavailable: '+errText(error);
    });
  }
  window.sharikaOpenRoyalRankingRewards=openRoyalRankingRewardCenter;
  window.renderRank=async function(){
    const view=document.getElementById('rb');
    if(!view)return;
    const rankView=document.getElementById('v-rank');
    ensureRoyalRankNavigation(rankView);
    if(rankView&&!document.getElementById('wgb')){
      const weeklyButton=document.createElement('button');
      weeklyButton.id='wgb';
      weeklyButton.textContent='🏆';
      weeklyButton.title='Verified weekly leaders';
      weeklyButton.onclick=()=>openRoyalRankingRewardCenter();
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
      4:{kind:'noble',icon:'👑',title:'Noble',description:'Settled gifts sent by active Noble members'},
      5:{kind:'games',icon:'🎮',title:'Games',description:'Verified coin payouts from settled game wins'},
      6:{kind:'recharge',icon:'🪙',title:'Recharge',description:'Approved coin recharge totals'}
    };
    const period=periods[window.rper]||'weekly';
    const selected=categories[window.rtab];
    const kind=selected?.kind;
    view.innerHTML='<div class="sh-royal-empty">✦ Loading verified royal rankings…</div>';
    if(!selected){
      const name='This';
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
      const fmt=n=>formatCompactCoins(n);
      const hero=document.createElement('section');
      hero.className='sh-royal-hero';
      const kicker=document.createElement('div');
      kicker.className='sh-royal-kicker';
      kicker.textContent=selected.icon+' '+selected.title+' · SHARIKA ROYAL LEAGUE';
      const heading=document.createElement('h2');
      heading.className='sh-royal-title';
      heading.textContent=period==='weekly'?'Current Week Rankings':
        selected.title+' Champions';
      const description=document.createElement('p');
      description.className='sh-royal-sub';
      description.textContent='TOP CHAMPIONS · '+selected.description;
      hero.append(kicker,heading,description);
      const week=document.createElement('div');week.className='sh-rank-week';
      week.textContent='▣ '+formatRoyalWeek(data.start_at,data.end_at)+
        ' · '+period.toUpperCase()+' · UTC';
      hero.appendChild(week);
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
          id.textContent='ID '+String(isRoom?leader.room_id:
            leader.display_id||leader.public_id||'');
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
        row.querySelector('.sid').textContent=isRoom?leader.room_id:
          leader.display_id||leader.public_id;
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
    {id:'sovera-gaddy',name:'Sovera Gaddy Game',tag:'👑 New • Royal Food Wheel',
      image:'file:///android_asset/food-wheel-original-card.png',
      page:'file:///android_asset/original-games/sovera-gaddy-game.html'},
    {id:'sovera-food',name:'Sovera Food Wheel',tag:'🎡 Classic',
      image:'file:///android_asset/food-wheel-original-card.png',
      page:'file:///android_asset/original-games/sovera-food-wheel.html'},
    {id:'night-food',name:'Night Food Wheel',tag:'🌙 Night',
      image:'file:///android_asset/food-wheel-original-card.png',
      page:'file:///android_asset/original-games/night-food-wheel.html'},
    {id:'fruit-royale',name:'Fruit Royale',tag:'👑 New Royal Jackpot',
      image:'file:///android_asset/jackpot-fruit-original-card.png',
      page:'file:///android_asset/fruit-royale/index.html'},
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
      .filter(w=>w&&/^[0-9]{1,10}$/.test(String(w.public_id||''))&&
        typeof w.name==='string'&&w.name.trim()&&
        Number.isSafeInteger(Number(w.total_win))&&Number(w.total_win)>0):[];
    if(!winners.length||announcedOriginalGameRounds.get(game)===prev.round_no)return null;
    announcedOriginalGameRounds.set(game,prev.round_no);
    return {round_no:prev.round_no,winners};
  }
  let originalGameWalletRefreshTime=0;
  let gameCatalogRequestSequence=0;
  function originalGameFullscreenStyle(doc){
    if(doc.getElementById('sh-original-fullscreen-style'))return;
    const style=doc.createElement('style');
    style.id='sh-original-fullscreen-style';
    style.textContent=[
      '#shb.sh-original-fullscreen,#bg.sh-original-fullscreen{position:fixed!important;',
      'inset:0!important;width:100%!important;height:100%!important;',
      'z-index:2147482000!important;align-items:stretch!important;',
      'background:#100424!important;backdrop-filter:none!important}',
      '#shb.sh-original-fullscreen #sh,#bg.sh-original-fullscreen #sheet{',
      'display:flex!important;flex-direction:column!important;flex:1!important;',
      'width:100%!important;height:100%!important;max-height:none!important;',
      'min-height:0!important;overflow:hidden!important;margin:0!important;',
      'padding:calc(8px + env(safe-area-inset-top,0px)) 10px ',
      'calc(12px + env(safe-area-inset-bottom,0px))!important;',
      'border:0!important;border-radius:0!important;animation:none!important;',
      'transform:none!important;box-sizing:border-box!important}',
      '#sh-original-host{flex:1!important;min-height:0!important;height:auto!important;',
      'max-height:none!important;overflow:hidden!important}',
      '#sh.sh-game-catalog-sheet{height:auto!important;min-height:0!important;',
      'max-height:min(76dvh,650px)!important;overflow-y:auto!important}',
      '#sh-original-host iframe{width:100%!important;height:100%!important;',
      'border:0!important;display:block!important}',
      '#sh-original-back{flex:none;align-self:flex-start;min-height:40px}',
      '#sh-original-game-title{flex:none;font-size:17px;margin:8px 0!important;',
      'color:#ffe4a0;line-height:1.25}',
      '@media(prefers-reduced-motion:reduce){#sh-original-host *{animation:none!important}}'
    ].join('');
    doc.head.appendChild(style);
  }
  // A room game runs in the authenticated top-level WebView document.
  // A file:// game iframe nested under the room's srcdoc frame is unreliable
  // on Android, and a full-screen sheet hides the active voice room.
  function ensureRoomGamePortal(doc){
    let overlay=doc.getElementById('sh-room-game-overlay');
    if(!overlay){
      const style=doc.createElement('style');
      style.id='sh-room-game-style';
      style.textContent=[
        '#sh-room-game-overlay{position:fixed;inset:0;z-index:2147482100;',
        'display:none;align-items:flex-end;justify-content:center;',
        'padding:calc(3vh + env(safe-area-inset-top,0px)) 8px ',
        'calc(2vh + env(safe-area-inset-bottom,0px));',
        'box-sizing:border-box;background:#070216ae;backdrop-filter:blur(3px)}',
        '#sh-room-game-overlay.on{display:flex}',
        '#sh-room-game-sheet{position:relative;display:flex;flex-direction:column;',
        'box-sizing:border-box;width:min(96vw,480px);height:min(84dvh,720px);',
        'max-height:calc(100dvh - 58px);min-height:0;min-width:0;',
        'padding:8px 9px 10px;overflow:hidden;border-radius:22px;',
        'border:2px solid #edc16f;background:linear-gradient(155deg,#351362,#120625);',
        'box-shadow:inset 0 2px #fff5,0 16px 34px #000b;color:#fff}',
        '#sh-room-game-sheet h3{margin:2px 42px 6px 0;color:#ffdfa0;',
        'font-size:clamp(14px,4vw,17px);line-height:1.2}',
        '#sh-room-game-sheet #sh-original-grid{flex:1;min-height:0;',
        'max-height:none!important;overflow-y:auto!important}',
        '#sh-room-game-sheet #sh-original-host{flex:1;min-height:0;',
        'height:auto!important;overflow:hidden}',
        '#sh-room-game-sheet #sh-original-host iframe{display:block;',
        'width:100%!important;height:100%!important;border:0}',
        '#sh-room-game-close{position:absolute;top:9px;right:9px;',
        'z-index:2;min-width:36px;min-height:36px;border-radius:50%;',
        'border:1px solid #f5cb77;background:#49165d;color:#fff;',
        'font-size:21px;cursor:pointer}',
        '@media(max-height:570px){#sh-room-game-overlay{padding-top:14px;',
        'padding-bottom:calc(14px + env(safe-area-inset-bottom,0px))}',
        '#sh-room-game-sheet{height:calc(100dvh - 42px);max-height:none}}'
      ].join('');
      doc.head.appendChild(style);
      overlay=doc.createElement('div');
      overlay.id='sh-room-game-overlay';
      overlay.setAttribute('role','dialog');
      overlay.setAttribute('aria-label','Room mini games');
      const sheet=doc.createElement('section');
      sheet.id='sh-room-game-sheet';
      const close=doc.createElement('button');
      close.id='sh-room-game-close';
      close.type='button';
      close.textContent='×';
      close.setAttribute('aria-label','Close game and return to voice room');
      overlay.append(sheet,close);
      doc.body.appendChild(overlay);
      const closeGame=()=>{
        doc.defaultView.__sharikaOriginalGameCleanup?.();
        overlay.classList.remove('on');
      };
      close.onclick=closeGame;
      overlay.onclick=event=>{if(event.target===overlay)closeGame();};
      doc.defaultView.__sharikaRoomGameClose=closeGame;
    }
    return {overlay,sheet:doc.getElementById('sh-room-game-sheet')};
  }
  function showGameCard(doc,insideRoom,showToast){
    if(!session){window.showAuth('welcome');return;}
    if(playStoreMode===null){
      playModeReady.then(()=>showGameCard(doc,insideRoom,showToast));
      return;
    }
    const portal=insideRoom?ensureRoomGamePortal(doc):null;
    const sheet=portal?.sheet||doc.getElementById('sh');
    const overlay=portal?.overlay||doc.getElementById('shb');
    if(!sheet||!overlay){showToast('Game menu unavailable');return;}
    originalGameFullscreenStyle(doc);
    // Reuse the existing verified Greedy Wheel asset and server bridge.
    // Keep the other legacy game assets and ledgers intact; they are no longer
    // selectable in the only Games entry point.
    const greedyGame=originalGameCards.find(game=>game.id==='greedy-wheel');
    let visibleGameCards=[greedyGame];
    function catalog(){
      if(portal)sheet.style.height='';
      overlay.classList.remove('sh-original-fullscreen');
      sheet.innerHTML='<div class="grab"></div><h3>🎮 Sharika Royal Games</h3>'+
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));'+
        'gap:10px;padding:8px 1px 16px;max-height:70vh;overflow:auto" id="sh-original-grid"></div>'+
        '<p style="font-size:12px;opacity:.8;text-align:center;margin:3px 0">'+
        'Original graphics · live virtual-coin server rounds</p>';
      const grid=sheet.querySelector('#sh-original-grid');
      if(!visibleGameCards.length)grid.textContent='All games are currently disabled by Admin.';
      visibleGameCards.forEach(item=>{
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
        '#sh-verified-original-winners{position:fixed;top:42%;left:50%;width:min(82vw,560px);max-width:calc(100vw - 44px);z-index:2147483000;pointer-events:none;filter:drop-shadow(0 10px 18px #000b);animation:shWinSlide .42s cubic-bezier(.18,1.4,.36,1) both}',
        '#sh-verified-original-winners .sh-win-pill{position:relative;isolation:isolate;display:flex;align-items:center;gap:8px;min-height:62px;padding:6px 7px;border:2px solid #ffdf75;border-radius:46px;background:linear-gradient(110deg,#754018,#d59b37 52%,#542859);box-shadow:inset 0 2px 4px #ffffff66,inset 0 -5px 10px #65391799,0 0 12px #f7d46eaa;color:#fff}',
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
        '@keyframes shWinSlide{0%{transform:translate(-50%,-170%) scale(.88);opacity:0}65%{transform:translate(-50%,-46%) scale(1.03);opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}',
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
      const gameIcon=(game==='jackpot-fruit'||game==='fruit-royale')?'🎰':game==='night-food'?'🌙':'🎡';
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
        amount.textContent='🪙'+formatCompactCoins(winner.total_win);
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
        Math.min(9000,confirmed.winners.length*3000));
    }
    function preview(item){
      currentGameFrame=null;clearWinnerBanner();
      if(portal)sheet.style.height=insideRoom&&item.id==='sovera-gaddy'?'min(65dvh,650px)':'';
      sheet.classList.remove('sh-game-catalog-sheet');
      if(!insideRoom)overlay.classList.add('sh-original-fullscreen');
      // In the room the game itself is the focus: the main close button
      // returns to voice chat, so the extra All games row is unnecessary.
      sheet.innerHTML='<div class="grab"></div>'+
        (insideRoom?'':'<button id="sh-original-back" type="button" '+
          'style="padding:8px 14px;border:1px solid #d4af37;border-radius:10px;'+
          'background:#351164;color:#fff">← All games</button>')+
        '<h3 id="sh-original-game-title"></h3>'+
        '<div id="sh-original-host" style="width:100%;'+
        'min-height:0;border:1px solid #a56dff;border-radius:12px;'+
        'overflow:hidden;background:#100424"></div>';
      sheet.querySelector('h3').textContent=item.name;
      const returnToCatalog=sheet.querySelector('#sh-original-back');
      if(returnToCatalog)returnToCatalog.onclick=()=>{
        currentGameFrame=null;clearWinnerBanner();catalog();
      };
      const gameFrame=doc.createElement('iframe');
      // The fragment chooses responsive room-only CSS in the trusted asset.
      // It does not alter the authenticated bet or settlement bridge.
      gameFrame.src=item.page+(insideRoom&&item.id!=='greedy-wheel'?'#sharika-room':'');
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
          view.__sharikaOriginalGameCleanup?.();
          overlay.classList.remove('on');return;
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
        const query=data.action==='rankings'&&current.item.id!=='sovera-gaddy'&&data.query&&
          ['daily','weekly','monthly'].includes(data.query.period)&&
          ['totalWin','totalBet','profitLoss','winCount'].includes(data.query.metric)
          ?'?period='+data.query.period+'&metric='+data.query.metric:'';
        const result=await api(method,'/original-games/'+current.item.id+'/'+data.action+query,
          data.action==='bet'?data.body:undefined);
        // If the user changed games mid-request, do not send any data to it.
        if(!session||currentGameFrame!==current)return;
        target.postMessage({type:'sharika:original-response',id:data.id,ok:true,value:result},'*');
        if(data.action==='state'){
          announceRoundWinners(current.item.id,result);
          // A winning round credits D1 on state reads. Refresh the shared
          // profile/room wallet when its coin balance changes, not just on bets.
          const authoritativeCoins=Number.isSafeInteger(result?.coins)?result.coins:result?.balance;
          if(Number.isSafeInteger(authoritativeCoins)&&authoritativeCoins>=0&&
             authoritativeCoins!==balance.coins&&
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
    const hiddenObserver=new MutationObserver(()=>{
      if(!overlay.classList.contains('on'))view.__sharikaOriginalGameCleanup?.();
    });
    hiddenObserver.observe(overlay,{attributes:true,attributeFilter:['class']});
    view.__sharikaOriginalGameCleanup=()=>{
      hiddenObserver.disconnect();
      view.removeEventListener('message',onOriginalGameMessage);
      clearWinnerBanner();
      currentGameFrame?.element?.remove();
      currentGameFrame=null;
      overlay.classList.remove('sh-original-fullscreen');
      sheet.classList.remove('sh-game-catalog-sheet');
    };
    overlay.classList.add('on');
    if(playStoreMode===true){
      // The Play Worker and Android bridge independently allow only this one
      // non-cash-redeemable, server-settled game. The game is opened directly,
      // so the blocked Play catalog route is never requested.
      preview(greedyGame);
      return;
    }
    sheet.innerHTML='<div class="grab"></div><p style="padding:20px;text-align:center">Loading available games…</p>';
    const catalogRequestNo=++gameCatalogRequestSequence;
    api('GET','/game-catalog').then(result=>{
      if(catalogRequestNo!==gameCatalogRequestSequence||
         !overlay.classList.contains('on')||!sheet.isConnected)return;
      const enabled=new Set((result.games||[]).filter(g=>g.enabled).map(g=>g.id));
      visibleGameCards=[greedyGame].filter(game=>enabled.has(game.id));
      catalog();
    }).catch(error=>{
      if(catalogRequestNo!==gameCatalogRequestSequence||
         !overlay.classList.contains('on')||!sheet.isConnected)return;
      sheet.replaceChildren();
      const title=doc.createElement('h3');
      title.textContent='🎮 Sharika Games';
      const message=doc.createElement('p');
      message.setAttribute('role','alert');
      message.textContent='Games could not load: '+errText(error);
      const retry=doc.createElement('button');
      retry.type='button';
      retry.textContent='↻ Retry loading games';
      retry.style.cssText='margin:12px 0;padding:12px 16px;border:1px solid #e9ba50;'+
        'border-radius:12px;background:#37145b;color:#ffe5a3;font-weight:800';
      retry.onclick=()=>showGameCard(doc,insideRoom,showToast);
      sheet.append(title,message,retry);
    });
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
    const options=playStoreMode===false?[
      {kind:'recharge',title:'Top Recharge'},
      {kind:'charm',title:'Top Gift'},
      {kind:'room',title:'Top Room'}
    ]:[
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
            ' · ID '+(kind==='room'?item.room_id:item.display_id||item.public_id);
          const amount=document.createElement('em');
          amount.textContent='🪙 '+formatCompactCoins(item.total);
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
    select(playStoreMode===false?'recharge':'charm');
  };

  // Real Notifications inbox. Official notices/rewards/gifts/events are not chats.
  // Message badges count verified unread private messages only.
  let notificationPanel=null,notificationUnread=0,messageUnread=0,notificationPoll=null;
  const notificationIcons={official:'📣',event:'🎉',reward:'🏆',gift:'🎁',system:'🔔'};
  function notificationBadges(){
    for(const bell of document.querySelectorAll('.sh-notify-bell')){
      let badge=bell.querySelector('em');
      if(!badge){badge=document.createElement('em');bell.appendChild(badge);}
      badge.textContent=notificationUnread>99?'99+':String(notificationUnread);
      badge.hidden=!notificationUnread;
    }
    const badge=document.querySelector('.ni[data-v="msg"] em');
    if(badge){
      badge.style.display=messageUnread?'inline-flex':'none';
      badge.textContent=messageUnread>99?'99+':String(messageUnread);
    }
  }
  function notificationDate(value){
    if(!value)return '';
    const d=new Date(String(value).replace(' ','T')+'Z');
    return Number.isNaN(+d)?'':d.toLocaleString();
  }
  function buildNotificationUI(){
    if(notificationPanel)return;
    const style=document.createElement('style');
    style.textContent=[
      '.sh-notify-bell{position:relative;border:1px solid #e9c46b77;background:#221044;',
      'color:white;min-width:42px;min-height:42px;border-radius:14px;font-size:22px;',
      'box-shadow:0 3px 12px #0006;display:flex;align-items:center;justify-content:center}',
      '.sh-notify-bell em,.ni[data-v="msg"] em{position:absolute;top:-4px;right:-5px;',
      'min-width:19px;height:19px;border-radius:11px;align-items:center;justify-content:center;',
      'padding:0 4px;background:#ef3f72;color:white;font:700 11px system-ui;',
      'border:1px solid #ffeef6;box-sizing:border-box}',
      '.sh-notify-panel{display:none;position:absolute;inset:0;z-index:75;',
      'background:linear-gradient(165deg,#190b38,#080315);color:#fff;overflow-y:auto;',
      'padding:calc(16px + env(safe-area-inset-top,0px)) 16px 110px}',
      '.sh-notify-panel.on{display:block}.sh-notify-head{display:flex;gap:12px;',
      'align-items:center;justify-content:space-between;padding-bottom:15px}',
      '.sh-notify-head h2{font-size:20px;margin:0}.sh-notify-head p{font-size:12px;',
      'margin:4px 0 0;color:#c3b5de}.sh-notify-action{border:1px solid #e1bc6977;',
      'color:#fff;background:#3d236c;border-radius:12px;padding:9px 12px;font-size:13px}',
      '.sh-notify-list{display:grid;gap:10px;margin-top:12px}',
      '.sh-notify-card{display:flex;text-align:left;gap:12px;width:100%;',
      'border:1px solid #a986b645;background:#24134a;color:#fff;padding:15px 13px;',
      'border-radius:16px;align-items:start}.sh-notify-card.unread{',
      'border-color:#e7b95b;background:#33205a}',
      '.sh-notify-card b{display:block;font-size:14px}.sh-notify-card small{',
      'display:block;color:#e6dbf8;margin-top:6px;line-height:1.5}',
      '.sh-notify-card time{display:block;font-size:11px;color:#ad9ccc;margin-top:7px}',
      '.sh-notify-card .sh-type{font-size:23px}.sh-notify-empty{text-align:center;',
      'color:#cabce5;padding:45px 14px;line-height:1.6}'
    ].join('');
    document.head.appendChild(style);
    for(const view of ['#v-home .hd','#v-msg .hd']){
      const header=document.querySelector(view);
      if(!header)continue;
      const button=document.createElement('button');
      button.type='button';button.className='sh-notify-bell';
      button.setAttribute('aria-label','Notifications');
      button.textContent='🔔';button.onclick=showNotifications;
      header.appendChild(button);
    }
    notificationPanel=document.createElement('section');
    notificationPanel.className='sh-notify-panel';
    notificationPanel.setAttribute('aria-label','Notifications');
    notificationPanel.innerHTML='<div class="sh-notify-head">'+
      '<button class="sh-notify-action" type="button" id="sh-notify-back">‹ Back</button>'+
      '<div><h2>🔔 Notifications</h2><p>'+
      (playStoreMode===false?'Receipts · recharge · shop · Family · BD · official notices':
        'Gifts · friends · community updates · official notices')+'</p></div>'+
      '</div><div class="sh-notify-head">'+
      '<span id="sh-notify-unread"></span>'+
      '<button class="sh-notify-action" id="sh-notify-readall" type="button">Mark all as read</button>'+
      '</div><div style="margin:8px 0 14px">'+
      '<button class="sh-notify-action" id="sh-notify-enable" type="button">🔔 Enable phone alerts</button>'+ 
      '<button class="sh-notify-action" id="sh-notify-bonds" type="button" style="margin-left:7px">💌 CP / Friends Invitations</button>'+ 
      '</div><div class="sh-notify-list" id="sh-notify-list"></div>';
    document.getElementById('app').appendChild(notificationPanel);
    notificationPanel.querySelector('#sh-notify-back').onclick=()=>{
      notificationPanel.classList.remove('on');
    };
    notificationPanel.querySelector('#sh-notify-enable').onclick=async()=>{
      const enabled=await registerPushDevice(true);
      toast(enabled ? 'Phone alerts enabled' : 'Phone alerts not enabled. You can still use Sharika.');
    };
    notificationPanel.querySelector('#sh-notify-bonds').onclick=()=>{
      notificationPanel.classList.remove('on');
      showBondInbox();
    };
    notificationPanel.querySelector('#sh-notify-readall').onclick=async()=>{
      if(!session)return;
      try{
        await api('POST','/notifications/read-all',{});
        await refreshNotifications(true);
      }catch(error){toast('Unable to mark read: '+errText(error));}
    };
    notificationBadges();
  }
  async function refreshNotifications(render,beforeId=null){
    if(!session)return;
    try{
      const data=await api('GET',beforeId?'/notifications/history/'+beforeId:'/notifications');
      notificationUnread=Number(data.unread_count)||0;
      notificationBadges();
      if(render||notificationPanel?.classList.contains('on')){
        const list=document.getElementById('sh-notify-list');
        if(!list)return;
        const oldMore=list.querySelector('[data-notify-more]');
        if(oldMore)oldMore.remove();
        if(!beforeId)list.textContent='';
        const count=document.getElementById('sh-notify-unread');
        if(count)count.textContent=notificationUnread+' unread';
        if(!(data.notifications||[]).length&&!beforeId){
          const empty=document.createElement('div');
          empty.className='sh-notify-empty';
          empty.textContent='No notifications yet. Your purchase receipts, recharge history, Family and BD updates will appear here.';
          list.appendChild(empty);return;
        }
        for(const item of data.notifications||[]){
          const button=document.createElement('button');
          button.type='button';
          button.className='sh-notify-card'+(item.read_at?'':' unread');
          const icon=document.createElement('span');icon.className='sh-type';
          icon.textContent=notificationIcons[item.kind]||'🔔';
          const content=document.createElement('span');
          const title=document.createElement('b');title.textContent=item.title;
          const body=document.createElement('small');body.textContent=item.body;
          const date=document.createElement('time');
          date.textContent=notificationDate(item.created_at)+(item.read_at?'':' · New');
          content.append(title,body,date);button.append(icon,content);
          button.onclick=async()=>{
            if(!item.read_at){
              try{await api('PATCH','/notifications/'+item.id+'/read',{});await refreshNotifications(true);}
              catch(error){toast('Unable to mark read: '+errText(error));}
            }
            if(/^(CP|Friendship) invitation received$/.test(item.title)){
              notificationPanel?.classList.remove('on');
              await showBondInbox();
            }
          };
          list.appendChild(button);
        }
        if(Number.isSafeInteger(Number(data.next_before))&&Number(data.next_before)>0){
          const more=document.createElement('button');
          more.type='button';more.dataset.notifyMore='1';
          more.className='sh-notify-action';
          more.style.cssText='width:100%;margin-top:12px;padding:12px';
          more.textContent='View older notifications';
          more.onclick=()=>refreshNotifications(true,Number(data.next_before));
          list.appendChild(more);
        }
      }
    }catch(error){
      if(render&&notificationPanel?.classList.contains('on')){
        toast('Unable to load notifications: '+errText(error));
      }
    }
  }
  async function refreshMessagesBadge(){
    if(!session)return;
    try{
      const inbox=await api('GET','/messages');
      messageUnread=Number(inbox.unread_total)||0;
      notificationBadges();
    }catch(_){}
  }
  function showNotifications(){
    if(!session){window.showAuth('welcome');return;}
    buildNotificationUI();
    notificationPanel.classList.add('on');
    refreshNotifications(true);
  }
  buildNotificationUI();
  notificationPoll=setInterval(()=>{
    if(!session||document.visibilityState==='hidden')return;
    refreshNotifications(false);
    refreshMessagesBadge();
  },30000);
  async function registerPushDevice(promptPermission=false){
    if(!session)return false;
    try{
      // Startup asks only for an existing grant; the Android dialog opens
      // solely when a member taps Enable phone alerts in Notifications.
      const result=await native('pushToken',{promptPermission});
      if(!result?.token)return false;
      await api('POST','/notifications/devices',{token:result.token});
      return true;
    }catch(error){
      if(errText(error)!=='notification_permission_required')
        console.info('Push registration unavailable',errText(error));
      return false;
    }
  }

  const originalLogout=window.logout;
  window.logout=function(){
    ++authAttemptId;
    document.getElementById('sh-login-recovery')?.remove();
    document.getElementById('sh-opening')?.remove();
    document.getElementById('sp')?.classList.remove('sharika-opening-pending','sharika-opening-featured');
    if(window.cur)window.leaveRoom();
    if(presenceTimer){clearInterval(presenceTimer);presenceTimer=null;}
    document.getElementById('sh-invite-newbie')?.remove();
    document.getElementById('sh-invite-page')?.remove();
    session=null;profile=null;balance={coins:0,dia:0,xp:0};
    lastCelebrationId=0;celebrationFirstPoll=true;
    celebrationQueues.ticker.length=0;celebrationQueues.winner.length=0;
    document.getElementById('sh-global-marquee')?.remove();
    document.getElementById('sh-global-winner')?.remove();
    notificationUnread=0;messageUnread=0;notificationBadges();
    notificationPanel?.classList.remove('on');
    native('signOut').catch(()=>{});
    cleanLocalFakeState();
    originalLogout();
  };
  window.SharikaServer={api,reloadWallet,reloadRooms,connected:()=>!!session,voiceProvider:()=>voiceBackend};

  async function restore(){
    const attempt=++authAttemptId;
    let account=null;
    if(!session)cleanLocalFakeState();
    try{
      account=await native('session');
      if(attempt!==authAttemptId)return;
      await playModeReady;
      if(!account.signedIn || (!account.emailVerified && !playVirtualIdentityAllowed)) {
        document.getElementById('sh-login-recovery')?.remove();
        window.showAuth('welcome');
        if(account.signedIn)toast('Verify your email, then sign in');
        return;
      }
      const local=await authenticated(account,undefined,attempt);
      if(attempt!==authAttemptId)return;
      window.A=Object.assign({
        name:'Me',pic:null,myRoom:null,claim:{d:'',streak:0},
        st:{},sw:{},rw:{},fol:[]
      },local.p);
      if(typeof window.fixA==='function')window.fixA();
      try{localStorage.setItem('vr_sess',local.key);}catch(_){}
      window.saveA();
      document.getElementById('sh-login-recovery')?.remove();
      window.hideAuth();
      window.refresh();
      window.renderRooms();
      window.go('home');
    }catch(error){
      if(attempt===authAttemptId){
        // A Firebase/network error cannot invalidate the persisted login.
        showConnectionRecovery(error);
      }
    }finally{
      if(attempt===authAttemptId){
        if(!session)
          document.getElementById('sp')?.classList.remove('sharika-opening-pending');
        finishVerifiedStartup();
      }
    }
  }
  restore();
})();
