const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const { ensureRepoDir, getRepoPath } = require('./config/fileRepo');

const app = express();

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// --- Middleware ---
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Device-Key']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- Swagger API Docs ---
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'HomeSignage API 文档',
  customCss: '.swagger-ui .topbar { background-color: #1a1a2e; }',
  swaggerOptions: { persistAuthorization: true },
}));
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));

// --- Static file serving ---
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use('/file-repo', express.static(getRepoPath()));

const adminDistPath = path.join(process.cwd(), 'admin-dist');
if (fs.existsSync(adminDistPath)) {
  app.use('/admin', express.static(adminDistPath));
  app.get('/admin/*', (req, res) => {
    res.sendFile(path.join(adminDistPath, 'index.html'));
  });
} else {
  app.get('/admin', (req, res) => {
    res.send('<h1>Admin Dashboard</h1><p>Run <code>npm run build</code> in admin/ first.</p>');
  });
}

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
app.use('/api/v1/settings', require('./routes/settings'));
app.use('/api/v1/info-items', require('./routes/infoItems'));
app.use('/api/v1/file-repo', require('./routes/fileRepo'));
// No-auth endpoint: server-proxies external URLs for display clients in isolated networks
app.use('/url-content', require('./routes/urlContent'));

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
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
