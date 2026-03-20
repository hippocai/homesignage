const request = require('supertest');
const { setupTestApp, getAdminToken } = require('./testApp');

let app;
let token;
let reminderId;
let alertId;

beforeAll(async () => {
  app = await setupTestApp();
  token = await getAdminToken(app);
});

// ── Timed Reminders ──────────────────────────────────────────
describe('POST /api/v1/reminders/timed', () => {
  it('creates a timed reminder', async () => {
    const res = await request(app)
      .post('/api/v1/reminders/timed')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '出门提醒',
        device_ids: ['all'],
        start_time: '08:00',
        end_time: '08:30',
        repeat: 'weekday',
        content: { text: '记得带钥匙！', style: 'bar-bottom', color: '#fff', backgroundColor: '#ff6600' }
      });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    reminderId = res.body.data.id;
  });

  it('returns 400 when required fields missing', async () => {
    const res = await request(app)
      .post('/api/v1/reminders/timed')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '无内容提醒' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid time format', async () => {
    const res = await request(app)
      .post('/api/v1/reminders/timed')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Bad Time',
        device_ids: ['all'],
        start_time: '8:00', // should be HH:MM
        end_time: '8:30',
        content: { text: 'test' }
      });
    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/reminders/timed')
      .send({ name: 'Unauthorized' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/reminders/timed', () => {
  it('lists all timed reminders', async () => {
    const res = await request(app)
      .get('/api/v1/reminders/timed')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

describe('GET /api/v1/reminders/timed/:id', () => {
  it('returns a single reminder', async () => {
    const res = await request(app)
      .get(`/api/v1/reminders/timed/${reminderId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(reminderId);
  });

  it('returns 404 for unknown reminder', async () => {
    const res = await request(app)
      .get('/api/v1/reminders/timed/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/reminders/timed/:id', () => {
  it('updates a reminder', async () => {
    const res = await request(app)
      .put(`/api/v1/reminders/timed/${reminderId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '更新后的提醒',
        device_ids: ['all'],
        start_time: '09:00',
        end_time: '09:15',
        content: { text: '已更新', style: 'center' }
      });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/v1/reminders/timed/:id', () => {
  it('deletes a reminder', async () => {
    const created = await request(app)
      .post('/api/v1/reminders/timed')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '临时提醒',
        device_ids: ['all'],
        start_time: '10:00',
        end_time: '10:05',
        content: { text: 'delete me' }
      });
    const id = created.body.data.id;

    const res = await request(app)
      .delete(`/api/v1/reminders/timed/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent reminder', async () => {
    const res = await request(app)
      .delete('/api/v1/reminders/timed/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ── Emergency Alerts ─────────────────────────────────────────
describe('POST /api/v1/reminders/emergency', () => {
  it('triggers an emergency alert', async () => {
    const res = await request(app)
      .post('/api/v1/reminders/emergency')
      .set('Authorization', `Bearer ${token}`)
      .send({
        device_ids: ['all'],
        content: { text: '火警！请立即疏散！', backgroundColor: '#FF0000', textColor: '#FFFFFF', blink: true },
        sound: { file: 'alarm.mp3', volume: 1.0, loop: true }
      });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    alertId = res.body.data.id;
  });

  it('also accepts deviceIds (camelCase)', async () => {
    const res = await request(app)
      .post('/api/v1/reminders/emergency')
      .set('Authorization', `Bearer ${token}`)
      .send({
        deviceIds: ['all'],
        content: { text: 'camelCase test' },
        sound: { file: 'alarm.mp3', volume: 1.0, loop: true }
      });
    expect(res.status).toBe(201);
  });

  it('returns 400 when content is missing', async () => {
    const res = await request(app)
      .post('/api/v1/reminders/emergency')
      .set('Authorization', `Bearer ${token}`)
      .send({ device_ids: ['all'], sound: { file: 'alarm.mp3', volume: 1 } });
    expect(res.status).toBe(400);
  });

  it('returns 400 when sound is missing', async () => {
    const res = await request(app)
      .post('/api/v1/reminders/emergency')
      .set('Authorization', `Bearer ${token}`)
      .send({ device_ids: ['all'], content: { text: 'test' } });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/reminders/emergency', () => {
  it('lists all emergency alerts', async () => {
    const res = await request(app)
      .get('/api/v1/reminders/emergency')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/v1/reminders/emergency/active', () => {
  it('returns active alerts', async () => {
    const res = await request(app)
      .get('/api/v1/reminders/emergency/active')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((a) => a.id === alertId)).toBe(true);
  });
});

describe('DELETE /api/v1/reminders/emergency/:id', () => {
  it('clears an active alert', async () => {
    const res = await request(app)
      .delete(`/api/v1/reminders/emergency/${alertId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 400 when alert is already cleared', async () => {
    const res = await request(app)
      .delete(`/api/v1/reminders/emergency/${alertId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent alert', async () => {
    const res = await request(app)
      .delete('/api/v1/reminders/emergency/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
