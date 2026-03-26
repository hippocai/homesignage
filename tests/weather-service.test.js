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

    const data = await weatherService.getWeather('TestCity1');
    expect(data).toMatchObject({
      city: 'Beijing',
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
    await weatherService.getWeather('TestCity2');
    expect(mockGet).toHaveBeenCalledTimes(1); // still 1
  });

  it('returns null when upstream responds with invalid JSON (retries 3 times)', async () => {
    const fakeReq = { on: jest.fn(), setTimeout: jest.fn() };
    mockGet.mockImplementation((url, opts, cb) => {
      cb(makeUpstreamResponse('not-json'));
      return fakeReq;
    });

    const data = await weatherService.getWeather('BadCity1');
    expect(data).toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(3); // retried 3 times
  });

  it('returns null when upstream request errors (retries 3 times)', async () => {
    mockGet.mockImplementation((url, opts, cb) => {
      const req = new EventEmitter();
      req.setTimeout = jest.fn();
      process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
      return req;
    });

    const data = await weatherService.getWeather('BadCity2');
    expect(data).toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(3); // retried 3 times
  });

  it('succeeds on second attempt after a transient TLS error', async () => {
    const fakeReq = { on: jest.fn(), setTimeout: jest.fn() };
    let calls = 0;
    mockGet.mockImplementation((url, opts, cb) => {
      calls++;
      if (calls === 1) {
        // First attempt: network error (TLS disconnect)
        const req = new EventEmitter();
        req.setTimeout = jest.fn();
        process.nextTick(() => req.emit('error', new Error('Client network socket disconnected')));
        return req;
      }
      // Second attempt: success
      cb(makeUpstreamResponse(SAMPLE_WTTR));
      return fakeReq;
    });

    const data = await weatherService.getWeather('RetryCity');
    expect(data).not.toBeNull();
    expect(data.city).toBe('Beijing');
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
      expect.objectContaining({ city: 'socketcity' })
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
