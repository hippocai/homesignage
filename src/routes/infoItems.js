const express = require('express');
const router = express.Router();
const { authenticateJWT, authenticateAny } = require('../middleware/auth');
const ctrl = require('../controllers/infoItemController');

// GET /api/v1/info-items         — all items (admin)
router.get('/', authenticateAny, ctrl.list);

// GET /api/v1/info-items/active  — active non-expired items (public, for display clients)
router.get('/active', ctrl.listActive);

// POST /api/v1/info-items
router.post('/', authenticateAny, ctrl.create);

// PUT /api/v1/info-items/:id
router.put('/:id', authenticateAny, ctrl.update);

// DELETE /api/v1/info-items/:id
router.delete('/:id', authenticateAny, ctrl.delete);

module.exports = router;
