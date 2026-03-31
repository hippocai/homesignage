/**
 * Weather provider: 和风天气 (QWeather)
 * Requires an API key from https://dev.qweather.com/
 * Free tier host: devapi.qweather.com
 * Paid tier host:  api.qweather.com
 */
const https = require('https');
const zlib  = require('zlib');

function fetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'HomeSignage/1.0', 'Accept-Encoding': 'gzip' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const decompress = res.headers['content-encoding'] === 'gzip'
          ? (cb) => zlib.gunzip(buf, cb)
          : (cb) => cb(null, buf);
        decompress((err, data) => {
          if (err) return reject(new Error('Decompress error: ' + err.message));
          try { resolve(JSON.parse(data.toString())); } catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 20000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// QWeather icon code → emoji
function iconToEmoji(code) {
  code = parseInt(code, 10);
  if (code === 100 || code === 150) return '\u2600\ufe0f'; // ☀️ 晴/晴夜
  if (code >= 101 && code <= 103) return '\u26c5';        // ⛅ 多云/少云
  if (code === 104) return '\u2601\ufe0f';                // ☁️ 阴
  if (code >= 300 && code <= 304) return '\u26c8\ufe0f';  // ⛈️ 雷阵雨
  if (code >= 305 && code <= 320) return '\ud83c\udf27\ufe0f'; // 🌧️ 雨
  if (code >= 321 && code <= 399) return '\ud83c\udf26\ufe0f'; // 🌦️ 小雨
  if (code >= 400 && code <= 499) return '\u2744\ufe0f';  // ❄️ 雪
  if (code >= 500 && code <= 515) return '\ud83c\udf2b\ufe0f'; // 🌫️ 雾/霾
  if (code === 900) return '\ud83c\udf21\ufe0f';          // 🌡️ 高温
  if (code === 901) return '\ud83e\uddca';                // 🧊 低温
  return '\ud83c\udf24\ufe0f'; // 🌤️ 默认
}

function buildWeatherUrl(locationId, apiKey, host) {
  const h = host || 'devapi.qweather.com';
  return `https://${h}/v7/weather/now?location=${encodeURIComponent(locationId)}&key=${encodeURIComponent(apiKey)}`;
}

function buildGeoUrl(query, apiKey) {
  return `https://geoapi.qweather.com/v2/city/lookup?location=${encodeURIComponent(query)}&number=10&key=${encodeURIComponent(apiKey)}`;
}

async function fetchWeather(locationConfig, apiConfig) {
  const apiKey = apiConfig && apiConfig.apiKey;
  if (!apiKey) throw new Error('QWeather API key not configured');

  // Prefer locationId, fall back to city name (GeoAPI lookup first)
  let locationId = locationConfig.locationId;
  if (!locationId) {
    const geoData = await fetchJson(buildGeoUrl(locationConfig.city || 'Beijing', apiKey));
    if (geoData.code !== '200' || !geoData.location || !geoData.location.length) {
      throw new Error('QWeather GeoAPI: city not found (' + (geoData.code || 'unknown') + ')');
    }
    locationId = geoData.location[0].id;
  }

  const host = apiConfig.host || 'devapi.qweather.com';
  const data = await fetchJson(buildWeatherUrl(locationId, apiKey, host));
  if (data.code !== '200') throw new Error('QWeather API error: ' + data.code);

  const now = data.now;
  const tempC = parseInt(now.temp, 10);
  return {
    city:        locationConfig.city || locationId,
    tempC,
    tempF:       Math.round(tempC * 9 / 5 + 32),
    icon:        iconToEmoji(now.icon),
    description: now.text,
    humidity:    now.humidity,
    windKmph:    now.windSpeed,
  };
}

async function searchLocations(query, apiConfig) {
  const apiKey = apiConfig && apiConfig.apiKey;
  if (!apiKey || !query) return [];
  try {
    const data = await fetchJson(buildGeoUrl(query, apiKey));
    if (data.code !== '200' || !data.location) return [];
    return data.location.map((loc) => ({
      id:          loc.id,
      name:        loc.name,
      adm2:        loc.adm2,
      adm1:        loc.adm1,
      country:     loc.country,
      lat:         loc.lat,
      lon:         loc.lon,
      displayName: [loc.name, loc.adm1, loc.country].filter(Boolean).join(' · '),
    }));
  } catch {
    return [];
  }
}

module.exports = {
  name: 'qweather',
  requiresApiKey: true,
  fetchWeather,
  searchLocations,
};
