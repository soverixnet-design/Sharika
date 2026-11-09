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
        panel.append(balances,note,title,history,refresh);
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
  // Registered before the normal profile's capture listener, so Wallet and
  // its coin/diamond balance shortcuts cannot accidentally open Recharge.
  document.addEventListener('click',event=>{
    if(!event.target.closest?.('#v-me #wr,'+
       '#v-me [data-sh-profile-action="wallet"]'))return;
    event.preventDefault();event.stopImmediatePropagation();
    showPlayWallet();
  },true);

  // Friendly casual games for the Play edition: zero staking, no wallet
  // changes, no game API calls, no random payout, and no prize advertising.
  // The older coin-betting games remain unavailable in the Play build.
  window.sharikaOpenPlayCasualGames=function(doc,portal){
    const sheet=portal?.sheet||doc.getElementById('sh');
    const overlay=portal?.overlay||doc.getElementById('shb');
    if(!sheet||!overlay)return;
    let active=true,screen='menu';
    doc.defaultView.__sharikaOriginalGameCleanup=()=>{active=false;};
    overlay.classList.add('on');
    sheet.classList.remove('sh-original-fullscreen');
    sheet.style.overflowY='auto';
    const el=(tag,text,css='')=>{
      const node=doc.createElement(tag);node.textContent=text;
      if(css)node.style.cssText=css;
      return node;
    };
    const button=(text,fn)=>{
      const node=el('button',text,'padding:13px;border:1px solid #e7ba64;'+
        'border-radius:14px;background:#3c215e;color:#ffe1a2;'+
        'font-size:15px;font-weight:800;cursor:pointer;min-height:46px');
      node.type='button';node.onclick=fn;return node;
    };
    const container=()=>{
      sheet.replaceChildren();
      sheet.append(el('div','🎮 Sharika Fun Games',
        'font-size:20px;font-weight:900;color:#ffdb91;padding:10px 2px'),
        el('p','Free to play · No betting · No coin rewards',
          'font-size:12px;color:#e6d6f5;margin:4px 0 16px'));
      const content=el('div','','display:grid;gap:10px;padding:6px 1px 20px');
      sheet.append(content);return content;
    };
    function menu(){
      screen='menu';const content=container();
      content.append(button('💎 Royal Memory Match',memory),
        button('⚡ Quick Tap Challenge',quickTap),
        button('🧠 Brain Quiz',quiz));
      if(!portal)content.append(button('Close Games',()=>overlay.classList.remove('on')));
    }
    function back(content){content.append(button('← All Games',menu));}
    function memory(){
      screen='memory';const content=container();
      const status=el('p','Find four matching pairs.','font-size:14px');
      const grid=el('div','','display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px');
      const symbols=['👑','💎','🎤','🎁'];
      const deck=[...symbols,...symbols];
      for(let i=deck.length-1;i>0;i--){
        const j=Math.floor(Math.random()*(i+1));
        [deck[i],deck[j]]=[deck[j],deck[i]];
      }
      let first=-1,locked=false,pairs=0;
      const cards=deck.map((symbol,i)=>{
        const card=button('?',()=>{
          if(!active||screen!=='memory'||locked||card.disabled||first===i)return;
          card.textContent=symbol;
          if(first<0){first=i;return;}
          const previous=first;
          if(deck[previous]===symbol){
            cards[previous].disabled=true;card.disabled=true;
            first=-1;pairs++;
            status.textContent=pairs===4?'🎉 All four pairs matched!':
              'Pairs matched: '+pairs+'/4';
          }else{
            first=-1;locked=true;
            setTimeout(()=>{
              if(!active||screen!=='memory')return;
              cards[previous].textContent='?';card.textContent='?';locked=false;
            },650);
          }
        });
        card.style.fontSize='27px';card.style.minHeight='62px';return card;
      });
      grid.append(...cards);content.append(status,grid);back(content);
    }
    function quickTap(){
      screen='tap';const content=container();
      const status=el('p','Tap the crown 15 times as quickly as you can!',
        'font-size:14px');
      let taps=0,started=0;
      const tap=button('👑 Tap to start',()=>{
        if(!active||screen!=='tap'||taps>=15)return;
        if(!started)started=Date.now();
        taps++;
        status.textContent='Taps: '+taps+'/15';
        if(taps===15){
          status.textContent='🎉 Completed in '+
            ((Date.now()-started)/1000).toFixed(2)+' seconds!';
          tap.disabled=true;tap.textContent='Challenge complete';
        }else tap.textContent='👑 '+taps+'/15';
      });
      tap.style.minHeight='110px';tap.style.fontSize='24px';
      content.append(status,tap);back(content);
    }
    function quiz(){
      screen='quiz';const content=container();
      const questions=[
        ['What comes after 8?', ['7','9','10'],1],
        ['How many sides has a triangle?', ['3','4','5'],0],
        ['What is 6 + 7?', ['12','13','14'],1],
        ['Which is the largest?', ['15','51','5'],1],
        ['What is 20 - 8?', ['10','11','12'],2]
      ];
      let round=0,score=0;
      const question=el('p','','font-size:16px;font-weight:800');
      const answers=el('div','','display:grid;gap:8px');
      const next=()=>{
        answers.replaceChildren();
        if(round===questions.length){
          question.textContent='🎉 Quiz complete · '+score+'/'+questions.length;
          return;
        }
        const [prompt,choices,correct]=questions[round];
        question.textContent=(round+1)+'/5 · '+prompt;
        choices.forEach((choice,index)=>answers.append(button(choice,()=>{
          if(!active||screen!=='quiz')return;
          if(index===correct)score++;
          round++;next();
        })));
      };
      content.append(question,answers);back(content);next();
    }
    menu();
  };
})();
