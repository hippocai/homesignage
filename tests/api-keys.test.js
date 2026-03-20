const request = require('supertest');
const { setupTestApp, getAdminToken } = require('./testApp');

let app;
let token;
let keyId;
let keyValue;

beforeAll(async () => {
  app = await setupTestApp();
  token = await getAdminToken(app);
});

describe('POST /api/v1/api-keys', () => {
  it('creates an API key', async () => {
    const res = await request(app)
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'HomeAssistant Integration' });
    expect(res.status).toBe(201);
    expect(res.body.data.key).toBeTruthy();
    expect(res.body.data.name).toBe('HomeAssistant Integration');
    keyId = res.body.data.id;
    keyValue = res.body.data.key;
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/api-keys')
      .send({ name: 'Unauthorized' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/api-keys', () => {
  it('lists all API keys', async () => {
    const res = await request(app)
      .get('/api/v1/api-keys')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/api-keys');
    expect(res.status).toBe(401);
  });
});

describe('API key authentication', () => {
  it('can use X-API-Key to access protected endpoints', async () => {
    const res = await request(app)
      .get('/api/v1/reminders/timed')
      .set('X-API-Key', keyValue);
    expect(res.status).toBe(200);
  });

  it('rejects invalid API key', async () => {
    const res = await request(app)
      .get('/api/v1/reminders/timed')
      .set('X-API-Key', 'invalid-key-value');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/v1/api-keys/:id', () => {
  it('deletes an API key', async () => {
    const res = await request(app)
      .delete(`/api/v1/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('key no longer works after deletion', async () => {
    const res = await request(app)
      .get('/api/v1/reminders/timed')
      .set('X-API-Key', keyValue);
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent key', async () => {
    const res = await request(app)
      .delete('/api/v1/api-keys/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
