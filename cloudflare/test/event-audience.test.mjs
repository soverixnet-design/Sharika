import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedMemberCountry,validEventAudience,eventAudienceAllows,
 readMemberCountry} from '../src/event-audience.mjs';
import {validEventPayload} from '../src/events.mjs';

test('manual country codes and historic country names are normalized without GPS',()=>{
 for(const [raw,normalized] of [['BD','BD'],['Bangladesh','BD'],['  bangladesh ','BD'],
   ['India','IN'],['OMAN','OM'],['United Arab Emirates','AE'],['de','DE'],
   ['',''],['unknown country','']]){
  assert.equal(normalizedMemberCountry(raw),normalized);
 }
 assert.equal(eventAudienceAllows('BD','Bangladesh'),true);
 assert.equal(eventAudienceAllows('BD','India'),false);
 assert.equal(eventAudienceAllows('GLOBAL','India'),true);
 assert.equal(eventAudienceAllows('BD',''),false);
});
test('audience editor accepts only Global or uppercase two-letter country codes',()=>{
 for(const country of [undefined,'GLOBAL','BD','IN','DE','US'])assert.equal(validEventAudience(country),true);
 for(const country of ['bd','BanGladesh','ALL','',false,'🇧🇩','US\n','GLOBAL ')assert.equal(validEventAudience(country),false);
});
test('event save rejects spoofed geographic audience values',()=>{
 const base={title:'Royal CP Country QA',kind:'festival',description:'Safe',
  starts_at:'2035-11-20T00:00:00.000Z',ends_at:'2035-11-21T00:00:00.000Z',
  prizes:[1000,500,100],status:'draft',country_code:'BD'};
 assert.equal(validEventPayload(base),true);
 assert.equal(validEventPayload({...base,country_code:'bangladesh'}),false);
 assert.equal(validEventPayload({...base,country_code:'GLOBAL'}),true);
});
test('readMemberCountry only trusts the authenticated active profile',async()=>{
 const calls=[];
 const db={prepare(sql){return {bind(uid){calls.push({sql,uid});return {async first(){
  return uid==='member-a'?{country:'Bangladesh'}:null;
 }}}}}};
 assert.equal(await readMemberCountry(db,'member-a'),'BD');
 assert.equal(await readMemberCountry(db,'member-b'),'');
 assert.ok(calls.every(x=>x.sql.includes("status='active'")));
});
