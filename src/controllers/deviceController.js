const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const deviceDao = require('../dao/deviceDao');
const deviceSceneDao = require('../dao/deviceSceneDao');
const sceneDao = require('../dao/sceneDao');
const componentDao = require('../dao/componentDao');
const emergencyDao = require('../dao/emergencyDao');
const socketService = require('../services/socketService');
const scenePlannerService = require('../services/scenePlannerService');
const logger = require('../utils/logger');

function generateDeviceKey() {
  return crypto.randomBytes(24).toString('hex');
}

async function listDevices(req, res) {
  try {
    const devices = await deviceDao.findAll();
    const connectedIds = new Set(socketService.getConnectedDevices());
    const devicesWithStatus = devices.map((d) => ({
      ...d,
      connected: connectedIds.has(d.id)
    }));
    return res.json({ data: devicesWithStatus });
  } catch (err) {
    logger.error('List devices error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createDevice(req, res) {
  const { name, group_name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Device name is required' });
  }

  try {
    const id = uuidv4();
    const device_key = generateDeviceKey();
    const device = await deviceDao.create({ id, name, group_name, device_key });
    logger.info('Device created', { deviceId: id, name });
    return res.status(201).json({ data: device, message: 'Device created successfully' });
  } catch (err) {
    logger.error('Create device error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getDevice(req, res) {
  const { id } = req.params;
  try {
    const device = await deviceDao.findById(id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    return res.json({ data: device });
  } catch (err) {
    logger.error('Get device error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateDevice(req, res) {
  const { id } = req.params;
  try {
    const device = await deviceDao.findById(id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const updated = await deviceDao.update(id, req.body);
    logger.info('Device updated', { deviceId: id });
    return res.json({ data: updated, message: 'Device updated successfully' });
  } catch (err) {
    logger.error('Update device error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteDevice(req, res) {
  const { id } = req.params;
  try {
    const deleted = await deviceDao.delete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Device not found' });
    }
    logger.info('Device deleted', { deviceId: id });
    return res.json({ message: 'Device deleted successfully' });
  } catch (err) {
    logger.error('Delete device error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getDeviceConfig(req, res) {
  const { id } = req.params;
  const deviceKey = req.headers['x-device-key'];

  if (!deviceKey) {
    return res.status(401).json({ error: 'X-Device-Key header required' });
  }

  try {
    const device = await deviceDao.findById(id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    if (device.device_key !== deviceKey) {
      return res.status(401).json({ error: 'Invalid device key' });
    }

    // Get device scenes with full scene + component data
    const deviceScenes = await deviceSceneDao.findByDeviceId(id);

    const scenesWithComponents = await Promise.all(
      deviceScenes
        .filter((ds) => ds.enabled)
        .map(async (ds) => {
          const components = await componentDao.findBySceneId(ds.scene_id);
          return {
            deviceSceneConfig: {
              duration: ds.duration,
              sort_order: ds.sort_order,
              enabled: ds.enabled
            },
            scene: {
              id: ds.scene_id,
              name: ds.scene_name,
              description: ds.scene_description,
              thumbnail: ds.scene_thumbnail
            },
            components
          };
        })
    );

    // Check for active emergency alerts targeting this device
    const activeAlerts = await emergencyDao.findActive();
    const deviceAlerts = activeAlerts.filter((a) => {
      return a.device_ids.includes('all') || a.device_ids.includes(id);
    });

    return res.json({
      data: {
        device: {
          id: device.id,
          name: device.name,
          group_name: device.group_name,
          config: device.config
        },
        scenes: scenesWithComponents,
        emergency_alerts: deviceAlerts
      }
    });
  } catch (err) {
    logger.error('Get device config error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function heartbeat(req, res) {
  const { id } = req.params;
  const ipAddress = req.ip || req.headers['x-forwarded-for'];

  try {
    const device = await deviceDao.findById(id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    await deviceDao.updateStatus(id, 'online', ipAddress);

    // Check for active emergency alerts
    const activeAlerts = await emergencyDao.findActive();
    const deviceAlerts = activeAlerts.filter((a) => {
      return a.device_ids.includes('all') || a.device_ids.includes(id);
    });

    return res.json({
      data: {
        status: 'online',
        emergency_alerts: deviceAlerts
      },
      message: 'Heartbeat received'
    });
  } catch (err) {
    logger.error('Heartbeat error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getDeviceScenes(req, res) {
  const { id } = req.params;
  try {
    const device = await deviceDao.findById(id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const scenes = await deviceSceneDao.findByDeviceId(id);
    return res.json({ data: scenes });
  } catch (err) {
    logger.error('Get device scenes error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function setDeviceScenes(req, res) {
  const { id } = req.params;
  const scenes = req.body.scenes;

  if (!Array.isArray(scenes)) {
    return res.status(400).json({ error: 'scenes must be an array' });
  }

  try {
    const device = await deviceDao.findById(id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const result = await deviceSceneDao.setDeviceScenes(id, scenes);

    // Notify device to reload config and update scene planner
    socketService.emitToDevice(id, 'config-updated', { deviceId: id });
    scenePlannerService.onDeviceConfigChange(id);

    logger.info('Device scenes updated', { deviceId: id, sceneCount: scenes.length });
    return res.json({ data: result, message: 'Device scenes updated successfully' });
  } catch (err) {
    logger.error('Set device scenes error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function forceScene(req, res) {
  const { id } = req.params;
  const { sceneId } = req.body;

  if (!sceneId) {
    return res.status(400).json({ error: 'sceneId is required' });
  }

  try {
    const device = await deviceDao.findById(id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const scene = await sceneDao.findById(sceneId);
    if (!scene) {
      return res.status(404).json({ error: 'Scene not found' });
    }

    socketService.emitToDevice(id, 'force-scene', { sceneId });
    logger.info('Force scene emitted', { deviceId: id, sceneId });
    return res.json({ message: 'Force scene command sent' });
  } catch (err) {
    logger.error('Force scene error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function forceRefresh(req, res) {
  const { id } = req.params;
  try {
    const device = await deviceDao.findById(id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    socketService.emitToDevice(id, 'force-refresh', { reason: 'manual' });
    logger.info('Force refresh emitted', { deviceId: id });
    return res.json({ message: 'Force refresh command sent' });
  } catch (err) {
    logger.error('Force refresh error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listDevices,
  createDevice,
  getDevice,
  updateDevice,
  deleteDevice,
  getDeviceConfig,
  heartbeat,
  getDeviceScenes,
  setDeviceScenes,
  forceScene,
  forceRefresh
};
