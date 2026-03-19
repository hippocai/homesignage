const { db } = require('../config/database');

function findById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function findByUsername(username) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function create(user) {
  return new Promise((resolve, reject) => {
    const { id, username, password, role = 'admin' } = user;
    db.run(
      'INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)',
      [id, username, password, role],
      function (err) {
        if (err) return reject(err);
        resolve({ id, username, role });
      }
    );
  });
}

function updatePassword(id, hashedPassword) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [hashedPassword, id],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

function list() {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT id, username, role, created_at, updated_at FROM users ORDER BY created_at ASC',
      [],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

module.exports = { findById, findByUsername, create, updatePassword, list };
