/**
 * URL Cache Service
 * Server-side fetches and caches external web pages.
 * Display clients access /url-content?url=... instead of the external URL.
 */
const {publicResource} = require('./briefing/providers');
const logger = require('../utils/logger');

// cache: Map<url -> { body, contentType, fetchedAt }>
const cache = new Map();
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function fetchUrl(url) {
  const response = await publicResource(url, {'User-Agent':'HomeSignage/1.0'}, 8*1024*1024);
  if (response.status !== 200) throw new Error('HTTP ' + response.status);
  return {body:response.body, contentType:response.headers['content-type'] || 'text/html', url:response.url};
}

async function getCachedContent(url, ttlMs) {
  const ttl = ttlMs != null ? ttlMs : DEFAULT_TTL_MS;
  const cached = cache.get(url);
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached;
  }
  try {
    const entry = { ...await fetchUrl(url), fetchedAt: Date.now(), error: null };
    if (cache.size >= 32 && !cache.has(url)) cache.delete(cache.keys().next().value);
    cache.set(url, entry);
    logger.info('URL cache updated', { url, size: entry.body.length });
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
