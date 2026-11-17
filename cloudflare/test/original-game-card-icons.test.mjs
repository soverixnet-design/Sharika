import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const iconSource = path.join(root, 'android-staging/game-icons');
const gradle = fs.readFileSync(path.join(root, 'android-staging/app/build.gradle'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'android-staging/staging-connection.js'), 'utf8');

test('owner-approved original icons are bundled and assigned only to the three new games', () => {
  const expected = [
    ['food-deluxe', 'Food Wheel Deluxe', 'fruit-machine.webp'],
    ['greedy-classic', 'Greedy Game', 'greedy-game.webp'],
    ['cleopatra', "Cleopatra's Gold Deluxe", 'cleopatra.webp']
  ];
  const blobs = new Set();
  for (const [id, name, image] of expected) {
    const marker = "{id:'" + id + "',";
    const at = adapter.indexOf(marker);
    assert.ok(at >= 0, 'missing game ' + id);
    const entry = adapter.slice(at, adapter.indexOf('}', at));
    assert.ok(entry.includes('name:' + (id === 'cleopatra' ? '"' : "'") + name + (id === 'cleopatra' ? '"' : "'")),
      'game name must remain the original: ' + name);
    assert.ok(entry.includes("image:'file:///android_asset/" + image + "'"),
      'incorrect game-card image for ' + id);
    assert.ok(gradle.includes("from(rootProject.file('game-icons/" + image + "'))"),
      'image not packaged into Android assets: ' + image);
    const bytes = fs.readFileSync(path.join(iconSource, image));
    assert.ok(bytes.length > 20000, 'missing or tiny HD icon: ' + image);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', 'not a WebP file: ' + image);
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', 'not a WebP file: ' + image);
    blobs.add(bytes.toString('base64'));
  }
  assert.equal(blobs.size, expected.length, 'all three cards must have distinct icon files');
  assert.ok(adapter.includes("img.style.objectFit='contain'"),
    'square originals must not be cropped in the landscape game picker');
});
