'use strict';
/* Server-authoritative UI for the owner-supplied Sovera food-wheel design.
 * Never receive a wallet token, invent a result, or credit local coins.
 * Authenticated Cloudflare requests travel through Sharika's parent bridge. */
(()=>{
  const GAME='sovera-gaddy';
  const ITEMS=[
    ['chicken','🍗',45],['fish','🐟',25],['hotdog','🌭',15],['steak','🥩',10],
    ['grapes','🍇',5],['lettuce','🥬',5],['pepper','🫑',5],['melon','🍉',5]
  ];
  const CHIPS=[50,500,2000,10000], CYCLE=30000, BET=20000,PAY=25000;
  const $=id=>document.getElementById(id);
  const format=n=>Math.max(0,Number(n)||0).toLocaleString('en-US');
  const icons=Object.fromEntries(ITEMS.map(x=>[x[0],x[1]]));
  icons.salad='🥗';icons.pizza='🍕';
  const host=window.parent;
  const pending=new Map(),pendingPicks=new Set(),uncertainBets=new Map();
  let seq=0,active=true,authorized=false,refreshing=false,selected=50,state=null;
  let lastServerSeenAt=0,lastRankingAt=0,rankingPromise=null,rankCache=null;
  let offset=0,roundNo=-1,shownResult=-1,lastPoll=0,lastSpin=-1;
  const slots=new Map();
  function alertMessage(message,ms=2300){
    const e=$('toast');e.textContent=message;e.classList.add('show');
    clearTimeout(alertMessage.timer);alertMessage.timer=setTimeout(()=>e.classList.remove('show'),ms);
  }
  function request(action,body){
    return new Promise((resolve,reject)=>{
      if(!active||host===window)return reject(new Error('Secure app connection unavailable'));
      const id=++seq,timer=setTimeout(()=>{
        pending.delete(id);reject(new Error('server_timeout'));
      },9000);
      pending.set(id,{resolve,reject,timer});
      host.postMessage({type:'sharika:original-request',id,game:GAME,
        action,method:action==='bet'?'POST':'GET',...(body?{body}:{})},'*');
    });
  }
  addEventListener('message',event=>{
    if(event.source!==host||!event.data||event.data.type!=='sharika:original-response')return;
    const data=event.data,p=pending.get(data.id);if(!p)return;
    clearTimeout(p.timer);pending.delete(data.id);
    if(data.ok)p.resolve(data.value);else p.reject(new Error(data.error||'server_unavailable'));
  });
  function exit(){active=false;for(const p of pending.values()){
    clearTimeout(p.timer);p.reject(new Error('game_closed'));
  }pending.clear();host.postMessage({type:'sharika:original-exit'},'*');}
  $('back').onclick=exit;
  const isRoom=location.hash==='#sharika-room';
  document.documentElement.classList.toggle('sharika-room-mini',isRoom);
  const wheel=$('wheel');
  ITEMS.forEach(([key,emoji,mult],i)=>{
    const angle=i*Math.PI/4-Math.PI/2,r=36;
    const button=document.createElement('button');button.className='slot';button.type='button';
    button.style.left=50+r*Math.cos(angle)+'%';button.style.top=50+r*Math.sin(angle)+'%';
    const image=document.createElement('span');image.className='e';image.textContent=emoji;
    const m=document.createElement('span');m.className='m';m.textContent='x'+mult;
    const amount=document.createElement('span');amount.className='b';amount.textContent='0';
    button.append(image,m,amount);button.dataset.pick=String(i);
    button.setAttribute('aria-label',`Bet on ${key}, multiplier ${mult}`);
    button.onclick=()=>place(i);
    const spoke=document.createElement('div');spoke.className='spoke';
    spoke.style.transform=`rotate(${i*45+180}deg)`;wheel.prepend(spoke);
    wheel.appendChild(button);slots.set(key,button);
  });
  CHIPS.forEach(c=>{
    const el=document.createElement('button');el.type='button';el.className='chip'+(c===selected?' sel':'');
    el.textContent=c>=1000?c/1000+'k':String(c);el.onclick=()=>{
      selected=c;document.querySelectorAll('.chip').forEach(x=>x.classList.toggle('sel',x===el));
    };$('chips').appendChild(el);
  });
  $('auto').style.display='none';$('mode').style.display='none';
  const rankCard=document.createElement('aside');
  rankCard.id='gaddy-bet-ranking';
  const rankHeader=document.createElement('div');rankHeader.className='gaddy-rank-head';
  const rankTitle=document.createElement('strong');rankTitle.textContent='🏆 DAILY BET RANKING';
  const viewRank=document.createElement('button');viewRank.type='button';
  viewRank.textContent='View all';viewRank.onclick=()=>$('rbtn').click();
  rankHeader.append(rankTitle,viewRank);
  const rankTop=document.createElement('ol');rankTop.id='gaddy-rank-top';
  const rankNote=document.createElement('small');rankNote.id='gaddy-rank-my';
  rankNote.textContent='Loading verified bets…';
  rankCard.append(rankHeader,rankTop,rankNote);$('stage').appendChild(rankCard);
  $('rbtn').title='Daily Bet Rankings';
  $('rbtn').setAttribute('aria-label','Open daily bet rankings');
  function hub(icon,label,count){
    $('big').textContent=icon;$('ht').textContent=label;
    $('tm').textContent=count===null?'':String(count);
  }
  function betsForRound(){
    const count=new Map();
    for(const b of state?.my_bets||[]){
      if(b.round_no!==state.round.round_no)continue;
      const name=ITEMS[b.pick_index]?.[0];if(name)count.set(name,(count.get(name)||0)+Number(b.amount));
    }
    return count;
  }
  function render(){
    if(!state)return;
    authorized=true;
    $('bal').textContent=format(state.coins);
    $('fnm').textContent=state.user?.name||'Sharika Player';
    $('fav').replaceChildren();
    const src=state.user?.avatar;
    if(typeof src==='string'&&/^https:\/\//.test(src)){
      const img=document.createElement('img');img.src=src;img.alt='';
      img.style.cssText='width:100%;height:100%;border-radius:50%;object-fit:cover';
      $('fav').appendChild(img);
    }else $('fav').textContent='👤';
    const counts=betsForRound();
    for(const [key,button] of slots)button.querySelector('.b').textContent=format(counts.get(key)||0);
    $('rn').textContent=Math.floor(((state.round.starts_ms+6*3600000)%86400000)/CYCLE)+1;
    const old=$('res');old.replaceChildren();
    const label=document.createElement('span');label.className='l';label.textContent='Server result:';old.appendChild(label);
    const results=[state.current_result?.item,state.previous_result?.item].filter(Boolean);
    results.forEach(name=>{
      const el=document.createElement('i');el.textContent=icons[name]||'🎡';old.appendChild(el);
    });
    $('rev').textContent=format(state.today_won);
  }
  async function refresh(){
    if(!active||refreshing)return;
    refreshing=true;
    try{
      const fresh=await request('state');
      if(!active||!fresh?.round||!fresh.virtual_coins_only)throw new Error('invalid_game_state');
      state=fresh;offset=Number(fresh.server_time)-Date.now();
      authorized=true;lastServerSeenAt=Date.now();
      for(const [pick,body] of uncertainBets){
        if((fresh.my_bets||[]).some(b=>b.request_id===body.request_id)){
          uncertainBets.delete(pick);
          alertMessage('Bet accepted ✓',1700);
        }else if(fresh.round.round_no>body.round_no+1){
          // Keep stale, unconfirmed requests from locking a food in later rounds.
          uncertainBets.delete(pick);
        }
      }
      render();
      if(Date.now()-lastRankingAt>20000)refreshBetRanking();
    }catch(error){
      // One slow read must not disable every betting cell during an active round.
      if(Date.now()-lastServerSeenAt>10000){
        authorized=false;alertMessage('Connection lost. Reconnecting…',2200);
      }
    }finally{refreshing=false;}
  }
  function requestId(){
    if(!crypto?.getRandomValues)throw new Error('secure_request_unavailable');
    return 'gaddy:'+Array.from(crypto.getRandomValues(new Uint8Array(16)),
      x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function place(pick){
    if(!authorized||!state)return alertMessage('Connecting to game server…');
    if(pendingPicks.has(pick))return alertMessage('Placing your bet…',900);
    const phase=(Date.now()+offset-state.round.starts_ms)%CYCLE;
    const previous=uncertainBets.get(pick);
    const existing=previous?.round_no===state.round.round_no?previous:null;
    if(previous&&!existing)uncertainBets.delete(pick);
    if(!existing&&phase>=BET)return alertMessage('Betting is closed');
    if(!existing&&state.coins<selected)return alertMessage('Insufficient coins');
    const body=existing||{round_no:state.round.round_no,pick,amount:selected,request_id:requestId()};
    pendingPicks.add(pick);
    const tile=slots.get(ITEMS[pick][0]);
    tile?.classList.add('pending');
    alertMessage(existing?'Checking previous bet…':'Placing your bet…',950);
    let timedOut=false;
    try{
      let receipt;
      try{receipt=await request('bet',body);}catch(error){
        // Retry the same idempotency key; never debit twice after a timeout.
        if(error.message!=='server_timeout')throw error;
        timedOut=true;alertMessage('Connection slow — retrying safely…',1700);
        receipt=await request('bet',body);
      }
      if(!receipt||!Number.isSafeInteger(receipt.coins))throw new Error('invalid_bet_receipt');
      uncertainBets.delete(pick);
      state.coins=receipt.coins;
      if(!(state.my_bets||[]).some(x=>x.request_id===body.request_id))
        state.my_bets=[...(state.my_bets||[]),{round_no:body.round_no,
          pick_index:pick,amount:body.amount,request_id:body.request_id,status:'accepted',payout:0}];
      render();alertMessage('Bet accepted ✓',1500);
      lastRankingAt=0;
    }catch(error){
      const code=String(error.message||error);
      if(code==='server_timeout'||timedOut){
        uncertainBets.set(pick,body);
        alertMessage('Bet status pending. Tap again to check safely.',3800);
      }else{
        uncertainBets.delete(pick);
        const reason=code==='insufficient_coins'?'Insufficient coins':
          code==='betting_closed'?'Betting is closed':
          /rate.?limit|too_many_requests/i.test(code)?'Too many bets. Please wait a moment.':code;
        alertMessage('Bet not accepted: '+reason,3000);
      }
    }finally{
      pendingPicks.delete(pick);tile?.classList.remove('pending');refresh();
    }
  }
  function drawSpin(index){
    for(const item of slots.values())item.classList.remove('on');
    const key=ITEMS[index]?.[0];if(key)slots.get(key).classList.add('on');
  }
  function settleDisplay(record){
    if(!record||shownResult===record.round_no)return;
    shownResult=record.round_no;
    for(const button of slots.values())button.classList.remove('on','win');
    for(const key of record.visual||[])slots.get(key)?.classList.add('win');
    const winners=(record.top_winners||[]).slice(0,3);
    const box=$('winners');box.replaceChildren();
    const title=document.createElement('h4');title.textContent='🏆 Top Winners This Round';box.appendChild(title);
    winners.forEach((w,i)=>{
      const div=document.createElement('div');div.className='row';
      div.textContent=['🥇','🥈','🥉'][i]+' '+(w.name||'Player')+'  +🪙'+format(w.total_win);
      box.appendChild(div);
    });
    box.classList.toggle('show',winners.length>0);
    const banner=$('banner');banner.textContent=winners.length?
      '👑 '+winners[0].name+'  WIN 🪙'+format(winners[0].total_win):'';
    banner.classList.toggle('show',winners.length>0);
    if(winners.length)setTimeout(()=>{banner.classList.remove('show');box.classList.remove('show');},6500);
    hub(icons[record.item]||'🎡','Server result',null);
  }
  function tick(){
    if(!active||!state)return;
    const now=Date.now()+offset;
    const n=Math.floor(now/CYCLE),t=now%CYCLE;
    if(n!==roundNo){roundNo=n;shownResult=-1;lastSpin=-1;for(const x of slots.values())x.classList.remove('win');}
    const canBet=authorized&&state.round.round_no===n&&t<BET;
    for(const x of slots.values())x.disabled=!canBet||pendingPicks.has(Number(x.dataset.pick));
    if(t<BET)hub('🍽','Place your bets',Math.ceil((BET-t)/1000));
    else if(t<PAY){
      hub('🎡','Spinning…',null);
      if(state.round.round_no===n&&state.spin){
        const position=state.spin.target_index;
        const next=Math.floor((t-BET)/220)%8;
        if(next!==lastSpin){lastSpin=next;drawSpin((position+next)%8);}
      }
    }else{
      const result=state.round.round_no===n?state.current_result:state.previous_result;
      if(result)settleDisplay(result);
      else hub('🎡','Waiting for result…',null);
    }
    if(Date.now()-lastPoll>1800){lastPoll=Date.now();refresh();}
  }
  function listHistory(data){
    const rows=(data.bets||[]).slice(0,30);
    return rows.map(r=>'<tr><td>'+r.round_no+'</td><td>'+
      (ITEMS[r.pick_index]?.[1]||'🎡')+'</td><td>'+format(r.amount)+'</td><td>'+
      (r.status==='settled'?format(r.payout):'Pending')+
      '</td></tr>').join('')||'<tr><td colspan="4">No bets yet</td></tr>';
  }
  $('hbtn').onclick=async()=>{
    $('sin').textContent='Loading bet history…';$('sheet').classList.add('show');
    try{const value=await request('history');$('sin').innerHTML='<b>My Bet History</b><table><tr><th>Round</th><th>Food</th><th>Bet</th><th>Win</th></tr>'+listHistory(value)+'</table>';}
    catch{$('sin').textContent='Unable to load bet history';}
  };
  function renderBetRanks(value){
    rankTop.replaceChildren();
    const leaders=(value?.list||[]).slice(0,3);
    leaders.forEach((user,i)=>{
      const li=document.createElement('li');
      const who=document.createElement('span');
      who.textContent=['🥇','🥈','🥉'][i]+' '+(user.name||'Player');
      who.title='ID '+user.id;
      const coins=document.createElement('b');coins.textContent=format(user.total);
      li.append(who,coins);rankTop.appendChild(li);
    });
    if(!leaders.length){const li=document.createElement('li');
      li.textContent='No verified bets yet';rankTop.appendChild(li);}
    rankNote.textContent='My rank: '+(value?.me?.rank||'100+')+
      '  ·  🪙 '+format(value?.me?.total);
  }
  function renderFullBetRanks(value){
    $('plist').replaceChildren();
    const header=document.createElement('div');header.className='ph';
    header.textContent='🏆 Daily Bet Ranking · Top 100 (BD time)';
    $('plist').appendChild(header);
    (value?.list||[]).forEach((entry,i)=>{
        const row=document.createElement('div');row.className='pr';
        const position=document.createElement('span');position.className='pk';position.textContent=String(i+1);
        const name=document.createElement('span');name.className='pn';name.textContent=(entry.name||'Player')+' · '+entry.id;
        const total=document.createElement('span');total.className='pw';total.textContent='🪙 '+format(entry.total);
        row.append(position,name,total);$('plist').appendChild(row);
    });
    const me=document.createElement('div');me.className='pr me stick';
    me.textContent='My rank: '+(value?.me?.rank||'100+')+' · 🪙'+format(value?.me?.total);
    $('plist').appendChild(me);
  }
  async function refreshBetRanking(force=false){
    if(!active)return null;
    if(rankingPromise)return rankingPromise;
    if(!force&&lastRankingAt&&Date.now()-lastRankingAt<10000)return rankCache;
    rankingPromise=request('rankings').then(value=>{
      if(!active)return null;
      if(!Array.isArray(value?.list))throw new Error('Invalid betting rank');
      rankCache=value;lastRankingAt=Date.now();renderBetRanks(value);
      if($('rsheet').classList.contains('show'))renderFullBetRanks(value);
      return value;
    }).catch(()=>{
      // Avoid immediately retrying failed ranking reads at every 1.8s state tick.
      lastRankingAt=Date.now();
      if(!rankCache)rankNote.textContent='Ranking unavailable · Tap View all';
      return rankCache;
    }).finally(()=>{rankingPromise=null;});
    return rankingPromise;
  }
  $('rbtn').onclick=async()=>{
    $('rsheet').classList.add('show');
    $('plist').textContent='Loading verified bet rankings…';
    if(rankCache)renderFullBetRanks(rankCache);
    const ranking=await refreshBetRanking(true);
    if(!ranking)$('plist').textContent='Ranking unavailable. Please retry.';
  };
  $('rclose').onclick=()=>$('rsheet').classList.remove('show');
  $('rsheet').onclick=e=>{if(e.target===$('rsheet'))$('rsheet').classList.remove('show');};
  $('sheet').onclick=e=>{if(e.target===$('sheet'))$('sheet').classList.remove('show');};
  $('help').onclick=()=>{
    $('sin').textContent='20 seconds to bet, 5 seconds to spin, 5 seconds for results. Salad and Pizza pay x2 on their food groups. All bets, winners and coins are verified by the server.';
    $('sheet').classList.add('show');
  };
  // The developer's original branding and 10-second loading animation stay.
  const loader=$('loader'),bar=$('lbar'),remaining=$('lnum'),message=$('lmsg');
  const began=Date.now();
  function updateLoading(){
    const elapsed=(Date.now()-began)/1000,p=Math.min(1,elapsed/10);
    if(bar)bar.style.width=(p*100)+'%';if(remaining)remaining.textContent=String(Math.ceil(10*(1-p)));
    if(message)message.textContent=authorized?'Connected to game server':
      'Connecting securely to game server…';
    if(p>=1){loader?.classList.add('off');clearInterval(loadTimer);}
  }
  const loadTimer=setInterval(updateLoading,150);
  refresh();setInterval(tick,250);
  if(host!==window)host.postMessage({type:'sharika:original-ready',game:GAME},'*');
})();
