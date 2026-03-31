require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

const logger = require('./utils/logger');
const { initDatabase } = require('./config/database');
const userDao = require('./dao/userDao');
const { initSocketService } = require('./services/socketService');
const { initScheduler } = require('./services/schedulerService');
const app = require('./app');

// Ensure required directories exist at startup
const requiredDirs = ['data', 'uploads', 'logs'];
for (const dir of requiredDirs) {
  const dirPath = path.join(process.cwd(), dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    logger.info('Created directory', { dir });
  }
}

const server = http.createServer(app);

// --- Startup ---
async function createDefaultAdmin() {
  try {
    const users = await userDao.list();
    if (users.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await userDao.create({
        id: uuidv4(),
        username: 'admin',
        password: hashedPassword,
        role: 'admin'
      });
      logger.info('Default admin user created (username: admin, password: admin123)');
      logger.warn('IMPORTANT: Change the default admin password immediately!');
    }
  } catch (err) {
    logger.error('Failed to create default admin user', { error: err.message });
  }
}

async function start() {
  const PORT = parseInt(process.env.PORT, 10) || 3000;

  try {
    // Initialize database and create tables
    await initDatabase();
    logger.info('Database initialized');

    // Create default admin if none exists
    await createDefaultAdmin();

    // Initialize Socket.IO
    initSocketService(server);
    logger.info('Socket.IO initialized');

    // Initialize weather service (caching + push)
    const weatherService = require('./services/weatherService');
    const socketService  = require('./services/socketService');
    const componentDao   = require('./dao/componentDao');
    weatherService.setSocketService(socketService);

    function buildLocationConfig(cfg) {
      return { city: cfg.city || 'Beijing', locationId: cfg.locationId || null };
    }
    async function getWeatherLocations() {
      const comps = await componentDao.findByType('weather').catch(() => []);
      const seen = new Set();
      return comps.map((c) => buildLocationConfig(c.config || {})).filter((loc) => {
        const k = (loc.locationId || loc.city).toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    async function getMinWeatherInterval() {
      const comps = await componentDao.findByType('weather').catch(() => []);
      const hours = comps.map((c) => parseInt((c.config && c.config.refreshInterval) || 1, 10)).filter(Boolean);
      return (hours.length ? Math.min(...hours) : 1) * 60; // convert hours → minutes
    }

    const initInterval = await getMinWeatherInterval();
    weatherService.startScheduler(getWeatherLocations, initInterval);
    logger.info('Weather service initialized');

    // Initialize scheduler
    await initScheduler();
    logger.info('Scheduler initialized');

    // Start listening
    server.listen(PORT, () => {
      logger.info(`HomeSignage server started`, {
        port: PORT,
        env: process.env.NODE_ENV || 'development',
        admin: `http://localhost:${PORT}/admin`,
        api: `http://localhost:${PORT}/api/v1`
      });
    });
  } catch (err) {
    logger.error('Failed to start server', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

start();
