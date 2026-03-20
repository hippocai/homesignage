const request = require('supertest');
const { setupTestApp, getAdminToken } = require('./testApp');

let app;
let token;
let itemId;

beforeAll(async () => {
  app = await setupTestApp();
  token = await getAdminToken(app);
});

describe('POST /api/v1/info-items', () => {
  it('creates an info item', async () => {
    const res = await request(app)
      .post('/api/v1/info-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'info', text: '今天有会议' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.text).toBe('今天有会议');
    itemId = res.body.data.id;
  });

  it('creates an important item with end_time', async () => {
    const res = await request(app)
      .post('/api/v1/info-items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'important',
        text: '明天停水',
        start_time: null,
        end_time: '2099-12-31T23:59:59'
      });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('important');
  });

  it('creates an urgent item', async () => {
    const res = await request(app)
      .post('/api/v1/info-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'urgent', text: '紧急通知！' });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('urgent');
  });

  it('defaults to type=info for invalid type', async () => {
    const res = await request(app)
      .post('/api/v1/info-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'unknown', text: 'Some notice' });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('info');
  });

  it('returns 400 when text is missing', async () => {
    const res = await request(app)
      .post('/api/v1/info-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'info' });
    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/info-items')
      .send({ text: 'Unauthorized' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/info-items', () => {
  it('lists all info items', async () => {
    const res = await request(app)
      .get('/api/v1/info-items')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/info-items');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/info-items/active', () => {
  it('returns active items without auth', async () => {
    const res = await request(app).get('/api/v1/info-items/active');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('excludes expired items', async () => {
    // Create an expired item
    await request(app)
      .post('/api/v1/info-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'Expired item', end_time: '2000-01-01T00:00:00' });

    const res = await request(app).get('/api/v1/info-items/active');
    expect(res.status).toBe(200);
    const expired = res.body.data.find((i) => i.text === 'Expired item');
    expect(expired).toBeUndefined();
  });
});

describe('PUT /api/v1/info-items/:id', () => {
  it('updates an item', async () => {
    const res = await request(app)
      .put(`/api/v1/info-items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'urgent', text: '更新后的内容' });
    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('urgent');
    expect(res.body.data.text).toBe('更新后的内容');
  });

  it('returns 404 for non-existent item', async () => {
    const res = await request(app)
      .put('/api/v1/info-items/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'No such item' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/info-items/:id', () => {
  it('deletes an item', async () => {
    const created = await request(app)
      .post('/api/v1/info-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'Delete me' });
    const id = created.body.data.id;

    const res = await request(app)
      .delete(`/api/v1/info-items/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent item', async () => {
    const res = await request(app)
      .delete('/api/v1/info-items/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
