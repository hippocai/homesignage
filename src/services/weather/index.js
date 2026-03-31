/**
 * Weather provider registry.
 * Add new providers by requiring them here and adding to PROVIDERS.
 */
const settingsDao = require('../../dao/settingsDao');

const PROVIDERS = {
  wttr:     require('./providers/wttr'),
  qweather: require('./providers/qweather'),
};

async function getProviderConfig() {
  const all = await settingsDao.getAll().catch(() => ({}));
  const providerName = all['weather.provider'] || 'wttr';
  const provider = PROVIDERS[providerName] || PROVIDERS.wttr;
  const apiConfig = {
    apiKey: all['weather.qweather.apiKey'] || '',
    host:   all['weather.qweather.host']   || 'devapi.qweather.com',
  };
  return { provider, apiConfig };
}

/**
 * Fetch current weather for the given location config.
 * @param {{ city: string, locationId?: string }} locationConfig
 */
async function fetchWeather(locationConfig) {
  const { provider, apiConfig } = await getProviderConfig();
  return provider.fetchWeather(locationConfig, apiConfig);
}

/**
 * Search locations by name using the active provider's GeoAPI.
 * @param {string} query
 * @returns {Promise<Array<{ id, name, adm1, adm2, country, displayName }>>}
 */
async function searchLocations(query) {
  const { provider, apiConfig } = await getProviderConfig();
  return provider.searchLocations(query, apiConfig);
}

/** Returns the list of available providers with metadata. */
function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    name:           p.name,
    requiresApiKey: p.requiresApiKey,
  }));
}

module.exports = { fetchWeather, searchLocations, listProviders };
