const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const { authenticateJWT, authenticateAny } = require('../middleware/auth');

// GET /api/v1/devices
router.get('/', authenticateJWT, deviceController.listDevices);

// POST /api/v1/devices
router.post('/', authenticateJWT, deviceController.createDevice);

// GET /api/v1/devices/:id
router.get('/:id', authenticateJWT, deviceController.getDevice);

// PUT /api/v1/devices/:id
router.put('/:id', authenticateJWT, deviceController.updateDevice);

// DELETE /api/v1/devices/:id
router.delete('/:id', authenticateJWT, deviceController.deleteDevice);

// GET /api/v1/devices/:id/config
// Used by display client using device_key - no JWT required, validated by device_key header
router.get('/:id/config', deviceController.getDeviceConfig);

// POST /api/v1/devices/:id/heartbeat
// No auth required from device - device_key is implicitly trusted via config fetch
router.post('/:id/heartbeat', deviceController.heartbeat);

// GET /api/v1/devices/:id/scenes
router.get('/:id/scenes', authenticateJWT, deviceController.getDeviceScenes);

// PUT /api/v1/devices/:id/scenes
router.put('/:id/scenes', authenticateJWT, deviceController.setDeviceScenes);

// POST /api/v1/devices/:id/active-scene
router.post('/:id/active-scene', authenticateAny, deviceController.forceScene);

// POST /api/v1/devices/:id/refresh
router.post('/:id/refresh', authenticateJWT, deviceController.forceRefresh);

module.exports = router;
