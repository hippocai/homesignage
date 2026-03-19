const { db } = require('../config/database');
const componentDao = require('./componentDao');

function parseScene(row) {
  if (!row) return null;
  return {
    ...row,
    config: row.config ? JSON.parse(row.config) : {}
  };
}

function findById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM scenes WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      resolve(parseScene(row));
    });
  });
}

function findAll() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT s.*, (SELECT COUNT(*) FROM components c WHERE c.scene_id = s.id) AS component_count
       FROM scenes s ORDER BY s.created_at ASC`,
      [],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(parseScene));
      }
    );
  });
}

function create(scene) {
  return new Promise((resolve, reject) => {
    const { id, name, description = null, thumbnail = null } = scene;
    db.run(
      'INSERT INTO scenes (id, name, description, thumbnail) VALUES (?, ?, ?, ?)',
      [id, name, description, thumbnail],
      function (err) {
        if (err) return reject(err);
        resolve(findById(id));
      }
    );
  });
}

function update(id, fields) {
  return new Promise((resolve, reject) => {
    const allowed = ['name', 'description', 'thumbnail', 'config'];
    const updates = [];
    const values = [];
    for (const key of allowed) {
      if (key in fields) {
        updates.push(`${key} = ?`);
        values.push(key === 'config' ? JSON.stringify(fields[key]) : fields[key]);
      }
    }
    if (updates.length === 0) return resolve(findById(id));
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    db.run(
      `UPDATE scenes SET ${updates.join(', ')} WHERE id = ?`,
      values,
      function (err) {
        if (err) return reject(err);
        resolve(findById(id));
      }
    );
  });
}

function deleteScene(id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM scenes WHERE id = ?', [id], function (err) {
      if (err) return reject(err);
      resolve(this.changes > 0);
    });
  });
}

async function findWithComponents(id) {
  const scene = await findById(id);
  if (!scene) return null;
  const components = await componentDao.findBySceneId(id);
  return { ...scene, components };
}

module.exports = { findById, findAll, create, update, delete: deleteScene, findWithComponents };
