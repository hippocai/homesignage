/**
 * Unit tests for urlCacheService
 * All external HTTP/HTTPS calls are mocked.
 */
require('./setup');

const { EventEmitter } = require('events');

function makeHttpResponse(body, statusCode = 200, contentType = 'text/html') {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.headers = { 'content-type': contentType };
  process.nextTick(() => {
    res.emit('data', Buffer.from(body));
    res.emit('end');
  });
  return res;
}

const mockHttpsGet = jest.fn();
const mockHttpGet  = jest.fn();

jest.mock('https', () => ({ get: (...args) => mockHttpsGet(...args) }));
jest.mock('http',  () => ({ get: (...args) => mockHttpGet(...args)  }));

const urlCacheService = require('../src/services/urlCacheService');

beforeEach(() => {
  mockHttpsGet.mockReset();
  mockHttpGet.mockReset();
  // Invalidate any cached entries from previous tests
  urlCacheService.invalidate('https://example.com/page1');
  urlCacheService.invalidate('https://example.com/page2');
  urlCacheService.invalidate('https://example.com/stale');
  urlCacheService.invalidate('http://example.com/http-page');
  urlCacheService.invalidate('https://example.com/redirect-target');
  urlCacheService.invalidate('https://example.com/redirect-source');
});

describe('urlCacheService.getCachedContent', () => {
  it('fetches content from HTTPS URL and returns it', async () => {
    const fakeReq = new EventEmitter();
    mockHttpsGet.mockImplementation((url, opts, cb) => {
      cb(makeHttpResponse('<html>Hello</html>'));
      return fakeReq;
    });

    const result = await urlCacheService.getCachedContent('https://example.com/page1');
    expect(result.body.toString()).toBe('<html>Hello</html>');
    expect(result.contentType).toBe('text/html');
    expect(result.fetchedAt).toBeLessThanOrEqual(Date.now());
  });

  it('fetches content from HTTP URL', async () => {
    const fakeReq = new EventEmitter();
    mockHttpGet.mockImplementation((url, opts, cb) => {
      cb(makeHttpResponse('<p>HTTP content</p>', 200, 'text/html; charset=utf-8'));
      return fakeReq;
    });

    const result = await urlCacheService.getCachedContent('http://example.com/http-page');
    expect(result.body.toString()).toContain('HTTP content');
  });

  it('returns cached response on second call within TTL', async () => {
    const fakeReq = new EventEmitter();
    mockHttpsGet.mockImplementation((url, opts, cb) => {
      cb(makeHttpResponse('<html>Cached</html>'));
      return fakeReq;
    });

    await urlCacheService.getCachedContent('https://example.com/page2');
    await urlCacheService.getCachedContent('https://example.com/page2');

    // Should only have called upstream once
    expect(mockHttpsGet).toHaveBeenCalledTimes(1);
  });

  it('re-fetches when TTL of 0 ms is forced (always stale)', async () => {
    const fakeReq = new EventEmitter();
    mockHttpsGet.mockImplementation((url, opts, cb) => {
      cb(makeHttpResponse('<html>Fresh</html>'));
      return fakeReq;
    });

    // TTL 0 means every call is stale
    await urlCacheService.getCachedContent('https://example.com/stale', 0);
    await urlCacheService.getCachedContent('https://example.com/stale', 0);

    expect(mockHttpsGet).toHaveBeenCalledTimes(2);
  });

  it('returns stale cache when upstream errors instead of throwing', async () => {
    const fakeReq = new EventEmitter();
    // First call succeeds
    mockHttpsGet.mockImplementationOnce((url, opts, cb) => {
      cb(makeHttpResponse('<html>Stale content</html>'));
      return fakeReq;
    });
    await urlCacheService.getCachedContent('https://example.com/stale', 0);

    // Second call fails — should return stale cache
    const errorReq = new EventEmitter();
    mockHttpsGet.mockImplementationOnce((url, opts, cb) => {
      process.nextTick(() => errorReq.emit('error', new Error('Network error')));
      return errorReq;
    });
    const result = await urlCacheService.getCachedContent('https://example.com/stale', 0);
    expect(result.body.toString()).toBe('<html>Stale content</html>');
  });

  it('throws when fetch fails and no stale cache exists', async () => {
    const errorReq = new EventEmitter();
    mockHttpsGet.mockImplementation((url, opts, cb) => {
      process.nextTick(() => errorReq.emit('error', new Error('ECONNREFUSED')));
      return errorReq;
    });

    await expect(
      urlCacheService.getCachedContent('https://example.com/no-cache-page')
    ).rejects.toThrow();
  });

  it('follows HTTP 302 redirect', async () => {
    const fakeReq = new EventEmitter();
    // First call: 302 redirect
    mockHttpsGet.mockImplementationOnce((url, opts, cb) => {
      const res = new EventEmitter();
      res.statusCode = 302;
      res.headers = { location: 'https://example.com/redirect-target', 'content-type': 'text/html' };
      process.nextTick(() => res.emit('end'));
      cb(res);
      return fakeReq;
    });
    // Second call: actual content
    mockHttpsGet.mockImplementationOnce((url, opts, cb) => {
      cb(makeHttpResponse('<html>Redirected</html>'));
      return fakeReq;
    });

    const result = await urlCacheService.getCachedContent('https://example.com/redirect-source');
    expect(result.body.toString()).toBe('<html>Redirected</html>');
  });

  it('throws on non-200 non-redirect status', async () => {
    const fakeReq = new EventEmitter();
    mockHttpsGet.mockImplementation((url, opts, cb) => {
      cb(makeHttpResponse('Not Found', 404));
      return fakeReq;
    });

    await expect(
      urlCacheService.getCachedContent('https://example.com/not-found')
    ).rejects.toThrow('HTTP 404');
  });
});

describe('urlCacheService.invalidate', () => {
  it('forces a fresh fetch after invalidation', async () => {
    const fakeReq = new EventEmitter();
    mockHttpsGet.mockImplementation((url, opts, cb) => {
      cb(makeHttpResponse('<html>v1</html>'));
      return fakeReq;
    });

    await urlCacheService.getCachedContent('https://example.com/page1');
    urlCacheService.invalidate('https://example.com/page1');

    mockHttpsGet.mockImplementation((url, opts, cb) => {
      cb(makeHttpResponse('<html>v2</html>'));
      return fakeReq;
    });

    const result = await urlCacheService.getCachedContent('https://example.com/page1');
    expect(result.body.toString()).toBe('<html>v2</html>');
    expect(mockHttpsGet).toHaveBeenCalledTimes(2);
  });
});
