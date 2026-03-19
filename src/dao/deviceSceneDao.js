const { db } = require('../config/database');

function findByDeviceId(deviceId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT ds.*, s.name as scene_name, s.description as scene_description, s.thumbnail as scene_thumbnail
       FROM device_scenes ds
       JOIN scenes s ON ds.scene_id = s.id
       WHERE ds.device_id = ?
       ORDER BY ds.sort_order ASC`,
      [deviceId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

function setDeviceScenes(deviceId, scenes) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      db.run('DELETE FROM device_scenes WHERE device_id = ?', [deviceId], (err) => {
        if (err) {
          db.run('ROLLBACK');
          return reject(err);
        }

        if (!scenes || scenes.length === 0) {
          db.run('COMMIT', (commitErr) => {
            if (commitErr) return reject(commitErr);
            resolve([]);
          });
          return;
        }

        const stmt = db.prepare(
          `INSERT INTO device_scenes (device_id, scene_id, duration, sort_order, enabled)
           VALUES (?, ?, ?, ?, ?)`
        );

        let insertCount = 0;
        let hasError = false;

        scenes.forEach((scene, index) => {
          const { sceneId, duration = 15, sortOrder = index, enabled = 1 } = scene;
          stmt.run([deviceId, sceneId, duration, sortOrder, enabled ? 1 : 0], (err) => {
            if (err && !hasError) {
              hasError = true;
              stmt.finalize();
              db.run('ROLLBACK');
              return reject(err);
            }
            insertCount++;
            if (insertCount === scenes.length && !hasError) {
              stmt.finalize((finalErr) => {
                if (finalErr) {
                  db.run('ROLLBACK');
                  return reject(finalErr);
                }
                db.run('COMMIT', (commitErr) => {
                  if (commitErr) return reject(commitErr);
                  resolve(findByDeviceId(deviceId));
                });
              });
            }
          });
        });
      });
    });
  });
}

function deleteByDeviceId(deviceId) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM device_scenes WHERE device_id = ?', [deviceId], function (err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
}

module.exports = { findByDeviceId, setDeviceScenes, delete: deleteByDeviceId };
