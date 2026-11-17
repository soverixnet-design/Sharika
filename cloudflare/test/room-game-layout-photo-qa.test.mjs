import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const adapter=readFileSync(path.join(root,'android-staging/staging-connection.js'),'utf8');
const home=readFileSync(path.join(root,'app/index.html'),'utf8');
const food=readFileSync(path.join(root,'android-staging/app/src/main/assets/original-games/food-wheel-deluxe.html'),'utf8');

test('Food Deluxe room shell scales the sheet, not the wagering canvas',()=>{
  assert.match(adapter,/function fitFoodDeluxeRoomSheet\(\)/);
  assert.match(adapter,/frameHeight\*\(1080\/2352\)/);
  assert.match(adapter,/Math\.min\(480,viewportWidth,optimal\)/);
  assert.match(adapter,/sheet\.style\.width=target\+'px'/);
  assert.match(adapter,/if\(insideRoom&&item\.id==='food-deluxe'\)fitFoodDeluxeRoomSheet\(\)/);
  assert.match(food,/const s=Math\.min\(innerWidth\/1080,innerHeight\/2352\)/);
  assert.doesNotMatch(food,/scaleX\(|scaleY\(/);
});
test('game aspect observers and resize listeners are released on every exit',()=>{
  assert.match(adapter,/function resetFoodDeluxeAspectFit\(\)/);
  assert.match(adapter,/sheet\.__shFoodDeluxeObserver\?\.disconnect\(\)/);
  assert.match(adapter,/removeEventListener\('resize',sheet\.__shFoodDeluxeResize\)/);
  const cleanup=adapter.slice(adapter.indexOf('view.__sharikaOriginalGameCleanup=()=>{'));
  assert.match(cleanup.slice(0,400),/resetFoodDeluxeAspectFit\(\)/);
  assert.match(adapter,/function catalog\(\)\{\s*resetFoodDeluxeAspectFit\(\)/);
  assert.match(adapter,/function preview\(item\)\{\s*resetFoodDeluxeAspectFit\(\)/);
});
test('room creation has a gallery control, validates photo before D1 creation',()=>{
  assert.match(home,/id=\\"sh-new-room-cover\\"/);
  assert.match(home,/type=\\"file\\" accept=\\"image\/\*\\"/);
  const creation=adapter.slice(adapter.indexOf("const selectedPhoto=document.getElementById('sh-new-room-cover')"));
  assert.ok(creation.indexOf('await jpegRoomPreview(selectedPhoto)')<creation.indexOf("await api('POST','/rooms'"));
  assert.match(creation.slice(0,2100),/photoError='Room ID was not returned/);
  assert.match(creation.slice(0,2800),/Room created; photo could not be saved/);
});
test('cover images remain versioned/verified, room theme image stays separate',()=>{
  assert.match(adapter,/function verifiedCoverUrl\(value\)/);
  assert.match(adapter,/function verifiedThemeUrl\(value\)/);
  assert.match(adapter,/await api\('PUT','\/rooms\/'\+room\.id\+'\/theme-image'/);
  assert.match(adapter,/await api\('PUT','\/rooms\/'\+room\.id\+'\/cover'/);
  assert.match(adapter,/paintRoomCoverPreview\(frame\.\$\?\.\('sh-room-cover-preview'\),roomCover\)/);
});
