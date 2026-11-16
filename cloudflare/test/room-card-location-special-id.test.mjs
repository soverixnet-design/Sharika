import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');

test('room list uses the owner’s permanent serial alongside the stored room key',()=>{
  assert.match(worker,/room_display_id:owner_public_no\?publicId\(owner_public_no\):null/);
  assert.match(worker,/SELECT r\.\*,COALESCE\(al\.locked,0\) AS access_locked,c\.version AS cover_version,u\.country AS owner_country/);
  assert.match(worker,/activeSpecialSelect\('u'\)\+' FROM sharika_rooms r '/);
  // The canonical r.id remains authoritative for API operations.
  assert.match(ui,/id:r\.id,name:r\.name/);
  assert.match(ui,/room_display_id:r\.room_display_id/);
});

test('room header uses the room serial, mic seats and profiles retain active Special ID',()=>{
  assert.match(ui,/roomHeaderId\.textContent=String\(\s*room\.room_display_id\|\|ownerMember\?\.sharika_users\?\.public_id\|\|room\.id/);
  assert.doesNotMatch(ui,/api\('GET','\/users\/'\+room\.id\)/);
  assert.match(worker,/room: roomId,room_name:room\.name,room_display_id:ownerPublicNo\?publicId\(ownerPublicNo\):null/);
  assert.match(ui,/display_id:user\.special_id\|\|user\.display_id\|\|user\.public_id/);
  assert.match(ui,/id:user\.special_id\|\|user\.display_id\|\|user\.public_id/);
  assert.match(ui,/seat\?\.special_id\|\|seat\?\.display_id\|\|canonical/);
  assert.match(ui,/person\?\.special_id\|\|person\?\.display_id\|\|person\?\.public_id/);
  assert.match(ui,/target_public_id:verifiedId/);
});

test('room cards put verified identity below the unfiltered photo',()=>{
  const html=readFileSync(new URL('../../app/index.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../../app/golden-home.css',import.meta.url),'utf8');
  const cardSource=html.slice(html.indexOf('function cardHTML('),html.indexOf('function renderRooms()'));
  const validateSource=ui.slice(ui.indexOf('  function verifiedCoverUrl('),ui.indexOf('  function verifiedThemeUrl('))+
    ui.match(/  window\.sharikaVerifiedRoomCover=[\s\S]*?\n  };/)[0];
  const window={SharikaDiscovery:{flagForCountry:()=> '🇧🇩',countryCode:()=> 'BD'}};
  const render=runInNewContext(validateSource+'\n'+cardSource+'\ncardHTML',{
    window,bn:String,esc:value=>String(value).replaceAll('<','&lt;').replaceAll('"','&quot;'),
  });
  const photo='https://sharika-api-staging.soverixnet.workers.dev/api/v1/rooms/10000002/cover?v=40';
  const room={id:'10000002',room_display_id:'10000018',name:'<A Room>',owner_country:'BD',
    cover_url:photo,n:3,access_locked:1};
  const card=render(room);
  assert.match(card,/data-id="10000002"/);
  assert.match(card,/class="room-card-cover">[^]*?class="sh-room-card-photo"[^]*?<\/div><div class="room-card-details">/);
  assert.match(card,/aria-label="3 online"[^]*?aria-label="Locked"/);
  assert.match(card,/class="room-card-details">[^]*?&lt;A Room>[^]*?aria-label="Bangladesh">🇧🇩[^]*?ID 10000018/);
  assert.doesNotMatch(card,/class="(?:pat|shine|tilt|live)"/);
  assert.doesNotMatch(render({...room,cover_url:photo.replace('10000002','10000003')}),/sh-room-card-photo/);
  assert.doesNotMatch(render({...room,cover_url:'https://example.test/cover.jpg'}),/sh-room-card-photo/);
  assert.match(css,/\.sh-room-card-photo \{[^}]*object-fit:cover/);
  assert.match(ui,/row\(roomGroup,'Profile photo',owner\?'Edit cover':''/);
  assert.match(ui,/paintRoomCoverPreview\(preview,verifiedCoverUrl\(room\.cover_url\)\)/);
  assert.match(ui,/owner\?\(\)=>pickRoomCover\(room,frame\):null/);
});

test('signup requires manual ISO country; existing users can choose a country without GPS',()=>{
  const html=readFileSync(new URL('../../app/index.html',import.meta.url),'utf8');
  assert.match(html,/Manual ISO country selection/);
  assert.match(html,/option value="'\+c\[2\]/);
  assert.match(ui,/manualCountryOptions\(\)/);
  assert.match(ui,/Country \/ Location/);
  assert.match(ui,/openManualCountryPicker/);
  assert.match(ui,/api\('PUT','\/me\/location',\{/);
  assert.match(ui,/country:manualCountryCode\(form\.country\)/);
  assert.match(ui,/if \(cached && cached\.name && cached\.dob && manualCountryCode\(cached\.country\)\)/);
});
