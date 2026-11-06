const { randomUUID } = require('crypto');
const db = require('./storage');
const api = require('./service');
const rules = require('./rules');
const providers = require('./providers');
const {weatherCityKey, resolveCity} = require('./weatherCity');
const logger = require('../../utils/logger');
const retry = new Map();
async function weather(deviceId, d, now = Date.now(), componentId) {
  if (!d.enabled || !d.cold) return;
  const { day, time, weekday } = rules.localTime(now, d.zone);
  const city = weatherCityKey(d);
  let today = await db.one('SELECT high FROM briefing_weather WHERE city=? AND day=?', city, day);
  if (!today && time >= '06:50' && time <= '07:00' && !(retry.get(city) > now)) {
    retry.set(city, now + 120000);
    const query = new URLSearchParams({
      ...await resolveCity(d.city),
      daily: 'temperature_2m_max',
      timezone: d.zone,
      forecast_days: '1'
    });
    const b = await providers.remote('https://api.open-meteo.com/v1/forecast?' + query);
    const high = b.daily?.temperature_2m_max?.[0];
    if (
      b.daily?.time?.[0] !== day ||
      !Number.isFinite(high) ||
      b.daily_units?.temperature_2m_max !== '°C'
    )
      return;
    await db.run('INSERT OR IGNORE INTO briefing_weather VALUES(?,?,?)', city, day, high);
    today = { high };
  }
  if (!today || !rules.between(time, d.from, d.to) || (d.weekdays && !weekday)) return;
  const yesterday = new Date(Date.parse(day + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  const prior = await db.one(
    'SELECT high FROM briefing_weather WHERE city=? AND day=?',
    city,
    yesterday
  );
  const diff = prior && Math.round((prior.high - today.high) * 10) / 10;
  if (!prior || diff < d.threshold) return;
  componentId ??= (await api.boundPig(deviceId)).id;
  const identity = ['cold',deviceId,componentId,city,day].join(':');
  if (await db.one('SELECT id FROM briefing_events WHERE identity=?', identity)) return;
  const minutes = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const end = now - (now % 60000) + ((minutes(d.to) - minutes(time) + 1440) % 1440) * 60000;
  const fact =
    d.city + '今天预计最高 ' + today.high + '℃，比昨天预报的最高温低 ' + diff + '℃。出门带件外套吧。';
  let speech = fact;
  try {
    const generated = await api.generate(await api.settings(), { title: '降温提醒', excerpt: fact });
    if (generated.speech.includes(String(today.high)) && generated.speech.includes(String(diff)))
      speech = generated.speech;
  } catch {}
  const payload = {
    title: '降温提醒',
    summary: fact,
    speech,
    source: 'Open-Meteo',
    drop: diff,
    action: 'scarf',
    speak: true,
    speakUntil: end
  };
  const ok = await db.run(
    "INSERT OR IGNORE INTO briefing_events(id,kind,identity,state,payload,targets,starts,expires,updated) VALUES(?,'weather',?,'published',?,?,?,?,?)",
    randomUUID(),
    identity,
    JSON.stringify(payload),
    JSON.stringify([deviceId]),
    now,
    end,
    now
  );
  if (ok) api.notify([deviceId]);
}
let scanning = false;
async function collectDue() {
  if (scanning) return;
  scanning = true;
  try {
    const rows = await db.all(
      "SELECT id FROM briefing_sources WHERE json_extract(config,'$.enabled')=1 AND due<=? ORDER BY due LIMIT 8",
      Date.now()
    );
    for (const { id } of rows) {
      try {
        await api.scan(id);
      } catch (e) {
        logger.warn('News collection unavailable', { source: id, reason: e.message });
      }
    }
  } finally {
    scanning = false;
  }
}
let running = false;
let analyzing = false, retryAnalysisAt = 0;
async function analyzeDue() {
  if (analyzing || Date.now()<retryAnalysisAt) return;
  analyzing = true;
  try { await require('./household').analyze(); }
  catch (e) {
    retryAnalysisAt = Date.now() + (e.status===429 ? 15 : 2)*60000;
    logger.warn('Household impact analysis postponed', { status:e.status || 500 });
  } finally { analyzing=false; }
}
async function tick() {
  if (running) return;
  running = true;
  try {
    for (const { device,component,config } of await db.all(
      "SELECT ds.device_id AS device,c.id AS component,c.config FROM device_scenes ds JOIN components c ON ds.scene_id=c.scene_id WHERE ds.enabled=1 AND c.type='companion' AND json_extract(c.config,'$.reminders.cold')=1"
    )) {
      try {
        await weather(device,rules.component(JSON.parse(config).reminders),Date.now(),component);
      } catch (e) {
        logger.warn('Weather briefing unavailable', { reason: e.message });
      }
    }
    for (const { item } of await db.all('SELECT item FROM briefing_info')) await api.syncFamily(item);
    collectDue().catch((e) => logger.warn('News scheduler unavailable', { reason: e.message }));
    void analyzeDue();
    await db.run('DELETE FROM briefing_claims WHERE claimed<?', Date.now() - 30 * 86400000);
    await db.run('DELETE FROM briefing_events WHERE expires<?', Date.now() - 30 * 86400000);
    await db.run('DELETE FROM briefing_history WHERE at<?', Date.now() - 30 * 86400000);
    await db.run('DELETE FROM briefing_topic_cache WHERE decided<?', Date.now() - 31 * 86400000);
    await db.run("DELETE FROM briefing_weather WHERE day<date('now','-8 days')");
  } finally {
    running = false;
  }
}
function start() {
  const run = () => tick().catch((e) => logger.error('Briefing worker failed', { reason: e.message }));
  run();
  const t = setInterval(run, 30000);
  t.unref();
  return t;
}
module.exports = { start, tick, weather };
