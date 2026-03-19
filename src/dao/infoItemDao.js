const { db } = require('../config/database');

function parseItem(row) {
  if (!row) return null;
  return { ...row };
}

function findAll() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM info_items ORDER BY created_at DESC', [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(parseItem));
    });
  });
}

function findActive() {
  const now = new Date().toISOString();
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM info_items
       WHERE (end_time IS NULL OR end_time > ?)
         AND (start_time IS NULL OR start_time <= ?)
       ORDER BY created_at ASC`,
      [now, now],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(parseItem));
      }
    );
  });
}

function findById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM info_items WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      resolve(parseItem(row));
    });
  });
}

function create(item) {
  return new Promise((resolve, reject) => {
    const { id, text, start_time = null, end_time = null } = item;
    db.run(
      `INSERT INTO info_items (id, text, start_time, end_time) VALUES (?, ?, ?, ?)`,
      [id, text, start_time, end_time],
      function (err) {
        if (err) return reject(err);
        resolve(findById(id));
      }
    );
  });
}

function update(id, fields) {
  return new Promise((resolve, reject) => {
    const allowed = ['text', 'start_time', 'end_time'];
    const updates = [];
    const values = [];
    for (const key of allowed) {
      if (key in fields) {
        updates.push(`${key} = ?`);
        values.push(fields[key]);
      }
    }
    if (updates.length === 0) return resolve(findById(id));
    updates.push("updated_at = datetime('now')");
    values.push(id);
    db.run(
      `UPDATE info_items SET ${updates.join(', ')} WHERE id = ?`,
      values,
      function (err) {
        if (err) return reject(err);
        resolve(findById(id));
      }
    );
  });
}

function deleteItem(id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM info_items WHERE id = ?', [id], function (err) {
      if (err) return reject(err);
      resolve(this.changes > 0);
    });
  });
}

function deleteExpired() {
  const now = new Date().toISOString();
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM info_items WHERE end_time IS NOT NULL AND end_time < ?`,
      [now],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes);
      }
    );
  });
}

module.exports = { findAll, findActive, findById, create, update, delete: deleteItem, deleteExpired };
