/*
 * RankCut Studio
 * Dependency-free local HTTP server. Video downloading is delegated to yt-dlp
 * and rendering to FFmpeg, both stored in ./tools by setup.ps1.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const RankingLayout = require('./static/ranking-layout.js');

const ROOT = __dirname;
const PROJECT_VERSION = 4;
const STATIC_DIR = path.join(ROOT, 'static');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const EXPORT_DIR = path.join(DATA_DIR, 'exports');
const JOB_DIR = path.join(DATA_DIR, 'jobs');
const PROJECT_FILE = path.join(DATA_DIR, 'project.json');
const TOOL_DIR = path.join(ROOT, 'tools');
const YTDLP = path.join(TOOL_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const FFMPEG = path.join(TOOL_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const FFPROBE = path.join(TOOL_DIR, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
const HOST = process.env.RANKCUT_HOST || '127.0.0.1';
const PORT = Number(process.env.RANKCUT_PORT || 4174);
const MAX_JSON = 5 * 1024 * 1024;
const MAX_UPLOAD = 8 * 1024 * 1024 * 1024;
const jobs = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

async function ensureDirs() {
  await Promise.all([
    fsp.mkdir(STATIC_DIR, { recursive: true }),
    fsp.mkdir(UPLOAD_DIR, { recursive: true }),
    fsp.mkdir(EXPORT_DIR, { recursive: true }),
    fsp.mkdir(JOB_DIR, { recursive: true }),
    fsp.mkdir(TOOL_DIR, { recursive: true }),
  ]);
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendError(res, status, message, detail) {
  sendJson(res, status, { ok: false, error: message, detail: detail || undefined });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function safeFilename(name) {
  const ext = path.extname(name || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
  const base = path.basename(name || 'clip', path.extname(name || ''))
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'clip';
  return `${base}${ext}`;
}

function makeId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

function resolveInside(base, relative) {
  const resolved = path.resolve(base, relative);
  const root = path.resolve(base) + path.sep;
  if (resolved !== path.resolve(base) && !resolved.startsWith(root)) return null;
  return resolved;
}

async function serveFile(req, res, filePath) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    sendError(res, 404, 'File not found.');
    return;
  }
  if (!stat.isFile()) {
    sendError(res, 404, 'File not found.');
    return;
  }

  const contentType = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range && stat.size > 0) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      'Content-Type': contentType,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': filePath.startsWith(STATIC_DIR) ? 'no-cache' : 'private, max-age=3600',
  });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(filePath).pipe(res);
}

function run(bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd || ROOT,
      windowsHide: true,
      shell: false,
      env: { ...process.env, ...options.env },
    });
    let stdout = '';
    let stderr = '';
    const collect = (key, chunk) => {
      const text = chunk.toString();
      if (key === 'stdout') stdout += text;
      else stderr += text;
      options.onOutput?.(text, key);
      if (stdout.length > 4_000_000) stdout = stdout.slice(-2_000_000);
      if (stderr.length > 4_000_000) stderr = stderr.slice(-2_000_000);
    };
    child.stdout.on('data', (chunk) => collect('stdout', chunk));
    child.stderr.on('data', (chunk) => collect('stderr', chunk));
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(bin)} exited with code ${code}.\n${stderr.slice(-3000)}`));
    });
  });
}

async function probeMedia(filePath) {
  if (!fs.existsSync(FFPROBE)) {
    return { duration: 0, width: 0, height: 0, hasAudio: true };
  }
  const result = await run(FFPROBE, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ]);
  const data = JSON.parse(result.stdout || '{}');
  const video = (data.streams || []).find((stream) => stream.codec_type === 'video') || {};
  const audio = (data.streams || []).find((stream) => stream.codec_type === 'audio');
  return {
    duration: Number(data.format?.duration || video.duration || 0),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    hasAudio: Boolean(audio),
  };
}

async function makePoster(filePath, targetPath) {
  if (!fs.existsSync(FFMPEG)) return null;
  try {
    await run(FFMPEG, [
      '-y', '-ss', '0.4', '-i', filePath, '-frames:v', '1',
      '-vf', 'scale=540:-2:force_original_aspect_ratio=decrease', '-q:v', '3', targetPath,
    ]);
    return targetPath;
  } catch {
    return null;
  }
}

function toMediaUrl(filePath) {
  const relative = path.relative(DATA_DIR, filePath).split(path.sep).map(encodeURIComponent).join('/');
  return `/media/${relative}`;
}

function validateSourceUrl(value) {
  let raw = String(value || '').trim();
  const embedded = raw.match(/https?:\/\/[^\s<>"']+/i);
  if (embedded) raw = embedded[0];
  raw = raw.replace(/[),.;!?\]}]+$/g, '');
  if (!/^https?:\/\//i.test(raw) && /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)\//i.test(raw)) {
    raw = `https://${raw}`;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Paste a complete TikTok or YouTube link.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http and https links are supported.');
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const allowed = [
    'youtube.com', 'youtu.be', 'youtube-nocookie.com',
    'tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com',
  ];
  if (!allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error('This importer accepts TikTok and YouTube links.');
  }
  parsed.hash = '';
  return parsed.toString();
}

function sourcePlatform(url) {
  const host = new URL(url).hostname.toLowerCase();
  return host.includes('tiktok') ? 'TikTok' : 'YouTube';
}

function friendlyImportError(platform, error) {
  const detail = String(error?.message || error || 'Unknown downloader error');
  if (/private|members-only|login required|sign in|authentication/i.test(detail)) {
    return `${platform} requires sign-in for this video. Use a public link or upload the video file directly.`;
  }
  if (/copyright|unavailable|removed|not available|region|geo/i.test(detail)) {
    return `This ${platform} video is unavailable, restricted, or removed. Try another public link.`;
  }
  if (/timed out|timeout|connection|network|resolve host|HTTP Error 429/i.test(detail)) {
    return `${platform} could not be reached from this PC. Check the connection, disable a blocking VPN if used, and retry.`;
  }
  if (/Unsupported URL|Invalid URL/i.test(detail)) {
    return `This does not look like a supported ${platform} video link. Open the video and copy its Share link again.`;
  }
  if (/No video formats|Unable to extract|empty media|Requested format/i.test(detail)) {
    return `${platform} did not provide a downloadable public video. Try the original Share link or upload the file directly.`;
  }
  return `${platform} import failed. Update the media engine with setup.ps1, then retry or upload the file directly.`;
}

async function removeImportArtifacts(id) {
  const names = await fsp.readdir(UPLOAD_DIR).catch(() => []);
  await Promise.all(names.filter((name) => name.startsWith(`${id}.`)).map((name) => fsp.unlink(path.join(UPLOAD_DIR, name)).catch(() => {})));
}

async function importFromUrl(sourceUrl) {
  if (!fs.existsSync(YTDLP)) throw new Error('yt-dlp is missing. Run setup.ps1 first.');
  if (!fs.existsSync(FFMPEG)) throw new Error('FFmpeg is missing. Run setup.ps1 first.');
  const url = validateSourceUrl(sourceUrl);
  const platform = sourcePlatform(url);
  const id = makeId('clip_');
  const template = path.join(UPLOAD_DIR, `${id}.%(ext)s`);
  const commonArgs = [
    '--no-playlist', '--newline', '--no-part',
    '--socket-timeout', '35', '--retries', '4', '--fragment-retries', '4',
    '--retry-sleep', 'http:linear=1::3', '--retry-sleep', 'fragment:linear=1::3',
    '--impersonate', 'chrome',
    '--ffmpeg-location', TOOL_DIR,
    '--merge-output-format', 'mp4',
    '-o', template,
    '--print', 'after_move:__RANKCUT_FILE__%(filepath)s',
    '--print', 'after_move:__RANKCUT_TITLE__%(title)s',
  ];
  const attempts = platform === 'YouTube'
    ? [
        ['-f', 'bv*[height<=1920]+ba/b[height<=1920]/b', '--extractor-args', 'youtube:player_client=web,android_vr'],
        ['-f', 'b[height<=1920]/b', '--extractor-args', 'youtube:player_client=web_creator,android'],
      ]
    : [
        ['-f', 'bv*+ba/b', '--extractor-args', 'tiktok:api_hostname=api22-normal-c-alisg.tiktokv.com'],
        ['-f', 'b', '--extractor-args', 'tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com'],
      ];
  let result = null;
  let lastError = null;
  for (const attempt of attempts) {
    await removeImportArtifacts(id);
    try {
      result = await run(YTDLP, [...commonArgs, ...attempt, url]);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!result) {
    await removeImportArtifacts(id);
    throw new Error(friendlyImportError(platform, lastError));
  }
  const fileLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith('__RANKCUT_FILE__'));
  const titleLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith('__RANKCUT_TITLE__'));
  let downloaded = fileLine ? fileLine.slice('__RANKCUT_FILE__'.length).trim() : null;
  if (!downloaded || !fs.existsSync(downloaded)) {
    const matches = (await fsp.readdir(UPLOAD_DIR))
      .filter((name) => name.startsWith(id + '.'))
      .map((name) => path.join(UPLOAD_DIR, name));
    downloaded = matches[0];
  }
  if (!downloaded || !fs.existsSync(downloaded)) throw new Error('The downloader finished but no playable file was created.');
  const media = await probeMedia(downloaded);
  const posterPath = path.join(UPLOAD_DIR, `${id}.jpg`);
  const poster = await makePoster(downloaded, posterPath);
  return {
    id,
    name: (titleLine ? titleLine.slice('__RANKCUT_TITLE__'.length).trim() : '') || path.basename(downloaded),
    source: platform,
    sourceUrl: url,
    file: path.relative(DATA_DIR, downloaded).split(path.sep).join('/'),
    url: toMediaUrl(downloaded),
    poster: poster ? toMediaUrl(poster) : '',
    duration: media.duration,
    width: media.width,
    height: media.height,
    hasAudio: media.hasAudio,
  };
}

async function saveUploadedVideo(req, originalName) {
  const allowed = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);
  const clean = safeFilename(originalName || 'uploaded-video.mp4');
  const ext = path.extname(clean).toLowerCase();
  if (!allowed.has(ext)) throw new Error('Choose an MP4, MOV, M4V, WebM, or MKV video.');
  const id = makeId('clip_');
  const target = path.join(UPLOAD_DIR, `${id}-${clean}`);
  const stream = fs.createWriteStream(target, { flags: 'wx' });
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_UPLOAD) throw new Error('The video is larger than the 8 GB local upload limit.');
      if (!stream.write(chunk)) await new Promise((resolve) => stream.once('drain', resolve));
    }
    await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
  } catch (error) {
    stream.destroy();
    await fsp.unlink(target).catch(() => {});
    throw error;
  }
  if (size === 0) {
    await fsp.unlink(target).catch(() => {});
    throw new Error('The uploaded file is empty.');
  }
  const media = await probeMedia(target);
  if (!media.width || !media.height) {
    await fsp.unlink(target).catch(() => {});
    throw new Error('FFmpeg could not read this file as a video.');
  }
  const posterPath = path.join(UPLOAD_DIR, `${id}.jpg`);
  const poster = await makePoster(target, posterPath);
  return {
    id,
    name: path.basename(clean, ext).replace(/[-_]+/g, ' '),
    source: 'Upload',
    sourceUrl: '',
    file: path.relative(DATA_DIR, target).split(path.sep).join('/'),
    url: toMediaUrl(target),
    poster: poster ? toMediaUrl(poster) : '',
    duration: media.duration,
    width: media.width,
    height: media.height,
    hasAudio: media.hasAudio,
  };
}

function safeNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeColor(value, fallback = '#FFFFFF') {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : fallback;
}

function normalizeTokens(tokens, fallbackText = '') {
  const safe = Array.isArray(tokens) ? tokens : [];
  const result = safe
    .slice(0, 120)
    .map((token) => ({ text: String(token?.text || '').slice(0, 80), color: normalizeColor(token?.color) }))
    .filter((token) => token.text.trim());
  if (result.length) return result;
  return String(fallbackText || '').trim().split(/\s+/).filter(Boolean).map((text) => ({ text, color: '#FFFFFF' }));
}

function escapeFilterPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function hexToFfmpeg(color) {
  return normalizeColor(color).slice(1);
}

const OUTPUT_WIDTH = RankingLayout.OUTPUT_WIDTH;
const OUTPUT_HEIGHT = RankingLayout.OUTPUT_HEIGHT;
const TEXT_SAFE_LEFT = RankingLayout.TEXT_SAFE_LEFT;
const TEXT_SAFE_RIGHT = RankingLayout.TEXT_SAFE_RIGHT;

function drawtextEffect(effect, color) {
  if (effect === 'none') return '';
  if (effect === 'shadow') return ':shadowcolor=05060A@0.95:shadowx=3:shadowy=5';
  if (effect === 'glow') return `:borderw=3:bordercolor=${hexToFfmpeg(color)}@0.55:shadowcolor=05060A@0.8:shadowx=2:shadowy=3`;
  return ':borderw=2:bordercolor=05060A@1:shadowcolor=000000@0.75:shadowx=2:shadowy=3';
}

async function wordDrawFilters(tokens, options) {
  const fontSize = safeNumber(options.fontSize, 76, 24, 150);
  const maxWidth = safeNumber(options.maxWidth, 900, 300, 1000);
  const normalized = normalizeTokens(tokens, options.fallbackText);
  if (!normalized.length) return { filters: [], lineCount: 0, height: 0 };
  const wrapped = options.lines
    ? { lines: options.lines, wordGap: options.wordGap ?? Math.max(9, Math.round(fontSize * .18)) }
    : RankingLayout.wrapTokens(normalized, fontSize, maxWidth, options.fallbackText);
  const lines = wrapped.lines;
  const gap = wrapped.wordGap;
  const lineHeight = Math.round(options.lineHeight || fontSize * 1.18);

  const filters = [];
  const baseY = safeNumber(options.y, 150, 0, 1800);
  const fontPath = fs.existsSync('C:\\Windows\\Fonts\\arialbd.ttf')
    ? 'C:\\Windows\\Fonts\\arialbd.ttf'
    : fs.existsSync('C:\\Windows\\Fonts\\arial.ttf') ? 'C:\\Windows\\Fonts\\arial.ttf' : '';
  let tokenIndex = 0;
  for (let row = 0; row < lines.length; row += 1) {
    const current = lines[row];
    const left = safeNumber(options.left, TEXT_SAFE_LEFT, 0, OUTPUT_WIDTH);
    const right = safeNumber(options.right, TEXT_SAFE_RIGHT, left, OUTPUT_WIDTH);
    let x = options.align === 'left'
      ? left
      : options.align === 'right' ? right - current.width : (OUTPUT_WIDTH - current.width) / 2;
    for (const token of current.words) {
      const textPath = path.join(options.tempDir, `${options.prefix}-${tokenIndex}.txt`);
      await fsp.writeFile(textPath, token.text, 'utf8');
      const fontPart = fontPath ? `fontfile='${escapeFilterPath(fontPath)}':` : '';
      filters.push(
        `drawtext=${fontPart}textfile='${escapeFilterPath(textPath)}':` +
        `fontcolor=${hexToFfmpeg(token.color)}:fontsize=${Math.round(fontSize)}:` +
        `x=${Math.round(x)}:y=${Math.round(baseY + row * lineHeight)}` +
        drawtextEffect(options.effect || 'outline', token.color)
      );
      x += token.width + gap;
      tokenIndex += 1;
    }
  }
  return { filters, lineCount: lines.length, height: lines.length * lineHeight };
}

async function buildVideoFilters(project, clip, revealedClipIds, tempDir) {
  const rank = Number(clip.rank) || 1;
  const fit = clip.fit === 'contain' ? 'contain' : 'cover';
  const base = fit === 'contain'
    ? 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=12151F'
    : 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920';
  const filters = [base, 'setsar=1', 'fps=30', 'format=yuv420p'];
  const title = project.title || {};
  const titleWords = normalizeTokens(title.tokens, title.text || '');
  if (title.enabled !== false && titleWords.length) {
    const titleLayout = RankingLayout.buildTitleLayout({ ...title, tokens: titleWords });
    const opacity = safeNumber(title.background, 66, 0, 100) / 100;
    if (opacity > 0) {
      filters.push(
        `drawbox=x=${titleLayout.boxX}:y=${titleLayout.boxY}:w=${titleLayout.boxWidth}:` +
        `h=${titleLayout.boxHeight}:color=090B12@${opacity.toFixed(2)}:t=fill`,
      );
    }
    const drawn = await wordDrawFilters(titleWords, {
      fontSize: titleLayout.fontSize,
      lineHeight: titleLayout.lineHeight,
      maxWidth: TEXT_SAFE_RIGHT - TEXT_SAFE_LEFT,
      y: titleLayout.textY,
      align: titleLayout.align,
      left: TEXT_SAFE_LEFT,
      right: TEXT_SAFE_RIGHT,
      lines: titleLayout.lines,
      wordGap: titleLayout.wordGap,
      tempDir,
      prefix: `title-${rank}`,
      fallbackText: title.text || '',
      effect: title.effect || 'outline',
    });
    filters.push(...drawn.filters);
  }

  const clips = Array.isArray(project.clips) ? project.clips : [];
  const ranking = RankingLayout.buildRankingLayout(clips, revealedClipIds, project.ranking);
  const rankFontPath = fs.existsSync('C:\\Windows\\Fonts\\arialbd.ttf') ? 'C:\\Windows\\Fonts\\arialbd.ttf' : '';
  const rankFontPart = rankFontPath ? `fontfile='${escapeFilterPath(rankFontPath)}':` : '';
  for (const entry of ranking.entries) {
    const item = clips[entry.sourceIndex] || {};
    const list = item.list || {};
    const badgeColor = hexToFfmpeg(list.badgeColor || '#FF795C');
    const rankFile = path.join(tempDir, `rank-${rank}-${entry.rank}.txt`);
    await fsp.writeFile(rankFile, entry.rankText, 'utf8');
    filters.push(
      `drawtext=${rankFontPart}textfile='${escapeFilterPath(rankFile)}':` +
      `fontcolor=${badgeColor}:fontsize=${ranking.rankSize}:x=${ranking.rankLeft}:y=${entry.numberY}:` +
      `borderw=2:bordercolor=090B12@0.9:shadowcolor=000000@0.75:shadowx=2:shadowy=3`,
    );

    if (!entry.revealed || !entry.lines.length) continue;
    const opacity = safeNumber(list.background, 72, 0, 100) / 100;
    if (opacity > 0) {
      filters.push(
        `drawbox=x=${entry.boxLeft}:y=${entry.labelY}:w=${entry.boxRight - entry.boxLeft}:` +
        `h=${entry.labelHeight}:color=090B12@${opacity.toFixed(2)}:t=fill`,
      );
    }
    const drawn = await wordDrawFilters(list.tokens, {
      fontSize: ranking.fontSize,
      lineHeight: ranking.lineHeight,
      maxWidth: entry.maxTextWidth,
      y: entry.textY,
      align: 'left',
      left: entry.titleLeft,
      right: ranking.textSafeRight,
      lines: entry.lines,
      wordGap: entry.wordGap,
      effect: list.effect || 'outline',
      tempDir,
      prefix: `list-${rank}-${entry.rank}`,
      fallbackText: list.text || '',
    });
    filters.push(...drawn.filters);
  }
  return filters.join(',');
}

function clipSourcePath(clip) {
  const relative = String(clip.file || '').replace(/\\/g, '/');
  return resolveInside(DATA_DIR, relative);
}

async function renderProject(jobId, project) {
  const job = jobs.get(jobId);
  const clips = Array.isArray(project?.clips) ? project.clips : [];
  if (!clips.length) throw new Error('Add at least one video before exporting.');
  if (!fs.existsSync(FFMPEG) || !fs.existsSync(FFPROBE)) throw new Error('FFmpeg is missing. Run setup.ps1 first.');
  const tempDir = path.join(JOB_DIR, jobId);
  await fsp.mkdir(tempDir, { recursive: true });
  const segments = [];
  const renderClips = RankingLayout.buildEntranceSequence(clips, project.entranceOrder);
  job.total = clips.length + 1;

  for (let index = 0; index < renderClips.length; index += 1) {
    const clip = renderClips[index];
    const rank = Number(clip.rank) || index + 1;
    const source = clipSourcePath(clip);
    if (!source || !fs.existsSync(source)) throw new Error(`Source file for “${clip.name || `clip ${index + 1}`}” is missing.`);
    const media = await probeMedia(source);
    const start = safeNumber(clip.trimStart, 0, 0, Math.max(0, media.duration - 0.1));
    const requestedEnd = safeNumber(clip.trimEnd, media.duration || 60, start + 0.1, media.duration || 36000);
    const duration = Math.max(0.1, requestedEnd - start);
    const segment = path.join(tempDir, `segment-${String(index).padStart(3, '0')}.mp4`);
    const revealedIds = renderClips.slice(0, index + 1).map((item) => item.id);
    const filters = await buildVideoFilters(project, clip, revealedIds, tempDir);
    const args = ['-y', '-hide_banner', '-ss', start.toFixed(3), '-t', duration.toFixed(3), '-i', source];
    if (!media.hasAudio) args.push('-f', 'lavfi', '-t', duration.toFixed(3), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    args.push('-map', '0:v:0', '-map', media.hasAudio ? '0:a:0' : '1:a:0');
    args.push('-vf', filters);
    const volume = clip.muted ? 0 : safeNumber(clip.volume, 1, 0, 2);
    args.push('-af', `volume=${volume.toFixed(2)},aresample=async=1:first_pts=0,apad=whole_dur=${duration.toFixed(3)}`);
    const preset = new Set(['fast', 'medium', 'slow']).has(project.export?.preset) ? project.export.preset : 'medium';
    args.push(
      '-t', duration.toFixed(3), '-r', '30', '-c:v', 'libx264', '-preset', preset,
      '-crf', String(safeNumber(project.export?.crf, 20, 16, 30)), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', segment,
    );
    job.message = `Rendering ${index + 1} of ${clips.length}: rank ${rank} — ${clip.name || 'video'}`;
    job.progress = Math.round((index / job.total) * 100);
    await run(FFMPEG, args, {
      onOutput(text) {
        const match = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
        if (match) {
          const elapsed = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
          const within = Math.min(1, elapsed / duration);
          job.progress = Math.round(((index + within) / job.total) * 100);
        }
      },
    });
    segments.push(segment);
  }

  const concatPath = path.join(tempDir, 'concat.txt');
  const concatBody = segments.map((segment) => `file '${segment.replace(/'/g, "'\\''").replace(/\\/g, '/')}'`).join('\n');
  await fsp.writeFile(concatPath, concatBody, 'utf8');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputName = `rankcut-${stamp}.mp4`;
  const output = path.join(EXPORT_DIR, outputName);
  job.message = 'Joining the ranked video';
  job.progress = Math.round((clips.length / job.total) * 100);
  await run(FFMPEG, ['-y', '-hide_banner', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', '-movflags', '+faststart', output]);
  const outputMedia = await probeMedia(output);
  job.status = 'complete';
  job.progress = 100;
  job.message = 'Export ready';
  job.output = { name: outputName, url: toMediaUrl(output), duration: outputMedia.duration };
  return job.output;
}

async function listExports() {
  const names = (await fsp.readdir(EXPORT_DIR)).filter((name) => name.toLowerCase().endsWith('.mp4'));
  const items = await Promise.all(names.map(async (name) => {
    const full = path.join(EXPORT_DIR, name);
    const stat = await fsp.stat(full);
    return { name, url: toMediaUrl(full), size: stat.size, createdAt: stat.mtime.toISOString() };
  }));
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
}

async function route(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      app: 'RankCut Studio',
      tools: {
        ytdlp: fs.existsSync(YTDLP),
        ffmpeg: fs.existsSync(FFMPEG),
        ffprobe: fs.existsSync(FFPROBE),
      },
    });
    return;
  }

  if (pathname === '/api/project' && req.method === 'GET') {
    try {
      const project = JSON.parse(await fsp.readFile(PROJECT_FILE, 'utf8'));
      sendJson(res, 200, { ok: true, project });
    } catch (error) {
      if (error.code === 'ENOENT') sendJson(res, 200, { ok: true, project: null });
      else sendError(res, 500, 'The saved project could not be read.', error.message);
    }
    return;
  }

  if (pathname === '/api/project' && req.method === 'POST') {
    const body = await readJson(req);
    const incomingProject = body.project || body;
    try {
      const savedProject = JSON.parse(await fsp.readFile(PROJECT_FILE, 'utf8'));
      if (Number(savedProject.version) >= PROJECT_VERSION && Number(incomingProject.version) < PROJECT_VERSION) {
        sendError(res, 409, 'This project is open in a newer RankCut editor. Reload this tab before saving.');
        return;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fsp.writeFile(PROJECT_FILE, JSON.stringify(incomingProject, null, 2), 'utf8');
    sendJson(res, 200, { ok: true, savedAt: new Date().toISOString() });
    return;
  }

  if (pathname === '/api/import' && req.method === 'POST') {
    const body = await readJson(req);
    const clip = await importFromUrl(body.url);
    sendJson(res, 200, { ok: true, clip });
    return;
  }

  if (pathname === '/api/upload' && req.method === 'PUT') {
    const clip = await saveUploadedVideo(req, requestUrl.searchParams.get('filename') || 'video.mp4');
    sendJson(res, 200, { ok: true, clip });
    return;
  }

  if (pathname === '/api/export' && req.method === 'POST') {
    const body = await readJson(req);
    const jobId = makeId('render_');
    jobs.set(jobId, { id: jobId, status: 'queued', progress: 0, message: 'Preparing export', createdAt: Date.now() });
    sendJson(res, 202, { ok: true, jobId });
    const job = jobs.get(jobId);
    job.status = 'running';
    renderProject(jobId, body.project || body).catch((error) => {
      job.status = 'error';
      job.message = error.message.split('\n')[0];
      job.error = error.message;
    });
    return;
  }

  if (pathname.startsWith('/api/jobs/') && req.method === 'GET') {
    const job = jobs.get(pathname.slice('/api/jobs/'.length));
    if (!job) sendError(res, 404, 'Render job not found.');
    else sendJson(res, 200, { ok: true, job });
    return;
  }

  if (pathname === '/api/exports' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, exports: await listExports() });
    return;
  }

  if (pathname.startsWith('/media/') && (req.method === 'GET' || req.method === 'HEAD')) {
    const target = resolveInside(DATA_DIR, pathname.slice('/media/'.length));
    if (!target) sendError(res, 403, 'Invalid media path.');
    else await serveFile(req, res, target);
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const target = resolveInside(STATIC_DIR, relative);
    if (!target) sendError(res, 403, 'Invalid path.');
    else await serveFile(req, res, target);
    return;
  }

  sendError(res, 404, 'Route not found.');
}

async function main() {
  await ensureDirs();
  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      console.error(error);
      if (!res.headersSent) sendError(res, 500, error.message || 'Unexpected server error.');
      else res.destroy(error);
    });
  });
  server.listen(PORT, HOST, () => {
    console.log(`\n  RankCut Studio is running at http://${HOST}:${PORT}\n`);
    console.log('  Press Ctrl+C to stop.\n');
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
