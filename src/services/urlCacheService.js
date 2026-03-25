/**
 * URL Cache Service
 * Server-side fetches and caches external web pages.
 * Display clients access /api/v1/url-content?url=... instead of the external URL.
 */
const https = require('https');
const http  = require('http');
const logger = require('../utils/logger');

// cache: Map<url -> { body, contentType, fetchedAt }>
const cache = new Map();
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HomeSignage/1.0)',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      timeout: 15000,
    }, (res) => {
      // Follow single redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const contentType = res.headers['content-type'] || 'text/html';
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ body: Buffer.concat(chunks), contentType }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

async function getCachedContent(url, ttlMs) {
  const ttl = ttlMs || DEFAULT_TTL_MS;
  const cached = cache.get(url);
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached;
  }
  try {
    const { body, contentType } = await fetchUrl(url);
    const entry = { body, contentType, fetchedAt: Date.now(), error: null };
    cache.set(url, entry);
    logger.info('URL cache updated', { url, size: body.length });
    return entry;
  } catch (e) {
    logger.warn('URL cache fetch failed', { url, error: e.message });
    // Return stale cache if available, otherwise throw
    if (cached) return cached;
    throw e;
  }
}

function invalidate(url) {
  cache.delete(url);
}

module.exports = { getCachedContent, invalidate };
