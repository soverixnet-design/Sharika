/* Google Play Personal Account edition: presentation-only hardening.
 * The Android bridge and the isolated Cloudflare Worker independently reject
 * money movement; hiding a control is never a security boundary.
 * This asset is injected ONLY into the dedicated play-virtual release bundle.
 */
(function () {
  'use strict';
  document.documentElement.classList.add('sharika-play-virtual-only');
  const style=document.createElement('style');
  style.id='sharika-play-virtual-closed-loop-ui';
  style.textContent=[
    '#qi,#pc,#rcl2,#sharika-recharge-seller-wallet,',
    '[data-m="invite"],#sh-bd-entry,#sh-agency-entry,#sh-host-entry,',
    '#sh-open-host-statement,#sh-rank-reward-box,',
    '#rt button:nth-child(1),#rt button:nth-child(6),',
    '#rt button:nth-child(7){display:none!important}'
  ].join('');
  document.head.appendChild(style);
  // Royal recharge page: match the supplied gold/white reference while
  // keeping package prices and purchase verification owned by Google Play.
  const rechargeStyle=document.createElement('style');
  rechargeStyle.id='sh-play-royal-recharge-style';
  rechargeStyle.textContent=[
    '#sh-play-coin-shop{position:fixed;inset:0;z-index:2147483400;',
    'background:#f5f5f5;color:#2c2c2c;overflow:auto}',
    '#sh-play-coin-shop .sh-play-recharge-content{max-width:540px;min-height:100%;',
    'margin:auto;background:#f5f5f5}',
    '#sh-play-coin-shop .sh-play-recharge-hero{min-height:255px;padding:',
    'calc(12px + env(safe-area-inset-top,0px)) 18px 32px;',
    'background:linear-gradient(175deg,#ffe398,#ffba39 70%,#ff9800)}',
    '#sh-play-coin-shop .sh-play-recharge-nav{display:flex;align-items:center;',
    'justify-content:space-between;gap:8px;color:#fff}',
    '#sh-play-coin-shop .sh-play-recharge-nav button{width:42px;height:42px;',
    'border:0;background:transparent;color:#fff;font-size:34px}',
    '#sh-play-coin-shop .sh-play-recharge-nav h2{font-size:22px;margin:0;color:#fff}',
    '#sh-play-coin-shop .sh-play-recharge-nav span{font-size:13px;font-weight:700}',
    '#sh-play-coin-shop .sh-play-recharge-balance{min-height:130px;margin:27px 8px 0;',
    'padding:22px;border-radius:24px 24px 0 0;text-align:center;',
    'background:#fff8e9;box-shadow:0 -3px 0 #ffffff70}',
    '#sh-play-coin-shop .sh-play-recharge-balance small{display:block;',
    'font-size:14px;color:#ad771d;font-weight:700}',
    '#sh-play-coin-shop .sh-play-recharge-balance strong{display:block;',
    'font-size:32px;color:#ed8b00;margin:8px 0}',
    '#sh-play-coin-shop .sh-play-recharge-balance p{font-size:12px;',
    'color:#826e55;margin:0}',
    '#sh-play-coin-shop .sh-play-recharge-body{padding:22px 16px 38px}',
    '#sh-play-coin-shop .sh-play-payment-heading{display:flex;',
    'align-items:center;justify-content:space-between;gap:8px;margin-bottom:19px}',
    '#sh-play-coin-shop .sh-play-payment-heading h3{font-size:23px;',
    'font-weight:700;color:#343434;margin:0}',
    '#sh-play-coin-shop .sh-play-payment-heading span{border:1px solid #d3d3d3;',
    'border-radius:22px;padding:8px 11px;background:#fff;color:#454545;font-size:12px}',
    '#sh-play-coin-shop .sh-play-payment-card{padding:18px 12px 34px;',
    'border-radius:25px;background:white;min-height:285px}',
    '#sh-play-coin-shop .sh-play-payment-tabs{display:flex;align-items:center;',
    'justify-content:space-between;border-bottom:2px solid #ededed;',
    'padding:2px 8px 16px;margin-bottom:14px}',
    '#sh-play-coin-shop .sh-play-payment-tabs strong{font-size:22px;',
    'color:#a66800;border-bottom:5px solid #ffad00;padding-bottom:12px}',
    '#sh-play-coin-shop .sh-play-payment-tabs span{font-size:12px;color:#666}',
    '#sh-play-coin-shop .sh-play-coin-packages{display:grid;',
    'grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
    '#sh-play-coin-shop .sh-play-ticket{min-width:0;min-height:145px;',
    'border:2px solid #e3e3e3;border-radius:18px;overflow:hidden;',
    'background:#fff;color:#ed8900;display:flex;flex-direction:column;',
    'justify-content:space-between;padding:0;text-align:center;font-weight:800}',
    '#sh-play-coin-shop .sh-play-ticket-coins{display:grid;place-items:center;',
    'flex:1;padding:20px 9px;font-size:19px;overflow-wrap:anywhere}',
    '#sh-play-coin-shop .sh-play-ticket-price{display:block;width:100%;',
    'background:#e3e3e3;color:#df8500;padding:11px 5px;font-size:20px}',
    '#sh-play-coin-shop .sh-play-ticket:focus-visible{outline:3px solid #ffa900}',
    '#sh-play-coin-shop .sh-play-ticket:disabled{opacity:.65}',
    '#sh-play-coin-shop #sh-play-coin-status{min-height:24px;',
    'margin:13px 3px;color:#744a08;font-size:13px;line-height:1.5}',
    '#sh-play-coin-shop .sh-play-recharge-actions{display:grid;gap:10px;margin-top:20px}',
    '#sh-play-coin-shop .sh-play-recharge-actions button{width:100%;min-height:51px;',
    'border:0;border-radius:30px;background:#ff5b24;color:#fff;',
    'font-size:16px;font-weight:800}',
    '#sh-play-coin-shop .sh-play-recharge-actions button:first-child{',
    'background:#b87918}',
    '#sh-play-coin-shop .sh-play-billing-note{color:#6d6d6d;',
    'font-size:12px;line-height:1.6;text-align:center;margin:19px 7px}',
    '@media(max-width:345px){#sh-play-coin-shop .sh-play-ticket-coins{font-size:15px}',
    '#sh-play-coin-shop .sh-play-ticket-price{font-size:17px}}'
  ].join('');
  document.head.appendChild(rechargeStyle);

  // Restrict text changes to first-party navigation and headings. Never
  // alter user names, chat, gift messages, or server-generated notices.
  function renameButtonText(selector, oldLabel, newLabel) {
    for(const button of document.querySelectorAll(selector)) {
      const walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT);
      let node;
      while((node=walker.nextNode())) {
        if(node.nodeValue.trim()===oldLabel)
          node.nodeValue=node.nodeValue.replace(oldLabel,newLabel);
      }
    }
  }
  function update() {
    renameButtonText('#qr small,.top-recharge small','Recharge','Coins');
    renameButtonText('#v-me button[data-m="recharge"]','Recharge','Coins');
    const top=document.getElementById('qr');
    if(top&&top.title!=='Get virtual coins')top.title='Get virtual coins';
    const notification=document.querySelector('.sh-notify-head p');
    if(notification&&notification.textContent.includes('recharge'))
      notification.textContent='Gifts · friends · community updates · official notices';
  }
  let scheduled=false;
  function schedule() {
    if(scheduled)return;
    scheduled=true;
    queueMicrotask(()=>{scheduled=false;update();});
  }
  document.addEventListener('DOMContentLoaded',()=>{
    update();
    // The profile/ranking screens are rebuilt when a member navigates.
    // These narrowly scoped observers do not watch room chat traffic.
    for(const selector of ['#v-me','#v-rank','#v-msg']) {
      const host=document.querySelector(selector);
      if(host)new MutationObserver(schedule).observe(host,{childList:true,subtree:true});
    }
  },{once:true});

  // A Wallet tile must open the user's real, authenticated D1 balance, not
  // a disabled Play Billing catalogue. This is a read-only profile screen.
  const coins=n=>Number.isSafeInteger(Number(n))&&Number(n)>=0?
    Number(n).toLocaleString('en-US'):'0';
  function showPlayWallet(){
    if(!window.SharikaServer?.connected?.()){
      window.showAuth?.('welcome');return;
    }
    window.openSheet('<h3>🪙 My Wallet</h3>'+
      '<div id="sh-play-wallet" role="status" aria-live="polite">Loading verified balance…</div>');
    const panel=document.getElementById('sh-play-wallet');
    if(!panel)return;
    const card=(title,value)=>{
      const item=document.createElement('div');
      item.style.cssText='padding:14px;border:1px solid #d5aa64;border-radius:15px;'+
        'background:#3b2155;min-width:0;flex:1';
      const label=document.createElement('small');label.textContent=title;
      label.style.cssText='display:block;color:#e9d5ff;margin-bottom:6px';
      const number=document.createElement('strong');number.textContent=value;
      number.style.cssText='color:#ffe09f;font-size:clamp(17px,5vw,24px)';
      item.append(label,number);return item;
    };
    async function load(){
      panel.textContent='Loading verified wallet…';
      try{
        const wallet=await window.SharikaServer.api('GET','/wallet');
        if(!panel.isConnected)return;
        panel.replaceChildren();
        const balances=document.createElement('div');
        balances.style.cssText='display:flex;gap:8px;margin:12px 0';
        balances.append(card('🪙 Coins',coins(wallet.coins)),
          card('💎 Diamonds',coins(wallet.diamonds)));
        const note=document.createElement('p');
        note.textContent='These are your verified, non-redeemable virtual balances. '+
          'No cash withdrawal or external transfer is available.';
        note.style.cssText='font-size:12px;line-height:1.5;color:#e3cbea';
        const title=document.createElement('h4');
        title.textContent='Recent transactions';
        title.style.cssText='margin:16px 0 8px;color:#ffe09f';
        const history=document.createElement('div');
        history.style.cssText='max-height:36vh;overflow-y:auto';
        const rows=Array.isArray(wallet.ledger)?wallet.ledger.slice(0,30):[];
        if(!rows.length)history.textContent='No transactions yet.';
        for(const entry of rows){
          const row=document.createElement('div');
          row.style.cssText='padding:10px 4px;border-bottom:1px solid #ffffff2c;'+
            'display:flex;justify-content:space-between;gap:10px';
          const reason=document.createElement('span');
          reason.textContent=String(entry.reason||'Wallet update').slice(0,100);
          const amount=document.createElement('b');
          const delta=Number(entry.delta)||0;
          amount.textContent=(delta>0?'+':'')+delta.toLocaleString('en-US')+
            (entry.currency==='diamonds'?' ◆':' 🪙');
          amount.style.color=delta<0?'#ffb5bc':'#a7ffcb';
          row.append(reason,amount);history.append(row);
        }
        const refresh=document.createElement('button');
        refresh.type='button';refresh.textContent='↻ Refresh wallet';
        refresh.style.cssText='width:100%;padding:12px;margin:15px 0;'+
          'border-radius:13px;border:1px solid #f5d58b;'+
          'background:#5a3272;color:white;font-weight:800';
        refresh.onclick=load;
        const purchase=document.createElement('button');
        purchase.type='button';purchase.textContent='＋ Recharge with Google Play';
        purchase.style.cssText='width:100%;padding:14px;margin:9px 0;'+
          'border-radius:18px;border:1px solid #f6d38d;'+
          'background:#ed941e;color:#25142c;font-weight:900';
        purchase.onclick=()=>{window.closeSheet();window.rechargeSheet();};
        const exchange=document.createElement('button');
        exchange.type='button';exchange.textContent='◆ Diamond to Coin Exchange';
        exchange.style.cssText='width:100%;padding:12px;margin-bottom:5px;'+
          'border-radius:16px;border:1px solid #9879bf;'+
          'background:#5a3272;color:white;font-weight:800';
        exchange.onclick=()=>{window.closeSheet();window.rechargeSheet(1);};
        panel.append(balances,purchase,exchange,note,title,history,refresh);
      }catch(error){
        if(!panel.isConnected)return;
        panel.textContent='Wallet could not load: '+String(error?.message||error);
        const retry=document.createElement('button');
        retry.type='button';retry.textContent='Retry wallet';retry.onclick=load;
        panel.append(retry);
      }
    }
    load();
  }
  window.sharikaOpenPlayWallet=showPlayWallet;
  // Registered before the normal profile's capture listener, so Wallet and
  // its coin/diamond balance shortcuts cannot accidentally open Recharge.
  document.addEventListener('click',event=>{
    if(!event.target.closest?.('#v-me #wr,'+
       '#v-me [data-sh-profile-action="wallet"]'))return;
    event.preventDefault();event.stopImmediatePropagation();
    showPlayWallet();
  },true);

  // The sole Play game is the original Greedy Wheel, opened and authenticated
  // by staging-connection.js. Wallet is still read-only on this screen.
})();
