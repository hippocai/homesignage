const os = require('os');
const path = require('path');

// Set test environment variables BEFORE any modules are required
process.env.SQLITE_PATH = ':memory:';
process.env.JWT_SECRET = 'test-jwt-secret-homesignage';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // suppress logs during tests
process.env.FILE_REPO_PATH = path.join(os.tmpdir(), 'homesignage-test-file-repo');
