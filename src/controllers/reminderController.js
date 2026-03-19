const { v4: uuidv4 } = require('uuid');
const reminderDao = require('../dao/reminderDao');
const schedulerService = require('../services/schedulerService');
const logger = require('../utils/logger');

async function listReminders(req, res) {
  try {
    const reminders = await reminderDao.findAll();
    return res.json({ data: reminders });
  } catch (err) {
    logger.error('List reminders error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createReminder(req, res) {
  const { name, device_ids, start_time, end_time, repeat, content, sound, priority, enabled } = req.body;

  if (!name || !device_ids || !start_time || !end_time || !content) {
    return res.status(400).json({
      error: 'name, device_ids, start_time, end_time, and content are required'
    });
  }

  if (!Array.isArray(device_ids) || device_ids.length === 0) {
    return res.status(400).json({ error: 'device_ids must be a non-empty array' });
  }

  // Validate time format HH:MM
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!timeRegex.test(start_time) || !timeRegex.test(end_time)) {
    return res.status(400).json({ error: 'start_time and end_time must be in HH:MM format' });
  }

  try {
    const id = uuidv4();
    const createdBy = req.user ? req.user.id : (req.apiKey ? req.apiKey.id : null);

    const reminder = await reminderDao.create({
      id,
      name,
      device_ids,
      start_time,
      end_time,
      repeat: repeat || 'none',
      content,
      sound: sound || null,
      priority: priority !== undefined ? priority : 5,
      enabled: enabled !== undefined ? enabled : true,
      created_by: createdBy
    });

    // Schedule the reminder if enabled
    if (reminder.enabled) {
      schedulerService.scheduleReminder(reminder);
    }

    logger.info('Timed reminder created', { reminderId: id, name });
    return res.status(201).json({ data: reminder, message: 'Reminder created successfully' });
  } catch (err) {
    logger.error('Create reminder error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getReminder(req, res) {
  const { id } = req.params;
  try {
    const reminder = await reminderDao.findById(id);
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    return res.json({ data: reminder });
  } catch (err) {
    logger.error('Get reminder error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateReminder(req, res) {
  const { id } = req.params;
  try {
    const existing = await reminderDao.findById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    // Validate time format if provided
    const { start_time, end_time } = req.body;
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (start_time && !timeRegex.test(start_time)) {
      return res.status(400).json({ error: 'start_time must be in HH:MM format' });
    }
    if (end_time && !timeRegex.test(end_time)) {
      return res.status(400).json({ error: 'end_time must be in HH:MM format' });
    }

    const updated = await reminderDao.update(id, req.body);

    // Reschedule: cancel existing and reschedule if enabled
    schedulerService.cancelReminder(id);
    if (updated.enabled) {
      schedulerService.scheduleReminder(updated);
    }

    logger.info('Reminder updated', { reminderId: id });
    return res.json({ data: updated, message: 'Reminder updated successfully' });
  } catch (err) {
    logger.error('Update reminder error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteReminder(req, res) {
  const { id } = req.params;
  try {
    const deleted = await reminderDao.delete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    // Cancel scheduled jobs
    schedulerService.cancelReminder(id);

    logger.info('Reminder deleted', { reminderId: id });
    return res.json({ message: 'Reminder deleted successfully' });
  } catch (err) {
    logger.error('Delete reminder error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { listReminders, createReminder, getReminder, updateReminder, deleteReminder };
