const jwt = require('jsonwebtoken');
const apiKeyDao = require('../dao/apiKeyDao');
const userDao = require('../dao/userDao');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

async function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await userDao.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.user = { id: user.id, username: user.username, role: user.role };
    next();
  } catch (err) {
    logger.warn('JWT authentication failed', { error: err.message });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing X-API-Key header' });
  }

  try {
    const keyRecord = await apiKeyDao.findByKey(apiKey);
    if (!keyRecord) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Check expiry
    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return res.status(401).json({ error: 'API key has expired' });
    }

    // Update last used timestamp (fire and forget)
    apiKeyDao.updateLastUsed(keyRecord.id).catch((err) => {
      logger.warn('Failed to update API key last_used_at', { error: err.message });
    });

    req.apiKey = keyRecord;
    next();
  } catch (err) {
    logger.error('API key authentication error', { error: err.message });
    return res.status(500).json({ error: 'Authentication error' });
  }
}

async function authenticateAny(req, res, next) {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateJWT(req, res, next);
  }

  if (apiKey) {
    return authenticateApiKey(req, res, next);
  }

  return res.status(401).json({ error: 'Authentication required. Provide Bearer token or X-API-Key header.' });
}

module.exports = { authenticateJWT, authenticateApiKey, authenticateAny };
