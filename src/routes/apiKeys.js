const express = require('express');
const router = express.Router();
const apiKeyController = require('../controllers/apiKeyController');
const { authenticateJWT } = require('../middleware/auth');

// GET /api/v1/api-keys
router.get('/', authenticateJWT, apiKeyController.listKeys);

// POST /api/v1/api-keys
router.post('/', authenticateJWT, apiKeyController.createKey);

// DELETE /api/v1/api-keys/:id
router.delete('/:id', authenticateJWT, apiKeyController.deleteKey);

module.exports = router;
