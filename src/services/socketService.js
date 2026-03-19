const { Server } = require('socket.io');
const deviceDao = require('../dao/deviceDao');
const emergencyDao = require('../dao/emergencyDao');
const logger = require('../utils/logger');

let io = null;
// Map of socketId -> { deviceId, groupName }
const connectedDevices = new Map();

function initSocketService(server) {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', async (socket) => {
    // Accept deviceId and device_key from handshake auth or query params
    const auth = socket.handshake.auth || {};
    const query = socket.handshake.query || {};

    const deviceId = auth.deviceId || query.deviceId;
    const deviceKey = auth.device_key || query.device_key;

    if (!deviceId || !deviceKey) {
      logger.warn('Socket connection rejected: missing deviceId or device_key', { socketId: socket.id });
      socket.emit('error', { message: 'Missing deviceId or device_key' });
      socket.disconnect(true);
      return;
    }

    try {
      const device = await deviceDao.findById(deviceId);
      if (!device) {
        logger.warn('Socket connection rejected: device not found', { deviceId });
        socket.emit('error', { message: 'Device not found' });
        socket.disconnect(true);
        return;
      }

      if (device.device_key !== deviceKey) {
        logger.warn('Socket connection rejected: invalid device_key', { deviceId });
        socket.emit('error', { message: 'Invalid device_key' });
        socket.disconnect(true);
        return;
      }

      // Join device room
      socket.join(`device:${deviceId}`);

      // Join group room if device has a group
      if (device.group_name) {
        socket.join(`group:${device.group_name}`);
      }

      // Track connection
      connectedDevices.set(socket.id, { deviceId, groupName: device.group_name });

      // Update device status to online
      const ipAddress = socket.handshake.address;
      await deviceDao.updateStatus(deviceId, 'online', ipAddress);

      logger.info('Device connected via WebSocket', { deviceId, socketId: socket.id });

      // Send any active emergency alerts to newly connected device
      try {
        const activeAlerts = await emergencyDao.findActive();
        const deviceAlerts = activeAlerts.filter((alert) => {
          return alert.device_ids.includes('all') || alert.device_ids.includes(deviceId);
        });
        for (const alert of deviceAlerts) {
          socket.emit('emergency-alert', alert);
        }
      } catch (err) {
        logger.warn('Failed to fetch active emergency alerts for new device', { error: err.message });
      }

      socket.on('disconnect', async () => {
        connectedDevices.delete(socket.id);
        logger.info('Device disconnected from WebSocket', { deviceId, socketId: socket.id });

        // Only mark offline if no other sockets exist for this device
        const stillConnected = [...connectedDevices.values()].some((d) => d.deviceId === deviceId);
        if (!stillConnected) {
          try {
            await deviceDao.updateStatus(deviceId, 'offline');
          } catch (err) {
            logger.warn('Failed to update device status on disconnect', { deviceId, error: err.message });
          }
        }
      });

      // Acknowledge successful connection
      socket.emit('connected', { deviceId, status: 'online' });
    } catch (err) {
      logger.error('Socket connection error', { error: err.message, deviceId });
      socket.emit('error', { message: 'Internal server error' });
      socket.disconnect(true);
    }
  });

  logger.info('Socket.IO service initialized');
  return io;
}

function emitToDevice(deviceId, event, data) {
  if (!io) {
    logger.warn('Socket.IO not initialized, cannot emit to device', { deviceId, event });
    return;
  }
  io.to(`device:${deviceId}`).emit(event, data);
  logger.debug('Emitted event to device', { deviceId, event });
}

function emitToGroup(groupName, event, data) {
  if (!io) return;
  io.to(`group:${groupName}`).emit(event, data);
}

function emitToAll(event, data) {
  if (!io) {
    logger.warn('Socket.IO not initialized, cannot emit to all');
    return;
  }
  io.emit(event, data);
  logger.debug('Emitted event to all devices', { event });
}

function getConnectedDevices() {
  const deviceIds = new Set();
  for (const { deviceId } of connectedDevices.values()) {
    deviceIds.add(deviceId);
  }
  return [...deviceIds];
}

module.exports = { initSocketService, emitToDevice, emitToGroup, emitToAll, getConnectedDevices };
