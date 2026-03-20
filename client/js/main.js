// HomeSignage Display Client
// Vanilla JS — compatible with iOS Safari 13+

/* ─────────────────────────────────────────────
   CONFIGURATION
───────────────────────────────────────────── */
var CONFIG = {
  SERVER_URL: window.location.origin,
  HEARTBEAT_INTERVAL: 30000,       // 30 s
  CONFIG_POLL_INTERVAL: 5 * 60 * 1000, // 5 min
  TRANSITION_DURATION: 1000,       // 1 s (must match CSS transition)
  DEFAULT_SCENE_DURATION: 15000,   // 15 s
};

/* ─────────────────────────────────────────────
   STATE
───────────────────────────────────────────── */
var state = 'INIT'; // INIT | LOADING | NORMAL | TIMED_REMINDER | EMERGENCY | OFFLINE

var deviceId  = null;
var deviceKey = null;
var currentConfig  = null;
var carouselTimer  = null;
var currentSceneIndex = 0;
var sceneLayers    = [];
var socket         = null;
var heartbeatTimer = null;
var pollTimer      = null;
var clockIntervals = [];
var infoListIntervals = [];
var infoListFetchers  = [];   // fetchAndRender functions for active info-list components

// Active emergency tracking
var activeEmergency = null; // { id, audio }

// Active reminder tracking — pool + per-position rotators
var reminderPool    = {};  // reminderId → { id, posClass, text, bgColor, textColor, fontSize, blink, audio }
var posRotators     = {};  // posClass   → { timerId }
var REMIND_SHOW_MS  = 4000;
var REMIND_FADE_MS  = 500;

// Audio unlock tracking
var audioUnlocked = false;

/* ─────────────────────────────────────────────
   BOOTSTRAP
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);

function init() {
  log('init', 'Client initialising');

  // Prefer URL params so a fresh link always works
  var params = new URLSearchParams(window.location.search);
  var urlDeviceId  = params.get('deviceId');
  var urlDeviceKey = params.get('deviceKey');

  deviceId  = urlDeviceId  || localStorage.getItem('deviceId');
  deviceKey = urlDeviceKey || localStorage.getItem('deviceKey');

  // Persist whatever we found to localStorage
  if (deviceId)  localStorage.setItem('deviceId',  deviceId);
  if (deviceKey) localStorage.setItem('deviceKey', deviceKey);

  // Attach a one-time touch/click to unlock audio on iOS
  document.addEventListener('touchstart', unlockAudio, { once: true });
  document.addEventListener('click',      unlockAudio, { once: true });

  if (!deviceId || !deviceKey) {
    showRegistrationPage();
    return;
  }

  startSignage();
}

/* ─────────────────────────────────────────────
   STATE MANAGEMENT
───────────────────────────────────────────── */
function setState(newState) {
  log('state', state + ' -> ' + newState);
  state = newState;
}

/* ─────────────────────────────────────────────
   REGISTRATION PAGE
───────────────────────────────────────────── */
function showRegistrationPage() {
  var app = document.getElementById('app');
  app.innerHTML =
    '<div id="registration-page">' +
      '<h1 style="font-size:2em;margin-bottom:20px;">HomeSignage</h1>' +
      '<p style="margin-bottom:20px;color:#aaa;">为此设备命名以完成注册</p>' +
      '<input type="text" id="device-name" placeholder="例如：客厅iPad" />' +
      '<button onclick="registerDevice()">注册设备</button>' +
      '<p id="reg-error" style="color:#ff4444;display:none;"></p>' +
    '</div>';

  // Allow Enter key to submit
  setTimeout(function () {
    var input = document.getElementById('device-name');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) registerDevice();
      });
    }
  }, 0);
}

function registerDevice() {
  var nameEl = document.getElementById('device-name');
  var errEl  = document.getElementById('reg-error');
  var name   = nameEl ? nameEl.value.trim() : '';

  if (!name) {
    showRegError('请输入设备名称');
    return;
  }

  var browserInfo = navigator.userAgent;

  var xhr = new XMLHttpRequest();
  xhr.open('POST', CONFIG.SERVER_URL + '/api/v1/devices', true);
  // Registration uses the admin JWT — but devices self-register via the
  // admin-protected endpoint only when accessed from the admin UI.
  // For kiosk self-registration the server must be configured to allow it,
  // or the admin creates the device and shares the URL with deviceId+deviceKey.
  // Here we try an unauthenticated POST and surface any server error.
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onload = function () {
    if (xhr.status === 201) {
      var resp = safeParseJSON(xhr.responseText);
      if (resp && resp.data) {
        var dev = resp.data;
        deviceId  = dev.id;
        deviceKey = dev.device_key;
        localStorage.setItem('deviceId',  deviceId);
        localStorage.setItem('deviceKey', deviceKey);
        log('register', 'Device registered: ' + deviceId);
        window.location.reload();
      } else {
        showRegError('注册响应格式异常');
      }
    } else {
      var body = safeParseJSON(xhr.responseText);
      var msg  = (body && body.error) ? body.error : ('HTTP ' + xhr.status);
      showRegError('注册失败：' + msg);
    }
  };
  xhr.onerror = function () {
    showRegError('无法连接到服务器，请检查网络');
  };
  xhr.send(JSON.stringify({ name: name, browserInfo: browserInfo }));
}

function showRegError(msg) {
  var el = document.getElementById('reg-error');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
}

/* ─────────────────────────────────────────────
   SIGNAGE START
───────────────────────────────────────────── */
function startSignage() {
  setState('LOADING');
  showLoadingScreen();

  fetchAndApplyConfig()
    .then(function () {
      connectWebSocket();
      startHeartbeat();
      startConfigPolling();
      setState('NORMAL');
      startCarousel();
    })
    .catch(function (err) {
      log('error', 'Config fetch failed: ' + err.message);
      var cached = loadCachedConfig();
      if (cached) {
        applyConfig(cached);
        setState('OFFLINE');
        updateOnlineStatus(false);
        startCarousel();
        // Still try to connect WebSocket in case network recovers
        connectWebSocket();
      } else {
        showError('无法连接到服务器，且无缓存内容');
      }
    });
}

