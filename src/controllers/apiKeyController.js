const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const apiKeyDao = require('../dao/apiKeyDao');
const logger = require('../utils/logger');

function generateApiKey() {
  return 'sk_' + crypto.randomBytes(32).toString('hex');
}

async function listKeys(req, res) {
  try {
    const keys = await apiKeyDao.findAll();
    // Mask the actual key for security - only show first/last 4 chars
    const maskedKeys = keys.map((k) => ({
      ...k,
      key: k.key.substring(0, 7) + '...' + k.key.slice(-4)
    }));
    return res.json({ data: maskedKeys });
  } catch (err) {
    logger.error('List API keys error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createKey(req, res) {
  const { name, permissions, expires_at } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'API key name is required' });
  }

  try {
    const id = uuidv4();
    const key = generateApiKey();
    const createdBy = req.user ? req.user.id : null;

    const apiKey = await apiKeyDao.create({
      id,
      name,
      key,
      permissions: permissions || [],
      expires_at: expires_at || null,
      created_by: createdBy
    });

    logger.info('API key created', { keyId: id, name });

    // Return the full key only on creation
    return res.status(201).json({
      data: { ...apiKey, key },
      message: 'API key created. Save this key - it will not be shown again.'
    });
  } catch (err) {
    logger.error('Create API key error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteKey(req, res) {
  const { id } = req.params;
  try {
    const deleted = await apiKeyDao.delete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'API key not found' });
    }
    logger.info('API key deleted', { keyId: id });
    return res.json({ message: 'API key deleted successfully' });
  } catch (err) {
    logger.error('Delete API key error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { listKeys, createKey, deleteKey };
