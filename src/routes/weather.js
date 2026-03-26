const express = require('express');
const router = express.Router();
const weatherService = require('../services/weatherService');

// GET /api/v1/weather?city=Beijing&unit=C
// Served from server-side cache; display clients never hit external APIs directly.
router.get('/', async (req, res) => {
  const city = req.query.city || 'Beijing';
  try {
    const result = await weatherService.getWeather(city);
    if (!result) return res.status(502).json({ error: 'Weather data unavailable' });
    res.json({ data: result.data, stale: result.stale, fetchedAt: result.fetchedAt });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
