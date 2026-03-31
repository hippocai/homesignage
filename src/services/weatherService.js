/**
 * Weather Service
 * Fetches weather data server-side via the configured provider, caches it,
 * and pushes updates to connected display clients via Socket.IO.
 * Display clients never reach external APIs directly.
 */
const schedule = require('node-schedule');
const logger   = require('../utils/logger');
const weatherProvider = require('./weather/index');

// cache: Map<cacheKey -> { data, fetchedAt }>
// cacheKey = `${providerName}:${locationId||city_lower}`
const cache     = new Map();
const _inflight = new Map();

let _intervalMinutes = 30;
let _socketService   = null;
let _refreshJob      = null;

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;

function setSocketService(svc) {
  _socketService = svc;
}

/**
 * Build a stable cache key from a location config.
 * The key is scoped to city name (lowercased); locationId is provider-specific
 * and the provider layer handles the lookup.
 */
function cacheKey(locationConfig) {
  return (locationConfig.locationId || locationConfig.city || '').toLowerCase();
}

async function refreshLocation(locationConfig) {
  const key = cacheKey(locationConfig);
  let lastError;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const data = await weatherProvider.fetchWeather(locationConfig);
      const fetchedAt = Date.now();
      cache.set(key, { data, fetchedAt });
      if (attempt > 1) logger.info('Weather fetch succeeded after retry', { key, attempt });
      else logger.info('Weather cache updated', { key });

      // Push fresh data to all connected display clients
      if (_socketService) {
        _socketService.emitToAll('weather-update', { city: key, data, fetchedAt });
      }
      return { data, fetchedAt, stale: false };
    } catch (e) {
      lastError = e;
      if (attempt < RETRY_ATTEMPTS) {
        logger.warn('Weather fetch failed, retrying...', { key, attempt, error: e.message });
        if (process.env.NODE_ENV !== 'test') {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
  }
  logger.warn('Weather fetch failed after all retries', { key, error: lastError.message });
  const stale = cache.get(key);
  if (stale) return { data: stale.data, fetchedAt: stale.fetchedAt, stale: true };
  return null;
}

/**
 * Get cached weather for a location. Fetches from upstream if cache is stale.
 * Returns { data, fetchedAt, stale } or null if no data available at all.
 * @param {string|object} cityOrConfig  city name string OR { city, locationId }
 */
async function getWeather(cityOrConfig) {
  const locationConfig = typeof cityOrConfig === 'string'
    ? { city: cityOrConfig }
    : cityOrConfig;
  const key = cacheKey(locationConfig);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < _intervalMinutes * 60 * 1000) {
    return { data: cached.data, fetchedAt: cached.fetchedAt, stale: false };
  }
  if (_inflight.has(key)) return _inflight.get(key);
  const promise = refreshLocation(locationConfig).finally(() => _inflight.delete(key));
  _inflight.set(key, promise);
  return promise;
}

// Keep refreshCity as an alias used by tests and scheduler
function refreshCity(city) {
  return refreshLocation(typeof city === 'string' ? { city } : city);
}

/**
 * Start (or restart) periodic refresh for all weather components.
 * @param {Function} getLocationsFromScenes  async fn → [{ city, locationId }]
 * @param {number}   [intervalMinutes=30]
 */
function startScheduler(getLocationsFromScenes, intervalMinutes) {
  _intervalMinutes = Math.max(1, Math.min(1440, Math.round(intervalMinutes || 30)));
  if (_refreshJob) _refreshJob.cancel();

  const cronInterval = Math.min(60, _intervalMinutes);
  _refreshJob = schedule.scheduleJob(`0 */${cronInterval} * * * *`, async () => {
    const locations = await getLocationsFromScenes();
    logger.info('Weather scheduler tick', { count: locations.length, intervalMinutes: _intervalMinutes });
    for (const loc of locations) {
      await refreshLocation(loc);
    }
  });
  logger.info('Weather scheduler started', { intervalMinutes: _intervalMinutes });
}

module.exports = {
  getWeather,
  refreshCity,
  startScheduler,
  setSocketService,
  getIntervalMinutes: () => _intervalMinutes,
};
