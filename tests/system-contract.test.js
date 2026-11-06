const request = require('supertest');
const { setupTestApp, getAdminToken } = require('./testApp');
const settings = require('../src/dao/settingsDao');

let app, token;
beforeAll(async () => {
  app = await setupTestApp();
  token = await getAdminToken(app);
});

// Inventory the actual mounted Express 4 routes, including nested guest routes.
function operations(stack, prefix = '') {
  return stack.flatMap(layer => {
    if (layer.route) {
      const path = (prefix + layer.route.path).replace(/\/$/, '').replace(/:(\w+)/g, '{$1}');
      return Object.keys(layer.route.methods).map(method => method + ' ' + path);
    }
    if (!layer.handle.stack) return [];
    const mount = layer.regexp.source.split('\\/?(?=')[0].replace(/^\^/, '').replace(/\\\//g, '/');
    return operations(layer.handle.stack, prefix + mount);
  });
}

test('published OpenAPI covers each mounted v1 operation and resolves local schema references', async () => {
  const {body: spec} = await request(app).get('/api/docs.json').expect(200);
  const live = operations(app._router.stack).filter(op => op.includes(' /api/v1/')).map(op => op.replace(' /api/v1',' '));
  expect(live.length).toBeGreaterThan(70);
  const documented = Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.keys(item).filter(key => ['get','post','put','delete','patch'].includes(key) && !item.servers)
      .map(method => method + ' ' + path));
  expect(documented.sort()).toEqual(live.sort());
  for (const ref of JSON.stringify(spec).matchAll(/"\$ref":"#\/([^"]+)"/g)) {
    expect(ref[1].split('/').reduce((obj,k) => obj?.[k],spec)).toBeDefined();
  }
});

test('administrator weather settings round-trip, mask credentials and preserve them on placeholder save', async () => {
  const url='/api/v1/settings';
  const auth={Authorization:'Bearer '+token};
  await request(app).get(url).expect(401);
  await request(app).put(url).set(auth).send({'weather.provider':'qweather','weather.qweather.apiKey':'fixture-secret'}).expect(200);
  const read=await request(app).get(url).set(auth).expect(200);
  expect(read.body.data).toMatchObject({'weather.provider':'qweather','weather.qweather.apiKey':'***'});
  await request(app).put(url).set(auth).send({'weather.qweather.apiKey':'***'}).expect(200);
  expect(await settings.get('weather.qweather.apiKey')).toBe('fixture-secret');
  await request(app).get('/api/v1/weather/providers').expect(401);
  const providers=await request(app).get('/api/v1/weather/providers').set(auth).expect(200);
  expect(providers.body.data.map(p=>p.name).sort()).toEqual(['qweather','wttr']);
  await request(app).get('/api/v1/weather/locations?query=x').set(auth).expect(200,{data:[]});
});

test('invalid JSON is a client error; health remains available afterwards', async () => {
  await request(app).post('/api/v1/auth/login').type('application/json').send('{').expect(400);
  await request(app).get('/api/v1/health').expect(200);
});

test('iframe proxy validates its URL, rejects loopback and preserves the upstream page directory', async () => {
  await request(app).get('/url-content?url=http://').expect(400);
  await request(app).get('/url-content?url=http://127.0.0.1').expect(400);
  await request(app).get('/url-content?url=https://example.org&ttl=-1').expect(400);
  const cache = jest.spyOn(require('../src/services/urlCacheService'),'getCachedContent').mockResolvedValue({
    body:Buffer.from('<html><head></head><img src="a.png"></html>'),contentType:'text/html',url:'https://example.org/news/today/index.html'
  });
  try {
    const res=await request(app).get('/url-content?url=https://example.org/start').expect(200);
    expect(res.text).toContain('<base href="https://example.org/news/today/index.html">');
    expect(res.headers['content-security-policy']).toBe('sandbox allow-scripts allow-forms');
  } finally { cache.mockRestore(); }
});
