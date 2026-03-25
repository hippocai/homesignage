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

  // Only proxy http/https URLs
  if (!/^https?:\/\//i.test(url)) return res.status(400).send('Invalid URL');

  const ttlMs = req.query.ttl ? parseInt(req.query.ttl, 10) * 60 * 1000 : undefined;

  try {
    const { body, contentType } = await urlCacheService.getCachedContent(url, ttlMs);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'no-store'); // client always asks server; server manages staleness
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.send(body);
  } catch (e) {
    res.status(502).send('Failed to fetch content: ' + e.message);
  }
});

module.exports = router;
