const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { setupTestApp, getAdminToken } = require('./testApp');

let app;
let token;
const repoDir = process.env.FILE_REPO_PATH;

beforeAll(async () => {
  app = await setupTestApp();
  token = await getAdminToken(app);
  // Ensure clean test repo dir
  if (fs.existsSync(repoDir)) {
    fs.rmSync(repoDir, { recursive: true });
  }
  fs.mkdirSync(repoDir, { recursive: true });
});

afterAll(() => {
  if (fs.existsSync(repoDir)) {
    fs.rmSync(repoDir, { recursive: true });
  }
});

describe('POST /api/v1/file-repo', () => {
  it('uploads an image file', async () => {
    const pngBuffer = Buffer.from(
      '89504e470d0a1a0a0000000d4948445200000001000000010802000000' +
      '9001' + '2e0000000c4944415408d76360f8ff3f000005fe02fedce34a0000000049454e44ae426082',
      'hex'
    );
    const res = await request(app)
      .post('/api/v1/file-repo')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pngBuffer, { filename: 'test-image.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('test-image.png');
    expect(res.body.data.type).toBe('image');
    expect(res.body.data.url).toContain('test-image.png');
  });

  it('uploads an audio file', async () => {
    const mp3Buffer = Buffer.alloc(128, 0);
    mp3Buffer[0] = 0xff;
    mp3Buffer[1] = 0xfb;

    const res = await request(app)
      .post('/api/v1/file-repo')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', mp3Buffer, { filename: 'test-audio.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('test-audio.mp3');
    expect(res.body.data.type).toBe('audio');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/file-repo')
      .attach('file', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when no file is attached', async () => {
    const res = await request(app)
      .post('/api/v1/file-repo')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/file-repo', () => {
  it('lists all files', async () => {
    const res = await request(app)
      .get('/api/v1/file-repo')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by type=image', async () => {
    const res = await request(app)
      .get('/api/v1/file-repo')
      .query({ type: 'image' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((f) => f.type === 'image')).toBe(true);
  });

  it('filters by type=audio', async () => {
    const res = await request(app)
      .get('/api/v1/file-repo')
      .query({ type: 'audio' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((f) => f.type === 'audio')).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/file-repo');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/file-repo/:filename/download', () => {
  it('downloads an existing file', async () => {
    const res = await request(app)
      .get('/api/v1/file-repo/test-image.png/download')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent file', async () => {
    const res = await request(app)
      .get('/api/v1/file-repo/nonexistent.png/download')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/file-repo/:filename', () => {
  it('renames a file', async () => {
    const res = await request(app)
      .patch('/api/v1/file-repo/test-image.png')
      .set('Authorization', `Bearer ${token}`)
      .send({ newName: 'renamed-image.png' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('renamed-image.png');
  });

  it('returns 409 if target name already exists', async () => {
    const res = await request(app)
      .patch('/api/v1/file-repo/renamed-image.png')
      .set('Authorization', `Bearer ${token}`)
      .send({ newName: 'test-audio.mp3' });
    expect(res.status).toBe(409);
  });

  it('returns 404 for non-existent source file', async () => {
    const res = await request(app)
      .patch('/api/v1/file-repo/nonexistent.png')
      .set('Authorization', `Bearer ${token}`)
      .send({ newName: 'something.png' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when newName is missing', async () => {
    const res = await request(app)
      .patch('/api/v1/file-repo/renamed-image.png')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/v1/file-repo/:filename', () => {
  it('deletes an existing file', async () => {
    const res = await request(app)
      .delete('/api/v1/file-repo/renamed-image.png')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent file', async () => {
    const res = await request(app)
      .delete('/api/v1/file-repo/nonexistent.png')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