function showLoadingScreen() {
  var app = document.getElementById('app');
  // Only inject loading screen if app is currently empty / not yet built
  if (app && sceneLayers.length === 0) {
    app.innerHTML =
      '<div style="display:flex;justify-content:center;align-items:center;height:100%;color:#555;font-size:1.2em;">' +
        '正在加载...' +
      '</div>';
  }
}

function showError(msg) {
  var app = document.getElementById('app');
  if (app) {
    app.innerHTML =
      '<div style="display:flex;justify-content:center;align-items:center;height:100%;flex-direction:column;gap:16px;">' +
        '<p style="color:#ff4444;font-size:1.2em;">' + escapeHtml(msg) + '</p>' +
        '<button onclick="window.location.reload()" ' +
          'style="padding:10px 24px;background:#333;color:#fff;border:1px solid #555;border-radius:6px;cursor:pointer;">' +
          '重试' +
        '</button>' +
      '</div>';
  }
}

/* ─────────────────────────────────────────────
   CONFIG FETCH & APPLY
───────────────────────────────────────────── */
function fetchAndApplyConfig() {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', CONFIG.SERVER_URL + '/api/v1/devices/' + deviceId + '/config', true);
    xhr.setRequestHeader('X-Device-Key', deviceKey);
    xhr.timeout = 15000;
    xhr.onload = function () {
      if (xhr.status === 200) {
        var resp = safeParseJSON(xhr.responseText);
        if (resp && resp.data) {
          applyConfig(resp.data);
          resolve();
        } else {
          reject(new Error('Invalid config response'));
        }
      } else if (xhr.status === 401) {
        // Bad device key — clear credentials
        localStorage.removeItem('deviceId');
        localStorage.removeItem('deviceKey');
        reject(new Error('Unauthorized — credentials cleared'));
      } else {
        reject(new Error('HTTP ' + xhr.status));
      }
    };
    xhr.onerror   = function () { reject(new Error('Network error')); };
    xhr.ontimeout = function () { reject(new Error('Request timeout')); };
    xhr.send();
  });
}

function applyConfig(config) {
  currentConfig = config;
  cacheConfig(config);

  // Clear clock and info-list intervals from old scene layers
  clearClockIntervals();
  clearInfoListIntervals();
  infoListFetchers = [];

  // Remove existing scene layers from DOM
  var app = document.getElementById('app');
  app.innerHTML = '';
  sceneLayers = [];
  currentSceneIndex = 0;

  var scenes = (config.scenes && config.scenes.length > 0) ? config.scenes : [];

  // Build scene layers
  for (var i = 0; i < scenes.length; i++) {
    var layer = buildSceneLayer(scenes[i], i);
    app.appendChild(layer);
    sceneLayers.push(layer);
  }

  // Show placeholder if no scenes configured
  if (sceneLayers.length === 0) {
    var placeholder = document.createElement('div');
    placeholder.className = 'scene-layer active';
    placeholder.style.display = 'flex';
    placeholder.style.justifyContent = 'center';
    placeholder.style.alignItems = 'center';
    placeholder.style.color = '#444';
    placeholder.style.fontSize = '1.2em';
    placeholder.textContent = '暂无配置内容';
    app.appendChild(placeholder);
    sceneLayers.push(placeholder);
  }

  // Handle any active emergency alerts returned in config
  var alerts = config.emergency_alerts;
  if (alerts && alerts.length > 0) {
    // Show the most recent active alert
    showEmergency(alerts[0]);
  }
}

/* ─────────────────────────────────────────────
   SCENE LAYER BUILDER
───────────────────────────────────────────── */
function buildSceneLayer(sceneData, index) {
  var layer = document.createElement('div');
  layer.className = 'scene-layer';
  layer.dataset.sceneIndex = index;

  var scene      = sceneData.scene      || {};
  var components = sceneData.components || [];

  // Scene background colour from scene config if set
  // (scenes don't currently carry a bg colour but leave hook for future)
  layer.style.background = '#111';

  for (var i = 0; i < components.length; i++) {
    var el = renderComponent(components[i]);
    if (el) layer.appendChild(el);
  }

  return layer;
}

/* ─────────────────────────────────────────────
   COMPONENT RENDERER
   Component schema from DB:
     { id, scene_id, type, position, config, style, sort_order }
   position: { x, y, width, height } — values are percentages (0-100)
   config:   type-specific config object
   style:    CSS overrides { color, fontSize, fontWeight, … }
───────────────────────────────────────────── */
function renderComponent(component) {
  var pos    = component.position || {};
  var cfg    = component.config   || {};
  var sty    = component.style    || {};
  var type   = component.type;

  var el = document.createElement('div');
  el.className = 'component ' + type + '-component';
  el.dataset.componentId = component.id;

  // Position (percentage-based layout)
  applyPosition(el, pos);

  // Apply style overrides
  applyStyle(el, sty);

  switch (type) {
    case 'clock':
      renderClock(el, cfg, sty);
      break;

    case 'weather':
      renderWeather(el, cfg, sty);
      break;

    case 'text':
      renderText(el, cfg, sty);
      break;

    case 'image':
      renderImage(el, cfg);
      break;

    case 'iframe':
      renderIframe(el, cfg);
      break;

    case 'info-list':
      renderInfoList(el, cfg);
      break;

    default:
      el.style.display = 'none';
      log('warn', 'Unknown component type: ' + type);
      break;
  }

  return el;
}

function applyPosition(el, pos) {
  el.style.position = 'absolute';
  // Support both percentage and pixel values
  // If the value looks like a number without '%', treat as percentage
  el.style.left   = formatDimension(pos.x      !== undefined ? pos.x      : 0);
  el.style.top    = formatDimension(pos.y      !== undefined ? pos.y      : 0);
  el.style.width  = formatDimension(pos.width  !== undefined ? pos.width  : 100);
  el.style.height = formatDimension(pos.height !== undefined ? pos.height : 100);
}

