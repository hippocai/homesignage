const express = require('express');
const router = express.Router();
const reminderController = require('../controllers/reminderController');
const emergencyController = require('../controllers/emergencyController');
const { authenticateAny } = require('../middleware/auth');

// --- Timed Reminders ---
// GET /api/v1/reminders/timed
router.get('/timed', authenticateAny, reminderController.listReminders);

// POST /api/v1/reminders/timed
router.post('/timed', authenticateAny, reminderController.createReminder);

// GET /api/v1/reminders/timed/:id
router.get('/timed/:id', authenticateAny, reminderController.getReminder);

// PUT /api/v1/reminders/timed/:id
router.put('/timed/:id', authenticateAny, reminderController.updateReminder);

// DELETE /api/v1/reminders/timed/:id
router.delete('/timed/:id', authenticateAny, reminderController.deleteReminder);

// --- Emergency Alerts ---
// GET /api/v1/reminders/emergency
router.get('/emergency', authenticateAny, emergencyController.listAlerts);

// POST /api/v1/reminders/emergency
router.post('/emergency', authenticateAny, emergencyController.triggerAlert);

// GET /api/v1/reminders/emergency/active
router.get('/emergency/active', authenticateAny, emergencyController.getActiveAlerts);

// DELETE /api/v1/reminders/emergency/:id
router.delete('/emergency/:id', authenticateAny, emergencyController.clearAlert);

module.exports = router;
