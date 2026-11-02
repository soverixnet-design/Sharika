import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../android-staging/staging-connection.js', import.meta.url), 'utf8');
const start = source.indexOf('  async function startSfuPublishing(state) {');
const end = source.indexOf('  async function connectSfu(roomId,canPublish', start);
assert.ok(start > 0 && end > start, 'publisher helper must remain available');
const helper = source.slice(start, end);

function simulatedSeatPromotion(failPublish = false) {
  let stopped = false, closedReceiver = false, cleaned = 0;
  const receiver = { connectionState: 'connected', close() { closedReceiver = true; } };
  const state = { roomId: '10000001', closed: false, canPublish: false,
    sessionIds: ['subscriber-1'], receivePC: receiver,
    publishPC: null, media: null, recoveryTimer: null };
  const audioTrack = { readyState: 'live', enabled: true,
    addEventListener() {}, stop() { stopped = true; } };
  class FakePeer {
    constructor() { this.connectionState = 'connected'; this.iceGatheringState = 'complete'; }
    addTransceiver() { return { mid: '0' }; }
    async createOffer() { return { type: 'offer', sdp: 'v=0' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription() {}
    addEventListener() {}
    close() { this.connectionState = 'closed'; }
  }
  const dependencies = {
    sfuState: state, wantedVoiceRoom: state.roomId, session: { user: { id: 'user-1' } },
    navigator: { mediaDevices: { getUserMedia: async () => ({
      getAudioTracks: () => [audioTrack], getTracks: () => [audioTrack] }) } },
    RTCPeerConnection: FakePeer,
    SHARIKA_ICE_CONFIG: { iceServers: [] }, microphoneWanted: () => true,
    watchSfuSpeaking() {}, unwatchSfuSpeaking() {},
    waitIce: async () => {},
    api: async (method, path) => {
      if(path.endsWith('/voice/session'))return { sessionId: 'publisher-1' };
      if(path.endsWith('/voice/publish')){
        if(failPublish)throw new Error('simulated publish outage');
        return { sessionDescription: { type: 'answer', sdp: 'v=0' } };
      }
      if(path.endsWith('/voice/leave'))cleaned++;
      return {};
    },
    markLocalMicrophone() {}, sfuTransportHealthy: () => true,
    recoverSfuPublication() {}
  };
  const factory = new Function('deps',
    'const {' + Object.keys(dependencies).join(',') + '}=deps;' +
      helper + 'return startSfuPublishing;');
  return { state, receiver, promote: factory(dependencies),
    get stopped() { return stopped; },
    get closedReceiver() { return closedReceiver; },
    get cleaned() { return cleaned; } };
}

test('taking the first microphone seat preserves the live receive connection', async () => {
  const sim = simulatedSeatPromotion();
  await sim.promote(sim.state);
  assert.equal(sim.state.canPublish, true);
  assert.equal(sim.state.receivePC, sim.receiver);
  assert.equal(sim.closedReceiver, false);
  assert.deepEqual(sim.state.sessionIds, ['subscriber-1', 'publisher-1']);
});

test('failed microphone publishing leaves incoming audio connected', async () => {
  const sim = simulatedSeatPromotion(true);
  await assert.rejects(sim.promote(sim.state), /simulated publish outage/);
  assert.equal(sim.state.canPublish, false);
  assert.equal(sim.state.receivePC, sim.receiver);
  assert.equal(sim.closedReceiver, false);
  assert.deepEqual(sim.state.sessionIds, ['subscriber-1']);
  assert.equal(sim.stopped, true);
  assert.equal(sim.cleaned, 1);
});
