const { db } = require('../config/database');

function get(key) {
  return new Promise((resolve, reject) => {
    db.get('SELECT value FROM settings WHERE key = ?', [key], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);
      try { resolve(JSON.parse(row.value)); } catch { resolve(row.value); }
    });
  });
}

function set(key, value) {
  const serialized = JSON.stringify(value);
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [key, serialized],
      (err) => { if (err) return reject(err); resolve(); }
    );
  });
}

function getAll() {
  return new Promise((resolve, reject) => {
    db.all('SELECT key, value FROM settings', [], (err, rows) => {
      if (err) return reject(err);
      const result = {};
      for (const row of rows) {
        try { result[row.key] = JSON.parse(row.value); } catch { result[row.key] = row.value; }
      }
      resolve(result);
    });
  });
}

module.exports = { get, set, getAll };
