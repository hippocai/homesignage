const { EventEmitter } = require('events');
const mockGet = jest.fn();
jest.mock('https', () => ({ get: (...args) => mockGet(...args) }));

function tencent(symbol = 'sh600519', date = '20261105') {
  const quote = [];
  Object.assign(quote, { 1: '测试股票', 3: '101.50', 4: '100', 5: '99', 30: date + '150000', 33: '102', 34: '98' });
  return { code: 0, data: { [symbol]: { qt: { [symbol]: quote }, data: { date, data: ['0930 99 1', '1130 100 2', '1300 100 2', '1500 101.5 3', '1530 101.5 3', 'invalid', '1000 0 0'] } } } };
}

function respond(payload, status = 200) {
  mockGet.mockImplementation((url, options, callback) => {
    const response = new EventEmitter();
    response.statusCode = status;
    response.resume = jest.fn();
    const req = new EventEmitter();
    req.setTimeout = jest.fn();
    req.destroy = jest.fn();
    process.nextTick(() => {
      callback(response);
      response.emit('data', Buffer.from(JSON.stringify(payload)));
      response.emit('end');
    });
    return req;
  });
}

let service;
beforeEach(() => { jest.resetModules(); mockGet.mockReset(); service = require('../src/services/stockService'); });
afterEach(() => jest.restoreAllMocks());

describe('stock symbols and configuration', () => {
  it.each([
    ['600519', 'auto', 'sh600519', 'cn'], ['300750', 'auto', 'sz300750', 'cn'],
    ['688981', 'auto', 'sh688981', 'cn'], ['920001', 'auto', 'bj920001', 'cn'],
    ['000001.SH', 'auto', 'sh000001', 'cn'], ['000001', 'auto', 'sz000001', 'cn'],
    ['00700', 'auto', 'hk00700', 'hk'], ['700.HK', 'auto', 'hk00700', 'hk'],
    ['AAPL', 'auto', 'AAPL', 'us'], ['BRK.B', 'us', 'BRK-B', 'us'], ['USM', 'us', 'USM', 'us'],
  ])('normalizes %s', (input, market, symbol, expectedMarket) => {
    expect(service.normalizeSymbol(input, market)).toEqual({ symbol, market: expectedMarket });
  });
  it.each(['https://localhost', '../../file', 'AAPL&host=localhost', '', null, ['AAPL']])('rejects invalid input %s', symbol => {
    expect(() => service.normalizeSymbol(symbol)).toThrow();
  });
  it('rejects incompatible market, invalid bounds and refresh intervals', () => {
    expect(service.validateConfig({ symbol: 'AAPL', market: 'cn' })).toBeTruthy();
    expect(service.validateConfig({ symbol: 'AAPL', scaleMode: 'fixed', priceMin: 20, priceMax: 10 })).toBeTruthy();
    expect(service.validateConfig({ symbol: 'AAPL', scaleMode: 'percent', scalePercent: 0 })).toBeTruthy();
    expect(service.validateConfig({ symbol: 'AAPL', refreshInterval: 5 })).toBeTruthy();
    expect(service.validateConfig({ symbol: 'AAPL', scaleMode: 'fixed', priceMin: 0, priceMax: 500 })).toBeNull();
  });
  it('allows blank component drafts but still rejects blank quote requests', () => {
    expect(service.validateConfig({ symbol: '', market: 'auto' })).toBeNull();
    expect(service.validateConfig({ symbol: '', market: 'unknown' })).toBeTruthy();
    expect(() => service.normalizeSymbol('')).toThrow();
  });
});

