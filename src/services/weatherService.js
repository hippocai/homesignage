/**
 * Weather Service
 * Fetches weather data server-side, caches it, and pushes updates
 * to connected display clients via Socket.IO.
 * Display clients never reach external APIs directly.
 */
const https = require('https');
const schedule = require('node-schedule');
const logger = require('../utils/logger');

// cache: Map<city_lower -> { data, fetchedAt }>
const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let _socketService = null;
let _refreshJob = null;

function setSocketService(svc) {
  _socketService = svc;
}

function fetchFromUpstream(city) {
  return new Promise((resolve, reject) => {
    const url = 'https://wttr.in/' + encodeURIComponent(city) + '?format=j1&lang=zh';
    const req = https.get(url, { headers: { 'User-Agent': 'HomeSignage/1.0' } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const data = parsed.data || parsed;
          const cur  = data.current_condition[0];
          const area = data.nearest_area && data.nearest_area[0];
          const desc = (cur.lang_zh && cur.lang_zh[0] && cur.lang_zh[0].value)
                       || (cur.weatherDesc && cur.weatherDesc[0] && cur.weatherDesc[0].value)
                       || '';
          resolve({
            city:        area ? area.areaName[0].value : city,
            tempC:       parseInt(cur.temp_C, 10),
            tempF:       parseInt(cur.temp_F, 10),
            weatherCode: parseInt(cur.weatherCode, 10),
            description: desc,
            humidity:    cur.humidity,
            windKmph:    cur.windspeedKmph,
          });
        } catch (e) {
          reject(new Error('Failed to parse weather: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Weather request timeout')); });
  });
}

async function refreshCity(city) {
  const key = city.toLowerCase();
  try {
    const data = await fetchFromUpstream(city);
    cache.set(key, { data, fetchedAt: Date.now() });
    logger.info('Weather cache updated', { city });

    // Push to all connected display clients
    if (_socketService) {
      _socketService.emitToAll('weather-update', { city: key, data });
    }
    return data;
  } catch (e) {
    logger.warn('Weather fetch failed', { city, error: e.message });
    return null;
  }
}

/**
 * Get cached weather for a city. Fetches from upstream if cache is stale.
 */
async function getWeather(city) {
  const key = city.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }
  return refreshCity(city);
}

/**
 * Start periodic refresh for all cities currently in the scene configs.
 * Called once at startup; also called whenever scene configs change.
 */
function startScheduler(getCitiesFromScenes) {
  if (_refreshJob) _refreshJob.cancel();

  // Refresh every 30 minutes
  _refreshJob = schedule.scheduleJob('0 */30 * * * *', async () => {
    const cities = await getCitiesFromScenes();
    logger.info('Weather scheduler tick', { cities });
    for (const city of cities) {
      await refreshCity(city);
    }
  });
  logger.info('Weather scheduler started');
}

module.exports = { getWeather, refreshCity, startScheduler, setSocketService };
