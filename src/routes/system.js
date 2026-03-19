const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const { authenticateJWT } = require('../middleware/auth');

// GET /api/v1/system/status
router.get('/status', authenticateJWT, systemController.getStatus);

module.exports = router;
