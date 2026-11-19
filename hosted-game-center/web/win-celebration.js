/* Royal Slots premium win celebration. Presentation only; no bets, credits or result generation. */
(()=>{'use strict';
const game=window.SharikaGame,container=document.getElementById('app');if(!game||!container)return;
const tiers=Object.freeze({
 win:{title:'WIN',kicker:'NICE SPIN!',ms:1800,n:8,fx:'win'},
 win2:{title:'NICE WIN',kicker:'WELL PLAYED!',ms:2200,n:14,fx:'win2'},
 big:{title:'BIG WINNER',kicker:'GREAT WIN!',ms:3500,n:23,fx:'big',voice:'voice_big'},
 super:{title:'SUPER WINNER',kicker:'AMAZING!',ms:4500,n:35,fx:'super',voice:'voice_super'},
 mega:{title:'MEGA WINNER',kicker:'INCREDIBLE!',ms:5550,n:45,fx:'mega',voice:'voice_mega'},
 jackpot:{title:'JACKPOT!',kicker:'THE ROYAL JACKPOT',ms:6150,n:55,fx:'jackpot',voice:'voice_jackpot'}
});
const root=document.createElement('div');root.id='sharika-win-celebration';root.hidden=true;
root.setAttribute('role','status');root.setAttribute('aria-live','polite');root.setAttribute('aria-atomic','true');
root.innerHTML='<div class="swc-shade"></div><div class="swc-burst"></div><div class="swc-rays"></div><div class="swc-particles"></div><div class="swc-content"><div class="swc-crown" aria-hidden="true">♛</div><div class="swc-kicker">GREAT WIN!</div><h2 class="swc-title">BIG WINNER</h2><div class="swc-line"></div><div class="swc-sub">YOU WON</div><div class="swc-prize"><span class="swc-medal">★</span><strong class="swc-amount">+0</strong><span class="swc-unit">COINS</span></div></div><button type="button" class="swc-close" aria-label="Skip celebration">SKIP ×</button>';
container.appendChild(root);
const $=s=>root.querySelector(s),particles=$('.swc-particles'),amount=$('.swc-amount');
let epoch=0,timer=null,frame=null,playing=[];
const reduced=!!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
function clear(){epoch++;if(timer!==null)clearTimeout(timer);timer=null;if(frame!==null)cancelAnimationFrame(frame);frame=null;for(const a of playing){try{a.pause();a.currentTime=0}catch{}}playing=[];root.hidden=true;root.className='';particles.replaceChildren();}
const money=x=>Math.round(x).toLocaleString('en-US');
function fx(key,volume){const src=game.sounds?.[key];if(!src)return null;try{const a=new Audio(src);a.volume=Math.min(1,Math.max(0,volume));playing.push(a);a.play().catch(()=>{});return a;}catch{return null;}}
function confetti(tier,compact){particles.replaceChildren();if(reduced)return;const frag=document.createDocumentFragment(),n=compact?Math.min(tier.n,17):tier.n;for(let i=0;i<n;i++){const c=document.createElement('span');c.className='swc-coin';c.textContent=i%3?'✦':'100';c.style.setProperty('--x',Math.random()*95+'%');c.style.setProperty('--size',(compact?12:15)+Math.random()*(compact?10:16)+'px');c.style.setProperty('--delay',Math.random()+'s');c.style.setProperty('--dur',(1.6+Math.random()*1.9)+'s');frag.appendChild(c);}for(let i=0;i<Math.floor(n*.5);i++){const c=document.createElement('span');c.className='swc-spark';c.textContent='✧';c.style.setProperty('--x',Math.random()*95+'%');c.style.setProperty('--y',(20+Math.random()*65)+'%');c.style.setProperty('--size',(10+Math.random()*14)+'px');c.style.setProperty('--delay',Math.random()+'s');c.style.setProperty('--dur',(.7+Math.random()*1.2)+'s');frag.appendChild(c);}particles.appendChild(frag);}
function countUp(target,ms,id){if(reduced){amount.textContent='+'+money(target);return;}const start=performance.now();function tick(now){if(epoch!==id)return;const t=Math.min(1,(now-start)/ms),e=1-Math.pow(1-t,3);amount.textContent='+'+money(target*e);if(t<1)frame=requestAnimationFrame(tick);else frame=null;}frame=requestAnimationFrame(tick);}
function show({win,bet,jackpot=false,audioEnabled=true,compact=false}={}) {
 // The original game invokes this ONLY after the authenticated server receipt.
 // The overlay cannot settle or alter wallet state.
 if(!Number.isSafeInteger(win)||win<=0||!Number.isSafeInteger(bet)||bet<=0)return 0;
 const x=win/bet,key=jackpot?'jackpot':x>=100?'mega':x>=30?'super':x>=10?'big':x>=3?'win2':'win',level=tiers[key];
 clear();const id=epoch,room=compact||container.clientHeight<480||container.clientHeight/Math.max(1,container.clientWidth)<1.4;
 root.className='tier-'+key+(room?' swc-compact':'');$('.swc-kicker').textContent=level.kicker;$('.swc-title').textContent=level.title;$('.swc-sub').textContent=jackpot?'CONGRATULATIONS':'YOU WON';amount.textContent='+0';root.hidden=false;
 confetti(level,room);countUp(win,Math.max(650,level.ms*.62),id);
 if(audioEnabled){const music=fx(level.fx,level.voice?.24:.35);if(level.voice)setTimeout(()=>{if(epoch!==id)return;if(music&&!music.paused)music.volume=Math.min(music.volume,.12);const voice=fx(level.voice,.85);if(voice&&music)voice.addEventListener('ended',()=>{if(epoch===id&&!music.paused)music.volume=.24;},{once:true});},420);
 [830,1200].forEach(ms=>setTimeout(()=>{if(epoch===id)fx('coin',.12);},ms));}
 timer=setTimeout(()=>{if(epoch!==id)return;root.classList.add('swc-exit');timer=setTimeout(()=>{if(epoch===id)clear();},reduced?1:340);},level.ms);
 return level.ms;
}
$('.swc-close').addEventListener('click',clear);
window.SharikaWinCelebration=Object.freeze({show,close:clear});
})();