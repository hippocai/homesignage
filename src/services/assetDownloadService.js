/**
 * Asset Download Service
 * Downloads external image/video URLs to the local file-repo so that
 * display clients never need external internet access.
 */
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');
const { getRepoPath, ensureRepoDir } = require('../config/fileRepo');
const logger = require('../utils/logger');

const EXT_MAP = {
  'image/jpeg':  '.jpg',
  'image/png':   '.png',
  'image/gif':   '.gif',
  'image/webp':  '.webp',
  'image/svg+xml': '.svg',
  'video/mp4':   '.mp4',
  'video/webm':  '.webm',
  'video/quicktime': '.mov',
};

function guessExt(url, contentType) {
  if (contentType) {
    const base = contentType.split(';')[0].trim().toLowerCase();
    if (EXT_MAP[base]) return EXT_MAP[base];
  }
  const m = url.match(/\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|mov|m4v)(\?|$)/i);
  return m ? '.' + m[1].toLowerCase() : '';
}

function isExternal(url) {
  if (!url || typeof url !== 'string') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  // Not a local server reference
  const origin = ['localhost', '127.0.0.1', '::1'];
  try {
    const host = new URL(url).hostname;
    return !origin.includes(host);
  } catch {
    return false;
  }
}

function download(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: { 'User-Agent': 'HomeSignage/1.0' },
      timeout: 30000,
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return download(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const contentType = res.headers['content-type'] || '';
      const ext = guessExt(url, contentType);
      const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
      const filename = 'dl_' + hash + ext;
      const dest = path.join(ensureRepoDir(), filename);

      // Skip if already downloaded
      if (fs.existsSync(dest)) return resolve({ filename, localUrl: '/file-repo/' + filename });

      const writer = fs.createWriteStream(dest);
      res.pipe(writer);
      writer.on('finish', () => resolve({ filename, localUrl: '/file-repo/' + filename }));
      writer.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')); });
  });
}

/**
 * If the given URL is external, download it to file-repo and return the local URL.
 * Returns the original URL if it's already local.
 */
async function localizeUrl(url) {
  if (!isExternal(url)) return url;
  try {
    const { localUrl } = await download(url);
    logger.info('External asset downloaded', { url, localUrl });
    return localUrl;
  } catch (e) {
    logger.warn('Asset download failed, keeping original URL', { url, error: e.message });
    return url; // Fallback to original
  }
}

module.exports = { isExternal, localizeUrl };
