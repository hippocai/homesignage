const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { authenticateJWT } = require('../middleware/auth');

// POST /api/v1/uploads
router.post('/', authenticateJWT, uploadController.uploadFile);

// GET /api/v1/uploads
router.get('/', authenticateJWT, uploadController.listUploads);

// DELETE /api/v1/uploads/:id
router.delete('/:id', authenticateJWT, uploadController.deleteUpload);

module.exports = router;
