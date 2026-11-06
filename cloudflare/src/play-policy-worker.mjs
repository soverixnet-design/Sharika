// Isolated public policy worker. It does not replace Sharika's voice/API worker.
import { handlePublicAccountDeletion } from './account-deletion.mjs';
import { handlePublicPrivacyPolicy } from './privacy-policy.mjs';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const deletion = await handlePublicAccountDeletion(request, env, path);
    if (deletion) return deletion;
    const privacy = handlePublicPrivacyPolicy(request, path);
    if (privacy) return privacy;
    return new Response('Not found', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store'
      }
    });
  }
};
