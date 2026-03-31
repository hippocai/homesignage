const { v4: uuidv4 } = require('uuid');
const sceneDao = require('../dao/sceneDao');
const componentDao = require('../dao/componentDao');
const socketService = require('../services/socketService');
const weatherService = require('../services/weatherService');
const { localizeUrl } = require('../services/assetDownloadService');
const logger = require('../utils/logger');

// Asset types whose URL should be downloaded to local file-repo
const ASSET_URL_TYPES = new Set(['image', 'video']);

// Re-compute and restart the weather scheduler whenever weather components change
async function maybeRestartWeatherScheduler(type) {
  if (type !== 'weather') return;
  const comps = await componentDao.findByType('weather').catch(() => []);
  const seen = new Set();
  const locations = comps.map((c) => ({
    city:       (c.config && c.config.city) || 'Beijing',
    locationId: (c.config && c.config.locationId) || null,
  })).filter((loc) => {
    const k = (loc.locationId || loc.city).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const intervals = comps.map((c) => parseInt((c.config && c.config.refreshInterval) || 30, 10)).filter(Boolean);
  const minInterval = intervals.length ? Math.min(...intervals) : 30;
  weatherService.startScheduler(async () => locations, minInterval);
  logger.info('Weather scheduler restarted', { intervalMinutes: minInterval, locations: locations.length });
}

async function localizeComponentConfig(type, config) {
  if (!ASSET_URL_TYPES.has(type)) return config;
  const url = config.url || config.src;
  if (!url) return config;
  const localUrl = await localizeUrl(url);
  if (localUrl === url) return config;
  return { ...config, url: localUrl };
}

async function listScenes(req, res) {
  try {
    const scenes = await sceneDao.findAll();
    return res.json({ data: scenes });
  } catch (err) {
    logger.error('List scenes error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createScene(req, res) {
  const { name, description, thumbnail } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Scene name is required' });
  }

  try {
    const id = uuidv4();
    const scene = await sceneDao.create({ id, name, description, thumbnail });
    logger.info('Scene created', { sceneId: id, name });
    return res.status(201).json({ data: scene, message: 'Scene created successfully' });
  } catch (err) {
    logger.error('Create scene error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getScene(req, res) {
  const { id } = req.params;
  try {
    const scene = await sceneDao.findWithComponents(id);
    if (!scene) {
      return res.status(404).json({ error: 'Scene not found' });
    }
    return res.json({ data: scene });
  } catch (err) {
    logger.error('Get scene error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateScene(req, res) {
  const { id } = req.params;
  try {
    const scene = await sceneDao.findById(id);
    if (!scene) {
      return res.status(404).json({ error: 'Scene not found' });
    }
    const updated = await sceneDao.update(id, req.body);
    logger.info('Scene updated', { sceneId: id });
    socketService.emitToAll('config-updated', { sceneId: id });
    return res.json({ data: updated, message: 'Scene updated successfully' });
  } catch (err) {
    logger.error('Update scene error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteScene(req, res) {
  const { id } = req.params;
  try {
    const deleted = await sceneDao.delete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Scene not found' });
    }
    logger.info('Scene deleted', { sceneId: id });
    socketService.emitToAll('config-updated', { sceneId: id });
    return res.json({ message: 'Scene deleted successfully' });
  } catch (err) {
    logger.error('Delete scene error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getComponents(req, res) {
  const { id } = req.params;
  try {
    const scene = await sceneDao.findById(id);
    if (!scene) {
      return res.status(404).json({ error: 'Scene not found' });
    }
    const components = await componentDao.findBySceneId(id);
    return res.json({ data: components });
  } catch (err) {
    logger.error('Get components error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function addComponent(req, res) {
  const { id: sceneId } = req.params;
  const { type, position, config, style, sort_order } = req.body;

  if (!type || !position || !config) {
    return res.status(400).json({ error: 'type, position, and config are required' });
  }

  try {
    const scene = await sceneDao.findById(sceneId);
    if (!scene) {
      return res.status(404).json({ error: 'Scene not found' });
    }

    const localizedConfig = await localizeComponentConfig(type, config);
    const componentId = uuidv4();
    const component = await componentDao.create({
      id: componentId,
      scene_id: sceneId,
      type,
      position,
      config: localizedConfig,
      style: style || {},
      sort_order: sort_order || 0
    });

    logger.info('Component added to scene', { sceneId, componentId, type });
    socketService.emitToAll('config-updated', { sceneId });
    await maybeRestartWeatherScheduler(type);
    return res.status(201).json({ data: component, message: 'Component added successfully' });
  } catch (err) {
    logger.error('Add component error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateComponent(req, res) {
  const { id: sceneId, componentId } = req.params;
  try {
    const component = await componentDao.findById(componentId);
    if (!component || component.scene_id !== sceneId) {
      return res.status(404).json({ error: 'Component not found' });
    }
    const body = { ...req.body };
    if (body.config) {
      body.config = await localizeComponentConfig(component.type, body.config);
    }
    const updated = await componentDao.update(componentId, body);
    logger.info('Component updated', { componentId, sceneId });
    socketService.emitToAll('config-updated', { sceneId });
    await maybeRestartWeatherScheduler(component.type);
    return res.json({ data: updated, message: 'Component updated successfully' });
  } catch (err) {
    logger.error('Update component error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteComponent(req, res) {
  const { id: sceneId, componentId } = req.params;
  try {
    const component = await componentDao.findById(componentId);
    if (!component || component.scene_id !== sceneId) {
      return res.status(404).json({ error: 'Component not found' });
    }
    const deletedType = component.type;
    await componentDao.delete(componentId);
    logger.info('Component deleted', { componentId, sceneId });
    socketService.emitToAll('config-updated', { sceneId });
    await maybeRestartWeatherScheduler(deletedType);
    return res.json({ message: 'Component deleted successfully' });
  } catch (err) {
    logger.error('Delete component error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateTextContent(req, res) {
  const { id: sceneId } = req.params;
  const { componentId, text } = req.body;

  if (!componentId || text === undefined) {
    return res.status(400).json({ error: 'componentId and text are required' });
  }

  try {
    const scene = await sceneDao.findById(sceneId);
    if (!scene) {
      return res.status(404).json({ error: 'Scene not found' });
    }

    const component = await componentDao.findById(componentId);
    if (!component || component.scene_id !== sceneId) {
      return res.status(404).json({ error: 'Component not found in this scene' });
    }

    if (component.type !== 'text') {
      return res.status(400).json({ error: 'Component is not a text type' });
    }

    const updatedConfig = { ...component.config, text };
    const updated = await componentDao.update(componentId, { config: updatedConfig });

    // Notify devices displaying this scene to reload config
    socketService.emitToAll('config-updated', { sceneId });

    logger.info('Text component content updated', { componentId, sceneId });
    return res.json({ data: updated, message: 'Text content updated successfully' });
  } catch (err) {
    logger.error('Update text content error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listScenes,
  createScene,
  getScene,
  updateScene,
  deleteScene,
  getComponents,
  addComponent,
  updateComponent,
  deleteComponent,
  updateTextContent
};
