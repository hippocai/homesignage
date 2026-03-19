require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const logger = require('./utils/logger');
const { initDatabase } = require('./config/database');
const userDao = require('./dao/userDao');
const { initSocketService } = require('./services/socketService');
const { initScheduler } = require('./services/schedulerService');

// Ensure required directories exist at startup
const requiredDirs = ['data', 'uploads', 'logs'];
for (const dir of requiredDirs) {
  const dirPath = path.join(process.cwd(), dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    logger.info('Created directory', { dir });
  }
}

const app = express();
const server = http.createServer(app);

// --- Middleware ---
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Device-Key']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl}`, {
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip
    });
  });
  next();
});

// --- Swagger API Docs ---
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'HomeSignage API 文档',
  customCss: '.swagger-ui .topbar { background-color: #1a1a2e; } .swagger-ui .topbar-wrapper img { display: none; } .swagger-ui .topbar-wrapper::after { content: "HomeSignage API"; color: white; font-size: 1.4em; font-weight: bold; }',
  swaggerOptions: { persistAuthorization: true },
}));
// Raw OpenAPI spec JSON
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));

// --- Static file serving ---
// Serve uploaded files
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Serve admin dashboard (Vue.js build output)
const adminDistPath = path.join(process.cwd(), 'admin-dist');
if (fs.existsSync(adminDistPath)) {
  app.use('/admin', express.static(adminDistPath));
  // SPA fallback for admin
  app.get('/admin/*', (req, res) => {
    res.sendFile(path.join(adminDistPath, 'index.html'));
  });
} else {
  app.get('/admin', (req, res) => {
    res.send('<h1>Admin Dashboard</h1><p>Admin frontend not built yet. Run <code>npm run build</code> in the admin/ directory.</p>');
  });
}

// Serve display client (Vanilla JS)
const clientPath = path.join(process.cwd(), 'client');
if (fs.existsSync(clientPath)) {
  app.use('/client', express.static(clientPath));
}

// --- API Routes ---
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/devices', require('./routes/devices'));
app.use('/api/v1/scenes', require('./routes/scenes'));
app.use('/api/v1/reminders', require('./routes/reminders'));
app.use('/api/v1/api-keys', require('./routes/apiKeys'));
app.use('/api/v1/system', require('./routes/system'));
app.use('/api/v1/uploads', require('./routes/uploads'));
app.use('/api/v1/weather', require('./routes/weather'));
app.use('/api/v1/info-items', require('./routes/infoItems'));

// Root health check
app.get('/', (req, res) => {
  res.json({ name: 'HomeSignage API', version: '1.0.0', status: 'running' });
});

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- 404 handler ---
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// --- Global error handler ---
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({ error: 'Internal server error' });
});

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
