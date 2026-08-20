'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { buildPinnedHttpsOptions } = require('../lib/pinned-https.js');

const port = Number(process.env.RANKCUT_TEST_PORT || 4185);
const base = `http://127.0.0.1:${port}`;
const root = path.resolve(__dirname, '..');
const dataRoot = path.resolve(process.env.RANKCUT_TEST_DATA_DIR || path.join(root, 'data'));
const jobsDir = path.join(dataRoot, 'jobs');
const ffmpeg = path.join(root, 'tools', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

function prepareImageFixture() {
  fs.mkdirSync(jobsDir, { recursive:true });
  const output = path.join(jobsDir, 'platform-smoke.jpg');
  const result = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x55e6ff:size=320x180', '-frames:v', '1', output], { encoding:'utf8' });
  assert.strictEqual(result.status, 0, result.stderr || 'could not generate the meme image fixture');
  return output;
}

function verifyPinnedImageLookup() {
  const options = buildPinnedHttpsOptions(new URL('https://images.example.test:8443/meme.png?size=large'), { address:'203.0.113.8', family:4 }, { 'User-Agent':'RankCut-Studio/test' });
  assert.strictEqual(options.hostname, 'images.example.test');
  assert.strictEqual(options.servername, 'images.example.test');
  assert.strictEqual(options.port, '8443');
  assert.strictEqual(options.path, '/meme.png?size=large');
  assert.strictEqual(options.agent, false);
  options.lookup('images.example.test', {}, (error, address, family) => {
    assert.ifError(error);
    assert.strictEqual(address, '203.0.113.8');
    assert.strictEqual(family, 4);
  });
}

async function json(url, options) {
  const response = await fetch(base + url, options);
  const body = await response.json();
  assert(response.ok, `${url}: ${body.error || response.status}`);
  assert(body.ok, `${url}: expected ok`);
  return body;
}

async function expectJsonError(url, options) {
  const response = await fetch(base + url, options);
  const body = await response.json();
  assert(!response.ok, `${url}: expected an error response`);
  assert(body.error, `${url}: expected a useful error message`);
}

async function main() {
  verifyPinnedImageLookup();
  const imagePath = prepareImageFixture();

  for (const page of ['/', '/ranking', '/meme']) {
    const response = await fetch(base + page);
    assert.strictEqual(response.status, 200, `${page} should load`);
    assert((response.headers.get('content-type') || '').includes('text/html'), `${page} should serve HTML`);
  }
  assert.strictEqual((await fetch(base + '/video-editor')).status, 404, 'the clean release must not expose a Video Editor route');

  const health = await json('/api/health');
  assert(health.tools.ffmpeg && health.tools.ffprobe && health.tools.ytdlp, 'core media tools should be ready');
  assert(!Object.prototype.hasOwnProperty.call(health.tools, 'whisper'), 'Video Editor tooling must be absent');

  const integrations = (await json('/api/meme/integrations')).integrations;
  assert(['templates','gifs','trending'].every((source) => typeof integrations[source]?.enabled === 'boolean'), 'integration state should describe every meme source');
  if (integrations.gifs.enabled) {
    const gifSearch = await json('/api/meme/search?source=gifs&q=celebrate');
    assert(!gifSearch.error && Array.isArray(gifSearch.items) && gifSearch.items.length > 0, 'configured GIF search should return results');
  }
  await expectJsonError('/api/meme/import', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ url:'https://127.0.0.1/private.png', manual:true }) });

  const sticker = await fetch(base + '/meme/stickers/burst.svg');
  assert(sticker.ok && (sticker.headers.get('content-type') || '').includes('image/svg+xml'), 'bundled stickers should be served');
  const font = await fetch(base + '/meme/fonts/Bangers-Regular.ttf');
  assert(font.ok && (font.headers.get('content-type') || '').includes('font/ttf'), 'the bundled font should be served');

  const memeProject = { version:1, aspect:'1:1', image:null, layers:[], filter:'none', distortion:'none', layout:'single' };
  await json('/api/meme/project', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ project:memeProject }) });
  assert.deepStrictEqual((await json('/api/meme/project')).project.aspect, '1:1');

  const image = fs.readFileSync(imagePath);
  const uploaded = await json('/api/meme/upload?filename=smoke.jpg', { method:'PUT', body:image });
  assert(uploaded.asset.url.startsWith('/media/'));
  const dataUrl = `data:image/jpeg;base64,${image.toString('base64')}`;
  const staticExport = await json('/api/meme/export', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ dataUrl, filename:'smoke.jpg' }) });
  assert(staticExport.export.url.startsWith('/media/'));
  const animatedExport = await json('/api/meme/export-animated', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ frames:[dataUrl, dataUrl, dataUrl], fps:6, format:'mp4' }) });
  assert(animatedExport.export.name.endsWith('.mp4'));

  console.log('Clean platform smoke test passed: dashboard, Ranking, Meme Editor, secure imports, bundled assets, and exports; Video Editor is absent.');
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
