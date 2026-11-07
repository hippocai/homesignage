const widget = require('../client/js/stock-widget');
const quote = { name: 'Example', symbol: 'AAPL', displaySymbol: 'AAPL', market: 'us', price: 102, previousClose: 100, change: 2, changePercent: 2, open: 99, high: 103, low: 99, currency: 'USD', quoteTime: '2026-11-05 10:00', timeZone: 'America/New_York', source: 'Yahoo Finance', sessions: [[570, 960]], points: [{ minute: 570, price: 99 }, { minute: 600, price: 102 }] };

it('automatically fits prices and the previous close with padding', () => {
  const scale = widget.getScale(quote, { scaleMode: 'auto' });
  expect(scale.min).toBeLessThan(99); expect(scale.max).toBeGreaterThan(102);
});
it('gives flat and single-point data a nonzero scale', () => {
  const scale = widget.getScale({ price: 100, previousClose: 100, points: [] }, {});
  expect(scale.max).toBeGreaterThan(scale.min);
});
it('preserves configured fixed bounds and signals clipping', () => {
  expect(widget.getScale(quote, { scaleMode: 'fixed', priceMin: 100, priceMax: 101 })).toEqual({ min: 100, max: 101, clipped: true });
  expect(widget.getScale(quote, { scaleMode: 'fixed', priceMin: 0, priceMax: 200 }).min).toBe(0);
});
it('centers a percentage scale on yesterday close', () => {
  expect(widget.getScale(quote, { scaleMode: 'percent', scalePercent: 5 })).toEqual({ min: 95, max: 105, clipped: false });
  expect(() => widget.getScale({ ...quote, previousClose: null }, { scaleMode: 'percent' })).toThrow();
});
it('rejects invalid bounds instead of emitting NaN coordinates', () => {
  expect(() => widget.getScale(quote, { scaleMode: 'fixed', priceMin: 100, priceMax: 100 })).toThrow();
  const chart = widget.chartSvg(quote, { scaleMode: 'fixed', priceMin: 100, priceMax: 101 }, 'test');
  expect(chart.html).toContain('clip-path="url(#test)"');
  expect(chart.html).not.toMatch(/NaN|Infinity/);
});
it('removes the lunch break from the time scale and preserves future session space', () => {
  expect(widget.tradingOffset(690, [[570, 690], [780, 900]])).toBe(120);
  expect(widget.tradingOffset(780, [[570, 690], [780, 900]])).toBe(120);
  expect(widget.tradingOffset(900, [[570, 690], [780, 900]])).toBe(240);
  expect(widget.tradingOffset(960, [[570, 960]])).toBe(390);
});
it('shows empty intraday data explicitly', () => {
  expect(widget.chartSvg({ ...quote, points: [] }, {}, 'test').html).toContain('暂无当日分时数据');
});

describe('widget refresh lifecycle', () => {
  let requests, element, children;
  beforeEach(() => {
    jest.useFakeTimers(); requests = []; children = {};
    global.XMLHttpRequest = class {
      constructor() { requests.push(this); this.abort = jest.fn(); }
      open() {} send() {}
    };
    element = { style: {}, classList: { add() {} }, querySelector(name) {
      if (!children[name]) children[name] = { style: {}, classList: { toggle() {} } };
      return children[name];
    } };
  });
  afterEach(() => { jest.useRealTimers(); delete global.XMLHttpRequest; });
  it('keeps the actual security name visible when a custom note names a different company', () => {
    const dispose = widget.mount(element, { symbol: 'sh600519', title: '合康新能' });
    requests[0].status = 200;
    requests[0].responseText = JSON.stringify({ data: { ...quote, name: '贵州茅台', displaySymbol: '600519.SH' } });
    requests[0].onload();
    expect(children['.stock-name'].textContent).toBe('贵州茅台');
    expect(children['.stock-symbol'].textContent).toBe('600519.SH');
    expect(children['.stock-note'].textContent).toBe('备注：合康新能');
    dispose();
  });
  it('does not query an example stock when the code has not been configured', () => {
    const dispose = widget.mount(element, { symbol: '', title: '合康新能' });
    expect(requests).toHaveLength(0);
    expect(children['.stock-name'].textContent).toBe('未配置股票');
    expect(children['.stock-meta'].textContent).toContain('填写股票代码');
    expect(jest.getTimerCount()).toBe(0);
    dispose();
  });
  it('renders real responses, refreshes, and cancels timers and requests on removal', () => {
    jest.setSystemTime(new Date(2026, 10, 7, 15, 30, 0));
    const dispose = widget.mount(element, { symbol: 'LIFECYCLE', refreshInterval: 60 });
    expect(children['.stock-refresh'].textContent).toContain('等待首次请求');
    requests[0].status = 200; requests[0].responseText = JSON.stringify({ data: quote }); requests[0].onload();
    expect(children['.stock-price'].textContent).toBe('102.00');
    expect(children['.stock-meta'].textContent).toContain('2026-11-05');
    expect(children['.stock-refresh'].textContent).toBe('最近刷新：2026-11-07 15:30:00 · 成功 · 每 60 秒');
    jest.advanceTimersByTime(60000); expect(requests).toHaveLength(2);
    requests[1].status = 200; requests[1].responseText = JSON.stringify({ data: quote }); requests[1].onload();
    expect(children['.stock-refresh'].textContent).toContain('15:31:00 · 成功');
    dispose(); expect(requests[1].abort).toHaveBeenCalled();
    requests[1].onerror(); jest.advanceTimersByTime(60000); expect(requests).toHaveLength(2);
  });
  it('keeps the last dated quote visible during an outage', () => {
    jest.setSystemTime(new Date(2026, 10, 7, 15, 30, 0));
    const dispose = widget.mount(element, { symbol: 'OUTAGE' });
    requests[0].status = 200; requests[0].responseText = JSON.stringify({ data: quote }); requests[0].onload();
    jest.advanceTimersByTime(60000); requests[1].onerror();
    expect(children['.stock-price'].textContent).toBe('102.00');
    expect(children['.stock-meta'].textContent).toContain('显示缓存');
    expect(children['.stock-refresh'].textContent).toContain('15:31:00 · 失败');
    jest.advanceTimersByTime(60000);
    requests[2].status = 200; requests[2].responseText = JSON.stringify({ data: { ...quote, stale: true } }); requests[2].onload();
    expect(children['.stock-refresh'].textContent).toContain('15:32:00 · 失败');
    dispose();
  });
});
