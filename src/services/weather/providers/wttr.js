/**
 * Weather provider: wttr.in
 * No API key required.
 */
const https = require('https');

function fetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'HomeSignage/1.0' } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 20000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

function codeToEmoji(code) {
  code = parseInt(code, 10);
  if (code === 113) return '\u2600\ufe0f';
  if (code === 116) return '\u26c5';
  if (code === 119 || code === 122) return '\u2601\ufe0f';
  if (code >= 143 && code <= 260) return '\ud83c\udf2b\ufe0f';
  if (code >= 263 && code <= 299) return '\ud83c\udf26\ufe0f';
  if (code >= 302 && code <= 374) return '\ud83c\udf27\ufe0f';
  if (code >= 377 && code <= 395) return '\u2744\ufe0f';
  if (code === 200 || code === 386 || code === 389 || code === 392 || code === 395) return '\u26c8\ufe0f';
  return '\ud83c\udf24\ufe0f';
}

async function fetchWeather(locationConfig) {
  const query = locationConfig.city || 'Beijing';
  const url = 'https://wttr.in/' + encodeURIComponent(query) + '?format=j1&lang=zh';
  const parsed = await fetchJson(url);
  const data   = parsed.data || parsed;
  const cur    = data.current_condition[0];
  const area   = data.nearest_area && data.nearest_area[0];
  const desc   = (cur.lang_zh && cur.lang_zh[0] && cur.lang_zh[0].value)
                 || (cur.weatherDesc && cur.weatherDesc[0] && cur.weatherDesc[0].value) || '';
  return {
    city:        area ? area.areaName[0].value : query,
    tempC:       parseInt(cur.temp_C, 10),
    tempF:       parseInt(cur.temp_F, 10),
    icon:        codeToEmoji(cur.weatherCode),
    description: desc,
    humidity:    cur.humidity,
    windKmph:    cur.windspeedKmph,
  };
}

// wttr.in has no structured GeoAPI — return empty; user types city manually
async function searchLocations() {
  return [];
}

module.exports = {
  name: 'wttr',
  requiresApiKey: false,
  fetchWeather,
  searchLocations,
};
