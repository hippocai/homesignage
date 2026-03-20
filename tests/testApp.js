const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const request = require('supertest');

const { initDatabase } = require('../src/config/database');
const userDao = require('../src/dao/userDao');
const app = require('../src/app');

let initialized = false;

async function setupTestApp() {
  if (!initialized) {
    await initDatabase();
    // Create default admin user
    const users = await userDao.list();
    if (users.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await userDao.create({ id: uuidv4(), username: 'admin', password: hash, role: 'admin' });
    }
    initialized = true;
  }
  return app;
}

async function getAdminToken(app) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'admin', password: 'admin123' });
  return res.body.data.token;
}

module.exports = { setupTestApp, getAdminToken };
