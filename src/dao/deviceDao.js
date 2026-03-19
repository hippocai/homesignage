const { db } = require('../config/database');

function parseDevice(row) {
  if (!row) return null;
  return {
    ...row,
    browser_info: row.browser_info ? JSON.parse(row.browser_info) : null,
    config: row.config ? JSON.parse(row.config) : {}
  };
}

function findById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM devices WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      resolve(parseDevice(row));
    });
  });
}

function findAll() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM devices ORDER BY created_at ASC', [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(parseDevice));
    });
  });
}

function create(device) {
  return new Promise((resolve, reject) => {
    const {
      id,
      name,
      group_name = null,
      device_key,
      browser_info = null,
      ip_address = null,
      config = {}
    } = device;
    const browserInfoStr = browser_info ? JSON.stringify(browser_info) : null;
    const configStr = JSON.stringify(config);
    db.run(
      `INSERT INTO devices (id, name, group_name, device_key, browser_info, ip_address, config)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name, group_name, device_key, browserInfoStr, ip_address, configStr],
      function (err) {
        if (err) return reject(err);
        resolve(findById(id));
      }
    );
  });
}

function update(id, fields) {
  return new Promise((resolve, reject) => {
    const allowed = ['name', 'group_name', 'browser_info', 'ip_address', 'config'];
    const updates = [];
    const values = [];
    for (const key of allowed) {
      if (key in fields) {
        updates.push(`${key} = ?`);
        if (key === 'browser_info' || key === 'config') {
          values.push(fields[key] != null ? JSON.stringify(fields[key]) : fields[key]);
        } else {
          values.push(fields[key]);
        }
      }
    }
    if (updates.length === 0) return resolve(findById(id));
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    db.run(
      `UPDATE devices SET ${updates.join(', ')} WHERE id = ?`,
      values,
      function (err) {
        if (err) return reject(err);
        resolve(findById(id));
      }
    );
  });
}

function updateStatus(id, status, ipAddress = null) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE devices SET status = ?, last_seen = CURRENT_TIMESTAMP, ip_address = COALESCE(?, ip_address), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, ipAddress, id],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

function updateConfig(id, config) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE devices SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [JSON.stringify(config), id],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

function deleteDevice(id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM devices WHERE id = ?', [id], function (err) {
      if (err) return reject(err);
      resolve(this.changes > 0);
    });
  });
}

module.exports = {
  findById,
  findAll,
  create,
  update,
  updateStatus,
  updateConfig,
  delete: deleteDevice
};
