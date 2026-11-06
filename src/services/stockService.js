const https = require('https');

const CACHE_MS = 30 * 1000;
const MAX_STALE_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;
const cache = new Map();
const inflight = new Map();

function normalizeSymbol(input, market = 'auto') {
  if (typeof input !== 'string' || !['auto', 'cn', 'hk', 'us'].includes(market)) {
    throw new Error('Invalid stock symbol or market');
  }
  let symbol = input.trim();
  if (market === 'auto') {
    market = /^(hk\d+|\d+\.HK)$/i.test(symbol) || /^\d{1,5}$/.test(symbol) ? 'hk'
      : /^(sh|sz|bj)\d{6}$/i.test(symbol) || /^\d{6}(\.(SH|SZ|BJ))?$/i.test(symbol) ? 'cn' : 'us';
  }
  if (market === 'cn') {
    symbol = symbol.toLowerCase().replace(/^(\d{6})\.(sh|sz|bj)$/, '$2$1');
    if (/^\d{6}$/.test(symbol)) symbol = (/^[56]/.test(symbol) ? 'sh' : /^[489]/.test(symbol) ? 'bj' : 'sz') + symbol;
    if (!/^(sh|sz|bj)\d{6}$/.test(symbol)) throw new Error('Invalid mainland stock code');
  } else if (market === 'hk') {
    symbol = symbol.replace(/^hk/i, '').replace(/\.HK$/i, '');
    if (!/^\d{1,5}$/.test(symbol)) throw new Error('Invalid Hong Kong stock code');
    symbol = 'hk' + symbol.padStart(5, '0');
  } else {
    symbol = symbol.replace(/^us(?=[A-Z])/, '').toUpperCase().replace(/\./g, '-');
    if (!/^[A-Z][A-Z0-9-]{0,14}$/.test(symbol)) throw new Error('Invalid US stock ticker');
  }
  return { symbol, market };
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return 'Stock config must be an object';
  const market = config.market || 'auto';
  if (!['auto', 'cn', 'hk', 'us'].includes(market)) return 'Invalid stock market';
  // New components may be unconfigured drafts; they must never query an example ticker.
  if (!(typeof config.symbol === 'string' && config.symbol.trim() === '')) {
    try { normalizeSymbol(config.symbol, market); } catch (e) { return e.message; }
  }
  const mode = config.scaleMode || 'auto';
  if (!['auto', 'fixed', 'percent'].includes(mode)) return 'Invalid stock scale mode';
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  if (mode === 'fixed' && (typeof config.priceMin !== 'number' || !Number.isFinite(config.priceMin) || config.priceMin < 0 || !positive(config.priceMax) || config.priceMin >= config.priceMax)) {
    return 'Price scale requires 0 <= minimum < maximum';
  }
  if (mode === 'percent' && (!positive(config.scalePercent) || config.scalePercent > 100)) return 'Scale percent must be between 0 and 100';
  if (config.refreshInterval !== undefined && (!positive(config.refreshInterval) || config.refreshInterval < 30 || config.refreshInterval > 3600)) {
    return 'Stock refresh interval must be between 30 and 3600 seconds';
  }
  return null;
}

// Upstream URLs are constructed here; callers cannot supply a host or arbitrary URL.
function fetchJson(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 HomeSignage/1.0', Accept: 'application/json' } }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('Stock provider returned HTTP ' + res.statusCode));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          res.destroy(new Error('Stock response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { reject(new Error('Invalid stock provider response')); }
      });
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('Stock provider response aborted')));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Stock provider timeout')));
    req.on('error', reject);
  });
}

