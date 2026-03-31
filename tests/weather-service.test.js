/**
 * Unit tests for weatherService
 * All external HTTP calls are mocked.
 */
require('./setup');

// Mock https before requiring the service
const { EventEmitter } = require('events');

function makeUpstreamResponse(body, statusCode = 200) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  process.nextTick(() => {
    res.emit('data', Buffer.from(body));
    res.emit('end');
  });
  return res;
}

const mockGet = jest.fn();
jest.mock('https', () => ({ get: (...args) => mockGet(...args) }));

// Mock node-schedule to prevent real jobs
jest.mock('node-schedule', () => ({ scheduleJob: jest.fn(() => ({ cancel: jest.fn() })) }));

const weatherService = require('../src/services/weatherService');

const SAMPLE_WTTR = JSON.stringify({
  current_condition: [{
    temp_C: '20', temp_F: '68', weatherCode: '116',
    humidity: '60', windspeedKmph: '15',
    lang_zh: [{ value: '局部多云' }],
  }],
  nearest_area: [{ areaName: [{ value: 'Beijing' }] }],
});

beforeEach(() => {
  mockGet.mockReset();
  // Clear internal cache between tests by calling with a fresh city each time,
  // or by directly clearing (we expose a helper via closure — just use unique cities)
});

describe('weatherService.getWeather', () => {
  it('fetches from upstream and returns parsed data', async () => {
    const fakeReq = { on: jest.fn(), setTimeout: jest.fn() };
    mockGet.mockImplementation((url, opts, cb) => {
      cb(makeUpstreamResponse(SAMPLE_WTTR));
      return fakeReq;
    });

    const result = await weatherService.getWeather('TestCity1');
    expect(result.stale).toBe(false);
    expect(result.fetchedAt).toBeGreaterThan(0);
    expect(result.data).toMatchObject({
      city: 'TestCity1',
      tempC: 20,
      tempF: 68,
      description: '局部多云',
      humidity: '60',
      windKmph: '15',
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('returns cached data without re-fetching if still fresh', async () => {
    const fakeReq = { on: jest.fn(), setTimeout: jest.fn() };
    mockGet.mockImplementation((url, opts, cb) => {
      cb(makeUpstreamResponse(SAMPLE_WTTR));
      return fakeReq;
    });

    // First call — fetches
    await weatherService.getWeather('TestCity2');
    expect(mockGet).toHaveBeenCalledTimes(1);

    // Second call — should use cache
    const cached = await weatherService.getWeather('TestCity2');
    expect(mockGet).toHaveBeenCalledTimes(1); // still 1
    expect(cached.stale).toBe(false);
  });

  it('returns null when no cache and all retries fail', async () => {
    mockGet.mockImplementation(() => {
      const req = new EventEmitter();
      req.setTimeout = jest.fn();
      process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
      return req;
    });

    const result = await weatherService.getWeather('BadCity1');
    expect(result).toBeNull(); // no stale cache → null
    expect(mockGet).toHaveBeenCalledTimes(3); // retried 3 times
  });

  it('returns stale cached data with stale:true when upstream fails', async () => {
    const fakeReq = { on: jest.fn(), setTimeout: jest.fn() };
    // First call: success → populates cache
    mockGet.mockImplementationOnce((url, opts, cb) => {
      cb(makeUpstreamResponse(SAMPLE_WTTR));
      return fakeReq;
    });
    await weatherService.getWeather('StaleCity');

    // Expire the cache by directly testing refreshCity with a broken upstream
    mockGet.mockImplementation(() => {
      const req = new EventEmitter();
      req.setTimeout = jest.fn();
      process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
      return req;
    });
    const result = await weatherService.refreshCity('StaleCity');
    expect(result).not.toBeNull();
    expect(result.stale).toBe(true);
    expect(result.data.city).toBe('StaleCity'); // stale data still returned
  });

  it('succeeds on second attempt after a transient TLS error', async () => {
    const fakeReq = { on: jest.fn(), setTimeout: jest.fn() };
    let calls = 0;
    mockGet.mockImplementation((url, opts, cb) => {
      calls++;
      if (calls === 1) {
        const req = new EventEmitter();
        req.setTimeout = jest.fn();
        process.nextTick(() => req.emit('error', new Error('Client network socket disconnected')));
        return req;
      }
      cb(makeUpstreamResponse(SAMPLE_WTTR));
      return fakeReq;
    });

    const result = await weatherService.getWeather('RetryCity');
    expect(result).not.toBeNull();
    expect(result.stale).toBe(false);
    expect(result.data.city).toBe('RetryCity');
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});

describe('weatherService.refreshCity', () => {
  it('emits weather-update to socket service when data is available', async () => {
    const mockSocket = { emitToAll: jest.fn() };
    weatherService.setSocketService(mockSocket);

    const fakeReq = { on: jest.fn(), setTimeout: jest.fn() };
    mockGet.mockImplementation((url, opts, cb) => {
      cb(makeUpstreamResponse(SAMPLE_WTTR));
      return fakeReq;
    });

    await weatherService.refreshCity('SocketCity');
    expect(mockSocket.emitToAll).toHaveBeenCalledWith(
      'weather-update',
      expect.objectContaining({ city: 'socketcity', fetchedAt: expect.any(Number) })
    );
  });

  it('does not throw when socket service is not set', async () => {
    weatherService.setSocketService(null);
    const fakeReq = { on: jest.fn(), setTimeout: jest.fn() };
    mockGet.mockImplementation((url, opts, cb) => {
      cb(makeUpstreamResponse(SAMPLE_WTTR));
      return fakeReq;
    });
    await expect(weatherService.refreshCity('NoSocketCity')).resolves.not.toThrow();
  });
});

describe('weatherService.startScheduler', () => {
  it('registers a cron job without throwing', () => {
    const schedule = require('node-schedule');
    expect(() => {
      weatherService.startScheduler(async () => ['Beijing']);
    }).not.toThrow();
    expect(schedule.scheduleJob).toHaveBeenCalled();
  });
});
