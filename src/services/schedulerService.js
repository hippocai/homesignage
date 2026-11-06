const schedule = require('node-schedule');
const reminderDao = require('../dao/reminderDao');
const infoItemDao = require('../dao/infoItemDao');
const socketService = require('./socketService');
const logger = require('../utils/logger');

// Map of reminderId -> { startJob, endJob }
const scheduledJobs = new Map();

/**
 * Parse "HH:MM" time string and build a cron-like rule for node-schedule.
 * Returns a RecurrenceRule.
 */
function buildRule(timeStr, repeat) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const rule = new schedule.RecurrenceRule();
  rule.hour = hours;
  rule.minute = minutes;
  rule.second = 0;

  switch (repeat) {
    case 'daily':
      // runs every day - default behavior when no dayOfWeek set
      break;
    case 'weekday':
      rule.dayOfWeek = [1, 2, 3, 4, 5]; // Mon-Fri
      break;
    case 'weekend':
      rule.dayOfWeek = [0, 6]; // Sun, Sat
      break;
    case 'none':
    default:
      // For 'none', we schedule for the next occurrence of that time today or tomorrow
      // node-schedule with RecurrenceRule will run daily by default, but we cancel after first run
      break;
  }
  return rule;
}

function buildDateFromParts(dateStr, timeStr) {
  // dateStr: YYYY-MM-DD, timeStr: HH:MM
  const [h, m] = timeStr.split(':').map(Number);
  const d = dateStr ? new Date(dateStr+'T00:00:00') : new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function emitToDevices(device_ids, event, payload) {
  if (!Array.isArray(device_ids) || device_ids.length === 0) return;
  if (device_ids.includes('all')) {
    socketService.emitToAll(event, payload);
  } else {
    device_ids.forEach((deviceId) => socketService.emitToDevice(deviceId, event, payload));
  }
}

function datedWindow(reminder) {
  const start=buildDateFromParts(reminder.start_date,reminder.start_time);
  const end=buildDateFromParts(reminder.start_date,reminder.end_time);
  if(end<=start) end.setDate(end.getDate()+1);
  return {start,end};
}
async function emitDated(reminder,event) {
  let current=reminder;
  if(reminder.created_by?.startsWith('pig:')) {
    // A timer may already be queued when a chat edit cancels its job.
    current=await reminderDao.findById(reminder.id);
    if(!current?.enabled || current.repeat!=='none' || current.start_date!==reminder.start_date ||
      current.start_time!==reminder.start_time || current.end_time!==reminder.end_time) return;
  }
  const payload={reminderId:current.id};
  if(event==='timed-reminder-start') Object.assign(payload,{content:current.content,sound:current.sound,
    start_time:current.start_time,end_time:current.end_time});
  emitToDevices(current.device_ids,event,payload);
}
async function activeDatedFor(device,now=new Date()) {
  const day=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  const prior=new Date(now);prior.setDate(prior.getDate()-1);
  return (await reminderDao.datedForDevice(device,day(now),day(prior))).filter(r=>{
    const {start,end}=datedWindow(r);return start<=now && now<end;
  });
}

function scheduleReminder(reminder) {
  if (!reminder.enabled) return;

  const { id, start_date, start_time, end_time, repeat, device_ids, content, sound } = reminder;

  cancelReminder(id);

  let startJob, endJob;

  if (repeat === 'none' && start_date) {
    // One-time: schedule at specific date+time
    const {start:startDate,end:endDate}=datedWindow(reminder);

    if (startDate > new Date()) {
      startJob = schedule.scheduleJob(`reminder-start-${id}`, startDate, () => {
        logger.info('Timed reminder starting (one-time)', { reminderId: id });
        return emitDated(reminder,'timed-reminder-start');
      });
    }
    if (endDate > new Date()) {
      endJob = schedule.scheduleJob(`reminder-end-${id}`, endDate, () => {
        logger.info('Timed reminder ending (one-time)', { reminderId: id });
        return emitDated(reminder,'timed-reminder-end');
      });
    }
  } else {
    // Recurring: use RecurrenceRule
    const startRule = buildRule(start_time, repeat);
    const endRule = buildRule(end_time, repeat);

    startJob = schedule.scheduleJob(`reminder-start-${id}`, startRule, () => {
      logger.info('Timed reminder starting', { reminderId: id, start_time });
      emitToDevices(device_ids, 'timed-reminder-start', { reminderId: id, content, sound, start_time, end_time });
    });

    endJob = schedule.scheduleJob(`reminder-end-${id}`, endRule, () => {
      logger.info('Timed reminder ending', { reminderId: id, end_time });
      emitToDevices(device_ids, 'timed-reminder-end', { reminderId: id });
    });
  }

  scheduledJobs.set(id, { startJob, endJob });
  logger.info('Reminder scheduled', { reminderId: id, start_date, start_time, end_time, repeat });
}

function cancelReminder(reminderId) {
  const jobs = scheduledJobs.get(reminderId);
  if (jobs) {
    if (jobs.startJob) jobs.startJob.cancel();
    if (jobs.endJob) jobs.endJob.cancel();
    scheduledJobs.delete(reminderId);
    logger.info('Reminder jobs cancelled', { reminderId });
  }
}

async function initScheduler() {
  try {
    const reminders = await reminderDao.findEnabled();
    logger.info('Loading enabled reminders for scheduling', { count: reminders.length });
    for (const reminder of reminders) {
      scheduleReminder(reminder);
    }

    // Clean up expired info items every hour
    schedule.scheduleJob('info-items-cleanup', '0 * * * *', async () => {
      try {
        const count = await infoItemDao.deleteExpired();
        if (count > 0) logger.info('Cleaned up expired info items', { count });
      } catch (err) {
        logger.error('Failed to clean up expired info items', { error: err.message });
      }
    });

    logger.info('Scheduler initialized successfully');
  } catch (err) {
    logger.error('Failed to initialize scheduler', { error: err.message });
  }
}

async function rescheduleAll() {
  // Cancel all existing jobs
  for (const [id] of scheduledJobs.entries()) {
    cancelReminder(id);
  }
  await initScheduler();
}

module.exports = { initScheduler, scheduleReminder, cancelReminder, rescheduleAll,activeDatedFor };