function formatDimension(val) {
  if (typeof val === 'string' && (val.indexOf('%') !== -1 || val.indexOf('px') !== -1)) {
    return val;
  }
  var n = parseFloat(val);
  if (isNaN(n)) return '0%';
  // Values > 1 are assumed to already be percentages
  return n + '%';
}

function applyStyle(el, sty) {
  if (!sty) return;
  var allowed = [
    'color', 'backgroundColor', 'fontSize', 'fontWeight', 'fontFamily',
    'textAlign', 'lineHeight', 'letterSpacing', 'borderRadius',
    'padding', 'margin', 'opacity', 'overflow',
  ];
  for (var i = 0; i < allowed.length; i++) {
    var k = allowed[i];
    if (sty[k] !== undefined) {
      el.style[k] = sty[k];
    }
  }
}

/* ── Clock ── */
function renderClock(el, cfg, sty) {
  var use24h     = cfg.format24h !== false; // default 24 h
  var showDate   = cfg.showDate  !== false;
  var timezone   = cfg.timezone  || null;   // e.g. 'Asia/Shanghai'

  var timeEl = document.createElement('div');
  timeEl.className = 'clock-time';
  timeEl.style.fontSize    = (sty && sty.fontSize)    ? sty.fontSize    : '4em';
  timeEl.style.fontWeight  = (sty && sty.fontWeight)  ? sty.fontWeight  : 'bold';
  timeEl.style.letterSpacing = '0.05em';
  timeEl.style.fontVariantNumeric = 'tabular-nums';

  var dateEl = document.createElement('div');
  dateEl.className = 'clock-date';
  dateEl.style.fontSize   = '1em';
  dateEl.style.marginTop  = '8px';
  dateEl.style.color      = (sty && sty.color) ? sty.color : '#ccc';
  if (!showDate) dateEl.style.display = 'none';

  el.appendChild(timeEl);
  el.appendChild(dateEl);

  function tick() {
    var now = timezone ? getTimeInZone(timezone) : new Date();
    timeEl.textContent = formatTime(now, use24h);
    if (showDate) {
      dateEl.textContent = formatDate(now);
    }
  }

  tick();
  var interval = setInterval(tick, 1000);
  clockIntervals.push(interval);
}

function getTimeInZone(tz) {
  try {
    // Build a Date whose local-time fields reflect the requested timezone
    var str = new Date().toLocaleString('en-US', { timeZone: tz });
    return new Date(str);
  } catch (e) {
    return new Date();
  }
}

function formatTime(date, use24h) {
  var h = date.getHours();
  var m = date.getMinutes();
  var s = date.getSeconds();
  var suffix = '';
  if (!use24h) {
    suffix = h >= 12 ? ' PM' : ' AM';
    h = h % 12;
    if (h === 0) h = 12;
  }
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s) + suffix;
}

function formatDate(date) {
  var days  = ['日', '一', '二', '三', '四', '五', '六'];
  var y = date.getFullYear();
  var m = date.getMonth() + 1;
  var d = date.getDate();
  var w = days[date.getDay()];
  return y + '年' + m + '月' + d + '日 星期' + w;
}

/* ── Weather ── */
function weatherCodeToEmoji(code) {
  code = parseInt(code, 10);
  if (code === 113) return '\u2600\ufe0f';           // ☀️ 晴
  if (code === 116) return '\u26c5';                 // ⛅ 局部多云
  if (code === 119 || code === 122) return '\u2601\ufe0f'; // ☁️ 多云
  if (code >= 143 && code <= 260) return '\ud83c\udf2b\ufe0f'; // 🌫️ 雾
  if (code >= 263 && code <= 299) return '\ud83c\udf26\ufe0f'; // 🌦️ 小雨
  if (code >= 302 && code <= 374) return '\ud83c\udf27\ufe0f'; // 🌧️ 雨
  if (code >= 377 && code <= 395) return '\u2744\ufe0f';       // ❄️ 雪
  if (code === 200 || code === 386 || code === 389 || code === 392 || code === 395) return '\u26c8\ufe0f'; // ⛈️ 雷雨
  return '\ud83c\udf24\ufe0f'; // 🌤️ 默认
}

function fetchWeatherData(city, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', CONFIG.SERVER_URL + '/api/v1/weather?city=' + encodeURIComponent(city), true);
  xhr.timeout = 10000;
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    if (xhr.status !== 200) { callback(null); return; }
    try {
      var resp = JSON.parse(xhr.responseText);
      var d = resp.data;
      callback({
        tempC:       d.tempC,
        tempF:       d.tempF,
        icon:        weatherCodeToEmoji(d.weatherCode),
        description: d.description,
        humidity:    d.humidity,
        wind:        d.windKmph + ' km/h',
        city:        d.city
      });
    } catch (e) {
      log('warn', 'Weather parse error: ' + e.message);
      callback(null);
    }
  };
  xhr.onerror = function() { callback(null); };
  xhr.send();
}

