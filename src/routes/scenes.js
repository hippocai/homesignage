const express = require('express');
const router = express.Router();
const sceneController = require('../controllers/sceneController');
const { authenticateJWT, authenticateAny } = require('../middleware/auth');

// GET /api/v1/scenes
router.get('/', authenticateJWT, sceneController.listScenes);

// POST /api/v1/scenes
router.post('/', authenticateJWT, sceneController.createScene);

// GET /api/v1/scenes/:id
router.get('/:id', authenticateJWT, sceneController.getScene);

// PUT /api/v1/scenes/:id
router.put('/:id', authenticateJWT, sceneController.updateScene);

// DELETE /api/v1/scenes/:id
router.delete('/:id', authenticateJWT, sceneController.deleteScene);

// GET /api/v1/scenes/:id/components
router.get('/:id/components', authenticateJWT, sceneController.getComponents);

// POST /api/v1/scenes/:id/components
router.post('/:id/components', authenticateJWT, sceneController.addComponent);

// PUT /api/v1/scenes/:id/components/:componentId
router.put('/:id/components/:componentId', authenticateJWT, sceneController.updateComponent);

// DELETE /api/v1/scenes/:id/components/:componentId
router.delete('/:id/components/:componentId', authenticateJWT, sceneController.deleteComponent);

// PATCH /api/v1/scenes/:id/content/text - external API for updating text content
router.patch('/:id/content/text', authenticateAny, sceneController.updateTextContent);

module.exports = router;
