const { v4: uuidv4 } = require('uuid');
const sceneDao = require('../dao/sceneDao');
const componentDao = require('../dao/componentDao');
const socketService = require('../services/socketService');
const logger = require('../utils/logger');

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

    const componentId = uuidv4();
    const component = await componentDao.create({
      id: componentId,
      scene_id: sceneId,
      type,
      position,
      config,
      style: style || {},
      sort_order: sort_order || 0
    });

    logger.info('Component added to scene', { sceneId, componentId, type });
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
    const updated = await componentDao.update(componentId, req.body);
    logger.info('Component updated', { componentId, sceneId });
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
    await componentDao.delete(componentId);
    logger.info('Component deleted', { componentId, sceneId });
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
