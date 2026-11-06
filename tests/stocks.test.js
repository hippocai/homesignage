const request = require('supertest');
const { setupTestApp, getAdminToken } = require('./testApp');
const service = require('../src/services/stockService');
let app, token, sceneId, componentId;
beforeAll(async () => {
  app = await setupTestApp(); token = await getAdminToken(app);
  const scene = await request(app).post('/api/v1/scenes').set('Authorization', `Bearer ${token}`).send({ name: 'Stock scene' });
  sceneId = scene.body.data.id;
});
afterEach(() => jest.restoreAllMocks());

it('serves normalized market data to display clients', async () => {
  jest.spyOn(service, 'getStock').mockResolvedValue({ symbol: 'AAPL', market: 'us', price: 200, points: [{ minute: 570, price: 200 }], tradingDate: '2026-11-05', stale: false });
  const result = await request(app).get('/api/v1/stocks').query({ symbol: 'AAPL', market: 'us' });
  expect(result.status).toBe(200);
  expect(result.body.data).toMatchObject({ price: 200, symbol: 'AAPL' });
  expect(result.headers['cache-control']).toBe('no-store');
});
it('rejects missing or unsafe symbols before calling a provider', async () => {
  const fetch = jest.spyOn(service, 'getStock');
  expect((await request(app).get('/api/v1/stocks')).status).toBe(400);
  expect((await request(app).get('/api/v1/stocks').query({ symbol: 'https://localhost' })).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it('returns a controlled upstream failure', async () => {
  jest.spyOn(service, 'getStock').mockRejectedValue(new Error('private upstream details'));
  const result = await request(app).get('/api/v1/stocks').query({ symbol: 'AAPL' });
  expect(result.status).toBe(502);
  expect(result.text).not.toContain('private upstream details');
});
it('persists a stock component and its percentage scale', async () => {
  const result = await request(app).post(`/api/v1/scenes/${sceneId}/components`).set('Authorization', `Bearer ${token}`).send({ type: 'stock', position: { x: 0, y: 0, width: 60, height: 50 }, config: { symbol: '300750', market: 'cn', scaleMode: 'percent', scalePercent: 10, refreshInterval: 60 } });
  expect(result.status).toBe(201);
  componentId = result.body.data.id;
  const stored = await request(app).get(`/api/v1/scenes/${sceneId}`).set('Authorization', `Bearer ${token}`);
  expect(stored.body.data.components[0].config).toMatchObject({ symbol: '300750', scaleMode: 'percent', scalePercent: 10 });
});
it('rejects reversed or null fixed bounds without corrupting saved config', async () => {
  for (const config of [{ symbol: 'AAPL', scaleMode: 'fixed', priceMin: 300, priceMax: 200 }, { symbol: 'AAPL', scaleMode: 'fixed', priceMin: null, priceMax: 200 }]) {
    const result = await request(app).put(`/api/v1/scenes/${sceneId}/components/${componentId}`).set('Authorization', `Bearer ${token}`).send({ config });
    expect(result.status).toBe(400);
  }
  const stored = await request(app).get(`/api/v1/scenes/${sceneId}/components`).set('Authorization', `Bearer ${token}`);
  expect(stored.body.data[0].config.scalePercent).toBe(10);
});
it('includes stock configuration in device payloads', async () => {
  const device = (await request(app).post('/api/v1/devices').set('Authorization', `Bearer ${token}`).send({ name: 'Stock display' })).body.data;
  await request(app).put(`/api/v1/devices/${device.id}/scenes`).set('Authorization', `Bearer ${token}`).send({ scenes: [{ sceneId }] });
  const result = await request(app).get(`/api/v1/devices/${device.id}/config`).set('X-Device-Key', device.device_key);
  expect(result.body.data.scenes[0].components[0]).toMatchObject({ type: 'stock', config: { market: 'cn', symbol: '300750' } });
});
