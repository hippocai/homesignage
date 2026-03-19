const { v4: uuidv4 } = require('uuid');
const emergencyDao = require('../dao/emergencyDao');
const socketService = require('../services/socketService');
const logger = require('../utils/logger');

async function listAlerts(req, res) {
  try {
    const alerts = await emergencyDao.findAll();
    return res.json({ data: alerts });
  } catch (err) {
    logger.error('List emergency alerts error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function triggerAlert(req, res) {
  const device_ids = req.body.device_ids || req.body.deviceIds;
  const { content, sound } = req.body;

  if (!device_ids || !content || !sound) {
    return res.status(400).json({ error: 'device_ids, content, and sound are required' });
  }

  if (!Array.isArray(device_ids) || device_ids.length === 0) {
    return res.status(400).json({ error: 'device_ids must be a non-empty array' });
  }

  try {
    const id = uuidv4();
    const triggeredBy = req.user ? req.user.id : (req.apiKey ? req.apiKey.id : null);

    const alert = await emergencyDao.create({ id, device_ids, content, sound, triggered_by: triggeredBy });

    // Emit to target devices immediately (< 2s latency requirement)
    const payload = { ...alert, alertId: id };

    if (device_ids.includes('all')) {
      socketService.emitToAll('emergency-alert', payload);
    } else {
      device_ids.forEach((deviceId) => {
        socketService.emitToDevice(deviceId, 'emergency-alert', payload);
      });
    }

    logger.info('Emergency alert triggered', { alertId: id, device_ids });
    return res.status(201).json({ data: alert, message: 'Emergency alert triggered' });
  } catch (err) {
    logger.error('Trigger emergency alert error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getActiveAlerts(req, res) {
  try {
    const alerts = await emergencyDao.findActive();
    return res.json({ data: alerts });
  } catch (err) {
    logger.error('Get active alerts error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function clearAlert(req, res) {
  const { id } = req.params;
  try {
    const alert = await emergencyDao.findById(id);
    if (!alert) {
      return res.status(404).json({ error: 'Emergency alert not found' });
    }

    if (alert.status !== 'active') {
      return res.status(400).json({ error: 'Alert is already cleared' });
    }

    const clearedBy = req.user ? req.user.id : (req.apiKey ? req.apiKey.id : null);
    await emergencyDao.clear(id, clearedBy);

    // Emit clear event to target devices
    const clearPayload = { alertId: id };

    if (alert.device_ids.includes('all')) {
      socketService.emitToAll('emergency-clear', clearPayload);
    } else {
      alert.device_ids.forEach((deviceId) => {
        socketService.emitToDevice(deviceId, 'emergency-clear', clearPayload);
      });
    }

    logger.info('Emergency alert cleared', { alertId: id });
    return res.json({ message: 'Emergency alert cleared' });
  } catch (err) {
    logger.error('Clear alert error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { listAlerts, triggerAlert, getActiveAlerts, clearAlert };
