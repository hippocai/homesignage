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
// in-flight: Map<city_lower -> Promise> — deduplicates concurrent upstream requests
const _inflight = new Map();

let _intervalMinutes = 30;
let _socketService = null;
let _refreshJob = null;

function setSocketService(svc) {
  _socketService = svc;
}

const FETCH_TIMEOUT_MS = 20000;
const RETRY_ATTEMPTS   = 3;
const RETRY_DELAY_MS   = 3000;

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
    req.setTimeout(FETCH_TIMEOUT_MS, () => { req.destroy(); reject(new Error('Weather request timeout')); });
  });
}

async function refreshCity(city) {
  const key = city.toLowerCase();
  let lastError;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const data = await fetchFromUpstream(city);
      const fetchedAt = Date.now();
      cache.set(key, { data, fetchedAt });
      if (attempt > 1) logger.info('Weather fetch succeeded after retry', { city, attempt });
      else logger.info('Weather cache updated', { city });

      // Push fresh data to all connected display clients
      if (_socketService) {
        _socketService.emitToAll('weather-update', { city: key, data, fetchedAt });
      }
      return { data, fetchedAt, stale: false };
    } catch (e) {
      lastError = e;
      if (attempt < RETRY_ATTEMPTS) {
        logger.warn('Weather fetch failed, retrying...', { city, attempt, error: e.message });
        if (process.env.NODE_ENV !== 'test') {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
  }
  logger.warn('Weather fetch failed after all retries', { city, error: lastError.message });
  // Return stale cache if available so the client can still display something
  const stale = cache.get(key);
  if (stale) return { data: stale.data, fetchedAt: stale.fetchedAt, stale: true };
  return null;
}

/**
 * Get cached weather for a city. Fetches from upstream if cache is stale.
 * Returns { data, fetchedAt, stale } or null if no data available at all.
 */
async function getWeather(city) {
  const key = city.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < _intervalMinutes * 60 * 1000) {
    return { data: cached.data, fetchedAt: cached.fetchedAt, stale: false };
  }
  // Deduplicate concurrent requests for the same city
  if (_inflight.has(key)) return _inflight.get(key);
  const promise = refreshCity(city).finally(() => _inflight.delete(key));
  _inflight.set(key, promise);
  return promise;
}

/**
 * Start (or restart) periodic refresh for all cities currently in the scene configs.
 * @param {Function} getCitiesFromScenes - async function returning array of city names
 * @param {number} [intervalMinutes=30] - refresh interval in minutes (1–1440)
 */
function startScheduler(getCitiesFromScenes, intervalMinutes) {
  _intervalMinutes = Math.max(1, Math.min(1440, Math.round(intervalMinutes || 30)));
  if (_refreshJob) _refreshJob.cancel();

  // node-schedule cron supports */N for minutes up to 60; cap at 60 for the cron expression
  const cronInterval = Math.min(60, _intervalMinutes);
  _refreshJob = schedule.scheduleJob(`0 */${cronInterval} * * * *`, async () => {
    const cities = await getCitiesFromScenes();
    logger.info('Weather scheduler tick', { cities, intervalMinutes: _intervalMinutes });
    for (const city of cities) {
      await refreshCity(city);
    }
  });
  logger.info('Weather scheduler started', { intervalMinutes: _intervalMinutes });
}

module.exports = { getWeather, refreshCity, startScheduler, setSocketService, getIntervalMinutes: () => _intervalMinutes };
