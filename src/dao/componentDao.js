const { db } = require('../config/database');

function parseComponent(row) {
  if (!row) return null;
  return {
    ...row,
    position: row.position ? JSON.parse(row.position) : {},
    config: row.config ? JSON.parse(row.config) : {},
    style: row.style ? JSON.parse(row.style) : {}
  };
}

function findBySceneId(sceneId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM components WHERE scene_id = ? ORDER BY sort_order ASC, created_at ASC',
      [sceneId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(parseComponent));
      }
    );
  });
}

function findById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM components WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      resolve(parseComponent(row));
    });
  });
}

function create(component) {
  return new Promise((resolve, reject) => {
    const {
      id,
      scene_id,
      type,
      position,
      config,
      style = {},
      sort_order = 0
    } = component;
    db.run(
      `INSERT INTO components (id, scene_id, type, position, config, style, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        scene_id,
        type,
        JSON.stringify(position),
        JSON.stringify(config),
        JSON.stringify(style),
        sort_order
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
    const jsonFields = ['position', 'config', 'style'];
    const allowed = ['type', 'position', 'config', 'style', 'sort_order'];
    const updates = [];
    const values = [];
    for (const key of allowed) {
      if (key in fields) {
        updates.push(`${key} = ?`);
        values.push(jsonFields.includes(key) ? JSON.stringify(fields[key]) : fields[key]);
      }
    }
    if (updates.length === 0) return resolve(findById(id));
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    db.run(
      `UPDATE components SET ${updates.join(', ')} WHERE id = ?`,
      values,
      function (err) {
        if (err) return reject(err);
        resolve(findById(id));
      }
    );
  });
}

function deleteComponent(id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM components WHERE id = ?', [id], function (err) {
      if (err) return reject(err);
      resolve(this.changes > 0);
    });
  });
}

function deleteBySceneId(sceneId) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM components WHERE scene_id = ?', [sceneId], function (err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
}

function findByType(type) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM components WHERE type = ?', [type], (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(parseComponent));
    });
  });
}

module.exports = {
  findBySceneId,
  findById,
  findByType,
  create,
  update,
  delete: deleteComponent,
  deleteBySceneId
};