function renderWeather(el, cfg, sty) {
  var city = cfg.city || 'Beijing';
  var unit = cfg.unit || 'C';

  var iconEl = document.createElement('div');
  iconEl.style.fontSize   = '3em';
  iconEl.style.lineHeight = '1.2';
  iconEl.textContent      = '\u26c5'; // ⛅ 初始占位

  var tempEl = document.createElement('div');
  tempEl.style.fontSize   = (sty && sty.fontSize) ? sty.fontSize : '3.5em';
  tempEl.style.fontWeight = 'bold';
  tempEl.style.marginTop  = '4px';
  tempEl.textContent      = '--\u00b0' + unit;

  var descEl = document.createElement('div');
  descEl.style.fontSize  = '1em';
  descEl.style.marginTop = '4px';
  descEl.style.color     = (sty && sty.color) ? sty.color : '#ccc';
  descEl.textContent     = '--';

  var cityEl = document.createElement('div');
  cityEl.style.fontSize  = '0.9em';
  cityEl.style.marginTop = '2px';
  cityEl.style.color     = '#aaa';
  cityEl.textContent     = city;

  var metaEl = document.createElement('div');
  metaEl.style.fontSize  = '0.8em';
  metaEl.style.marginTop = '6px';
  metaEl.style.color     = '#888';

  el.appendChild(iconEl);
  el.appendChild(tempEl);
  el.appendChild(descEl);
  el.appendChild(cityEl);
  el.appendChild(metaEl);

  function applyData(data) {
    if (!data) return;
    iconEl.textContent = data.icon;
    tempEl.textContent = (unit === 'F' ? data.tempF : data.tempC) + '\u00b0' + unit;
    descEl.textContent = data.description;
    cityEl.textContent = data.city || city;
    metaEl.textContent = '\u6e7f\u5ea6 ' + data.humidity + '%  \u98ce\u901f ' + data.wind;
  }

  fetchWeatherData(city, applyData);

  // Refresh every 30 minutes
  var timer = setInterval(function() { fetchWeatherData(city, applyData); }, 30 * 60 * 1000);
  clockIntervals.push(timer);
}

/* ── Text ── */
function renderText(el, cfg, sty) {
  var content  = cfg.content  || cfg.text || '';
  var fontSize = (sty && sty.fontSize) ? sty.fontSize : '1.2em';

  el.style.fontSize   = fontSize;
  el.style.lineHeight = (sty && sty.lineHeight) ? sty.lineHeight : '1.6';
  el.style.padding    = (sty && sty.padding)    ? sty.padding    : '8px';
  el.style.overflowY  = 'auto';
  el.style.wordBreak  = 'break-word';

  // Allow basic HTML in content (the admin controls input so this is safe)
  el.innerHTML = content;
}

/* ── Image ── */
function renderImage(el, cfg) {
  var url = cfg.url || cfg.src || '';
  el.style.overflow = 'hidden';

  var img = document.createElement('img');
  img.src = url;
  img.alt = '';
  img.style.width     = '100%';
  img.style.height    = '100%';
  img.style.objectFit = cfg.objectFit || 'cover';
  img.loading = 'lazy';

  // If loading fails, show a subtle placeholder
  img.onerror = function () {
    el.style.background = '#222';
    img.style.display = 'none';
    var ph = document.createElement('div');
    ph.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#555;font-size:0.9em;';
    ph.textContent = '图片加载失败';
    el.appendChild(ph);
  };

  el.appendChild(img);
}

/* ── Iframe ── */
function renderIframe(el, cfg) {
  var src = cfg.url || cfg.src || '';
  el.style.overflow = 'hidden';

  var iframe = document.createElement('iframe');
  iframe.src             = src;
  iframe.style.width     = '100%';
  iframe.style.height    = '100%';
  iframe.style.border    = 'none';
  iframe.scrolling       = 'no';
  iframe.setAttribute('allowfullscreen', '');
  // sandbox allows scripts and same-origin; tighten as needed
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');

  el.appendChild(iframe);
}

/* ─────────────────────────────────────────────
   CAROUSEL
───────────────────────────────────────────── */
function startCarousel() {
  stopCarousel();

  if (sceneLayers.length === 0) return;

  // Immediately show first scene
  showScene(0);

  if (sceneLayers.length === 1) {
    // Only one scene — nothing to rotate
    return;
  }

  scheduleNextScene();
}

function scheduleNextScene() {
  // Duration comes from the current scene's deviceSceneConfig
  var scenes   = (currentConfig && currentConfig.scenes) ? currentConfig.scenes : [];
  var sceneData = scenes[currentSceneIndex];
  var duration  = CONFIG.DEFAULT_SCENE_DURATION;

  if (sceneData && sceneData.deviceSceneConfig && sceneData.deviceSceneConfig.duration) {
    duration = sceneData.deviceSceneConfig.duration * 1000; // stored as seconds
  }

  // Ensure minimum of 3 s to prevent thrashing
  if (duration < 3000) duration = 3000;

  carouselTimer = setTimeout(function () {
    if (state === 'EMERGENCY') {
      // Do not advance carousel during emergency; will restart after clear
      return;
    }
    var next = (currentSceneIndex + 1) % sceneLayers.length;
    transitionToScene(next);
  }, duration);
}

function transitionToScene(index) {
  var current = sceneLayers[currentSceneIndex];
  var next    = sceneLayers[index];

  if (!current || !next) return;

  // Fade in next (on top while both visible)
  next.style.zIndex = '2';
  requestAnimationFrame(function () {
    next.classList.add('active');
  });

  // After transition completes, hide current
  setTimeout(function () {
    current.classList.remove('active');
    current.style.zIndex = '';
    next.style.zIndex    = '';
    currentSceneIndex = index;
    // Schedule the following transition
    if (state !== 'EMERGENCY') {
      scheduleNextScene();
    }
  }, CONFIG.TRANSITION_DURATION + 50); // slight buffer
}

function showScene(index) {
  // Hide all layers, show only the target
  for (var i = 0; i < sceneLayers.length; i++) {
    sceneLayers[i].classList.remove('active');
    sceneLayers[i].style.zIndex = '';
  }
  if (sceneLayers[index]) {
    sceneLayers[index].classList.add('active');
    currentSceneIndex = index;
  }
}

function stopCarousel() {
  if (carouselTimer) {
    clearTimeout(carouselTimer);
    carouselTimer = null;
  }
}

/* ─────────────────────────────────────────────
   FORCE SCENE (from socket event)
───────────────────────────────────────────── */
function forceShowScene(sceneId) {
  var scenes = (currentConfig && currentConfig.scenes) ? currentConfig.scenes : [];
  for (var i = 0; i < scenes.length; i++) {
    if (scenes[i].scene && scenes[i].scene.id === sceneId) {
      stopCarousel();
      transitionToScene(i);
      // Resume carousel after showing forced scene
      var sceneData = scenes[i];
      var duration  = (sceneData.deviceSceneConfig && sceneData.deviceSceneConfig.duration)
        ? sceneData.deviceSceneConfig.duration * 1000
        : CONFIG.DEFAULT_SCENE_DURATION;
      carouselTimer = setTimeout(function () {
        var next = (i + 1) % sceneLayers.length;
        transitionToScene(next);
      }, duration);
      return;
    }
  }
  log('warn', 'force-scene: sceneId not found: ' + sceneId);
}

