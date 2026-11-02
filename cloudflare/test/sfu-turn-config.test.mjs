import test from 'node:test';
import assert from 'node:assert/strict';
import { handleVoiceOperation } from '../src/sfu.mjs';

test('voice config provides only scoped Cloudflare TURN credentials and safely falls back', async () => {
  const originalFetch = globalThis.fetch;
  const baseEnv = { VOICE_ROOMS: {}, REALTIME_SFU_APP_ID: 'test-sfu',
    REALTIME_SFU_APP_SECRET: 'test-sfu-secret' };
  const config = env => handleVoiceOperation({
    request: { method: 'GET' }, env, room: { owner_id: 'member-1' },
    member: { seat_no: 1, muted: 0 }, uid: 'member-1', roomId: '10000001',
    operation: 'config', cors: {}, reply: value => value,
    fail: code => ({ error: code })
  });
  try {
    const fallback = await config(baseEnv);
    assert.equal(fallback.provider, 'cloudflare_sfu');
    assert.equal(fallback.publish, true);
    assert.deepEqual(fallback.iceServers, [{ urls: ['stun:stun.cloudflare.com:3478'] }]);

    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(String(url),
        'https://rtc.live.cloudflare.com/v1/turn/keys/test-turn/credentials/generate-ice-servers');
      assert.equal(options.method, 'POST');
      assert.equal(JSON.parse(options.body).ttl, 86400);
      return { ok: true, json: async () => ({ iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        { urls: ['turn:turn.cloudflare.com:3478?transport=udp',
          'turns:turn.cloudflare.com:443?transport=tcp',
          'turn:other.example:3478?transport=udp'],
          username: 'short-lived-user', credential: 'short-lived-password' }
      ] }) };
    };
    const result = await config({ ...baseEnv,
      REALTIME_TURN_KEY_ID: 'test-turn',
      REALTIME_TURN_API_TOKEN: 'private-server-token' });
    assert.equal(calls, 1);
    assert.equal(result.iceServers.length, 2);
    assert.equal(result.iceServers[1].username, 'short-lived-user');
    assert.equal(result.iceServers[1].urls.length, 2);
    assert.equal(JSON.stringify(result).includes('private-server-token'), false);

    globalThis.fetch = async () => ({ ok: false });
    const outage = await config({ ...baseEnv,
      REALTIME_TURN_KEY_ID: 'test-turn',
      REALTIME_TURN_API_TOKEN: 'private-server-token' });
    assert.deepEqual(outage.iceServers, fallback.iceServers);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
