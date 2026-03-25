/**
 * Unit tests for assetDownloadService
 * All external HTTP/HTTPS calls, filesystem operations, and crypto are mocked.
 */
require('./setup');

const { EventEmitter } = require('events');
const path = require('path');

// --- HTTP mocks ---
const mockHttpsGet = jest.fn();
const mockHttpGet  = jest.fn();
jest.mock('https', () => ({ get: (...args) => mockHttpsGet(...args) }));
jest.mock('http',  () => ({ get: (...args) => mockHttpGet(...args)  }));

// --- fs mocks ---
const mockExistsSync        = jest.fn();
const mockCreateWriteStream = jest.fn();
jest.mock('fs', () => ({
  existsSync:        (...args) => mockExistsSync(...args),
  createWriteStream: (...args) => mockCreateWriteStream(...args),
}));

// --- fileRepo mock ---
jest.mock('../src/config/fileRepo', () => ({
  getRepoPath:   jest.fn(() => '/tmp/test-repo'),
  ensureRepoDir: jest.fn(() => '/tmp/test-repo'),
}));

// --- logger mock ---
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
}));

const { isExternal, localizeUrl } = require('../src/services/assetDownloadService');

// ---------- helpers ----------

function makeResponse(statusCode, contentType, opts = {}) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.headers    = { 'content-type': contentType, ...opts.headers };
  res.pipe       = jest.fn((writer) => {
    process.nextTick(() => writer.emit('finish'));
  });
  return res;
}

function makeWriteStream() {
  const ws = new EventEmitter();
  ws.emit = ws.emit.bind(ws);
  return ws;
}

beforeEach(() => {
  mockHttpsGet.mockReset();
  mockHttpGet.mockReset();
  mockExistsSync.mockReset();
  mockCreateWriteStream.mockReset();
});

// =============================================================
// isExternal
// =============================================================
describe('assetDownloadService.isExternal', () => {
  it('returns true for an external https URL', () => {
    expect(isExternal('https://example.com/image.jpg')).toBe(true);
  });

  it('returns true for an external http URL', () => {
    expect(isExternal('http://cdn.example.com/video.mp4')).toBe(true);
  });

  it('returns false for localhost URLs', () => {
    expect(isExternal('http://localhost:3000/file-repo/x.jpg')).toBe(false);
    expect(isExternal('http://127.0.0.1/file-repo/x.jpg')).toBe(false);
  });

  it('returns false for relative paths', () => {
    expect(isExternal('/file-repo/image.png')).toBe(false);
  });

  it('returns false for null / undefined', () => {
    expect(isExternal(null)).toBe(false);
    expect(isExternal(undefined)).toBe(false);
  });

  it('returns false for non-URL strings', () => {
    expect(isExternal('just-a-filename.jpg')).toBe(false);
  });
});

// =============================================================
// localizeUrl — non-external URLs pass through unchanged
// =============================================================
describe('assetDownloadService.localizeUrl — non-external URLs', () => {
  it('returns the original URL for localhost paths', async () => {
    const url = 'http://localhost:3000/file-repo/img.jpg';
    const result = await localizeUrl(url);
    expect(result).toBe(url);
    expect(mockHttpsGet).not.toHaveBeenCalled();
    expect(mockHttpGet).not.toHaveBeenCalled();
  });

  it('returns the original URL for relative paths', async () => {
    const url = '/file-repo/video.mp4';
    const result = await localizeUrl(url);
    expect(result).toBe(url);
  });
});