function positiveNumber(value) {
  if (value === null || value === '' || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function minuteOfDay(time) {
  const match = /^(\d{2}):?(\d{2})$/.exec(time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function finishQuote(quote) {
  quote.change = quote.previousClose ? quote.price - quote.previousClose : null;
  quote.changePercent = quote.previousClose ? quote.change / quote.previousClose * 100 : null;
  return quote;
}

function parseTencent(payload, symbol, market) {
  const entry = payload && payload.data && payload.data[symbol];
  const quote = entry && entry.qt && entry.qt[symbol];
  if (payload.code !== 0 || !Array.isArray(quote) || !positiveNumber(quote[3])) throw new Error('Stock data unavailable');
  const rawTime = String(quote[30] || '').replace(/\D/g, '');
  const quoteDate = rawTime.length >= 8 ? rawTime.slice(0, 4) + '-' + rawTime.slice(4, 6) + '-' + rawTime.slice(6, 8) : null;
  const rawDate = String(entry.data && entry.data.date || '').replace(/\D/g, '');
  const pointDate = rawDate.length === 8 ? rawDate.slice(0, 4) + '-' + rawDate.slice(4, 6) + '-' + rawDate.slice(6, 8) : null;
  if (!quoteDate) throw new Error('Stock timestamp unavailable');
  const sessions = market === 'hk' ? [[570, 720], [780, 960]] : [[570, 690], [780, 900]];
  const points = [];
  if (pointDate === quoteDate && Array.isArray(entry.data.data)) {
    for (const row of entry.data.data.slice(0, 2000)) {
      if (typeof row !== 'string') continue;
      const fields = row.trim().split(/\s+/);
      const minute = minuteOfDay(fields[0]);
      const price = positiveNumber(fields[1]);
      if (price && sessions.some(([start, end]) => minute !== null && minute >= start && minute <= end)) {
        points.push({ minute, time: fields[0].slice(0, 2) + ':' + fields[0].slice(2), price });
      }
    }
  }
  points.sort((a, b) => a.minute - b.minute);
  return finishQuote({
    symbol, market, name: String(quote[1] || symbol),
    displaySymbol: market === 'hk' ? symbol.slice(2) + '.HK' : symbol.slice(2) + '.' + symbol.slice(0, 2).toUpperCase(),
    currency: market === 'hk' ? 'HKD' : 'CNY', timeZone: market === 'hk' ? 'Asia/Hong_Kong' : 'Asia/Shanghai',
    price: positiveNumber(quote[3]), previousClose: positiveNumber(quote[4]),
    open: positiveNumber(quote[5]), high: positiveNumber(quote[33]), low: positiveNumber(quote[34]),
    tradingDate: quoteDate,
    quoteTime: quoteDate + (rawTime.length >= 12 ? ' ' + rawTime.slice(8, 10) + ':' + rawTime.slice(10, 12) : ''),
    sessions, points, source: '腾讯财经',
  });
}

function marketTime(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp * 1000));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${fields.year}-${fields.month}-${fields.day}`, time: `${fields.hour}:${fields.minute}`, minute: Number(fields.hour) * 60 + Number(fields.minute) };
}

function parseYahoo(payload, symbol) {
  const result = payload && payload.chart && payload.chart.result && payload.chart.result[0];
  const meta = result && result.meta;
  if (!meta || !positiveNumber(meta.regularMarketPrice) || !positiveNumber(meta.regularMarketTime)) throw new Error('Stock data unavailable');
  const timeZone = meta.exchangeTimezoneName || 'America/New_York';
  const asOf = marketTime(meta.regularMarketTime, timeZone);
  const bars = result.indicators && result.indicators.quote && result.indicators.quote[0] || {};
  const closes = bars.close || [];
  const points = [];
  let open = null;
  for (let i = 0; i < Math.min((result.timestamp || []).length, 2000); i++) {
    if (!positiveNumber(result.timestamp[i])) continue;
    const time = marketTime(result.timestamp[i], timeZone);
    const price = positiveNumber(closes[i]);
    if (time.date === asOf.date && time.minute >= 570 && time.minute <= 960) {
      if (open === null && bars.open) open = positiveNumber(bars.open[i]);
      if (price) points.push({ minute: time.minute, time: time.time, price });
    }
  }
  points.sort((a, b) => a.minute - b.minute);
  return finishQuote({
    symbol, market: 'us', displaySymbol: symbol, name: meta.shortName || meta.longName || symbol,
    currency: meta.currency || 'USD', timeZone, price: meta.regularMarketPrice,
    previousClose: positiveNumber(meta.chartPreviousClose) || positiveNumber(meta.previousClose),
    open,
    high: positiveNumber(meta.regularMarketDayHigh), low: positiveNumber(meta.regularMarketDayLow),
    tradingDate: asOf.date, quoteTime: asOf.date + ' ' + asOf.time,
    sessions: [[570, 960]], points, source: 'Yahoo Finance',
  });
}

async function getStock(input, market) {
  const normalized = normalizeSymbol(input, market);
  const key = normalized.market + ':' + normalized.symbol;
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && now - cached.attemptedAt < CACHE_MS) {
    if (cached.data && now - cached.fetchedAt <= MAX_STALE_MS) return { ...cached.data, fetchedAt: cached.fetchedAt, stale: !!cached.error };
    throw new Error('Stock data unavailable');
  }
  if (inflight.has(key)) return inflight.get(key);
  const task = (async () => {
    try {
      const { symbol, market: selectedMarket } = normalized;
      let data;
      if (selectedMarket === 'us') {
        const suffix = '/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1m&range=1d&includePrePost=false';
        try {
          data = parseYahoo(await fetchJson('https://query1.finance.yahoo.com' + suffix, 6000), symbol);
        } catch (_) {
          data = parseYahoo(await fetchJson('https://query2.finance.yahoo.com' + suffix, 6000), symbol);
        }
      } else {
        const payload = await fetchJson('https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=' + encodeURIComponent(symbol));
        data = parseTencent(payload, symbol, selectedMarket);
      }
      const fetchedAt = Date.now();
      cache.set(key, { data, fetchedAt, attemptedAt: fetchedAt });
      return { ...data, fetchedAt, stale: false };
    } catch (error) {
      cache.set(key, { data: cached && cached.data, fetchedAt: cached && cached.fetchedAt, attemptedAt: Date.now(), error: true });
      if (cached && cached.data && Date.now() - cached.fetchedAt <= MAX_STALE_MS) return { ...cached.data, fetchedAt: cached.fetchedAt, stale: true };
      throw error;
    } finally {
      inflight.delete(key);
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
    }
  })();
  inflight.set(key, task);
  return task;
}

module.exports = { getStock, normalizeSymbol, validateConfig, parseTencent, parseYahoo };
