const request = require('supertest');
const { setupTestApp, getAdminToken } = require('./testApp');

let app;
let token;
let deviceId;
let deviceKey;
let sceneId;

beforeAll(async () => {
  app = await setupTestApp();
  token = await getAdminToken(app);
  // Create a scene for scene-assignment tests
  const sceneRes = await request(app)
    .post('/api/v1/scenes')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Test Scene' });
  sceneId = sceneRes.body.data.id;
});

describe('POST /api/v1/devices', () => {
  it('creates a device and returns device_key', async () => {
    const res = await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Living Room iPad', group_name: 'Living Room' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.device_key).toBeTruthy();
    deviceId = res.body.data.id;
    deviceKey = res.body.data.device_key;
  });

  it('returns 400 without name', async () => {
    const res = await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ group_name: 'Bedroom' });
    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/devices')
      .send({ name: 'Unauthorized' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/devices', () => {
  it('lists all devices', async () => {
    const res = await request(app)
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/devices');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/devices/:id', () => {
  it('returns device details', async () => {
    const res = await request(app)
      .get(`/api/v1/devices/${deviceId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(deviceId);
  });

  it('returns 404 for unknown device', async () => {
    const res = await request(app)
      .get('/api/v1/devices/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/devices/:id', () => {
  it('updates device name', async () => {
    const res = await request(app)
      .put(`/api/v1/devices/${deviceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Name' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Name');
  });
});

describe('GET /api/v1/devices/:id/config', () => {
  it('returns device config with valid device key', async () => {
    const res = await request(app)
      .get(`/api/v1/devices/${deviceId}/config`)
      .set('X-Device-Key', deviceKey);
    expect(res.status).toBe(200);
    expect(res.body.data.device.id).toBe(deviceId);
    expect(Array.isArray(res.body.data.scenes)).toBe(true);
    expect(Array.isArray(res.body.data.emergency_alerts)).toBe(true);
  });

  it('returns 401 without device key', async () => {
    const res = await request(app).get(`/api/v1/devices/${deviceId}/config`);
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong device key', async () => {
    const res = await request(app)
      .get(`/api/v1/devices/${deviceId}/config`)
      .set('X-Device-Key', 'wrongkey');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/devices/:id/heartbeat', () => {
  it('accepts heartbeat and returns status', async () => {
    const res = await request(app)
      .post(`/api/v1/devices/${deviceId}/heartbeat`)
      .send({ browserInfo: { userAgent: 'TestAgent', platform: 'test', screenSize: '1920x1080' } });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('online');
    expect(Array.isArray(res.body.data.emergency_alerts)).toBe(true);
  });
});

describe('GET /api/v1/devices/:id/scenes', () => {
  it('returns device scenes list', async () => {
    const res = await request(app)
      .get(`/api/v1/devices/${deviceId}/scenes`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('PUT /api/v1/devices/:id/scenes', () => {
  it('assigns scenes to device', async () => {
    const res = await request(app)
      .put(`/api/v1/devices/${deviceId}/scenes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scenes: [{ sceneId, duration: 15, sortOrder: 0, enabled: true }] });
    expect(res.status).toBe(200);
  });

  it('returns 400 when scenes is not an array', async () => {
    const res = await request(app)
      .put(`/api/v1/devices/${deviceId}/scenes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scenes: 'invalid' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/devices/:id/active-scene', () => {
  it('sends force-scene command', async () => {
    const res = await request(app)
      .post(`/api/v1/devices/${deviceId}/active-scene`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sceneId });
    expect(res.status).toBe(200);
  });

  it('returns 400 without sceneId', async () => {
    const res = await request(app)
      .post(`/api/v1/devices/${deviceId}/active-scene`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/devices/:id/refresh', () => {
  it('sends force-refresh command', async () => {
    const res = await request(app)
      .post(`/api/v1/devices/${deviceId}/refresh`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBeTruthy();
  });
});

describe('DELETE /api/v1/devices/:id', () => {
  it('deletes the device', async () => {
    // Create a throwaway device to delete
    const created = await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Delete Me' });
    const id = created.body.data.id;

    const res = await request(app)
      .delete(`/api/v1/devices/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent device', async () => {
    const res = await request(app)
      .delete('/api/v1/devices/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