// =============================================================
// localizeUrl — external HTTPS download (file not cached)
// =============================================================
describe('assetDownloadService.localizeUrl — download', () => {
  it('downloads an external HTTPS image and returns a local /file-repo/ URL', async () => {
    mockExistsSync.mockReturnValue(false); // not already downloaded

    const ws = makeWriteStream();
    mockCreateWriteStream.mockReturnValue(ws);

    const fakeReq = new EventEmitter();
    mockHttpsGet.mockImplementation((url, opts, cb) => {
      cb(makeResponse(200, 'image/jpeg'));
      return fakeReq;
    });

    const result = await localizeUrl('https://example.com/photo.jpg');
    expect(result).toMatch(/^\/file-repo\/dl_[a-f0-9]+\.jpg$/);
    expect(mockHttpsGet).toHaveBeenCalledTimes(1);
  });

  it('downloads an external HTTP video and returns a local /file-repo/ URL', async () => {
    mockExistsSync.mockReturnValue(false);

    const ws = makeWriteStream();
    mockCreateWriteStream.mockReturnValue(ws);

    const fakeReq = new EventEmitter();
    mockHttpGet.mockImplementation((url, opts, cb) => {
      cb(makeResponse(200, 'video/mp4'));
      return fakeReq;
    });

    const result = await localizeUrl('http://example.com/clip.mp4');
    expect(result).toMatch(/^\/file-repo\/dl_[a-f0-9]+\.mp4$/);
    expect(mockHttpGet).toHaveBeenCalledTimes(1);
  });

  it('skips re-download when destination file already exists', async () => {
    mockExistsSync.mockReturnValue(true); // already on disk

    const fakeReq = new EventEmitter();
    mockHttpsGet.mockImplementation((url, opts, cb) => {
      cb(makeResponse(200, 'image/png'));
      return fakeReq;
    });

    const result = await localizeUrl('https://example.com/cached.png');
    expect(result).toMatch(/^\/file-repo\/dl_[a-f0-9]+\.png$/);
    // createWriteStream should NOT be called since we skip the write
    expect(mockCreateWriteStream).not.toHaveBeenCalled();
  });

  it('follows a 302 redirect and downloads the target', async () => {
    mockExistsSync.mockReturnValue(false);

    const ws = makeWriteStream();
    mockCreateWriteStream.mockReturnValue(ws);

    const fakeReq = new EventEmitter();

    // First call: 302 redirect
    mockHttpsGet.mockImplementationOnce((url, opts, cb) => {
      const res = new EventEmitter();
      res.statusCode = 302;
      res.headers = { location: 'https://example.com/final.jpg', 'content-type': 'text/html' };
      res.pipe = jest.fn();
      process.nextTick(() => res.emit('end'));
      cb(res);
      return fakeReq;
    });

    // Second call: real content
    mockHttpsGet.mockImplementationOnce((url, opts, cb) => {
      cb(makeResponse(200, 'image/jpeg'));
      return fakeReq;
    });

    const result = await localizeUrl('https://example.com/redirect.jpg');
    expect(result).toMatch(/^\/file-repo\/dl_[a-f0-9]+\.jpg$/);
    expect(mockHttpsGet).toHaveBeenCalledTimes(2);
  });

  it('returns original URL when server responds with 404', async () => {
    const fakeReq = new EventEmitter();
    mockHttpsGet.mockImplementation((url, opts, cb) => {
      cb(makeResponse(404, 'text/html'));
      return fakeReq;
    });

    const url = 'https://example.com/missing.jpg';
    const result = await localizeUrl(url);
    // localizeUrl falls back to original on error
    expect(result).toBe(url);
  });

  it('returns original URL on network error', async () => {
    const fakeReq = new EventEmitter();
    mockHttpsGet.mockImplementation((url, opts, cb) => {
      process.nextTick(() => fakeReq.emit('error', new Error('ECONNREFUSED')));
      return fakeReq;
    });

    const url = 'https://example.com/unreachable.jpg';
    const result = await localizeUrl(url);
    expect(result).toBe(url);
  });

  it('guesses file extension from URL when content-type is absent', async () => {
    mockExistsSync.mockReturnValue(false);

    const ws = makeWriteStream();
    mockCreateWriteStream.mockReturnValue(ws);

    const fakeReq = new EventEmitter();
    mockHttpsGet.mockImplementation((url, opts, cb) => {
      cb(makeResponse(200, '')); // no content-type
      return fakeReq;
    });

    const result = await localizeUrl('https://example.com/photo.webp');
    expect(result).toMatch(/\.webp$/);
  });
});
