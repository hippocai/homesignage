const { fault, webUrl, providers } = require('./providers');
const defaults = {
  provider: 'glm',
  model: 'glm-4.6',
  preview: false,
  interests: [],
  dislikes: [],
  dailyCalls: 100,
  dailyTokens: 100000,
  braveCalls: 48,
  blocked: '',
  familyAI: false
};
const deviceDefaults = {
  enabled: false,
  sound: false,
  volume: 0.8,
  zone: 'Asia/Shanghai',
  quietFrom: '22:00',
  quietTo: '07:00',
  gap: 10,
  repeatMinutes: 60,
  maxPlays: 3,
  cold: false,
  family: true,
  news: true,
  city: '',
  threshold: 5,
  from: '07:00',
  to: '09:00',
  weekdays: true
};
function int(v, min, max, label) {
  if (!Number.isInteger(v) || v < min || v > max) throw fault(label + ' 超出范围');
  return v;
}
function config(input) {
  const s = { ...defaults, ...input };
  if (!Object.hasOwn(providers, s.provider) || !/^[\w.-]{1,80}$/.test(s.model))
    throw fault('无效的模型');
  int(s.dailyCalls, -1, 10000, '调用上限');
  int(s.dailyTokens, -1, 10000000, '令牌上限');
  int(s.braveCalls, 0, 10000, '搜索上限');
  return {
    provider: s.provider,
    model: s.model,
    preview: false,
    interests: topicList(s.interests),
    dislikes: topicList(s.dislikes),
    dailyCalls: s.dailyCalls,
    dailyTokens: s.dailyTokens,
    braveCalls: s.braveCalls,
    blocked: String(s.blocked).slice(0, 500),
    familyAI: s.familyAI === true
  };
}
function device(input) {
  const d = { ...deviceDefaults, ...input };
  try {
    new Intl.DateTimeFormat('en', { timeZone: d.zone }).format();
  } catch {
    throw fault('时区无效');
  }
  for (const key of ['quietFrom', 'quietTo', 'from', 'to'])
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d[key])) throw fault('时间应为 HH:mm');
  int(d.gap, 0, 240, '提醒间隔');
  int(d.repeatMinutes, 1, 1440, '同一提醒间隔');
  int(d.maxPlays, 1, 12, '每条最多提醒次数');
  int(d.threshold, 1, 30, '温差');
  if (typeof d.volume !== 'number' || d.volume < 0 || d.volume > 1) throw fault('音量应为 0 至 1');
  d.city = typeof d.city === 'string' ? d.city.trim() : '';
  if (d.cold && (!d.city || d.city.length > 80)) throw fault('请填写降温提醒的城市名称（最多 80 个字符）');
  for (const k of ['enabled', 'sound', 'cold', 'weekdays', 'family', 'news'])
    if (typeof d[k] !== 'boolean') throw fault('设备开关应为布尔值');
  return Object.fromEntries(Object.keys(deviceDefaults).map((k) => [k, d[k]]));
}
function source(input) {
  const { type, name } = input;
  if (!['rss', 'brave', 'ranking', 'zaobao'].includes(type) || !String(name || '').trim())
    throw fault('请选择来源类型并填写名称');
  if (type !== 'zaobao' && (type === 'brave' ? !String(input.query || '').trim() : !webUrl(input.url)))
    throw fault('请填写有效的订阅地址或查询词');
  const section = input.section || 'all';
  if (!['all', 'china', 'world', 'singapore', 'finance'].includes(section))
    throw fault('无效的早报栏目');
  const targets = input.targets || [];
  if (!Array.isArray(targets) || !targets.every((x) => typeof x === 'string'))
    throw fault('目标设备无效');
  const interval = int(input.interval ?? (type === 'brave' ? 30 : 10), 2, 1440, '刷新分钟');
  return {
    type,
    name: String(name).slice(0, 80),
    section,
    url: type === 'zaobao' ? require('./providers').zaobaoUrl : webUrl(input.url),
    query: String(input.query || '').slice(0, 200),
    interval,
    keywords: String(input.keywords || '').slice(0, 300),
    region: String(input.region || '').slice(0, 80),
    blocked: String(input.blocked || '').slice(0, 300),
    enabled: input.enabled !== false,
    trusted: type === 'rss' && input.trusted === true,
    targets: [...new Set(targets)],
    country: input.country || 'ALL',
    language: input.language || 'zh-hans'
  };
}
const terms = (s) =>
  String(s || '')
    .split(/[,，\n]/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
function topicList(values) {
  if (!Array.isArray(values) || values.length > 100 ||
      values.some(v => typeof v !== 'string' || !v.trim() || v.trim().length > 80))
    throw fault('话题列表最多 100 项，每项需为 1 至 80 个字符');
  return [...new Set(values.map(v => v.trim().toLowerCase()))];
}
const chinaTerms = /中国|中國|北京|上海|深圳|广州|廣州|重庆|重慶|杭州|香港|澳门|江苏|浙江|广东|福建|四川|山东|湖北|湖南|河南|河北|国务院|外交部发言人|人民币|中美|中日|中新关系|访华|訪華|在华|对华|對華|\bchina\b/i;
function topicMatches(settings, article) {
  const text = [article.title, article.excerpt, article.summary, article.topic].filter(Boolean).join(' ').toLowerCase();
  function match(term) {
    if (/^(中国|中國|中国相关|中国相关内容|china)$/i.test(term))
      return chinaTerms.test(text) || /^https:\/\/www\.zaobao\.com\.sg\/(?:news|realtime)\/(?:china|greater-china)\//i.test(article.url || '');
    return text.includes(term);
  }
  const excluded = [...(settings.dislikes || []), ...terms(settings.blocked)];
  return !excluded.some(match) && (!settings.interests?.length || settings.interests.some(match));
}
function timely(a, now) {
  return !a.time || (a.time <= now + 300000 && now - a.time < 86400000);
}
function evaluate(s, settings, a, now, acceptedByFilter = false) {
  const text = (a.title + ' ' + (a.excerpt || '')).toLowerCase();
  const blocked = terms(settings.blocked + ',' + s.blocked).some((t) => text.includes(t));
  const keys = terms(s.keywords);
  const match = keys.some((t) => text.includes(t));
  const region = !s.region || text.includes(s.region.toLowerCase());
  const recent = !!a.time && a.time <= now + 300000 && now - a.time < 86400000;
  const major = /地震|海啸|紧急|重大|红色预警|停火|进入紧急状态/.test(a.title);
  const important = acceptedByFilter ? (keys.length > 0 || major) : (match || major) && region;
  return {
    skip: !timely(a, now) || (!acceptedByFilter && (blocked || !topicMatches(settings, a) || (keys.length > 0 && !match) || !region)),
    important,
    speak: s.type !== 'ranking' && important && recent,
    reason: !acceptedByFilter && blocked
      ? '命中屏蔽词'
      : !recent
        ? '缺少近期发布时间'
        : important
          ? '命中关注词与地区'
          : '订阅来源'
  };
}
function localTime(now, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short'
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value])
  );
  return {
    day: parts.year + '-' + parts.month + '-' + parts.day,
    time: parts.hour + ':' + parts.minute,
    weekday: !['Sat', 'Sun'].includes(parts.weekday)
  };
}
function between(t, start, end) {
  return start === end ? false : start < end ? t >= start && t < end : t >= start || t < end;
}
function component(options) {
  if(options!==undefined && (!options || Array.isArray(options) || typeof options!=='object')) throw fault('组件提醒规则无效');
  return device({...require('../../../shared/pig-reminders.json'),...options});
}
module.exports = { defaults, deviceDefaults, int, config, device, component, source, terms, timely, evaluate, topicMatches, localTime, between };
