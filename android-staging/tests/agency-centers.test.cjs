const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const staging=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(staging,name),'utf8');

function harness(){
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

test('each center has the configured rates and role-specific services',()=>{
  const {window,elements}=harness();
  const cases={
    bd:['BD Center','Invite Agency','Assistant BD'],
    agency:['Agency Center','Invite Host','Host Members'],
    host:['Host Center','My Target','5M Gift Value']
  };
  for(const [role,words] of Object.entries(cases)){
    window.sharikaCentersOpen(role);
    const html=elements['sh-centers-panel'].innerHTML;
    for(const word of words)assert.ok(html.includes(word),role+': '+word);
    for(const rate of ['40%','10%','5%'])assert.ok(html.includes(rate),role+': '+rate);
    assert.match(html,/Not connected|not connected/);
    assert.match(html,/>—<\/strong>/);
  }
});

test('salary screen disables exchange and Android Back returns to its center',()=>{
  const {window,elements}=harness();
  window.sharikaCentersOpen('agency');
  const layer=elements['sh-centers-panel'];
  layer.listeners.click({target:{closest:()=>({dataset:{shcSection:'salary'},hasAttribute:()=>false})}});
  assert.match(layer.innerHTML,/Exchange Salary to Coins · Not Activated/);
  assert.match(layer.innerHTML,/<button class="shc-primary" type="button" disabled>/);
  assert.equal(window.sharikaCentersBack(),true);
  assert.match(layer.innerHTML,/Invite Host/);
  assert.equal(window.sharikaCentersBack(),true);
  assert.equal(layer.hidden,true);
  assert.equal(window.sharikaCentersBack(),false);
});

test('no payout or role mutation is performed from the UI presentation',()=>{
  const code=read('agency-centers.js');
  assert.doesNotMatch(code,/\.api\('(?:POST|PUT|DELETE)'/);
  assert.doesNotMatch(code,/localStorage|Math\.random/);
  assert.match(code,/service\.api\('GET','\/me'\)/);
});
