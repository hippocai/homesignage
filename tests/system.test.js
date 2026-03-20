const request = require('supertest');
const { setupTestApp, getAdminToken } = require('./testApp');

let app;
let token;

beforeAll(async () => {
  app = await setupTestApp();
  token = await getAdminToken(app);
});

describe('GET /api/v1/system/status', () => {
  it('returns system status', async () => {
    const res = await request(app)
      .get('/api/v1/system/status')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(typeof d.uptime).toBe('number');
    expect(typeof d.uptime_human).toBe('string');
    expect(typeof d.device_count).toBe('number');
    expect(typeof d.online_device_count).toBe('number');
    expect(typeof d.connected_device_count).toBe('number');
    expect(Array.isArray(d.connected_device_ids)).toBe(true);
    expect(typeof d.node_version).toBe('string');
    expect(typeof d.platform).toBe('string');
    expect(typeof d.pid).toBe('number');
    expect(typeof d.memory).toBe('object');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/system/status');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/health', () => {
  it('returns ok without auth', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeTruthy();
  });
});

describe('GET /', () => {
  it('returns server info', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('HomeSignage API');
    expect(res.body.status).toBe('running');
  });
});
