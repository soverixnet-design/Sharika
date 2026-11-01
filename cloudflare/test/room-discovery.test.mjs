import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const discovery=require('../../app/room-discovery.js');

test('registered country codes, country names and flags normalize consistently',()=>{
  for(const country of ['BD','Bangladesh','বাংলাদেশ','🇧🇩']){
    assert.equal(discovery.countryCode(country),'BD');
    assert.equal(discovery.flagForCountry(country),'🇧🇩');
  }
  assert.equal(discovery.countryCode('United Arab Emirates'),'AE');
  assert.equal(discovery.flagForCountry('Oman'),'🇴🇲');
  assert.equal(discovery.flagForCountry(''), '');
});

test('same-country rooms precede more popular foreign rooms; other rooms stay visible',()=>{
  const rooms=[
    {id:'10000001',owner_country:'US',n:90},
    {id:'10000002',owner_country:'Bangladesh',n:2},
    {id:'10000003',owner_country:'IN',n:50},
    {id:'10000004',owner_country:'BD',n:7}
  ];
  assert.deepEqual(discovery.sortRooms(rooms,'BD','popular').map(r=>r.id),
    ['10000004','10000002','10000001','10000003']);
  assert.deepEqual(discovery.sortRooms(rooms,'US','popular').map(r=>r.id),
    ['10000001','10000003','10000004','10000002']);
});

test('New is country-first then newest; History only shows visited rooms',()=>{
  const rooms=[
    {id:'10000001',owner_country:'BD',created_at:'2026-01-01'},
    {id:'10000002',owner_country:'US',created_at:'2026-09-01'},
    {id:'10000003',owner_country:'BD',created_at:'2026-05-01'}
  ];
  assert.deepEqual(discovery.sortRooms(rooms,'BD','new').map(r=>r.id),
    ['10000003','10000001','10000002']);
  assert.deepEqual(discovery.sortRooms(rooms,'BD','history',['10000002','10000001']).map(r=>r.id),
    ['10000001','10000002']);
  assert.deepEqual(discovery.sortRooms(rooms,'BD','history',[]),[]);
});

test('history persists recent unique room visits independently per signed-in user',()=>{
  const data=new Map();
  const storage={getItem:key=>data.get(key)||null,setItem:(key,val)=>data.set(key,val)};
  assert.deepEqual(discovery.recordVisit(storage,'firebase:alice','10000001'),['10000001']);
  discovery.recordVisit(storage,'firebase:alice','10000002');
  discovery.recordVisit(storage,'firebase:alice','10000001');
  discovery.recordVisit(storage,'firebase:bob','10000003');
  assert.deepEqual(discovery.readHistory(storage,'firebase:alice'),['10000001','10000002']);
  assert.deepEqual(discovery.readHistory(storage,'firebase:bob'),['10000003']);
  assert.deepEqual(discovery.recordVisit(storage,'firebase:alice','invalid'),[]);
  assert.deepEqual(discovery.readHistory(storage,'firebase:alice'),['10000001','10000002']);
});
