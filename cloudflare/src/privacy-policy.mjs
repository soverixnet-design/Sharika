// Public mirror of the Privacy Policy already shown in Sharika's sign-up UI.
// Play Store visitors must be able to read it before installing the app.
const POLICY = [
  ['Who we are', 'Sharika Voice Chat App ("Sharika", "we", "us") is a social voice chat app where people join live voice rooms, chat, send virtual gifts and play games.'],
  ['Information we collect', 'Account details (name, email or phone number, password, date of birth, country, profile photo); activity (rooms you join, messages, gifts, coin and diamond transactions); device data (device ID, IP address, app version, crash logs); and the voice you stream live in rooms.'],
  ['Voice and permissions', 'The app asks for microphone access only so you can speak in rooms, and photo access only when you choose a picture. You can turn these off in your phone settings. Voice is streamed live and is not saved by default; it may be reviewed if a report is filed.'],
  ['How we use it', 'To run your account and rooms, show rankings, process purchases and rewards, keep the community safe, prevent fraud and abuse, send notifications you allow, and improve the app.'],
  ['Sharing', 'Your public profile (name, ID, photo, level, country) is visible to other users. We share data only with service providers that help us run the app (hosting, voice, SMS, payments, analytics) and when required by law. We do not sell your personal data.'],
  ['Children and teens', 'Sharika is for people aged 13 and over. Users under 18 get a restricted experience: chance-based and betting-style games, including Lucky gifts, are turned off.'],
  ['Retention and deletion', 'We keep your data while your account is active. You may request deletion through Customer Service in the app or at our public account deletion request page. We review account ownership before processing deletion of associated data. Some records may need to be retained for legal compliance, security or fraud prevention.'],
  ['Security', 'We use industry-standard protections such as encrypted connections and hashed passwords. No system is 100% secure, so please keep your password private.'],
  ['Your choices', 'You can edit your profile, block or report users, and control permissions and notifications. You may request access to or correction of your data.'],
  ['Changes and contact', 'We may update this policy and show the updated date. For questions, contact Customer Service from the Messages tab in Sharika.']
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
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export function handlePublicPrivacyPolicy(request, path) {
  if (path !== '/privacy-policy') return null;
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  const sections = POLICY.map(([title, text]) =>
    `<section><h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p></section>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sharika Privacy Policy</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:24px;background:linear-gradient(145deg,#160e23,#302020);color:#f5e8d5;font-family:system-ui,-apple-system,sans-serif}main{max-width:720px;margin:auto;background:#1c1527;border:1px solid #c89c51;border-radius:20px;padding:26px}h1{margin-top:6px;color:#ffe0a1}h2{font-size:18px;color:#e5ba76;margin-bottom:4px}p{line-height:1.6;color:#eadff0;margin-top:0}.brand{font-size:13px;letter-spacing:2px;color:#ebbd64}a{color:#ffe09c}footer{border-top:1px solid #84653e;margin-top:22px;padding-top:20px}</style></head><body><main><div class="brand">SHARIKA · VOICE CHAT</div><h1>Privacy Policy</h1><p>Last updated: November 2026</p>${sections}<footer><a href="/account-deletion">Request account and data deletion</a></footer></main></body></html>`;
  return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers: HEADERS });
}
