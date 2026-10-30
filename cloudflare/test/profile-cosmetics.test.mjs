import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {handleRequest} from '../src/index.mjs';

globalThis.crypto ??= webcrypto;
const project='sharika-cosmetic-test';
const pair=await crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'
},true,['sign','verify']);
const jwk={...(await crypto.subtle.exportKey('jwk',pair.publicKey)),
  kid:'cosmetics-test',alg:'RS256',use:'sig'};
const base64=value=>Buffer.from(typeof value==='string'?value:
  JSON.stringify(value)).toString('base64url');
async function token(){
  const now=Math.floor(Date.now()/1000);
  const head=base64({alg:'RS256',kid:'cosmetics-test',typ:'JWT'});
  const body=base64({aud:project,iss:'https://securetoken.google.com/'+project,
    sub:'member',email_verified:true,iat:now-60,auth_time:now-60,exp:now+3600});
  const signed=head+'.'+body;
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    pair.privateKey,new TextEncoder().encode(signed));
  return signed+'.'+Buffer.from(signature).toString('base64url');
}
function cosmeticsDb(){
  const current={auth_uid:'firebase:'+project+':member',
    public_no:10000001,name:'Member',country:'BD',birthdate:'2000-01-01',
    minor:0,status:'active',coins:42,diamonds:0,xp:0,wealth_level:1,charm_level:1,
    pic:null,cover:null,bio:'',frame_style:'',entry_style:''};
  const mutations=[];
  const db={current,mutations,prepare(sql){
    return {values:[],bind(...values){this.values=values;return this;},
      async first(){
        if(sql.startsWith('SELECT * FROM sharika_users WHERE auth_uid'))
          return {...current};
        if(sql.startsWith('SELECT * FROM sharika_users WHERE public_no'))
          return {...current};
        return null;
      },
      async run(){
        assert.match(sql,/^UPDATE sharika_users SET /);
        mutations.push(sql);
        const assignment=sql.slice('UPDATE sharika_users SET '.length)
          .split(',updated_at=')[0].split(',').map(item=>item.split('=')[0]);
        assignment.forEach((key,i)=>{current[key]=this.values[i];});
        return {success:true};
      }
    };
  }};
  return db;
}
test('original Sovera cosmetics persist on verified profiles without wallet changes',async()=>{
  const prior=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,headers:new Headers({'cache-control':'max-age=300'}),
    json:async()=>({keys:[jwk]})});
  try{
    const db=cosmeticsDb();
    const headers={Authorization:'Bearer '+await token(),'Content-Type':'application/json'};
    const run=(method,path,body)=>handleRequest(new Request(
      'https://sharika.example/api/v1'+path,{
        method,headers,...(body?{body:JSON.stringify(body)}:{})
      }),{DB:db,FIREBASE_PROJECT_ID:project});
    let response=await run('PATCH','/me',{
      frame_style:'royal-gold',entry_style:'phoenix-queen'
    });
    assert.equal(response.status,200);
    const updated=await response.json();
    assert.equal(updated.frame_style,'royal-gold');
    assert.equal(updated.entry_style,'phoenix-queen');
    assert.equal(updated.coins,42);
    assert.equal(db.mutations.length,1);
    response=await run('GET','/users/10000001');
    const publicView=await response.json();
    assert.equal(publicView.frame_style,'royal-gold');
    assert.equal(publicView.entry_style,'phoenix-queen');
    assert.equal(publicView.coins,undefined);
    response=await run('PATCH','/me',{frame_style:'https://untrusted.example/frame'});
    assert.equal(response.status,400);
    assert.equal(db.mutations.length,1);
    response=await run('PATCH','/me',{entry_style:'../../script.js'});
    assert.equal(response.status,400);
    assert.equal(db.mutations.length,1);
    response=await run('PATCH','/me',{coins:5000,frame_style:'vip7'});
    assert.equal(response.status,403);
    assert.equal(db.mutations.length,1);
    response=await run('PATCH','/me',{frame_style:'',entry_style:''});
    assert.equal(response.status,200);
    assert.equal(db.current.frame_style,'');
    assert.equal(db.current.entry_style,'');
    assert.equal(db.current.coins,42);
  }finally{globalThis.fetch=prior;}
});
