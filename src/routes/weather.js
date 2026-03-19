const express = require('express');
const router = express.Router();
const https = require('https');

// GET /api/v1/weather?city=Beijing&unit=C
router.get('/', (req, res) => {
  const city = req.query.city || 'Beijing';
  const url = 'https://wttr.in/' + encodeURIComponent(city) + '?format=j1&lang=zh';

  https.get(url, { headers: { 'User-Agent': 'HomeSignage/1.0' } }, (upstream) => {
    let body = '';
    upstream.on('data', (chunk) => { body += chunk; });
    upstream.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const data = parsed.data || parsed; // wttr.in wraps in { data: {...} }
        const cur  = data.current_condition[0];
        const area = data.nearest_area && data.nearest_area[0];
        const desc = (cur.lang_zh && cur.lang_zh[0] && cur.lang_zh[0].value)
                     || (cur.weatherDesc && cur.weatherDesc[0] && cur.weatherDesc[0].value)
                     || '';
        res.json({
          data: {
            city:        area ? area.areaName[0].value : city,
            tempC:       parseInt(cur.temp_C, 10),
            tempF:       parseInt(cur.temp_F, 10),
            weatherCode: parseInt(cur.weatherCode, 10),
            description: desc,
            humidity:    cur.humidity,
            windKmph:    cur.windspeedKmph
          }
        });
      } catch (e) {
        res.status(502).json({ error: 'Failed to parse weather data' });
      }
    });
  }).on('error', (e) => {
    res.status(502).json({ error: 'Failed to fetch weather: ' + e.message });
  });
});

module.exports = router;
