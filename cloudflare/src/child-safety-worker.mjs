// Public, standalone Child Safety Standards for Sharika's Google Play listing.
// Deliberately separate from the voice/API and account-deletion workers.

const SECTIONS = [
  {
    title: 'Zero tolerance for child sexual abuse and exploitation',
    paragraphs: [
      'Sharika voice chat app (Sharika) prohibits all child sexual abuse and exploitation (CSAE) and child sexual abuse material (CSAM). This includes creating, requesting, uploading, distributing or facilitating such material or conduct; grooming; sexual extortion involving a minor; sexual trafficking of children; and using voice rooms, messages, gifts, profiles or any other feature to exploit or endanger a child.',
      'These rules apply to every account and all user-generated content. Sharika is intended for adults aged 18 and over on Google Play. An age designation is not an exemption from our responsibility to protect children.'
    ]
  },
  {
    title: 'Report a concern in the app',
    paragraphs: [
      'Signed-in users can open a user profile and choose Report, or open a room information panel and choose Report this room. These reports go to Sharika Support for review. Describe the affected user or room ID and what happened. You may also email soverixnet@gmail.com with the subject "Sharika Child Safety Report".',
      'For your safety, do not download, copy or forward suspected CSAM to us or to other users. Report the account, room or relevant identifying information instead. If someone is in immediate danger, contact local emergency services or law enforcement without waiting for a response from Sharika.'
    ]
  },
  {
    title: 'Review, removal and enforcement',
    paragraphs: [
      'We review reported child-safety concerns, restrict access to reports to authorized support and safety personnel, and investigate with appropriate priority. When we identify material or behavior that violates these standards, we take appropriate action, including removing prohibited material where technically possible, blocking or suspending involved accounts, and preventing further access or distribution.',
      'We preserve only the information necessary for safety review, legal compliance or an authorized investigation, and do not publish or redistribute suspected CSAM.'
    ]
  },
  {
    title: 'Reports to authorities and legal compliance',
    paragraphs: [
      'Our designated safety contact escalates confirmed CSAM cases for appropriate handling. We report confirmed CSAM and other legally reportable child-safety incidents to the relevant national or regional authorities, or the National Center for Missing & Exploited Children (NCMEC) where applicable, in accordance with relevant laws and reporting requirements. We cooperate with lawful requests from competent authorities.',
      'These standards are reviewed as needed when laws, reporting obligations or app features change.'
    ]
  },
  {
    title: 'Designated child-safety contact',
    paragraphs: [
      'Responsible contact: Soverix Net, the developer of Sharika voice chat app. Child-safety reports and Google Play inquiries: soverixnet@gmail.com.'
    ]
  }
];

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=300',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function render() {
  const sections = SECTIONS.map(section =>
    `<section><h2>${escapeHtml(section.title)}</h2>${section.paragraphs.map(text =>
      `<p>${escapeHtml(text)}</p>`).join('')}</section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sharika Child Safety Standards | Soverix Net</title><meta name="description" content="Published child safety standards against CSAE and CSAM for Sharika voice chat app."><style>*{box-sizing:border-box}body{margin:0;padding:24px;min-height:100vh;background:radial-gradient(circle at top,#4b2e3d,#170f24 68%);color:#f7ead4;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6}main{max-width:820px;margin:auto;padding:26px 30px;border-radius:22px;border:1px solid #cba866;background:#20162d;box-shadow:0 20px 65px #0d0615}header{border-bottom:1px solid #74543b;margin-bottom:20px;padding-bottom:14px}.brand{letter-spacing:2px;color:#e9b963;font-weight:800;font-size:13px}h1{font-size:clamp(27px,5vw,37px);line-height:1.2;margin:10px 0;color:#ffe1a0}h2{font-size:20px;margin:27px 0 8px;color:#efc681}p{margin:8px 0 13px;color:#efe3ee}a{color:#ffe2a0;overflow-wrap:anywhere}footer{margin-top:26px;padding-top:18px;border-top:1px solid #74543b;font-size:14px;color:#d8c6d7}@media(max-width:550px){body{padding:10px}main{padding:22px 19px;border-radius:15px}}</style></head><body><main><header><div class="brand">SHARIKA · SOVERIX NET</div><h1>Child Safety Standards</h1><p>Our public standards against child sexual abuse and exploitation (CSAE).</p><small>Effective: 7 November 2026 · Applies worldwide</small></header>${sections}<footer><p>For privacy and data deletion information, visit <a href="https://sharika-play-policy.soverixnet.workers.dev/privacy-policy">Privacy Policy</a> or <a href="https://sharika-play-policy.soverixnet.workers.dev/account-deletion">Account Deletion</a>.</p></footer></main></body></html>`;
}

export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path !== '/' && path !== '/child-safety') {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    return new Response(request.method === 'HEAD' ? null : render(), { status: 200, headers: HEADERS });
  }
};
