const { db } = require('../config/database');

function parseKey(row) {
  if (!row) return null;
  return {
    ...row,
    permissions: row.permissions ? JSON.parse(row.permissions) : []
  };
}

function findById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM api_keys WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      resolve(parseKey(row));
    });
  });
}

function findByKey(key) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM api_keys WHERE key = ?', [key], (err, row) => {
      if (err) return reject(err);
      resolve(parseKey(row));
    });
  });
}

function findAll() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM api_keys ORDER BY created_at DESC', [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(parseKey));
    });
  });
}

function create(apiKey) {
  return new Promise((resolve, reject) => {
    const {
      id,
      name,
      key,
      permissions = [],
      expires_at = null,
      created_by = null
    } = apiKey;
    db.run(
      `INSERT INTO api_keys (id, name, key, permissions, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, key, JSON.stringify(permissions), expires_at, created_by],
      function (err) {
        if (err) return reject(err);
        resolve(findById(id));
      }
    );
  });
}

function deleteKey(id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM api_keys WHERE id = ?', [id], function (err) {
      if (err) return reject(err);
      resolve(this.changes > 0);
    });
  });
}

function updateLastUsed(id) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

module.exports = { findById, findByKey, findAll, create, delete: deleteKey, updateLastUsed };
