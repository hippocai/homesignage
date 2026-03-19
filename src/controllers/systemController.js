const deviceDao = require('../dao/deviceDao');
const reminderDao = require('../dao/reminderDao');
const emergencyDao = require('../dao/emergencyDao');
const socketService = require('../services/socketService');
const logger = require('../utils/logger');

const startTime = Date.now();

async function getStatus(req, res) {
  try {
    const [devices, enabledReminders, activeAlerts] = await Promise.all([
      deviceDao.findAll(),
      reminderDao.findEnabled(),
      emergencyDao.findActive()
    ]);

    const connectedDeviceIds = socketService.getConnectedDevices();
    const onlineDevices = devices.filter((d) => d.status === 'online');

    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

    return res.json({
      data: {
        uptime: uptimeSeconds,
        uptime_human: formatUptime(uptimeSeconds),
        device_count: devices.length,
        online_device_count: onlineDevices.length,
        connected_device_count: connectedDeviceIds.length,
        connected_device_ids: connectedDeviceIds,
        active_reminder_count: enabledReminders.length,
        active_emergency_count: activeAlerts.length,
        node_version: process.version,
        platform: process.platform,
        memory: process.memoryUsage(),
        pid: process.pid
      }
    });
  } catch (err) {
    logger.error('Get system status error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}

module.exports = { getStatus };
