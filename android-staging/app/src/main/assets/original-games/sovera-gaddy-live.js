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
  const pending=new Map();
  let seq=0,active=true,authorized=false,betting=false,refreshing=false,selected=50,state=null;
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
    button.append(image,m,amount);button.onclick=()=>place(i);
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
    const label=document.createElement('span');label.className='l';label.textContent='সার্ভার ফলাফল:';old.appendChild(label);
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
      render();
    }catch(error){
      authorized=false;alertMessage('সার্ভার সংযোগ নেই — বাজি বন্ধ',3500);
    }finally{refreshing=false;}
  }
  function requestId(){
    if(!crypto?.getRandomValues)throw new Error('secure_request_unavailable');
    return 'gaddy:'+Array.from(crypto.getRandomValues(new Uint8Array(16)),
      x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function place(pick){
    if(!authorized||betting||!state)return alertMessage('সার্ভার সংযোগের অপেক্ষায়');
    const phase=(Date.now()+offset-state.round.starts_ms)%CYCLE;
    if(phase>=BET)return alertMessage('বাজির সময় শেষ');
    if(state.coins<selected)return alertMessage('পর্যাপ্ত কয়েন নেই');
    const body={round_no:state.round.round_no,pick,amount:selected,request_id:requestId()};
    betting=true;
    try{
      let receipt;
      try{receipt=await request('bet',body);}catch(error){
        // Retry the same idempotency key; never debit twice after a timeout.
        if(error.message!=='server_timeout')throw error;
        receipt=await request('bet',body);
      }
      if(!receipt||!Number.isSafeInteger(receipt.coins))throw new Error('invalid_bet_receipt');
      state.coins=receipt.coins;
      state.my_bets=[...(state.my_bets||[]),{round_no:body.round_no,pick_index:pick,amount:selected,status:'accepted',payout:0}];
      render();alertMessage('✅ বাজি গ্রহণ করা হয়েছে',1200);
    }catch(error){alertMessage('বাজি গ্রহণ হয়নি: '+error.message,3100);}
    finally{betting=false;refresh();}
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
    const title=document.createElement('h4');title.textContent='🏆 এই রাউন্ডের বিজয়ী';box.appendChild(title);
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
    hub(icons[record.item]||'🎡','সার্ভার ফলাফল',null);
  }
  function tick(){
    if(!active||!state)return;
    const now=Date.now()+offset;
    const n=Math.floor(now/CYCLE),t=now%CYCLE;
    if(n!==roundNo){roundNo=n;shownResult=-1;lastSpin=-1;for(const x of slots.values())x.classList.remove('win');}
    const canBet=authorized&&!betting&&state.round.round_no===n&&t<BET;
    for(const x of slots.values())x.disabled=!canBet;
    if(t<BET)hub('🍽','বাজি চলছে',Math.ceil((BET-t)/1000));
    else if(t<PAY){
      hub('🎡','ঘুরছে...',null);
      if(state.round.round_no===n&&state.spin){
        const position=state.spin.target_index;
        const next=Math.floor((t-BET)/220)%8;
        if(next!==lastSpin){lastSpin=next;drawSpin((position+next)%8);}
      }
    }else{
      const result=state.round.round_no===n?state.current_result:state.previous_result;
      if(result)settleDisplay(result);
      else hub('🎡','ফলাফল আসছে...',null);
    }
    if(Date.now()-lastPoll>1800){lastPoll=Date.now();refresh();}
  }
  function listHistory(data){
    const rows=(data.bets||[]).slice(0,30);
    return rows.map(r=>'<tr><td>'+r.round_no+'</td><td>'+
      (ITEMS[r.pick_index]?.[1]||'🎡')+'</td><td>'+format(r.amount)+'</td><td>'+
      (r.status==='settled'?format(r.payout):'অপেক্ষা')+
      '</td></tr>').join('')||'<tr><td colspan="4">এখনো কোনো বাজি নেই</td></tr>';
  }
  $('hbtn').onclick=async()=>{
    $('sin').textContent='সার্ভার হিস্ট্রি লোড হচ্ছে…';$('sheet').classList.add('show');
    try{const value=await request('history');$('sin').innerHTML='<b>আমার বাজির হিস্ট্রি</b><table><tr><th>রাউন্ড</th><th>খাবার</th><th>বাজি</th><th>জয়</th></tr>'+listHistory(value)+'</table>';}
    catch{$('sin').textContent='হিস্ট্রি লোড করা যায়নি';}
  };
  $('rbtn').onclick=async()=>{
    $('rsheet').classList.add('show');$('plist').textContent='র‍্যাঙ্কিং লোড হচ্ছে…';
    try{
      const value=await request('rankings');$('plist').replaceChildren();
      (value.list||[]).forEach((entry,i)=>{
        const row=document.createElement('div');row.className='pr';
        const position=document.createElement('span');position.className='pk';position.textContent=String(i+1);
        const name=document.createElement('span');name.className='pn';name.textContent=(entry.name||'Player')+' · '+entry.id;
        const total=document.createElement('span');total.className='pw';total.textContent='🪙 '+format(entry.total);
        row.append(position,name,total);$('plist').appendChild(row);
      });
      const me=document.createElement('div');me.className='pr me stick';
      me.textContent='আমার র‍্যাঙ্ক: '+(value.me?.rank||'100+')+' · 🪙'+format(value.me?.total);
      $('plist').appendChild(me);
    }catch{$('plist').textContent='র‍্যাঙ্কিং লোড করা যায়নি';}
  };
  $('rclose').onclick=()=>$('rsheet').classList.remove('show');
  $('rsheet').onclick=e=>{if(e.target===$('rsheet'))$('rsheet').classList.remove('show');};
  $('sheet').onclick=e=>{if(e.target===$('sheet'))$('sheet').classList.remove('show');};
  $('help').onclick=()=>{
    $('sin').textContent='২০ সেকেন্ড বাজি, ৫ সেকেন্ড স্পিন, ৫ সেকেন্ড ফলাফল। সালাদ/পিজা বোনাস x2। সব ফলাফল ও কয়েন Cloudflare সার্ভার থেকে আসে।';
    $('sheet').classList.add('show');
  };
  // The developer's original branding and 10-second loading animation stay.
  const loader=$('loader'),bar=$('lbar'),remaining=$('lnum'),message=$('lmsg');
  const began=Date.now();
  function updateLoading(){
    const elapsed=(Date.now()-began)/1000,p=Math.min(1,elapsed/10);
    if(bar)bar.style.width=(p*100)+'%';if(remaining)remaining.textContent=String(Math.ceil(10*(1-p)));
    if(message)message.textContent=authorized?'সার্ভার যাচাই সম্পন্ন':
      'সার্ভারের সঙ্গে নিরাপদ সংযোগ হচ্ছে…';
    if(p>=1){loader?.classList.add('off');clearInterval(loadTimer);}
  }
  const loadTimer=setInterval(updateLoading,150);
  refresh();setInterval(tick,250);
  if(host!==window)host.postMessage({type:'sharika:original-ready',game:GAME},'*');
})();
