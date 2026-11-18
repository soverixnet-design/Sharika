// Public static game assets only. Never handles coins, credentials or winning outcomes.
const games=Object.freeze([
{id:'royal-ace',name:'SuperAce Deluxe',category:'Slots',asset:'/games/original-games/royal-ace-deluxe.html'},
{id:'cleopatra',name:"Cleopatra's Gold Deluxe",category:'Slots',asset:'/games/original-games/cleopatra-slot.html'},
{id:'greedy-classic',name:'Greedy Game',category:'Food Wheels',asset:'/games/original-games/greedy-classic.html'},
{id:'food-deluxe',name:'Food Wheel Deluxe',category:'Food Wheels',asset:'/games/original-games/food-wheel-deluxe.html'},
{id:'sovera-gaddy',name:'Sovera Gaddy',category:'Food Wheels',asset:'/games/original-games/sovera-gaddy-game.html'},
{id:'sovera-food',name:'Sovera Food Wheel',category:'Food Wheels',asset:'/games/original-games/sovera-food-wheel.html'},
{id:'night-food',name:'Night Food Wheel',category:'Food Wheels',asset:'/games/original-games/night-food-wheel.html'},
{id:'greedy-wheel',name:'Greedy Wheel',category:'Food Wheels',asset:'/games/greedy-wheel/index.html?sheet=1&lang=en'},
{id:'fruit-royale',name:'Fruit Royale',category:'Fruit',asset:'/games/fruit-royale/index.html'},
{id:'jackpot-fruit',name:'Fruit Jackpot',category:'Fruit',asset:'/games/original-games/jackpot-fruit.html'}
]);
const security={
'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
'permissions-policy':'camera=(),microphone=(),geolocation=(),payment=()',
'x-frame-options':'SAMEORIGIN'};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...security}});
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname==='/health')return json({ok:true,service:'sharika-hosted-game-center',environment:'staging',wallet:'native-bridge-only'});
 if(url.pathname==='/api/catalog')return request.method==='GET'?json({games,virtual_only:true,browser_demo:true,requires_sharika_app:true}):json({error:'method_not_allowed'},405);
 if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
 const result=await env.ASSETS.fetch(request);
 const h=new Headers(result.headers);
 for(const [k,v] of Object.entries(security))h.set(k,v);
 // No authenticated data is embedded or cached on this origin.
 h.set('cache-control',url.pathname.endsWith('.html')||url.pathname==='/'?'public,max-age=60':'public,max-age=300');
 // A sandboxed iframe has an opaque origin, so CSP 'self' alone does not
 // permit its own hosted subresources. Explicitly allow ONLY this game host.
 const staticOrigin='https://sharika-games-web-staging.soverixnet.workers.dev';
 const profileImages='https://sharika-api-staging.soverixnet.workers.dev https://lh3.googleusercontent.com https://firebasestorage.googleapis.com https://storage.googleapis.com';
 h.set('content-security-policy',url.pathname.startsWith('/games/')?
   "default-src 'none'; img-src 'self' "+staticOrigin+" "+profileImages+" data: blob:; script-src 'self' "+staticOrigin+" 'unsafe-inline'; style-src 'self' "+staticOrigin+" 'unsafe-inline'; font-src 'self' "+staticOrigin+" data:; frame-ancestors 'self' "+staticOrigin+"; connect-src 'none'; media-src 'self' "+staticOrigin+" data: blob:":
   "default-src 'self'; img-src 'self' "+profileImages+" data:; style-src 'self'; script-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
 return new Response(request.method==='HEAD'?null:result.body,{status:result.status,headers:h});
}};