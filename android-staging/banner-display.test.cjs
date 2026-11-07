const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..');
const imageUrl = 'https://sharika-api-staging.soverixnet.workers.dev/api/v1/banners/1/image?v=2';
const imageBanner = {
  id: 1, title: 'Extra headline', subtitle: 'Extra subtitle', emoji: '🎉',
  color_a: '#112233', color_b: '#445566', action: 'recharge', image_url: imageUrl
};

function renderStagingBanner(rows) {
  const src = fs.readFileSync(path.join(__dirname, 'staging-connection.js'), 'utf8');
  const start = src.indexOf('function verifiedBannerImageUrl(');
  const end = src.indexOf('async function refreshVerifiedBanners()', start);
  assert.ok(start > 0 && end > start, 'verified banner renderer must exist');
  const elements = {ban: {innerHTML: ''}, dots: {innerHTML: ''}};
  const context = {
    window: {CFG: {}},
    document: {getElementById(id) {return elements[id]}},
    sellerEscape(v) {return String(v).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c])}
  };
  vm.runInNewContext(src.slice(start, end) + '\nrenderVerifiedBanners(rows);',
    {...context, rows});
  return elements.ban.innerHTML;
}

test('staging photo banners show only the original artwork', () => {
  const html = renderStagingBanner([imageBanner]);
  assert.match(html, /class="slide slide--image"/);
  assert.match(html, /class="banner-art"/);
  assert.match(html, /object-fit|loading="eager"/);
  assert.doesNotMatch(html, /<b>|<small>|<i>|linear-gradient|rgba\(/);
  assert.match(html, /aria-label="Extra headline"/);
});

test('text-only banners retain their title, subtitle and action card', () => {
  const html = renderStagingBanner([{...imageBanner, image_url: null}]);
  assert.match(html, /<b>Extra headline<\/b><small>Extra subtitle<\/small>/);
  assert.match(html, /linear-gradient\(135deg/);
  assert.doesNotMatch(html, /banner-art|slide--image/);
});

test('original carousel also omits image-overlay text and light effects', () => {
  const html = fs.readFileSync(path.join(repo, 'app/index.html'), 'utf8');
  const baseCss = html.slice(html.indexOf('.slide.slide--image'), html.indexOf('@keyframes fl'));
  const goldCss = fs.readFileSync(path.join(repo, 'app/golden-home.css'), 'utf8');
  assert.match(baseCss, /\.slide\.slide--image::after\{content:none\}/);
  assert.match(baseCss, /object-fit:contain/);
  assert.match(goldCss, /\.slide\.slide--image::after \{ content: none; \}/);
  assert.match(html, /b\.img\s*\?'<div class="slide slide--image"/);
  assert.doesNotMatch(html.slice(html.indexOf('applyAdmin();$("ban").innerHTML'),
    html.indexOf('$("dots").innerHTML')), /rgba\(0,0,0,\.6\)/);
});
