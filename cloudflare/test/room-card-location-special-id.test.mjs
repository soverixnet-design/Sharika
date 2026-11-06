import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');

test('room list serves verified owner Special ID alongside canonical room ID',()=>{
  assert.match(worker,/owner_display_id:r\.special_id\|\|r\.id/);
  assert.match(worker,/SELECT r\.\*,c\.version AS cover_version,u\.country AS owner_country/);
  assert.match(worker,/activeSpecialSelect\('u'\)\+' FROM sharika_rooms r '/);
  // The canonical r.id remains authoritative for API operations.
  assert.match(ui,/id:r\.id,name:r\.name/);
  assert.match(ui,/owner_display_id:r\.owner_display_id\|\|r\.id/);
});

test('room header, mic seats, listeners and user profiles prefer active Special ID',()=>{
  assert.match(ui,/paintSpecialIdLabel\(roomHeaderId,visibleOwnerId/);
  assert.match(ui,/owner\.special_id\|\|owner\.display_id\|\|room\.id/);
  assert.match(ui,/display_id:user\.special_id\|\|user\.display_id\|\|user\.public_id/);
  assert.match(ui,/id:user\.special_id\|\|user\.display_id\|\|user\.public_id/);
  assert.match(ui,/seat\?\.special_id\|\|seat\?\.display_id\|\|canonical/);
  assert.match(ui,/member\.special_id\|\|member\.display_id\|\|member\.id/);
  assert.match(ui,/target_public_id:verifiedId/);
});

test('outside room cards show account country, but photo management remains inside',()=>{
  assert.match(ui,/className='sh-room-country-label'/);
  assert.match(ui,/flagForCountry\(storedCountry\)/);
  assert.match(ui,/countryCode\(storedCountry\)/);
  assert.match(ui,/location\.textContent=title/);
  assert.match(ui,/paintSpecialIdLabel\(summary,displayId,!!room\.owner_special_id\)/);
  assert.doesNotMatch(ui,/textContent='📷 Edit photo'/);
  assert.match(ui,/row\(roomGroup,'Profile photo','Edit cover'/);
  assert.match(ui,/owner\?\(\)=>pickRoomCover\(room,frame\):null/);
});

test('signup requires manual ISO country; existing users can choose a country without GPS',()=>{
  const html=readFileSync(new URL('../../app/index.html',import.meta.url),'utf8');
  assert.match(html,/Manual ISO country selection/);
  assert.match(html,/option value="'\+c\[2\]/);
  assert.match(ui,/manualCountryOptions\(\)/);
  assert.match(ui,/Country \/ Location/);
  assert.match(ui,/openManualCountryPicker/);
  assert.match(ui,/api\('PATCH','\/me',\{country:code\}\)/);
  assert.match(ui,/country:manualCountryCode\(form\.country\)/);
  assert.match(ui,/if \(cached && cached\.name && cached\.dob && manualCountryCode\(cached\.country\)\)/);
});
