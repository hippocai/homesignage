const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { authenticateJWT } = require('../middleware/auth');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// POST /api/v1/auth/login
router.post('/login', loginLimiter, authController.login);

// GET /api/v1/auth/verify
router.get('/verify', authenticateJWT, authController.verify);

// POST /api/v1/auth/change-password
router.post('/change-password', authenticateJWT, authController.changePassword);

module.exports = router;
