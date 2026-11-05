const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const staging=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(staging,name),'utf8');

function harness(workforce){
  const elements={};
  const listeners={};
  const accountFeatures={children:[],querySelectorAll:()=>[],appendChild(node){this.children.push(node);}};
  const document={
    body:{appendChild(node){elements[node.id]=node;}},
    createElement(){
      return {hidden:false,dataset:{},listeners:{},
        setAttribute(key,value){this[key]=value;},
        addEventListener(name,fn){this.listeners[name]=fn;}};
    },
    getElementById:id=>elements[id]||null,
    querySelector:selector=>selector==='#v-me .profile-account .ml2'?accountFeatures:null,
    addEventListener(name,fn){listeners[name]=fn;}
  };
  const window={A:{name:'Test Host',id:'10000001',pic:''},renderMe(){}};
  if(workforce)window.SharikaServer={connected:()=>true,api:async(method,path)=>{
    if(method==='GET'&&path==='/me')return {name:'Test Host',public_id:'10000001'};
    if(method==='GET'&&path==='/workforce/me')return workforce;
    throw Error('Unconfigured mock request: '+method+' '+path);
  }};
  vm.runInNewContext(read('agency-centers.js'),{document,window,console});
  return {window,elements,accountFeatures};
}

test('Android staging build packages Centers CSS and JS after verified adapter',()=>{
  const gradle=read('app/build.gradle');
  for(const filename of ['agency-centers.css','agency-centers.js'])
    assert.match(gradle,new RegExp(filename.replace('.','\\.')));
  assert.match(gradle,/sharika-centers-ui/);
  assert.match(read('back-navigation.js'),/sharikaCentersBack/);
});

test('profile exposes BD, Agency and Host Centers',()=>{
  const {accountFeatures,window}=harness();
  assert.equal(accountFeatures.children.length,3);
  assert.deepEqual(accountFeatures.children.map(node=>node.dataset.shCenter),['bd','agency','host']);
  assert.equal(typeof window.sharikaCentersOpen,'function');
});

test('each center has role-specific services; no verified policy means no salary amounts',()=>{
  const {window,elements}=harness();
  const cases={
    bd:['BD Center','Invite Agency','Assistant BD'],
    agency:['Agency Center','Invite Host','Host Members'],
    host:['Host Center','My Target','Salary Wallet']
  };
  for(const [role,words] of Object.entries(cases)){
    window.sharikaCentersOpen(role);
    const html=elements['sh-centers-panel'].innerHTML;
    for(const word of words)assert.ok(html.includes(word),role+': '+word);
    assert.match(html,/Verified salary data is unavailable/);
    assert.match(html,/>—<\/strong>/);
  }
});

test('salary screen disables exchange and Android Back returns to its center',()=>{
  const {window,elements}=harness();
  window.sharikaCentersOpen('agency');
  const layer=elements['sh-centers-panel'];
  layer.listeners.click({target:{closest:()=>({dataset:{shcSection:'salary'},hasAttribute:()=>false})}});
  assert.match(layer.innerHTML,/Admin approval required/);
  assert.match(layer.innerHTML,/data-shc-exchange disabled/);
  assert.equal(window.sharikaCentersBack(),true);
  assert.match(layer.innerHTML,/Invite Host/);
  assert.equal(window.sharikaCentersBack(),true);
  assert.equal(layer.hidden,true);
  assert.equal(window.sharikaCentersBack(),false);
});

test('app requests verified workforce data and refuses unapproved salary exchange',()=>{
  const code=read('agency-centers.js');
  assert.doesNotMatch(code,/localStorage|Math\.random/);
  assert.match(code,/service\.api\('GET','\/me'\)/);
  assert.match(code,/service\.api\('GET','\/workforce\/me'\)/);
  assert.match(code,/service\.api\('POST','\/workforce\/salary\/exchange'/);
});

test('verified backend policy, salary and targets replace all design-only placeholders',async()=>{
  const verified={role:{kind:'host',active:true},policy:{host_bps:4000,agency_bps:1000,
      bd_bps:500,direct_exchange_bps:3000,enabled:1,salary_exchange_enabled:0,
      settlement_mode:'weekly',version:2},
    salary:{by_kind:[{kind:'host',units:20000000000,gift_coins:5000000}],
      matured_available_units:0,remaining_units:20000000000},
    host_target_gifts:5000000,
    targets:[{label:'5M',target_coins:5000000}],
    target_progress:[{label:'5M',target_coins:5000000,progress:5000000,completed:true}],
    roster:[],exchanges:[]};
  const {window,elements}=harness(verified);
  window.sharikaCentersOpen('host');
  await new Promise(resolve=>setImmediate(resolve));
  const layer=elements['sh-centers-panel'];
  assert.match(layer.innerHTML,/2,000,000/);
  assert.match(layer.innerHTML,/40%/);
  assert.match(layer.innerHTML,/10%/);
  assert.match(layer.innerHTML,/5%/);
  assert.match(layer.innerHTML,/5M/);
  assert.match(layer.innerHTML,/30%/);
  layer.listeners.click({target:{closest:()=>({dataset:{shcSection:'salary'},hasAttribute:()=>false})}});
  assert.match(layer.innerHTML,/Admin approval required/);
  assert.match(layer.innerHTML,/data-shc-exchange disabled/);
});
