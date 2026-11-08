// Release-preparation entrypoint. Real handlers and a separate production
// Durable Object class are wired, but the public API is compile-time gated.
// Never enable without code review, account-scoped secrets, and device QA.
import {handleRequest} from './index.mjs';
import {createProductionFetch} from './production-readiness.mjs';
export {SharikaVoiceRoom} from './voice-room.mjs';

export default {fetch: createProductionFetch(handleRequest)};
// Deliberately no scheduled handler: automated payouts and game settlements
// remain off until their production test plans have passed.
