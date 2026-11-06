/**
 * GET /url-content?url=<encoded>&ttl=<minutes>
 * Serves server-cached external web pages to display clients (no auth required).
 * Display clients use this endpoint as the iframe src instead of the external URL.
 */
const express = require('express');
const router  = express.Router();
const urlCacheService = require('../services/urlCacheService');

router.get('/', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url parameter');

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
      return res.status(400).send('Invalid URL');
  } catch { return res.status(400).send('Invalid URL'); }
  const minutes = req.query.ttl === undefined ? undefined : Number(req.query.ttl);
  if (minutes !== undefined && (!Number.isFinite(minutes) || minutes < 0))
    return res.status(400).send('Invalid cache interval');
  const ttlMs = minutes === undefined ? undefined : minutes * 60000;

  try {
    const { body, contentType, url:finalUrl } = await urlCacheService.getCachedContent(url, ttlMs);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'no-store'); // client always asks server; server manages staleness
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Content-Security-Policy', 'sandbox allow-scripts allow-forms');

    // For HTML responses, inject <base href> so relative URLs inside the proxied
    // page resolve against the original host rather than localhost.
    if (contentType && contentType.includes('text/html')) {
      const tag = `<base href="${finalUrl.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">`;
      let html = body.toString('utf8');
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
      } else {
        html = tag + html;
      }
      return res.send(html);
    }

    res.send(body);
  } catch (e) {
    res.status(e.status === 400 ? 400 : 502).type('text').send('Failed to fetch content: ' + e.message);
  }
});

module.exports = router;
