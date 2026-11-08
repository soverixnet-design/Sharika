import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('published event banners open separate detail and gift ranking, not main Rankings',()=>{
  const web=read('../../app/index.html');
  const android=read('../../android-staging/staging-connection.js');
  assert.match(web,/a==="event"&&typeof window\.showSharikaEvent/);
  assert.match(android,/event&&event\.published&&\['live','scheduled'\]/);
  assert.match(android,/window\.showSharikaEvent=async function/);
  assert.match(android,/\/events\/'.*ranking/);
  assert.match(android,/Event Rewards · Top 1–7/);
  assert.doesNotMatch(android,/sharika-room-events/);
  assert.doesNotMatch(android,/id="sh-event-launch"/);
});

test('admin chooses catalog gifts, banner, reward labels and hides drafts',()=>{
  const ui=read('../../admin/connection.js');
  const worker=read('../src/events.mjs');
  assert.match(ui,/data-sh-ev-gift/);
  assert.match(ui,/id="sh-ev-banner"/);
  assert.match(ui,/reward_labels:Array\.from/);
  assert.match(worker,/validateCampaignReferences/);
  assert.match(worker,/WHERE e\.status=\? AND e\.ends_at>=\?/);
  assert.match(worker,/settledEventRanking/);
  assert.match(worker,/event_rank_mismatch/);
});
