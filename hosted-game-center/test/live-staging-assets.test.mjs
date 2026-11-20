// Live HTTP smoke against public staging only. NEVER sends a bet, Firebase
// credential, wallet mutation, room action, or authenticated game request.
import test from 'node:test';
import assert from 'node:assert/strict';

const origin='https://sharika-games-web-staging.soverixnet.workers.dev';
const privateOrigin='https://sharika-private-center-staging.soverixnet.workers.dev';
const timeout=12000;
const get=async (base,relative)=>{
  const url=new URL(relative,base);
  assert.equal(url.origin,base,'cross-origin public game asset forbidden');
  const response=await fetch(url,{signal:AbortSignal.timeout(timeout),headers:{accept:'text/html,application/json,*/*'}});
  return {url,response};
};

test('deployed public staging Game Center serves its full catalog and every game document', {timeout:230000},async()=>{
  const h=await get(origin,'/health');
  assert.equal(h.response.status,200,'public staging is not healthy');
  const health=await h.response.json();
  assert.equal(health.service,'sharika-hosted-game-center');
  const c=await get(origin,'/api/catalog');
  assert.equal(c.response.status,200,'public game catalog unavailable');
  const {games}=await c.response.json();
  assert.ok(Array.isArray(games)&&games.length>=11,'missing hosted game cards');
  assert.equal(new Set(games.map(g=>g.id)).size,games.length,'duplicate game keys');
  const errors=[];
  const loaded=[];
  for(const game of games){
    try{
      const {url,response}=await get(origin,game.asset);
      assert.equal(response.status,200,game.id+' document HTTP '+response.status);
      const type=response.headers.get('content-type')||'';
      assert.match(type,/text\/html/i,game.id+' is not HTML: '+type);
      const csp=response.headers.get('content-security-policy')||'';
      assert.match(csp,/frame-ancestors/i,game.id+' iframe CSP missing');
      assert.ok(csp.includes(privateOrigin),game.id+' blocked from Sharika private room Game Center');
      assert.equal(response.headers.get('x-frame-options'),null,game.id+' X-Frame-Options blocks Android iframe');
      const html=await response.text();
      assert.ok(html.length>150&&/<body\b/i.test(html),game.id+' HTML blank/incomplete');
      // Verify the actual live JS/CSS entry points, not just an HTML shell.
      const refs=[...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)]
        .map(m=>m[1]).filter(x=>!x.startsWith('data:')&&!x.startsWith('blob:')&&!x.startsWith('#'));
      let assets=0;
      for(const asset of refs){
        const destination=new URL(asset,url);
        if(destination.origin!==origin)continue;
        if(!/\.(?:js|css)(?:$|\?)/i.test(destination.pathname+destination.search))continue;
        const nested=await get(origin,destination.href);
        assert.equal(nested.response.status,200,game.id+' missing script/stylesheet '+destination.pathname);
        assets++;
      }
      loaded.push({id:game.id,name:game.name,filesChecked:assets});
      console.log('GAME_OK '+game.id+' '+game.name+' scripts_and_css='+assets);
    }catch(error){
      errors.push(game.id+': '+error.message);
      console.error('GAME_FAIL '+game.id+': '+error.message);
    }
  }
  console.log('GAME_HTTP_SUMMARY '+JSON.stringify({loaded,errors,count:games.length}));
  assert.deepEqual(errors,[],'one or more deployed game pages or assets failed staging HTTP validation');
});

test('private Game Center stays protected for anonymous users', {timeout:35000},async()=>{
  const h=await get(privateOrigin,'/health');
  assert.equal(h.response.status,200);
  assert.equal((await h.response.json()).private_center,true);
  const c=await get(privateOrigin,'/api/catalog');
  assert.equal(c.response.status,401,'private game catalog must require login');
  const w=await get(privateOrigin,'/api/center/wallet');
  assert.equal(w.response.status,401,'private wallet must require login');
});