describe('provider parsing', () => {
  it('parses mainland quotes and excludes invalid and after-session points', () => {
    const data = service.parseTencent(tencent(), 'sh600519', 'cn');
    expect(data).toMatchObject({ price: 101.5, previousClose: 100, change: 1.5, changePercent: 1.5, tradingDate: '2026-11-05', currency: 'CNY' });
    expect(data.points).toHaveLength(4);
    expect(data.sessions).toEqual([[570, 690], [780, 900]]);
  });
  it('parses Hong Kong timestamps and afternoon session', () => {
    const payload = tencent('hk00700');
    payload.data.hk00700.qt.hk00700[30] = '2026/11/05 16:08:22';
    expect(service.parseTencent(payload, 'hk00700', 'hk')).toMatchObject({ currency: 'HKD', quoteTime: '2026-11-05 16:08', sessions: [[570, 720], [780, 960]] });
  });
  it('does not combine a prior-day line with a new trading-day quote', () => {
    const payload = tencent();
    payload.data.sh600519.data.date = '20261104';
    expect(service.parseTencent(payload, 'sh600519', 'cn').points).toEqual([]);
  });
  it.each(['2026-07-01T13:30:00Z', '2026-01-05T14:30:00Z'])('uses exchange timezone including DST for %s', iso => {
    const timestamp = Date.parse(iso) / 1000;
    const payload = { chart: { result: [{ meta: { regularMarketPrice: 201, regularMarketTime: timestamp + 60, exchangeTimezoneName: 'America/New_York', chartPreviousClose: 200, currency: 'USD' }, timestamp: [timestamp, timestamp + 60], indicators: { quote: [{ open: [199, 200], close: [200, 201] }] } }] } };
    const result = service.parseYahoo(payload, 'AAPL');
    expect(result.points[0]).toEqual({ minute: 570, time: '09:30', price: 200 });
    expect(result).toMatchObject({ currency: 'USD', changePercent: 0.5, open: 199 });
  });
  it('rejects unknown stocks instead of inventing prices', () => {
    expect(() => service.parseTencent({ code: 0, data: {} }, 'sz999999', 'cn')).toThrow();
    expect(() => service.parseYahoo({ chart: { result: null } }, 'UNKNOWN')).toThrow();
  });
});

describe('stock fetch caching', () => {
  it('retries the alternate Yahoo host when the primary endpoint fails', async () => {
    const timestamp = Date.parse('2026-11-05T15:00:00Z') / 1000;
    const good = { chart: { result: [{ meta: { regularMarketPrice: 201, regularMarketTime: timestamp, chartPreviousClose: 200 }, timestamp: [timestamp], indicators: { quote: [{ close: [201] }] } }] } };
    mockGet.mockImplementation((url, options, callback) => {
      const res = new EventEmitter(); res.statusCode = url.includes('query1.') ? 503 : 200; res.resume = jest.fn();
      process.nextTick(() => { callback(res); res.emit('data', Buffer.from(JSON.stringify(good))); res.emit('end'); });
      const req = new EventEmitter(); req.setTimeout = jest.fn(); return req;
    });
    expect(await service.getStock('AAPL', 'us')).toMatchObject({ price: 201, stale: false });
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet.mock.calls[1][0]).toContain('https://query2.finance.yahoo.com/');
  });
  it('coalesces concurrent requests and caches equivalent symbols', async () => {
    respond(tencent());
    const [first, second] = await Promise.all([service.getStock('600519', 'cn'), service.getStock('sh600519', 'auto')]);
    expect(first).toEqual(second);
    expect((await service.getStock('600519', 'auto')).stale).toBe(false);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet.mock.calls[0][0]).toBe('https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=sh600519');
  });
  it('keeps dated cached prices on outage, retries later, and expires old data', async () => {
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    respond(tencent());
    await service.getStock('600519', 'cn');
    now += 31000;
    respond({}, 503);
    expect(await service.getStock('600519', 'cn')).toMatchObject({ stale: true, tradingDate: '2026-11-05' });
    await service.getStock('600519', 'cn');
    expect(mockGet).toHaveBeenCalledTimes(2);
    now += 25 * 60 * 60 * 1000;
    await expect(service.getStock('600519', 'cn')).rejects.toThrow();
  });
  it('rejects malformed upstream JSON', async () => {
    mockGet.mockImplementation((url, options, callback) => {
      const res = new EventEmitter(); res.statusCode = 200;
      process.nextTick(() => { callback(res); res.emit('data', Buffer.from('not JSON')); res.emit('end'); });
      const req = new EventEmitter(); req.setTimeout = jest.fn(); return req;
    });
    await expect(service.getStock('600519', 'cn')).rejects.toThrow('Invalid stock provider response');
  });
});
