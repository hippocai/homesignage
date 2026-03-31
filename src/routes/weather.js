const express = require('express');
const router = express.Router();
const weatherService  = require('../services/weatherService');
const weatherProvider = require('../services/weather/index');
const { authenticateJWT } = require('../middleware/auth');

// GET /api/v1/weather?city=Beijing
// Served from server-side cache; display clients never hit external APIs directly.
router.get('/', async (req, res) => {
  const city       = req.query.city       || 'Beijing';
  const locationId = req.query.locationId || null;
  try {
    const result = await weatherService.getWeather({ city, locationId });
    if (!result) return res.status(502).json({ error: 'Weather data unavailable' });
    res.json({ data: result.data, stale: result.stale, fetchedAt: result.fetchedAt });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/v1/weather/locations?query=xxx  (admin only)
// Searches city locations using the configured weather provider's GeoAPI.
router.get('/locations', authenticateJWT, async (req, res) => {
  const query = (req.query.query || '').trim();
  if (!query || query.length < 2) return res.json({ data: [] });
  try {
    const locations = await weatherProvider.searchLocations(query);
    res.json({ data: locations });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/v1/weather/providers  (admin only)
router.get('/providers', authenticateJWT, (req, res) => {
  res.json({ data: weatherProvider.listProviders() });
});

module.exports = router;
