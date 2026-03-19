const { db } = require('../config/database');

function parseAlert(row) {
  if (!row) return null;
  return {
    ...row,
    device_ids: row.device_ids ? JSON.parse(row.device_ids) : [],
    content: row.content ? JSON.parse(row.content) : {},
    sound: row.sound ? (function(s) { try { return JSON.parse(s); } catch(e) { return null; } })(row.sound) : null
  };
}

function findById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM emergency_alerts WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      resolve(parseAlert(row));
    });
  });
}

function findActive() {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT * FROM emergency_alerts WHERE status = 'active' ORDER BY triggered_at DESC",
      [],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(parseAlert));
      }
    );
  });
}

function findAll() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM emergency_alerts ORDER BY triggered_at DESC', [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(parseAlert));
    });
  });
}

function create(alert) {
  return new Promise((resolve, reject) => {
    const {
      id,
      device_ids,
      content,
      sound,
      triggered_by = null
    } = alert;
    db.run(
      `INSERT INTO emergency_alerts (id, device_ids, content, sound, triggered_by)
       VALUES (?, ?, ?, ?, ?)`,
      [id, JSON.stringify(device_ids), JSON.stringify(content), JSON.stringify(sound), triggered_by],
      function (err) {
        if (err) return reject(err);
        resolve(findById(id));
      }
    );
  });
}

function clear(id, clearedBy = null) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE emergency_alerts SET status = 'cleared', cleared_at = CURRENT_TIMESTAMP, cleared_by = ? WHERE id = ?`,
      [clearedBy, id],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

module.exports = { findById, findActive, findAll, create, clear };
