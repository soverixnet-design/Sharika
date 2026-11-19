/* Browser-only practice adapter. No fetch, Firebase credentials, D1 database,
   persistent wallet, payments, or claims about real game odds. All balances
   and responses exist solely in the current open demo session. */
(function(){
 'use strict';
 const fruit=[
  ['lemon','Lemon','🍋',4],['strawberry','Strawberry','🍓',4],
  ['kiwi','Kiwi','🥝',4],['cherry','Cherry','🍒',20],
  ['plum','Plum','🫐',15],['watermelon','Watermelon','🍉',10],
  ['mango','Mango','🥭',6],['apple','Apple','🍎',6]
 ];
 const games={
  'sovera-food':{names:['chicken','fish','hotdog','steak','grapes','lettuce','pepper','melon'],symbols:['🍗','🐟','🌭','🥩','🍇','🥬','🫑','🍉'],mult:[45,25,15,10,5,5,5,5]},
  'night-food':{symbols:['🌭','🍢','🍗','🥩','🥕','🌽','🥬','🍅'],mult:[10,15,25,45,5,5,5,5,1.2,4]},
  'jackpot-fruit':{symbols:['🍋','🍇','🥝','🍑','🍓','🍌','🍉','🍒'],mult:[5,5,5,5,10,10,20,40]}
 };
 const random=n=>{
   const bits=new Uint32Array(1);crypto.getRandomValues(bits);return bits[0]%n;
 };
 const pick=a=>a[random(a.length)];
 const valid=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000000000;
 const clock=(duration=40000,betMs=28000,spinMs=5000)=>{
   const now=Date.now(),n=Math.floor(now/duration),start=n*duration,betEnd=start+betMs,
    spinEnd=betEnd+spinMs;
   return {now,n,start,betEnd,spinEnd,end:start+duration,
     phase:now<betEnd?'betting':now<spinEnd?'spinning':'result'};
 };
 window.createSharikaPractice=function(game){
   let coins=1000000,bonus=0,betLock=0,lastRound=-1;
   const receiptCache=new Map(),bets=[],history=[];
   let wagers=Array(8).fill(0),yesterday=Array(8).fill(0),totals=Array(8).fill(0);
   const person={id:'00000000',name:'Demo Player',avatar:'',pic:''};
   const pay=(amount,id,value)=>{
     if(!valid(amount))throw Error('invalid_demo_bet');
     if(id&&receiptCache.has(id))return receiptCache.get(id);
     if(coins<amount)throw Error('insufficient_demo_coins');
     coins-=amount;
     const out=typeof value==='function'?value():value;
     if(id)receiptCache.set(id,out);
     return out;
   };
   const current=(duration=40000,betMs=28000,spinMs=5000)=>{
     const r=clock(duration,betMs,spinMs);
     if(lastRound!==r.n){
       if(lastRound>=0)yesterday=wagers.slice();
       wagers=Array(8).fill(0);totals=Array(8).fill(0);
       lastRound=r.n;
     }
     return r;
   };
   const gamble=(bet,id,buy)=>{
     const allowed=[1000,10000,100000,1000000,10000000];
     if(!allowed.includes(bet))throw Error('invalid_demo_bet');
     if(receiptCache.has(id))return receiptCache.get(id);
     const cost=buy?bet*10:bonus?0:bet;
     return pay(cost,id,()=>{
       const win=buy?0:random(5)===0?bet*2:0;
       coins+=win;
       if(buy){bonus=10;betLock=bet;}else if(bonus){bonus--;if(bonus===0)betLock=0;}
       return {requestId:id,bet,win,balance:coins,freeSpins:bonus,
         bonusSpins:buy?10:0,mode:buy?'bonus_buy':cost===0?'free':'paid',
         steps:buy?[]:[{grid:Array.from({length:5},()=>Array.from({length:4},()=>({
           s:random(8),g:false}))),marks:[],combo:0,multiplier:1}],
         virtual_coins_only:true,settled:true,practice_only:true};
     });
   };
   const classic=(r,action,body)=>{
     const state={round:r.n,phase:r.phase,endsAt:r.phase==='betting'?r.betEnd:
       r.phase==='spinning'?r.spinEnd:r.end,
       totals:totals.slice(),online:1};
     if(r.phase!=='betting')state.resultId='chicken';
     if(action==='state'){
       const out={serverTime:r.now,balance:coins,
         todayDay:new Date().toISOString().slice(0,10),todayWin:0,todayPlayed:0,
         user:person,config:{chips:[100,1000,10000,50000],maxBetPerRound:100000000},
         state,myBets:wagers.slice(),history:[]};
       if(r.phase==='result')out.result={round:r.n,resultId:state.resultId,
         endsAt:r.end,you:{bet:0,win:0,balance:coins},top:[]};
       return out;
     }
     if(action==='records'||action==='history')return {list:history};
     if(action==='rankings')return {rankings:[],period:'daily'};
     if(action==='winners')return {winners:[]};
     if(action==='bet'){
       if(r.now>=r.betEnd)throw Error('betting_closed');
       const itemId=String(body?.itemId||'chicken'),amount=Number(body?.amount);
       const id=String(body?.request_id||'');
       const items=['chicken','fish','hotdog','steak','grape','lettuce','pepper','watermelon'];
       if(!items.includes(itemId)||!valid(amount)||![100,1000,10000,50000].includes(amount)||
          !Number.isSafeInteger(body?.round)||body.round!==r.n)
         throw Error('invalid_demo_bet');
       return pay(amount,id,()=>{
         const index=items.indexOf(itemId)%8;wagers[index]+=amount;totals[index]+=amount;
         return {round:r.n,itemId,amount,balance:coins,myBets:wagers.slice(),
           totals:totals.slice(),online:1,duplicate:false,practice_only:true};
       });
     }
   };
   return {
     get coins(){return coins;},
     async request(method,path,body){
       if(typeof path!=='string'||path.length>245||!path.startsWith('/api/v1/'))
         throw Error('practice_route_denied');
       if(path.includes('game-catalog'))throw Error('practice_catalog_uses_public_assets');
       const action=path.split('/').pop().split('?')[0];
       if(action==='bet'&&Array.isArray(body?.taps)){
         const receipts=[];
         for(const tap of body.taps){
           const key=tap.request_id;
           try{
             const classic=game==='greedy-classic',wheel=game==='greedy-wheel';
             const items=classic?['chicken','fish','hotdog','steak','grape','lettuce','pepper','watermelon']:
               ['shrimp','fish','chicken','steak','cabbage','carrot','corn','tomato'];
             const data=classic||wheel?{...tap,round:body.round_no,itemId:items[tap.pick]}:
               game==='food-deluxe'?{request_id:key,round_no:body.round_no,stakes:tap.pick}:
               game==='fruit-royale'?{requestId:key,fruitId:fruit[tap.pick][0],roundId:'fruit-royale:'+body.round_no,amount:tap.amount}:
               {...tap,round_no:body.round_no};
             const receipt=await this.request(method,path,data);
             receipts.push({request_id:key,bet_id:receipt.bet_id||receipt.id||1});
           }catch(error){receipts.push({request_id:key,error:error.message});}
         }
         return {round_no:body.round_no,coins,receipts};
       }
       if(path.startsWith('/api/v1/royal-ace/')){
         if(action==='state')return {balance:coins,bets:[1000,10000,100000,1000000,10000000],
           freeSpins:bonus,lockedBet:betLock,virtual_coins_only:true,practice_only:true};
         if(action==='spin'&&method==='POST')return gamble(Number(body?.bet),String(body?.requestId||''),!!body?.buy);
       }
       if(path.startsWith('/api/v1/cleopatra/')){
         if(action==='state')return {balance:coins,bets:[1000,10000,100000,1000000,10000000],
           freeSpins:0,lockedBet:0,virtual_coins_only:true,practice_only:true};
         if(action==='spin'&&method==='POST'){
           const stake=Number(body?.bet),id=String(body?.requestId||'');
           if(!valid(stake)||stake===0)throw Error('invalid_demo_bet');
           return pay(stake,id,()=>{
             const win=random(5)===0?stake*2:0;coins+=win;
             return {requestId:id,bet:stake,win,balance:coins,freeSpins:0,
               grid:Array.from({length:5},()=>Array.from({length:3},()=>pick(
                 ['K','H','N','Q','J','T','L','E','A']))),bonusSpins:0,
               settled:true,practice_only:true};
           });
         }
       }
       if(game==='sovera-gaddy'){
         const r=current(30000,20000,5000);
         const round={round_no:r.n,starts_ms:r.start,bet_closes_ms:r.betEnd,
           closes_ms:r.end,payout_at_ms:r.spinEnd,phase:r.now<r.betEnd?'bet':
           r.now<r.spinEnd?'spin':'result',commit_sha256:'practice'};
         if(action==='state')return {game,virtual_coins_only:true,server_time:r.now,coins,
           user:person,chips:[50,500,2000,10000],today_won:0,today_wagered:0,
           multipliers:[45,25,15,10,5,5,5,5,2,4],
           symbols:games['sovera-food'].symbols,round,
           my_bets:bets.filter(x=>x.round_no>=r.n-1),
           spin:r.now>=r.betEnd?{round_no:r.n,item:games['sovera-food'].names[r.n%8],
             result_index:r.n%8,target_index:0,visual:[games['sovera-food'].names[r.n%8]],
             top_winners:[]}:null,
           current_result:r.phase==='result'?{round_no:r.n,
             item:games['sovera-food'].names[r.n%8],top_winners:[]}:null,
           previous_result:{round_no:r.n-1,
             item:games['sovera-food'].names[(r.n+7)%8],top_winners:[]}};
         if(action==='history')return {game,rounds:[],bets:[]};
         if(action==='rankings')return {list:[],me:{rank:null,total:0}};
         if(action==='stats')return {game,bets:bets.length,wagered:0,won:0};
         if(action==='bet'&&method==='POST'){
           if(r.now>=r.betEnd)throw Error('betting_closed');
           const amount=Number(body?.amount),key=String(body?.request_id||'');
           const index=Number(body?.pick);
           if(!Number.isInteger(index)||index<0||index>7)throw Error('invalid_demo_bet');
           return pay(amount,key,()=>{
             bets.push({round_no:r.n,pick_index:index,amount,request_id:key,status:'accepted',payout:0});
             return {duplicate:false,bet_id:bets.length,coins,round_no:r.n,practice_only:true};
           });
         }
       }
       if(game==='food-deluxe'){
         const r=current(40000,28000,6500);
         const round={round_no:r.n,starts_ms:r.start,bet_closes_ms:r.betEnd,
           result_ms:r.spinEnd,closes_ms:r.end,phase:r.now<r.betEnd?'bet':
           r.now<r.spinEnd?'spin':'result',commit_sha256:'practice'};
         if(action==='state')return {game,virtual_coins_only:true,server_time:r.now,
           round_ms:40000,round,balance:coins,chips:[50,500,2000,10000],
           multipliers:[45,25,15,10,5,5,5,5],
           symbols:games['sovera-food'].symbols,my_stakes:wagers.slice(),
           last_stakes:yesterday.slice(),
           history:[(r.n+7)%8,(r.n+6)%8,(r.n+5)%8],
           result:r.phase==='result'?{round_no:r.n,index:r.n%8,
             multiplier:[45,25,15,10,5,5,5,5][r.n%8],my_payout:0,
             top_winners:[]}:null,
           previous_result:{round_no:r.n-1,index:(r.n+7)%8,my_payout:0,
             top_winners:[]},today_wagered:0,today_won:0};
         if(action==='history')return {rounds:[]};
         if(action==='rankings')return {rankings:[],verified:false};
         if(action==='bet'&&method==='POST'){
           if(r.now>=r.betEnd)throw Error('betting_closed');
           const stakes=body?.stakes;
           if(!Array.isArray(stakes)||stakes.length!==8||stakes.some(v=>!valid(v)))
             throw Error('invalid_demo_bet');
           const amount=stakes.reduce((a,b)=>a+b,0),key=String(body?.request_id||'');
           return pay(amount,key,()=>{
             wagers=wagers.map((x,i)=>x+stakes[i]);
             return {accepted:true,round_no:r.n,stake_total:amount,
               balance:coins,stakes,practice_only:true};
           });
         }
       }
       if(game==='greedy-classic'||game==='greedy-wheel'){
         return classic(current(40000,27000,6000),action,body);
       }
       if(games[game]){
         const r=current(40000,28000,5000),g=games[game];
         const round={round_no:r.n,starts_ms:r.start,bet_closes_ms:r.betEnd,
           closes_ms:r.end,commit_sha256:'practice',
           phase:r.now<r.betEnd?'bet':'spin'};
         if(action==='state')return {game,virtual_coins_only:true,server_time:r.now,
           round,symbols:g.symbols,multipliers:g.mult,
           chips:[1000,10000,100000,1000000,10000000],
           coins,my_bets:bets.filter(x=>x.round_no>=r.n-1),
           previous_result:{round_no:r.n-1,index:(r.n+7)%8,
             positions:[(r.n+7)%8],symbols:[g.symbols[(r.n+7)%8]],
             bonus:'none',top_winners:[]},
           today_won:0,today_wagered:0,bonus_pool:0};
         if(action==='history')return {game,rounds:[]};
         if(action==='stats')return {game,today_utc:new Date().toISOString().slice(0,10),
           bets:bets.length,wagered:0,won:0,net:0};
         if(action==='rankings')return {game,period:'daily',rankings:[]};
         if(action==='bet'&&method==='POST'){
           if(r.now>=r.betEnd)throw Error('betting_closed');
           const amount=Number(body?.amount),key=String(body?.request_id||'');
           return pay(amount,key,()=>{
             bets.push({round_no:r.n,pick_index:0,amount,request_id:key,status:'accepted'});
             return {bet_id:bets.length,duplicate:false,coins,round_no:r.n,
               pick:body?.pick,amount,practice_only:true};
           });
         }
       }
       if(game==='fruit-royale'){
         const r=current(40000,28000,5000),id='fruit-royale:'+r.n;
         if(action==='state')return {game,serverNow:r.now,server_time:r.now,
           balance:coins,jackpot:0,round:{id,status:r.now<r.betEnd?'open':'settling',
             closesAt:r.betEnd,settlesAt:r.end,commit_sha256:'practice'},
           bets:bets.filter(x=>x.roundId===id),
           fruits:fruit.map(x=>({id:x[0],name:x[1],emoji:x[2],multiplier:x[3]})),
           user:person,limits:{minBet:1,maxBet:10000000},
           previous_result:null,policy:{version:'practice',publicOdds:[],bonusOdds:[],
             poolContributionPercent:0}};
         if(action==='history'||action==='rankings')return [];
         if(action==='stats')return {totalBets:bets.length,totalBet:0,totalWin:0,profitLoss:0};
         if(action==='bet'&&method==='POST'){
           if(r.now>=r.betEnd)throw Error('betting_closed');
           const amount=Number(body?.amount),key=String(body?.requestId||'');
           return pay(amount,key,()=>{
             const b={id:bets.length+1,requestId:key,roundId:id,
               fruitId:body?.fruitId||'lemon',amount,balance:coins,practice_only:true};
             bets.push(b);return b;
           });
         }
       }
       throw Error('practice_action_unavailable');
     }
   };
 };
})();
