const request = require('supertest');
const { setupTestApp } = require('./testApp');

let app;

beforeAll(async () => {
  app = await setupTestApp();
});

describe('GET /api/v1/weather', () => {
  it('returns weather data or 502 when upstream unavailable', async () => {
    const res = await request(app)
      .get('/api/v1/weather')
      .query({ city: 'Beijing' });
    // Either 200 (wttr.in available) or 502 (wttr.in down)
    expect([200, 502]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.data).toHaveProperty('city');
      expect(res.body.data).toHaveProperty('tempC');
      expect(res.body.data).toHaveProperty('tempF');
      expect(res.body.data).toHaveProperty('description');
      expect(res.body.data).toHaveProperty('humidity');
      expect(res.body.data).toHaveProperty('windKmph');
    }
  }, 10000); // longer timeout for external HTTP
});
