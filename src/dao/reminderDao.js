const { db } = require('../config/database');

function parseReminder(row) {
  if (!row) return null;
  return {
    ...row,
    device_ids: row.device_ids ? JSON.parse(row.device_ids) : [],
    content: row.content ? JSON.parse(row.content) : {},
    enabled: row.enabled === 1 || row.enabled === true
  };
}

function findById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM timed_reminders WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      resolve(parseReminder(row));
    });
  });
}

function findAll() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM timed_reminders ORDER BY created_at DESC', [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(parseReminder));
    });
  });
}

function findEnabled() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM timed_reminders WHERE enabled = 1 ORDER BY start_time ASC', [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(parseReminder));
    });
  });
}

function findActive() {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM timed_reminders
       WHERE enabled = 1 AND start_time <= ? AND end_time >= ?
         AND (repeat != 'none' OR start_date = ? OR start_date IS NULL)`,
      [timeStr, timeStr, dateStr],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(parseReminder));
      }
    );
  });
}

function create(reminder) {
  return new Promise((resolve, reject) => {
    const {
      id,
      name,
      device_ids,
      start_date = null,
      start_time,
      end_time,
      repeat = 'none',
      content,
      sound = null,
      priority = 5,
      enabled = 1,
      created_by = null
    } = reminder;
    db.run(
      `INSERT INTO timed_reminders
       (id, name, device_ids, start_date, start_time, end_time, repeat, content, sound, priority, enabled, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        JSON.stringify(device_ids),
        start_date,
        start_time,
        end_time,
        repeat,
        JSON.stringify(content),
        sound,
        priority,
        enabled ? 1 : 0,
        created_by
      ],
      function (err) {
        if (err) return reject(err);
        resolve(findById(id));
      }
    );
  });
}

function update(id, fields) {
  return new Promise((resolve, reject) => {
    const jsonFields = ['device_ids', 'content'];
    const allowed = ['name', 'device_ids', 'start_date', 'start_time', 'end_time', 'repeat', 'content', 'sound', 'priority', 'enabled'];
    const updates = [];
    const values = [];
    for (const key of allowed) {
      if (key in fields) {
        updates.push(`${key} = ?`);
        if (jsonFields.includes(key)) {
          values.push(JSON.stringify(fields[key]));
        } else if (key === 'enabled') {
          values.push(fields[key] ? 1 : 0);
        } else {
          values.push(fields[key]);
        }
      }
    }
    if (updates.length === 0) return resolve(findById(id));
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    db.run(
      `UPDATE timed_reminders SET ${updates.join(', ')} WHERE id = ?`,
      values,
      function (err) {
        if (err) return reject(err);
        resolve(findById(id));
      }
    );
  });
}

function deleteReminder(id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM timed_reminders WHERE id = ?', [id], function (err) {
      if (err) return reject(err);
      resolve(this.changes > 0);
    });
  });
}

module.exports = { findById, findAll, findEnabled, findActive, create, update, delete: deleteReminder };
