const request = require('supertest');
const path = require('path');
const { setupTestApp, getAdminToken } = require('./testApp');

let app;
let token;
let uploadId;

beforeAll(async () => {
  app = await setupTestApp();
  token = await getAdminToken(app);
});

describe('POST /api/v1/uploads', () => {
  it('uploads a PNG image', async () => {
    // Minimal 1x1 PNG (67 bytes)
    const pngBuffer = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
      '2e0000000c4944415408d76360f8ff3f000005fe02fedce34a0000000049454e44ae426082',
      'hex'
    );

    const res = await request(app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pngBuffer, { filename: 'test.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.data.url).toBeTruthy();
    expect(res.body.data.file_type).toBe('image');
    uploadId = res.body.data.id;
  });

  it('uploads an MP3 audio file', async () => {
    // Minimal valid MP3 header bytes
    const mp3Buffer = Buffer.alloc(128, 0);
    mp3Buffer[0] = 0xff;
    mp3Buffer[1] = 0xfb;

    const res = await request(app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', mp3Buffer, { filename: 'test.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(201);
    expect(res.body.data.file_type).toBe('audio');
  });

  it('rejects unsupported file type', async () => {
    const textBuffer = Buffer.from('hello world');
    const res = await request(app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', textBuffer, { filename: 'test.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const pngBuffer = Buffer.from('fake', 'utf8');
    const res = await request(app)
      .post('/api/v1/uploads')
      .attach('file', pngBuffer, { filename: 'test.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/uploads', () => {
  it('lists all uploads', async () => {
    const res = await request(app)
      .get('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('filters by type', async () => {
    const res = await request(app)
      .get('/api/v1/uploads')
      .query({ type: 'image' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((f) => f.file_type === 'image')).toBe(true);
  });
});

describe('DELETE /api/v1/uploads/:id', () => {
  it('deletes an upload', async () => {
    if (!uploadId) return;
    const res = await request(app)
      .delete(`/api/v1/uploads/${uploadId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent upload', async () => {
    const res = await request(app)
      .delete('/api/v1/uploads/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
