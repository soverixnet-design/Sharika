import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');
const start=source.indexOf('  P.sellers=async function(){');
const end=source.indexOf('\n  };',start)+6;
const endpoints=['sellers','sellers/transfers','sellers/allocations','sellers/play-recharge-permission-audit'];
const ids=['seller-list','seller-transfers','seller-allocations','seller-recharge-audit'];
for(const failed of [null,...endpoints]){
  test('seller panels preserve successful responses when '+(failed||'nothing')+' fails',async()=>{
    const elements=new Map();
    const byId=id=>{
      if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',insertAdjacentHTML(){}});
      return elements.get(id);
    };
    const calls=[];
    const context={P:{},byId,role:'finance',esc:String,fmt:String,
      window:{T:(headers,rows)=>JSON.stringify({headers,rows})},
      api:async(method,path)=>{
        calls.push([method,path]);
        if(path===failed)throw new Error('Endpoint unavailable');
        return {sellers:[{public_id:'10000001',name:'Seller',active:true,available_coins:42}],
          transfers:[{id:1,coins:5}],allocations:[{id:2,coins:8}],changes:[{id:3,allowed:false,reason:'Revoked permission'}]};
      }};
    runInNewContext(source.slice(start,end),context);
    await context.P.sellers();
    assert.equal(calls.length,4);
    assert.ok(calls.every(([method])=>method==='GET'));
    ids.forEach((id,i)=>{
      const element=elements.get(id);
      if(endpoints[i]===failed){
        assert.equal(element.textContent,'Unavailable: Endpoint unavailable');
        assert.equal(element.innerHTML,'');
      }else assert.equal(JSON.parse(element.innerHTML).rows.length,1);
    });
  });
}
