const settingsDao = require('../dao/settingsDao');
const logger = require('../utils/logger');

// Keys that are allowed to be read/written via the API.
// Sensitive values (api keys) are masked on GET.
const ALLOWED_KEYS = new Set([
  'weather.provider',
  'weather.qweather.apiKey',
  'weather.qweather.host',
]);

async function getSettings(req, res) {
  try {
    const all = await settingsDao.getAll();
    // Mask API keys: replace with boolean indicating whether set
    const result = {};
    for (const key of ALLOWED_KEYS) {
      const val = all[key];
      if (key.endsWith('.apiKey')) {
        result[key] = val ? '***' : '';
      } else {
        result[key] = val !== undefined ? val : null;
      }
    }
    return res.json({ data: result });
  } catch (err) {
    logger.error('Get settings error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateSettings(req, res) {
  try {
    const updates = req.body || {};
    for (const [key, value] of Object.entries(updates)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      // Don't overwrite API key if placeholder sent
      if (key.endsWith('.apiKey') && value === '***') continue;
      await settingsDao.set(key, value);
    }
    logger.info('Settings updated', { keys: Object.keys(updates) });
    return res.json({ message: 'Settings updated' });
  } catch (err) {
    logger.error('Update settings error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { getSettings, updateSettings };
