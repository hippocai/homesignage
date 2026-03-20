// Set test environment variables BEFORE any modules are required
process.env.SQLITE_PATH = ':memory:';
process.env.JWT_SECRET = 'test-jwt-secret-homesignage';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // suppress logs during tests
