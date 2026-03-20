const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const dbPath = process.env.SQLITE_PATH || './data/signage.db';
const dbDir = path.dirname(dbPath);

// Ensure data directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logger.error('Failed to open SQLite database', { error: err.message });
    process.exit(1);
  }
  logger.info('Connected to SQLite database', { path: dbPath });
});

// Enable WAL mode and foreign keys
db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
});

const SQL_CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key TEXT UNIQUE NOT NULL,
    permissions TEXT,
    expires_at TIMESTAMP,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    group_name TEXT,
    device_key TEXT UNIQUE NOT NULL,
    browser_info TEXT,
    status TEXT DEFAULT 'offline',
    last_seen TIMESTAMP,
    ip_address TEXT,
    config TEXT DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scenes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    thumbnail TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS components (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL,
    type TEXT NOT NULL,
    position TEXT NOT NULL,
    config TEXT NOT NULL,
    style TEXT DEFAULT '{}',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS device_scenes (
    device_id TEXT NOT NULL,
    scene_id TEXT NOT NULL,
    duration INTEGER DEFAULT 15,
    sort_order INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (device_id, scene_id),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS timed_reminders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    device_ids TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    repeat TEXT DEFAULT 'none',
    content TEXT NOT NULL,
    sound TEXT,
    priority INTEGER DEFAULT 5,
    enabled INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS emergency_alerts (
    id TEXT PRIMARY KEY,
    device_ids TEXT NOT NULL,
    content TEXT NOT NULL,
    sound TEXT NOT NULL,
    triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    triggered_by TEXT,
    cleared_at TIMESTAMP,
    cleared_by TEXT,
    status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    url TEXT NOT NULL,
    uploaded_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS info_items (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'info',
    text TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);
CREATE INDEX IF NOT EXISTS idx_components_scene_id ON components(scene_id);
CREATE INDEX IF NOT EXISTS idx_timed_reminders_start_time ON timed_reminders(start_time);
CREATE INDEX IF NOT EXISTS idx_emergency_alerts_status ON emergency_alerts(status);
CREATE INDEX IF NOT EXISTS idx_info_items_end_time ON info_items(end_time);
`;

async function initDatabase() {
  await new Promise((resolve, reject) => {
    db.serialize(() => {
      const statements = SQL_CREATE_TABLES
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      let completed = 0;
      let hasError = false;

      if (statements.length === 0) return resolve();

      statements.forEach((stmt) => {
        db.run(stmt + ';', (err) => {
          if (err && !hasError) {
            hasError = true;
            logger.error('Database init error', { error: err.message, stmt: stmt.substring(0, 80) });
            return reject(err);
          }
          completed++;
          if (completed === statements.length && !hasError) {
            logger.info('Database tables initialized successfully');
            resolve();
          }
        });
      });
    });
  });

  // Migrations: add columns that may not exist in older DBs
  await new Promise((resolve) => {
    db.all('PRAGMA table_info(scenes)', [], (err, cols) => {
      if (err || !cols) return resolve();
      const hasConfig = cols.some(c => c.name === 'config');
      if (!hasConfig) {
        db.run("ALTER TABLE scenes ADD COLUMN config TEXT DEFAULT '{}'", resolve);
      } else {
        resolve();
      }
    });
  });

  await new Promise((resolve) => {
    db.all('PRAGMA table_info(timed_reminders)', [], (err, cols) => {
      if (err || !cols) return resolve();
      const hasStartDate = cols.some(c => c.name === 'start_date');
      if (!hasStartDate) {
        db.run('ALTER TABLE timed_reminders ADD COLUMN start_date TEXT', resolve);
      } else {
        resolve();
      }
    });
  });

  await new Promise((resolve) => {
    db.all('PRAGMA table_info(info_items)', [], (err, cols) => {
      if (err || !cols) return resolve();
      const hasType = cols.some(c => c.name === 'type');
      if (!hasType) {
        db.run("ALTER TABLE info_items ADD COLUMN type TEXT NOT NULL DEFAULT 'info'", resolve);
      } else {
        resolve();
      }
    });
  });
}

module.exports = { db, initDatabase };
