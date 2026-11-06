/* Shared by the display client and the Vue editor. No charting library required. */
(function (root, factory) {
  var widget = factory();
  if (typeof module === 'object' && module.exports) module.exports = widget;
  if (root) root.HomeSignageStock = widget;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  var nextId = 0;
  var memoryCache = {};

  function number(value) { return typeof value === 'number' && isFinite(value); }
  function price(value) { return number(value) ? value.toFixed(Math.abs(value) < 1 ? 4 : 2) : '--'; }
  function escape(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  function getScale(data, config) {
    var values = (data.points || []).map(function (point) { return point.price; }).filter(number);
    if (number(data.price)) values.push(data.price);
    if (number(data.previousClose)) values.push(data.previousClose);
    var min, max;
    if (config.scaleMode === 'fixed') {
      min = config.priceMin; max = config.priceMax;
      if (!number(min) || !number(max) || min < 0 || max <= min) throw new Error('价格范围需满足：0 ≤ 下限 < 上限');
    } else if (config.scaleMode === 'percent') {
      if (!number(data.previousClose) || data.previousClose <= 0) throw new Error('缺少昨收，无法使用百分比比例尺');
      var percent = config.scalePercent === undefined ? 5 : config.scalePercent;
      if (!number(percent) || percent <= 0 || percent > 100) throw new Error('比例尺百分比需大于 0 且不超过 100');
      min = data.previousClose * (1 - percent / 100);
      max = data.previousClose * (1 + percent / 100);
    } else {
      if (!values.length) throw new Error('暂无价格数据');
      min = Math.min.apply(null, values); max = Math.max.apply(null, values);
      var padding = Math.max((max - min) * 0.1, Math.abs(max) * 0.001, 0.0001);
      min = Math.max(0, min - padding); max += padding;
    }
    return { min: min, max: max, clipped: values.some(function (value) { return value < min || value > max; }) };
  }

  // Compress the lunch break, while retaining a full trading-day time axis.
  function tradingOffset(minute, sessions) {
    var offset = 0;
    for (var i = 0; i < sessions.length; i++) {
      var start = sessions[i][0], end = sessions[i][1];
      if (minute <= start) return offset;
      if (minute <= end) return offset + minute - start;
      offset += end - start;
    }
    return offset;
  }

  function chartSvg(data, config, clipId) {
    var scale = getScale(data, config);
    var step = (scale.max - scale.min) / 4;
    var precision = Math.max(2, Math.min(6, Math.ceil(-Math.log(step) / Math.LN10) + 1));
    var sessions = data.sessions || [[570, 960]];
    var total = sessions.reduce(function (sum, session) { return sum + session[1] - session[0]; }, 0);
    var left = 64, right = 578, top = 12, bottom = 192;
    var color = data.change === null || data.change >= 0 ? '#fb7185' : '#34d399';
    var x = function (minute) { return left + tradingOffset(minute, sessions) / total * (right - left); };
    var y = function (value) { return bottom - (value - scale.min) / (scale.max - scale.min) * (bottom - top); };
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 222" preserveAspectRatio="none" role="img" aria-label="股票当日分时走势图">';
    svg += '<defs><clipPath id="' + clipId + '"><rect x="' + left + '" y="' + top + '" width="' + (right - left) + '" height="' + (bottom - top) + '"/></clipPath></defs>';
    for (var i = 0; i <= 4; i++) {
      var value = scale.max - (scale.max - scale.min) * i / 4;
      var tickY = y(value);
      svg += '<line x1="' + left + '" x2="' + right + '" y1="' + tickY + '" y2="' + tickY + '" stroke="currentColor" opacity="0.14"/>';
      svg += '<text x="58" y="' + (tickY + 4) + '" text-anchor="end" fill="currentColor" opacity="0.7" font-size="12">' + value.toFixed(precision) + '</text>';
      if (data.previousClose) {
        var pct = (value / data.previousClose - 1) * 100;
        svg += '<text x="586" y="' + (tickY + 4) + '" fill="currentColor" opacity="0.7" font-size="11">' + (pct > 0 ? '+' : '') + pct.toFixed(1) + '%</text>';
      }
    }
    var ticks = sessions.length === 2
      ? [{ minute: sessions[0][0], label: '09:30' }, { minute: sessions[0][1], label: data.market === 'hk' ? '12:00/13:00' : '11:30/13:00' }, { minute: sessions[1][1], label: data.market === 'hk' ? '16:00' : '15:00' }]
      : [{ minute: 570, label: '09:30' }, { minute: 765, label: '12:45' }, { minute: 960, label: '16:00' }];
    ticks.forEach(function (tick) {
      svg += '<text x="' + x(tick.minute) + '" y="213" text-anchor="middle" fill="currentColor" opacity="0.65" font-size="12">' + escape(tick.label) + '</text>';
    });
    svg += '<g clip-path="url(#' + clipId + ')">';
    if (number(data.previousClose)) svg += '<line x1="' + left + '" x2="' + right + '" y1="' + y(data.previousClose) + '" y2="' + y(data.previousClose) + '" stroke="currentColor" stroke-dasharray="5 5" opacity="0.5"/>';
    var points = (data.points || []).filter(function (point) { return number(point.minute) && number(point.price); });
    if (points.length) {
      var path = points.map(function (point, index) { return (index ? 'L' : 'M') + x(point.minute).toFixed(2) + ',' + y(point.price).toFixed(2); }).join(' ');
      svg += '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2" vector-effect="non-scaling-stroke"/>';
      var last = points[points.length - 1];
      svg += '<circle cx="' + x(last.minute) + '" cy="' + y(last.price) + '" r="3" fill="' + color + '"/>';
    }
    svg += '</g>';
    if (!points.length) svg += '<text x="320" y="104" text-anchor="middle" fill="currentColor" opacity="0.6" font-size="16">暂无当日分时数据</text>';
    return { html: svg + '</svg>', clipped: scale.clipped };
  }

  function cacheKey(config) { return 'signage_stock:' + (config.market || 'auto') + ':' + String(config.symbol || '').trim(); }
  function readCache(key) {
    if (memoryCache[key]) return memoryCache[key];
    try {
      var value = JSON.parse(localStorage.getItem(key));
      return value && number(value.price) && Array.isArray(value.points) ? value : null;
    } catch (_) { return null; }
  }
  function writeCache(key, data) {
    memoryCache[key] = data;
    var keys = Object.keys(memoryCache);
    if (keys.length > 32) delete memoryCache[keys[0]];
    try {
      // Bound persisted quote history independently of the configured scene count.
      var saved = [];
      for (var i = 0; i < localStorage.length; i++) {
        var item = localStorage.key(i);
        if (item.indexOf('signage_stock:') === 0) saved.push(item);
      }
      if (saved.length >= 32 && saved.indexOf(key) === -1) localStorage.removeItem(saved[0]);
      localStorage.setItem(key, JSON.stringify(data));
    } catch (_) { /* Full or disabled storage must not interrupt rendering. */ }
  }

  function mount(element, config, options) {
    options = options || {};
    var disposed = false, timer = null, xhr = null;
    var lastData = readCache(cacheKey(config));
    var clipId = 'stock-clip-' + (++nextId);
    element.classList.add('stock-widget');
    element.style.color = config.color || '#e2e8f0';
    element.style.background = config.backgroundColor || '#101b2e';
    element.innerHTML = '<div class="stock-heading"><span class="stock-name"></span><span class="stock-symbol"></span></div>' +
      '<div class="stock-note"></div>' +
      '<div class="stock-quote"><strong class="stock-price">--</strong><span class="stock-change">--</span><span class="stock-currency"></span></div>' +
      '<div class="stock-details"></div><div class="stock-chart"></div><div class="stock-meta">正在获取行情…</div>';
    var find = function (name) { return element.querySelector('.stock-' + name); };
    find('name').textContent = config.symbol || '未配置股票';
    find('note').style.display = 'none';
    if (!String(config.symbol || '').trim()) {
      find('meta').textContent = '请在画面编辑器中填写股票代码，再点击「应用更改」';
      return function dispose() { disposed = true; };
    }

    function render(data, offline) {
      if (disposed) return;
      // A user note must never disguise the actual security behind a quote.
      find('name').textContent = data.name;
      find('symbol').textContent = data.displaySymbol;
      find('note').textContent = config.title ? '备注：' + config.title : '';
      find('note').style.display = config.title && config.title !== data.name ? 'block' : 'none';
      find('price').textContent = price(data.price);
      var direction = data.change === null ? '' : data.change >= 0 ? '+' : '';
      find('change').textContent = data.change === null ? '--' : direction + price(data.change) + ' (' + direction + data.changePercent.toFixed(2) + '%)';
      var color = data.change === null || data.change === 0 ? '#94a3b8' : data.change > 0 ? '#fb7185' : '#34d399';
      find('price').style.color = color;
      find('change').style.color = color;
      find('currency').textContent = data.currency;
      find('details').textContent = '昨收 ' + price(data.previousClose) + '　今开 ' + price(data.open) + '　最高 ' + price(data.high) + '　最低 ' + price(data.low);
      var warning = '';
      try {
        var chart = chartSvg(data, config, clipId);
        find('chart').innerHTML = chart.html;
        if (chart.clipped) warning = ' · 部分价格超出比例尺';
      } catch (error) {
        find('chart').textContent = error.message;
      }
      find('meta').textContent = (offline === 'loading' ? '缓存行情，正在更新 · ' : offline || data.stale ? '更新失败，显示缓存 · ' : '') + '行情 ' + data.quoteTime + ' (' + data.timeZone + ') · ' + data.source + ' · 可能延迟' + warning;
      find('meta').classList.toggle('stock-stale', offline === true || !!data.stale);
    }

    function refresh() {
      if (disposed) return;
      xhr = new XMLHttpRequest();
      xhr.open('GET', (options.endpoint || '/api/v1/stocks') + '?symbol=' + encodeURIComponent(config.symbol || '') + '&market=' + encodeURIComponent(config.market || 'auto'), true);
      xhr.timeout = 15000;
      var settled = false;
      function complete(data) {
        if (settled || disposed) return;
        settled = true;
        if (data && number(data.price) && Array.isArray(data.points)) {
          lastData = data;
          writeCache(cacheKey(config), data);
          render(data, false);
        } else if (lastData) {
          render(lastData, true);
        } else {
          find('meta').textContent = '行情暂不可用，请检查股票代码或稍后重试';
        }
        timer = setTimeout(refresh, Math.max(30, Math.min(3600, Number(config.refreshInterval) || 60)) * 1000);
      }
      xhr.onload = function () {
        var data = null;
        try { if (xhr.status === 200) data = JSON.parse(xhr.responseText).data; } catch (_) {}
        complete(data);
      };
      xhr.onerror = xhr.ontimeout = function () { complete(null); };
      xhr.send();
    }

    if (lastData) render(lastData, 'loading');
    refresh();
    return function dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (xhr) xhr.abort();
    };
  }

  return { mount: mount, getScale: getScale, tradingOffset: tradingOffset, chartSvg: chartSvg };
});