/* ─────────────────────────────────────────────
   WEBSOCKET
───────────────────────────────────────────── */
function connectWebSocket() {
  if (typeof io === 'undefined') {
    log('warn', 'Socket.IO not loaded — skipping WebSocket connection');
    return;
  }

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  socket = io(CONFIG.SERVER_URL, {
    query: {
      deviceId:   deviceId,
      device_key: deviceKey,
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', function () {
    log('socket', 'Connected — socket id: ' + socket.id);
    updateOnlineStatus(true);
    if (state === 'OFFLINE') {
      // Re-fetch fresh config now that we're back online
      fetchAndApplyConfig()
        .then(function () {
          setState('NORMAL');
          startCarousel();
        })
        .catch(function (e) {
          log('warn', 'Re-fetch on reconnect failed: ' + e.message);
        });
    }
  });

  socket.on('connected', function (data) {
    log('socket', 'Auth confirmed for device: ' + data.deviceId);
  });

  socket.on('disconnect', function (reason) {
    log('socket', 'Disconnected: ' + reason);
    if (state !== 'EMERGENCY') {
      updateOnlineStatus(false);
      if (state === 'NORMAL' || state === 'TIMED_REMINDER') {
        setState('OFFLINE');
      }
    }
  });

  socket.on('reconnect', function (attempt) {
    log('socket', 'Reconnected after ' + attempt + ' attempts');
    updateOnlineStatus(true);
  });

  socket.on('info-items-updated', function () {
    log('socket', 'info-items-updated received');
    for (var i = 0; i < infoListFetchers.length; i++) {
      infoListFetchers[i]();
    }
  });

  socket.on('config-updated', function (data) {
    log('socket', 'config-updated received');
    fetchAndApplyConfig()
      .then(function () {
        // Restart carousel with new config
        startCarousel();
      })
      .catch(function (e) {
        log('warn', 'Failed to fetch updated config: ' + e.message);
      });
  });

  socket.on('timed-reminder-start', function (data) {
    log('socket', 'timed-reminder-start: ' + data.reminderId);
    showTimedReminder(data);
  });

  socket.on('timed-reminder-end', function (data) {
    log('socket', 'timed-reminder-end: ' + data.reminderId);
    hideTimedReminder(data.reminderId);
  });

  socket.on('emergency-alert', function (data) {
    log('socket', 'emergency-alert: ' + (data.id || data.alertId));
    showEmergency(data);
  });

  socket.on('emergency-clear', function (data) {
    log('socket', 'emergency-clear: ' + data.alertId);
    hideEmergency(data.alertId);
  });

  socket.on('force-scene', function (data) {
    log('socket', 'force-scene: ' + data.sceneId);
    forceShowScene(data.sceneId);
  });

  socket.on('force-refresh', function () {
    log('socket', 'force-refresh received — reloading page');
    window.location.reload();
  });

  socket.on('error', function (err) {
    log('error', 'Socket error: ' + (err && err.message ? err.message : JSON.stringify(err)));
  });
}

/* ─────────────────────────────────────────────
   TIMED REMINDER
   reminder payload from socket:
     { reminderId, content, sound, start_time, end_time }
   content is an object: { text, style, color, backgroundColor, fontSize }
   Multiple reminders at the same position rotate with fade transitions.
───────────────────────────────────────────── */

function _reminderPosClass(style) {
  if (style === 'bar-bottom') return 'reminder-bar-bottom';
  if (style === 'center')     return 'reminder-center';
  return 'reminder-bar-top'; // bar-top, blink, highlight
}

function _reminderOverlayId(posClass) {
  if (posClass === 'reminder-bar-bottom') return 'reminder-overlay-bottom';
  if (posClass === 'reminder-center')     return 'reminder-overlay-center';
  return 'reminder-overlay-top';
}

function _getPositionReminders(posClass) {
  return Object.keys(reminderPool).map(function(k) { return reminderPool[k]; })
    .filter(function(r) { return r.posClass === posClass; });
}

function _renderInOverlay(posClass, item, fadeIn) {
  var el = document.getElementById(_reminderOverlayId(posClass));
  if (!el) return;
  var inner = el.querySelector('.reminder-content');
  if (!inner) {
    inner = document.createElement('div');
    el.appendChild(inner);
  }
  inner.className = 'reminder-content' + (item.blink ? ' blink' : '');
  inner.style.backgroundColor = item.bgColor;
  inner.style.color            = item.textColor;
  inner.style.fontSize         = item.fontSize;
  inner.textContent            = item.text;
  el.style.display = (posClass === 'reminder-center') ? 'flex' : 'block';
  if (fadeIn) {
    inner.style.opacity = '0';
    // double rAF ensures the transition fires after the display/content change
    requestAnimationFrame(function() {
      requestAnimationFrame(function() { inner.style.opacity = '1'; });
    });
  } else {
    inner.style.opacity = '1';
  }
}

function _fadeOutOverlay(posClass, cb) {
  var el = document.getElementById(_reminderOverlayId(posClass));
  if (!el) { if (cb) cb(); return; }
  var inner = el.querySelector('.reminder-content');
  if (!inner) { if (cb) cb(); return; }
  inner.style.opacity = '0';
  setTimeout(cb || function() {}, REMIND_FADE_MS);
}

function _startPosRotator(posClass) {
  if (posRotators[posClass]) {
    clearInterval(posRotators[posClass].timerId);
  }
  var currentIdx = 0;

  function showNext() {
    var items = _getPositionReminders(posClass);
    if (items.length === 0) { _stopPosRotator(posClass); return; }
    currentIdx = currentIdx % items.length;
    var item = items[currentIdx];
    currentIdx = (currentIdx + 1) % items.length;
    if (items.length > 1) {
      _fadeOutOverlay(posClass, function() { _renderInOverlay(posClass, item, true); });
    } else {
      _renderInOverlay(posClass, item, false);
    }
  }

  showNext();
  posRotators[posClass] = { timerId: setInterval(showNext, REMIND_SHOW_MS) };
}

function _stopPosRotator(posClass) {
  if (posRotators[posClass]) {
    clearInterval(posRotators[posClass].timerId);
    delete posRotators[posClass];
  }
  _fadeOutOverlay(posClass, function() {
    var el = document.getElementById(_reminderOverlayId(posClass));
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  });
}

function showTimedReminder(reminder) {
  var reminderId = reminder.reminderId || reminder.id;
  var content    = reminder.content || {};
  if (typeof content === 'string') content = safeParseJSON(content) || {};

  var style     = content.style || 'bar-bottom';
  var posClass  = _reminderPosClass(style);
  var fontSize  = content.fontSize || '1.4em';
  if (typeof fontSize === 'number') fontSize = fontSize + 'px';

  var audio = null;
  var soundUrl = reminder.sound || content.sound || null;
  if (soundUrl) {
    if (reminderPool[reminderId] && reminderPool[reminderId].audio) {
      stopAudio(reminderPool[reminderId].audio);
    }
    audio = playAudio(soundUrl, false);
  }

  reminderPool[reminderId] = {
    id:        reminderId,
    posClass:  posClass,
    text:      content.text || content.message || '',
    bgColor:   content.backgroundColor || content.bgColor || 'rgba(255,136,0,0.92)',
    textColor: content.color || content.textColor || '#fff',
    fontSize:  fontSize,
    blink:     (style === 'blink'),
    audio:     audio
  };

  if (!posRotators[posClass]) {
    _startPosRotator(posClass);
  }
  // else: new item joins the pool and will appear on the next rotation cycle

  if (state !== 'EMERGENCY') setState('TIMED_REMINDER');
}

function hideTimedReminder(reminderId) {
  var data = reminderPool[reminderId];
  if (!data) return;

  if (data.audio) stopAudio(data.audio);
  var posClass = data.posClass;
  delete reminderPool[reminderId];

  if (_getPositionReminders(posClass).length === 0) {
    _stopPosRotator(posClass);
  }

  var anyLeft = Object.keys(reminderPool).length > 0;
  if (!anyLeft && state === 'TIMED_REMINDER') setState('NORMAL');
}

/* ─────────────────────────────────────────────
   EMERGENCY ALERT
   alert payload from socket / config:
     { id, content, sound, status }
   content: { text } or a plain string
───────────────────────────────────────────── */
function showEmergency(alert) {
  var alertId = alert.id || alert.alertId;
  var content = alert.content || {};

  if (typeof content === 'string') {
    content = safeParseJSON(content) || { text: content };
  }

  var text      = content.text || content.message || JSON.stringify(content);
  var bgColor   = content.backgroundColor || content.bgColor || '#FF0000';
  var textColor = content.textColor || content.color || '#FFFFFF';
  var soundObj  = (alert.sound && typeof alert.sound === 'object') ? alert.sound : null;
  var soundUrl  = (soundObj && soundObj.file) || (typeof alert.sound === 'string' ? alert.sound : null) || null;
  var soundLoop = soundObj ? (soundObj.loop !== false) : true;

  // Stop all active reminder audio
  Object.keys(reminderPool).forEach(function(k) {
    if (reminderPool[k].audio) stopAudio(reminderPool[k].audio);
  });

  // Stop previous emergency audio if any
  if (activeEmergency && activeEmergency.audio) {
    stopAudio(activeEmergency.audio);
  }

  var overlay   = document.getElementById('emergency-overlay');
  var textEl    = document.getElementById('emergency-text');

  overlay.style.background = bgColor;
  textEl.style.color = textColor;
  textEl.textContent = text;
  overlay.classList.add('active');

  // Loop emergency audio
  var audio = soundUrl ? playAudio(soundUrl, soundLoop) : null;
  activeEmergency = { id: alertId, audio: audio };

  // Stop carousel
  stopCarousel();

  setState('EMERGENCY');
}

function hideEmergency(alertId) {
  // If alertId provided, only clear if it matches
  if (alertId && activeEmergency && activeEmergency.id !== alertId) {
    log('warn', 'hideEmergency: id mismatch, ignoring: ' + alertId);
    return;
  }

  var overlay = document.getElementById('emergency-overlay');
  overlay.classList.remove('active');

  if (activeEmergency && activeEmergency.audio) {
    stopAudio(activeEmergency.audio);
  }
  activeEmergency = null;

  setState('NORMAL');

  // Resume carousel
  startCarousel();
}

// Called by the confirm button in the HTML
function handleEmergencyConfirm() {
  // Client-side local confirmation only — server is not notified here.
  // The server can independently clear the alert via the admin UI / API.
  hideEmergency(activeEmergency ? activeEmergency.id : null);
}

/* ─────────────────────────────────────────────
   AUDIO
───────────────────────────────────────────── */
function unlockAudio() {
  if (audioUnlocked) return;
  try {
    // Create and immediately suspend a tiny AudioContext to satisfy iOS
    var AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      var ctx = new AudioContext();
      ctx.resume().then(function () {
        ctx.close();
        audioUnlocked = true;
        log('audio', 'AudioContext unlocked');
      }).catch(function () {
        audioUnlocked = true;
      });
    } else {
      audioUnlocked = true;
    }
  } catch (e) {
    audioUnlocked = true;
  }
}

