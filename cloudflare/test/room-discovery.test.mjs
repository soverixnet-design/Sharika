import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const discovery=require('../../app/room-discovery.js');

test('registered country codes, country names and flags normalize consistently',()=>{
  for(const country of ['BD','Bangladesh','বাংলাদেশ','🇧🇩','🇧🇩 Bangladesh']){
    assert.equal(discovery.countryCode(country),'BD');
    assert.equal(discovery.flagForCountry(country),'🇧🇩');
  }
  assert.equal(discovery.countryCode('United Arab Emirates'),'AE');
  assert.equal(discovery.flagForCountry('Oman'),'🇴🇲');
  assert.equal(discovery.flagForCountry(''), '');
  assert.equal(discovery.countryCode('🇦🇪 United Arab Emirates'),'AE');
});

test('Popular uses live occupancy ahead of country and ignores stale template counts',()=>{
  const rooms=[
    {id:'10000001',owner_country:'US',n:900,online_count:0},
    {id:'10000002',owner_country:'Bangladesh',n:2,online_count:15},
    {id:'10000003',owner_country:'IN',n:50,online_count:3},
    {id:'10000004',owner_country:'BD',n:7,online_count:1}
  ];
  const expected=['10000002','10000003','10000004','10000001'];
  for(const viewer of ['BD','US','IN'])
    assert.deepEqual(discovery.sortRooms(rooms,viewer,'popular').map(r=>r.id),expected);
  assert.equal(discovery.onlineCount(rooms[0]),0);
  assert.equal(discovery.onlineCount({n:23}),23);
  assert.equal(discovery.onlineCount({online_count:-5,n:100}),0);
});

test('Popular uses a home-country tiebreaker when live counts match',()=>{
  const rooms=[
    {id:'10000001',owner_country:'US',online_count:5},
    {id:'10000002',owner_country:'BD',online_count:5},
    {id:'10000003',owner_country:'IN',online_count:8}
  ];
  assert.deepEqual(discovery.sortRooms(rooms,'BD','popular').map(r=>r.id),
    ['10000003','10000002','10000001']);
});

test('Global keeps every room, while selecting a country shows only its rooms',()=>{
  const rooms=[
    {id:'10000001',owner_country:'BD'},
    {id:'10000002',owner_country:'IN'},
    {id:'10000003',owner_country:'Bangladesh'},
    {id:'10000004',owner_country:'OM'}
  ];
  assert.deepEqual(discovery.filterRooms(rooms,''),rooms);
  assert.deepEqual(discovery.filterRooms(rooms,'BD').map(r=>r.id),
    ['10000001','10000003']);
  assert.deepEqual(discovery.filterRooms(rooms,'🇮🇳 India').map(r=>r.id),
    ['10000002']);
  assert.deepEqual(discovery.filterRooms(rooms,'OM').map(r=>r.id),
    ['10000004']);
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
