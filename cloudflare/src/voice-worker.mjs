// Deployment entrypoint. Node unit tests import index.mjs without Worker globals.
export { SharikaVoiceRoom } from './voice-room.mjs';
export { default } from './index.mjs';
