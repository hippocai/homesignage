const request = require('supertest');
const { setupTestApp, getAdminToken } = require('./testApp');

let app;
let token;
let sceneId;
let componentId;

beforeAll(async () => {
  app = await setupTestApp();
  token = await getAdminToken(app);
});

describe('POST /api/v1/scenes', () => {
  it('creates a scene', async () => {
    const res = await request(app)
      .post('/api/v1/scenes')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Clock Scene', description: 'Shows clock and weather' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.name).toBe('Clock Scene');
    sceneId = res.body.data.id;
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/v1/scenes').send({ name: 'Test' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/scenes', () => {
  it('lists all scenes', async () => {
    const res = await request(app)
      .get('/api/v1/scenes')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

describe('GET /api/v1/scenes/:id', () => {
  it('returns scene with components', async () => {
    const res = await request(app)
      .get(`/api/v1/scenes/${sceneId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(sceneId);
    expect(Array.isArray(res.body.data.components)).toBe(true);
  });

  it('returns 404 for unknown scene', async () => {
    const res = await request(app)
      .get('/api/v1/scenes/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/scenes/:id', () => {
  it('updates scene name', async () => {
    const res = await request(app)
      .put(`/api/v1/scenes/${sceneId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Scene Name' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/scenes/:id/components', () => {
  it('adds a clock component', async () => {
    const res = await request(app)
      .post(`/api/v1/scenes/${sceneId}/components`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'clock',
        position: { x: 5, y: 5, width: 90, height: 40 },
        config: { format: '24h', showDate: true },
        style: { color: '#ffffff', fontSize: '4em' }
      });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('clock');
    componentId = res.body.data.id;
  });

  it('adds a text component', async () => {
    const res = await request(app)
      .post(`/api/v1/scenes/${sceneId}/components`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'text',
        position: { x: 5, y: 50, width: 90, height: 40 },
        config: { content: 'Hello World', align: 'center' }
      });
    expect(res.status).toBe(201);
  });

  it('adds an info-list component', async () => {
    const res = await request(app)
      .post(`/api/v1/scenes/${sceneId}/components`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'info-list',
        position: { x: 0, y: 60, width: 100, height: 40 },
        config: { fontSize: 18, color: '#ffffff', scrollSpeed: 40, pageInterval: 5 }
      });
    expect(res.status).toBe(201);
  });

  it('returns 404 for unknown scene', async () => {
    const res = await request(app)
      .post('/api/v1/scenes/00000000-0000-0000-0000-000000000000/components')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'clock', position: { x: 0, y: 0, width: 100, height: 100 }, config: {} });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/scenes/:id/components', () => {
  it('lists components of a scene', async () => {
    const res = await request(app)
      .get(`/api/v1/scenes/${sceneId}/components`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

describe('PUT /api/v1/scenes/:id/components/:componentId', () => {
  it('updates a component', async () => {
    const res = await request(app)
      .put(`/api/v1/scenes/${sceneId}/components/${componentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'clock',
        position: { x: 10, y: 10, width: 80, height: 30 },
        config: { format: '12h', showDate: false }
      });
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/v1/scenes/:id/content/text', () => {
  it('updates text component content using "text" field', async () => {
    // Add a text component
    const compRes = await request(app)
      .post(`/api/v1/scenes/${sceneId}/components`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'text',
        position: { x: 5, y: 50, width: 90, height: 20 },
        config: { content: 'Original text', align: 'left' }
      });
    const textComponentId = compRes.body.data.id;

    const res = await request(app)
      .patch(`/api/v1/scenes/${sceneId}/content/text`)
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId: textComponentId, text: 'Updated text content' });
    expect(res.status).toBe(200);
  });

  it('returns 400 when applied to non-text component', async () => {
    const res = await request(app)
      .patch(`/api/v1/scenes/${sceneId}/content/text`)
      .set('Authorization', `Bearer ${token}`)
      .send({ componentId, text: 'Should fail' }); // componentId is a clock
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/v1/scenes/:id/components/:componentId', () => {
  it('deletes a component', async () => {
    const res = await request(app)
      .delete(`/api/v1/scenes/${sceneId}/components/${componentId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/v1/scenes/:id', () => {
  it('deletes a scene', async () => {
    const created = await request(app)
      .post('/api/v1/scenes')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'To Delete' });
    const id = created.body.data.id;

    const res = await request(app)
      .delete(`/api/v1/scenes/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent scene', async () => {
    const res = await request(app)
      .delete('/api/v1/scenes/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
