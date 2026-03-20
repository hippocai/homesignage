const request = require('supertest');
const { setupTestApp, getAdminToken } = require('./testApp');

let app;
let token;

beforeAll(async () => {
  app = await setupTestApp();
  token = await getAdminToken(app);
});

describe('POST /api/v1/auth/login', () => {
  it('returns token on valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.username).toBe('admin');
  });

  it('returns 401 on wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('returns 400 on missing fields', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/auth/verify', () => {
  it('returns valid for a good token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/verify')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe('admin');
  });

  it('returns 401 for no token', async () => {
    const res = await request(app).get('/api/v1/auth/verify');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/change-password', () => {
  it('changes password successfully', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'admin123', newPassword: 'admin123' }); // change back to same
    expect(res.status).toBe(200);
    expect(res.body.message).toBeTruthy();
  });

  it('returns 400 for wrong current password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrongpassword', newPassword: 'newpass123' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when new password is too short', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'admin123', newPassword: '123' });
    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: 'admin123', newPassword: 'newpass123' });
    expect(res.status).toBe(401);
  });
});