/**
 * Play an audio file by URL.
 * Returns the HTMLAudioElement for later control.
 * @param {string} url  - Absolute or relative URL of the audio file
 * @param {boolean} loop - Whether to loop the audio
 * @returns {HTMLAudioElement|null}
 */
function playAudio(url, loop) {
  if (!url) return null;
  try {
    var audio = new Audio(url);
    audio.loop = !!loop;
    audio.volume = 1.0;
    // On iOS, play() returns a Promise; suppress unhandled rejections
    var p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(function (err) {
        log('audio', 'playAudio failed (autoplay policy?): ' + err.message);
      });
    }
    return audio;
  } catch (e) {
    log('error', 'playAudio exception: ' + e.message);
    return null;
  }
}

/**
 * Stop and release an audio element.
 * @param {HTMLAudioElement} audio
 */
function stopAudio(audio) {
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.src = '';
  } catch (e) {
    // Swallow — element may already be garbage collected
  }
}

/* ─────────────────────────────────────────────
   HEARTBEAT
───────────────────────────────────────────── */
function startHeartbeat() {
  stopHeartbeat();
  sendHeartbeat(); // immediate first beat
  heartbeatTimer = setInterval(sendHeartbeat, CONFIG.HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function sendHeartbeat() {
  var xhr = new XMLHttpRequest();
  xhr.open('POST', CONFIG.SERVER_URL + '/api/v1/devices/' + deviceId + '/heartbeat', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.timeout = 10000;
  xhr.onload = function () {
    if (xhr.status === 200) {
      var resp = safeParseJSON(xhr.responseText);
      updateOnlineStatus(true);

      // Check emergency alerts returned in heartbeat
      if (resp && resp.data && resp.data.emergency_alerts) {
        var alerts = resp.data.emergency_alerts;
        if (alerts.length > 0 && state !== 'EMERGENCY') {
          showEmergency(alerts[0]);
        } else if (alerts.length === 0 && state === 'EMERGENCY') {
          // Server has cleared the alert
          hideEmergency(null);
        }
      }
    } else {
      log('warn', 'Heartbeat non-200: ' + xhr.status);
    }
  };
  xhr.onerror = function () {
    log('warn', 'Heartbeat network error');
    updateOnlineStatus(false);
  };
  xhr.ontimeout = function () {
    log('warn', 'Heartbeat timeout');
    updateOnlineStatus(false);
  };
  xhr.send('{}');
}

/* ─────────────────────────────────────────────
   CONFIG POLLING (fallback for missed socket events)
───────────────────────────────────────────── */
function startConfigPolling() {
  stopConfigPolling();
  pollTimer = setInterval(function () {
    if (state === 'EMERGENCY') return; // do not disturb during emergency
    fetchAndApplyConfig()
      .then(function () {
        if (state === 'OFFLINE') {
          setState('NORMAL');
          updateOnlineStatus(true);
        }
        // Always restart carousel after config reload — applyConfig rebuilds
        // scene layers without the 'active' class, so they must be re-activated.
        startCarousel();
      })
      .catch(function (e) {
        log('warn', 'Poll fetch failed: ' + e.message);
        if (state === 'NORMAL' || state === 'TIMED_REMINDER') {
          setState('OFFLINE');
          updateOnlineStatus(false);
        }
      });
  }, CONFIG.CONFIG_POLL_INTERVAL);
}

function stopConfigPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/* ─────────────────────────────────────────────
   ONLINE / OFFLINE STATUS UI
───────────────────────────────────────────── */
function updateOnlineStatus(online) {
  var indicator = document.getElementById('status-indicator');
  var banner    = document.getElementById('offline-banner');

  if (indicator) {
    if (online) {
      indicator.classList.remove('offline');
    } else {
      indicator.classList.add('offline');
    }
  }

  if (banner) {
    if (online) {
      banner.classList.remove('visible');
    } else {
      banner.classList.add('visible');
    }
  }
}

/* ─────────────────────────────────────────────
   LOCAL CACHE (localStorage)
───────────────────────────────────────────── */
function cacheConfig(config) {
  try {
    localStorage.setItem('signage_config', JSON.stringify(config));
  } catch (e) {
    log('warn', 'cacheConfig failed (storage full?): ' + e.message);
  }
}

function loadCachedConfig() {
  try {
    var raw = localStorage.getItem('signage_config');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    log('warn', 'loadCachedConfig parse error: ' + e.message);
    return null;
  }
}

/* ─────────────────────────────────────────────
   CLOCK INTERVALS CLEANUP
───────────────────────────────────────────── */
function clearClockIntervals() {
  for (var i = 0; i < clockIntervals.length; i++) {
    clearInterval(clockIntervals[i]);
  }
  clockIntervals = [];
}

/* ─────────────────────────────────────────────
   INFO-LIST INTERVALS CLEANUP
───────────────────────────────────────────── */
function clearInfoListIntervals() {
  for (var i = 0; i < infoListIntervals.length; i++) {
    clearInterval(infoListIntervals[i]);
  }
  infoListIntervals = [];
}

/* ─────────────────────────────────────────────
   INFO-LIST COMPONENT
───────────────────────────────────────────── */
function renderInfoList(el, cfg) {
  var fontSize     = cfg.fontSize     !== undefined ? cfg.fontSize     : 18;
  var color        = cfg.color        || '#ffffff';
  var bgColor      = cfg.backgroundColor || 'rgba(0,0,0,0.5)';
  var itemSpacing  = cfg.itemSpacing  !== undefined ? cfg.itemSpacing  : 6;
  var padding      = cfg.padding      !== undefined ? cfg.padding      : 10;
  var scrollSpeed  = cfg.scrollSpeed  || 40;   // px/sec for horizontal marquee
  var pageInterval = (cfg.pageInterval || 5) * 1000; // ms between page flips

  var TYPE_MAP = {
    info:      { label: '提示', bg: '#1677ff' },
    important: { label: '重要', bg: '#d48806' },
    urgent:    { label: '紧急', bg: '#cf1322' },
  };

  el.style.backgroundColor = bgColor;
  el.style.padding          = padding + 'px';
  el.style.boxSizing        = 'border-box';
  el.style.overflow         = 'hidden';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'width:100%;height:100%;overflow:hidden;position:relative;';
  el.appendChild(wrapper);

  var _marqueeCounter = 0;
  var currentPageEl   = null;
  var pageTimer       = null;

  // Build a single row element (badge + text)
  function buildRowEl(item) {
    var typeInfo = TYPE_MAP[item.type] || TYPE_MAP.info;

    var row = document.createElement('div');
    row.style.cssText = [
      'display:flex', 'align-items:center', 'flex-shrink:0', 'overflow:hidden',
      'margin-bottom:' + itemSpacing + 'px',
    ].join(';');

    // Type badge
    var badge = document.createElement('div');
    badge.style.cssText = [
      'flex-shrink:0', 'white-space:nowrap', 'text-align:center',
      'padding:2px 8px', 'border-radius:3px', 'font-weight:bold',
      'margin-right:10px', 'min-width:3em',
      'font-size:' + fontSize + 'px',
      'background:' + typeInfo.bg, 'color:#fff',
    ].join(';');
    badge.textContent = typeInfo.label;
    row.appendChild(badge);

    // Text wrapper (overflow clip container)
    var textWrap = document.createElement('div');
    textWrap.className = 'il-textwrap';
    textWrap.style.cssText = 'flex:1;min-width:0;overflow:hidden;';

    var span = document.createElement('span');
    span.className = 'il-text';
    span.style.cssText = [
      'display:inline-block', 'white-space:nowrap',
      'font-size:' + fontSize + 'px', 'color:' + color,
    ].join(';');
    span.textContent = item.text;
    textWrap.appendChild(span);
    row.appendChild(textWrap);

    return row;
  }

  // Apply horizontal marquee to overflowing text spans in a container
  function applyMarquee(container) {
    var wraps = container.querySelectorAll('.il-textwrap');
    for (var i = 0; i < wraps.length; i++) {
      var tw   = wraps[i];
      var span = tw.querySelector('.il-text');
      if (!span) continue;
      var containerW = tw.clientWidth;
      var textW      = span.scrollWidth;
      if (textW > containerW + 1) {
        var animName  = 'il-mq-' + (++_marqueeCounter);
        var totalDist = containerW + textW;
        var dur       = totalDist / scrollSpeed;
        var styleEl   = document.createElement('style');
        styleEl.textContent = '@keyframes ' + animName +
          ' { 0% { transform: translateX(' + containerW + 'px); }' +
          ' 100% { transform: translateX(-' + textW + 'px); } }';
        document.head.appendChild(styleEl);
        span.style.animation = animName + ' ' + dur + 's linear infinite';
      }
    }
  }

  // Fade in a new page element, fade out the old one
  function showPage(pageEl) {
    pageEl.style.cssText += 'position:absolute;top:0;left:0;width:100%;opacity:0;transition:opacity 0.5s ease;';
    wrapper.appendChild(pageEl);

    // Measure and apply marquee before fading in
    setTimeout(function () {
      applyMarquee(pageEl);
      pageEl.style.opacity = '1';
    }, 50);

    // Fade out old page
    if (currentPageEl) {
      var old = currentPageEl;
      old.style.opacity = '0';
      setTimeout(function () {
        if (old.parentNode) old.parentNode.removeChild(old);
      }, 560);
    }
    currentPageEl = pageEl;
  }

  function renderItems(items) {
    // Stop existing page timer
    if (pageTimer) { clearInterval(pageTimer); pageTimer = null; }
    if (currentPageEl) {
      wrapper.removeChild(currentPageEl);
      currentPageEl = null;
    }

    if (!items || items.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'padding:20px;color:' + color + ';opacity:0.5;font-size:' + fontSize + 'px;';
      empty.textContent = '暂无信息';
      wrapper.appendChild(empty);
      currentPageEl = empty;
      return;
    }

    // Measure row height using a hidden test row, then paginate
    var testRow = buildRowEl(items[0]);
    testRow.style.visibility = 'hidden';
    testRow.style.position   = 'absolute';
    wrapper.appendChild(testRow);

    setTimeout(function () {
      var wrapH  = wrapper.clientHeight;
      var rowH   = testRow.offsetHeight + itemSpacing;
      if (rowH <= 0) rowH = fontSize * 1.6 + itemSpacing;
      wrapper.removeChild(testRow);

      var perPage = Math.max(1, Math.floor(wrapH / rowH));

      // Split items into pages
      var pages = [];
      for (var i = 0; i < items.length; i += perPage) {
        pages.push(items.slice(i, i + perPage));
      }

      var currentIdx = 0;
      function buildPageEl(pageItems) {
        var page = document.createElement('div');
        for (var j = 0; j < pageItems.length; j++) {
          page.appendChild(buildRowEl(pageItems[j]));
        }
        return page;
      }

      showPage(buildPageEl(pages[0]));

      if (pages.length > 1) {
        pageTimer = setInterval(function () {
          currentIdx = (currentIdx + 1) % pages.length;
          showPage(buildPageEl(pages[currentIdx]));
        }, pageInterval);
        infoListIntervals.push(pageTimer);
      }
    }, 400);
  }

  function fetchAndRender() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/v1/info-items/active', true);
    xhr.onload = function () {
      if (xhr.status === 200) {
        var resp = safeParseJSON(xhr.responseText);
        if (resp && resp.data) renderItems(resp.data);
      }
    };
    xhr.send();
  }

  fetchAndRender();
  infoListFetchers.push(fetchAndRender);
  var refreshId = setInterval(fetchAndRender, 60000);
  infoListIntervals.push(refreshId);
}

/* ─────────────────────────────────────────────
   UTILITY HELPERS
───────────────────────────────────────────── */
function safeParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function log(tag, msg) {
  var ts = new Date().toISOString().substring(11, 23);
  try {
    console.log('[' + ts + '] [' + tag + '] ' + msg);
  } catch (e) { /* swallow in environments without console */ }
}

/* ─────────────────────────────────────────────
   VISIBILITY API — pause/resume on tab hide
   (useful if device runs multiple tabs)
───────────────────────────────────────────── */
document.addEventListener('visibilitychange', function () {
  if (document.hidden) {
    stopCarousel();
  } else {
    if (state === 'NORMAL' || state === 'TIMED_REMINDER') {
      startCarousel();
    }
  }
});
