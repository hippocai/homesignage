const { randomUUID } = require('crypto');
const db = require('./storage');
const p = require('./providers');
const rules = require('./rules');
const topics = require('./topics');
const rankingStories = require('./ranking-stories');
const settingsDao = require('../../dao/settingsDao');
const sockets = require('../socketService');
const hour = 3600000;
const settings = async () => rules.config((await settingsDao.get('briefing.settings')) || {});
async function boundPig(device,component) {
  const rows=await db.all(`SELECT c.id,c.config FROM components c JOIN device_scenes ds ON ds.scene_id=c.scene_id
    WHERE ds.device_id=? AND ds.enabled=1 AND c.type='companion' AND (? IS NULL OR c.id=?) LIMIT 2`,device,component??null,component??null);
  if(component!=null && rows.length!==1) throw p.fault('组件未绑定此屏幕',403);
  return rows.length===1?{id:rows[0].id,prefs:rules.component(JSON.parse(rows[0].config).reminders)}:{id:'',prefs:rules.device({})};
}
const prefs=async id=>(await boundPig(id)).prefs;
function notify(ids) {
  if (!ids.length) sockets.emitToAll('briefing-updated', {});
  else for (const id of new Set(ids)) sockets.emitToDevice(id, 'briefing-updated', {});
}
async function validTargets(ids) {
  if (!Array.isArray(ids) || ids.length > 200 || ids.some((x) => typeof x !== 'string'))
    throw p.fault('目标设备列表无效');
  if (
    ids.length &&
    (
      await db.all(
        'SELECT id FROM devices WHERE id IN (SELECT value FROM json_each(?))',
        JSON.stringify(ids)
      )
    ).length !== new Set(ids).size
  )
    throw p.fault('设备不存在');
  return [...new Set(ids)];
}
function unpack(row) {
  return row && { ...row, payload: JSON.parse(row.payload), targets: JSON.parse(row.targets) };
}
async function reserve(provider, maxCalls, maxTokens, amount) {
  const callsError = provider === 'brave' ? 'Brave 今日搜索次数已达到上限' : '模型今日调用次数已达到上限';
  const tokensError = '模型今日剩余令牌不足以完成本次请求';
  if (maxCalls === 0) throw p.fault(callsError, 429);
  if (maxTokens !== -1 && amount > maxTokens) throw p.fault(tokensError, 429);
  const day = new Date().toISOString().slice(0, 10);
  const changed = await db.run(
    `INSERT INTO briefing_usage(day,provider,calls,tokens) VALUES(?,?,1,?)
    ON CONFLICT(day,provider) DO UPDATE SET calls=calls+1,tokens=tokens+excluded.tokens
    WHERE (?=-1 OR calls<?) AND (?=-1 OR tokens+excluded.tokens<=?)`,
    day,
    provider,
    amount,
    maxCalls, maxCalls, maxTokens,
    maxTokens
  );
  if (!changed) {
    const usage = await db.one('SELECT calls FROM briefing_usage WHERE day=? AND provider=?', day, provider);
    throw p.fault(maxCalls !== -1 && usage.calls >= maxCalls ? callsError : tokensError, 429);
  }
  return day;
}
async function generate(s, a, generateResult = p.model, reserved = 2400) {
  const day = await reserve(s.provider, s.dailyCalls, s.dailyTokens, reserved);
  let tokens;
  try {
    const result = await generateResult(s, a);
    tokens = result.tokens;
    return result;
  } catch (error) {
    tokens = error.tokens;
    throw error;
  } finally {
    if (Number.isInteger(tokens) && tokens >= 0) {
      await db.run('UPDATE briefing_usage SET tokens=tokens-?+? WHERE day=? AND provider=?',
        reserved,tokens,day,s.provider);
    }
  }
}
async function saveSource(input, id = randomUUID()) {
  const cfg = rules.source(input);
  await validTargets(cfg.targets);
  await db.run(
    `INSERT INTO briefing_sources(id,config) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config,due=0,etag=NULL,modified=NULL`,
    id,
    JSON.stringify(cfg)
  );
  return id;
}
function titleKey(title) {
  return title
    .toLowerCase()
    .replace(/^[【\[][^】\]]{1,10}[】\]]/, '')
    .replace(/[\s，。！？：、,.!?:“”"']/g, '');
}
let processing = Promise.resolve();
function record(...args) {
  const next = processing.then(() => recordOne(...args));
  processing = next.catch(() => {});
  return next;
}
function transitStatus(text) {
  if (/恢复运营|恢复运行|恢复通行/.test(text)) return 'restored';
  if (/停运|暂停运营|暂停运行|暂停通行/.test(text)) return 'suspended';
  return '';
}
async function topicItems(items, opts, articleOf) {
  return topics.filter(items, articleOf, opts, topics.preferences(opts), a=>rules.topicMatches(opts,a), generate);
}
async function filterEvents(events, opts) {
  if (!events.some(e=>e.payload.rankingMembers?.length))
    return (await topicItems(events,opts,e=>e.payload)).items;
  const entries = events.flatMap(e=>(e.payload.rankingMembers || [e.payload]).map(article=>({event:e,article})));
  const matches = (await topicItems(entries,opts,item=>item.article)).items;
  const visible = new Set(matches.map(item=>item.event.id));
  return events.filter(e=>visible.has(e.id));
}
async function selectArticles(articles, s, opts, now, report) {
  const recent = articles.filter(a=>rules.timely(a,now));
  const global = await topicItems(recent,opts,a=>a);
  const source = await topics.filter(global.items,a=>a,opts,topics.sourcePolicy(s),
    a=>!rules.evaluate(s,rules.defaults,a,now).skip,generate);
  report.fallback ||= global.fallback || source.fallback;
  return source.items;
}
async function recordOne(sourceId, s, article, opts, now = Date.now(), scanReport) {
  if (!scanReport && !(await selectArticles([article],s,opts,now,{})).length) return;
  const decision = rules.evaluate(s, opts, article, now, true);
  if (decision.skip) return;
  const previous = await db.one(
    'SELECT * FROM briefing_evidence WHERE source_id=? AND ref=?',
    sourceId,
    article.ref
  );
  const priorArticle = previous && JSON.parse(previous.article);
  if (s.type === 'zaobao' && !article.excerpt) {
    const cached = priorArticle?.title === article.title && priorArticle.excerpt;
    article = { ...article, excerpt: cached || await p.zaobaoDescription(article.url) };
    if (article.excerpt && !(await selectArticles([article],s,opts,now,scanReport || {})).length) return;
  }
  const fingerprint = p.hash([article.title, article.excerpt, article.rank].join('|'));
  if (previous?.fingerprint === fingerprint && s.type !== 'ranking') return previous.event_id;
  const sameLink = await db.one(
    "SELECT event_id FROM briefing_evidence WHERE json_extract(article,'$.url')=? LIMIT 1",
    article.url
  );
  const status = transitStatus(article.title);
  const line = article.title.match(/(?:地铁)?(?:\d+|[一二三四五六七八九十]+)号线/);
  const cluster =
    s.region && line && status ? s.region + line[0].replace('地铁', '') : titleKey(article.title);
  const scope = JSON.stringify([...s.targets].sort());
  const key =
    s.type === 'ranking'
      ? sourceId + '|' + article.ref
      : [scope, s.region, cluster, new Date(article.time || now).toISOString().slice(0, 10)].join('|');
  let existing = unpack(
    await db.one(
      'SELECT * FROM briefing_events WHERE id=? OR identity=? LIMIT 1',
      previous?.event_id || sameLink?.event_id || '',
      key
    )
  );
  if (existing && !previous && JSON.stringify([...existing.targets].sort()) !== scope)
    existing = unpack(await db.one('SELECT * FROM briefing_events WHERE identity=?', key));
  const statusChange = existing && status && status !== transitStatus(existing.payload.title);
  const conflict =
    statusChange && (!s.trusted || !article.time || article.time <= (existing.payload.time || 0));
  const timeFacts = (text) =>
    (String(text || '').match(/\d{1,4}(?:年|月|日|时|点|分)|\d{1,2}:\d{2}/g) || []).join('|');
  const timingChanged =
    previous && !(s.type === 'zaobao' && !priorArticle.excerpt) &&
    timeFacts(priorArticle.excerpt) !== timeFacts(article.excerpt);
  const material =
    existing &&
    (statusChange ||
      timingChanged ||
      (previous && titleKey(existing.payload.title) !== titleKey(article.title)));
  const expires = (article.time || now) + (s.type === 'ranking' ? s.interval * 120000 : 24 * hour);
  const evId = existing?.id || randomUUID();
  if (!existing || material) {
    let generated = {},
      failure = '';
    try {
      generated = await generate(opts, article);
    } catch (e) {
      failure = e.message;
    }
    const state = 'published';
    const payload = {
      title: article.title,
      summary: generated.summary || article.title,
      excerpt: article.excerpt || '',
      speech: generated.speech || article.title,
      topic: generated.topic || '',
      source: article.publisher || s.name,
      url: article.url,
      time: article.time,
      rank: article.rank,
      important: decision.important,
      speak: decision.speak && !conflict,
      reason: [decision.reason, failure, conflict ? '来源状态冲突' : '']
        .filter(Boolean)
        .join(' · '),
      action: decision.important ? 'serious' : 'point',
      speakUntil: Math.min(expires, now + hour / 2)
    };
    if (!existing)
      await db.run(
        'INSERT INTO briefing_events(id,kind,identity,state,payload,targets,starts,expires,updated) VALUES(?,?,?,?,?,?,?,?,?)',
        evId,
        s.type === 'ranking' ? 'ranking' : 'news',
        key,
        state,
        JSON.stringify(payload),
        JSON.stringify(s.targets),
        now,
        expires,
        now
      );
    else if (existing.state !== 'withdrawn')
      await db.run(
        'UPDATE briefing_events SET state=?,version=version+1,edition=edition+1,payload=?,starts=?,expires=?,updated=? WHERE id=? AND version=?',
        state,
        JSON.stringify(payload),
        now,
        expires,
        now,
        evId,
        existing.version
      );
    notify(existing ? [...existing.targets, ...s.targets] : s.targets);
  } else if (s.type === 'ranking' && existing.state !== 'withdrawn') {
    await db.run(
      "UPDATE briefing_events SET payload=json_set(payload,'$.rank',?,'$.time',?),expires=?,updated=? WHERE id=?",
      article.rank,
      now,
      expires,
      now,
      evId
    );
    notify(existing.targets);
  } else if (s.type === 'zaobao' && article.excerpt && !existing.payload.excerpt &&
             existing.payload.title === article.title && existing.state === 'published') {
    await db.run("UPDATE briefing_events SET payload=json_set(payload,'$.excerpt',?),version=version+1 WHERE id=? AND version=?",
      article.excerpt, evId, existing.version);
    notify(existing.targets);
  }
  await db.run(
    `INSERT INTO briefing_evidence(source_id,ref,event_id,fingerprint,article) VALUES(?,?,?,?,?) ON CONFLICT(source_id,ref) DO UPDATE SET fingerprint=excluded.fingerprint,article=excluded.article,event_id=excluded.event_id`,
    sourceId,
    article.ref,
    evId,
    fingerprint,
    JSON.stringify(article)
  );
  return evId;
}
const busy = new Set();
async function scan(id, preview = false) {
  const row = await db.one('SELECT * FROM briefing_sources WHERE id=?', id);
  if (!row) throw p.fault('来源不存在', 404);
  if (busy.has(id)) throw p.fault('来源采集中', 409);
  busy.add(id);
  const cfg = JSON.parse(row.config);
  try {
    const opts = await settings();
    if (cfg.type === 'brave') await reserve('brave', opts.braveCalls, 0, 0);
    const policyKey = topics.signature(opts,[topics.preferences(opts),topics.sourcePolicy(cfg)]);
    const result = await p.collect(cfg, preview || cfg.type==='ranking' || policyKey !== row.topic_policy ? {} : row).catch(error => {
      const reason = p.networkIssue(error) || (error instanceof SyntaxError ? '来源返回的数据格式无效' : '');
      if (reason) throw p.fault(cfg.name + '：' + reason + '，请稍后再试', 502);
      throw error;
    });
    const now = Date.now();
    const report = {};
    const matches = await selectArticles(result.articles,cfg,opts,now,report);
    const selected = cfg.type === 'zaobao' ? matches.slice(0, 12) : matches;
    let count = 0;
    let ranking = {};
    if (cfg.type==='ranking' && !result.unchanged) {
      const stories = await rankingStories.prepare(id,cfg,opts,policyKey,selected,now,generate);
      if (preview) return stories.groups.slice(0,3).map(({payload:a})=>({
        ref:a.url,title:a.title,url:a.url,excerpt:a.excerpt,time:a.time,rank:a.rank
      }));
      await rankingStories.save(id,cfg,policyKey,now,stories);
      count = stories.count;
      ranking = {eventCount:stories.groups.length,
        ...(stories.fallback ? {groupFallback:stories.fallback} : {})};
      notify(cfg.targets);
    } else {
      if (preview) return selected.slice(0, 3);
      for (const a of selected) {
        if (await record(id, cfg, a, opts, now, report)) count++;
      }
    }
    await db.run(
      'UPDATE briefing_sources SET last_ok=?,error=NULL,due=?,etag=?,modified=?,topic_policy=? WHERE id=?',
      Date.now(),
      Date.now() + cfg.interval * 60000,
      result.unchanged ? row.etag : result.etag || null,
      result.unchanged ? row.modified : result.modified || null,
      report.fallback ? null : policyKey,
      id
    );
    return { count, received:result.articles.length, unchanged:!!result.unchanged,...ranking,
      ...(report.fallback ? {topicFallback:report.fallback} : {}) };
  } catch (e) {
    if (!preview)
      await db.run(
        'UPDATE briefing_sources SET error=?,due=? WHERE id=?',
        e.message.slice(0, 180),
        Date.now() + Math.max(cfg.interval * 60, e.retryAfter || 300) * 1000,
        id
      );
    throw e;
  } finally {
    busy.delete(id);
  }
}
async function review(id, input) {
  const old = unpack(await db.one('SELECT * FROM briefing_events WHERE id=?', id));
  if (!old) throw p.fault('事件不存在', 404);
  if (!['news', 'ranking'].includes(old.kind))
    throw p.fault('家庭事项请在信息列表修改，天气提醒请在设备规则修改');
  if (input.version !== old.version) throw p.fault('事件版本已变化，请刷新', 409);
  if (['merge', 'split'].includes(input.action)) {
    if (old.kind !== 'news') throw p.fault('仅支持新闻分合');
    const split = input.action === 'split';
    const dest = split ? randomUUID() : input.destination;
    const predicate = split
      ? 'EXISTS(SELECT 1 FROM briefing_evidence WHERE event_id=e.id AND source_id=? AND ref=?) AND (SELECT count(*) FROM briefing_evidence WHERE event_id=e.id)>1'
      : "EXISTS(SELECT 1 FROM briefing_events d WHERE d.id=? AND d.version=? AND d.id!=e.id AND d.kind=e.kind AND d.targets=e.targets AND d.state!='withdrawn')";
    const args = split ? [input.source, input.ref] : [dest, input.destinationVersion];
    const ok = await db.run(
      'INSERT INTO briefing_group_actions SELECT ?,?,e.id,?,?,?,? FROM briefing_events e WHERE e.id=? AND e.version=? AND ' +
        predicate,
      randomUUID(),
      input.action,
      dest,
      input.source || null,
      input.ref || null,
      Date.now(),
      id,
      old.version,
      ...args
    );
    if (!ok) throw p.fault('请选择同一设备范围的有效版本或可拆分的证据', 409);
    notify(old.targets);
    return unpack(await db.one('SELECT * FROM briefing_events WHERE id=?', dest));
  }
  if (!['publish', 'withdraw', 'edit'].includes(input.action)) throw p.fault('未知操作');
  const targets = await validTargets(input.targets ?? old.targets);
  const payload = { ...old.payload };
  for (const key of ['title', 'summary', 'speech'])
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 500)
        throw p.fault('文案长度无效');
      payload[key] = input[key].trim();
    }
  if (input.speak !== undefined) payload.speak = input.speak === true;
  if (payload.speak && !targets.length && old.kind !== 'news') throw p.fault('主动播报需要指定设备');
  const state = { publish: 'published', withdraw: 'withdrawn', edit: old.state }[input.action];
  if (state === 'published' && old.expires <= Date.now()) throw p.fault('事件已过期', 409);
  if (input.action === 'publish') payload.speakUntil = Math.min(old.expires, Date.now() + hour / 2);
  const ok = await db.run(
    'UPDATE briefing_events SET state=?,version=version+1,edition=edition+?,payload=?,targets=?,updated=? WHERE id=? AND version=?',
    state,
    input.replay === true ? 1 : 0,
    JSON.stringify(payload),
    JSON.stringify(targets),
    Date.now(),
    id,
    input.version
  );
  if (!ok) throw p.fault('事件版本已变化，请刷新', 409);
  notify(!old.targets.length || !targets.length ? [] : old.targets.concat(targets));
  return unpack(await db.one('SELECT * FROM briefing_events WHERE id=?', id));
}

async function syncFamily(id) {
  const row = await db.one(
    'SELECT i.*,b.targets,b.edition FROM info_items i JOIN briefing_info b ON b.item=i.id WHERE i.id=?',
    id
  );
  const old = unpack(await db.one('SELECT * FROM briefing_events WHERE identity=?', 'family:' + id));
  if (!row || row.type === 'info' || row.targets === '[]') {
    if (old && old.state !== 'withdrawn') {
      await db.run("UPDATE briefing_events SET state='withdrawn',version=version+1 WHERE id=?", old.id);
      notify(old.targets);
    }
    return;
  }
  const start = row.start_time ? Date.parse(row.start_time) : old?.starts || Date.now();
  const end = row.end_time ? Date.parse(row.end_time) : start + 24 * hour;
  const payload = {
    title: '家庭提醒',
    summary: row.text,
    speech: row.text,
    source: '家庭信息',
    action: row.type === 'urgent' ? 'serious' : 'wave',
    speak: true,
    important: true,
    urgent: row.type === 'urgent',
    speakUntil: end
  };
  if (old?.payload.summary === row.text) payload.speech = old.payload.speech;
  else {
    const s = await settings();
    if (s.familyAI) {
      try {
        const generated = await generate(s, {
          title: row.text.slice(0, 90),
          excerpt: row.text.slice(0, 1000)
        });
        // Keep every deadline and instruction in a household notice.
        if (generated.speech === row.text.trim()) payload.speech = '猪猪提醒你，' + generated.speech;
      } catch {
        /* Use the full local notice when the provider is unavailable. */
      }
    }
  }
  if (
    old &&
    old.state === 'published' &&
    old.payload.summary === row.text &&
    old.payload.urgent === payload.urgent &&
    old.edition === row.edition &&
    old.starts === start &&
    old.expires === end &&
    JSON.stringify(old.targets) === row.targets
  )
    return;
  await db.run(
    `INSERT INTO briefing_events(id,kind,identity,state,payload,targets,starts,expires,updated,edition)
    SELECT ?,'family',?,'published',?,?,?,?,?,? WHERE EXISTS (
      SELECT 1 FROM info_items WHERE id=? AND text=? AND type=? AND start_time IS ? AND end_time IS ?
      AND companion_targets=? AND companion_edition=?
    )
    ON CONFLICT(identity) DO UPDATE SET state='published',version=version+1,payload=excluded.payload,targets=excluded.targets,starts=excluded.starts,expires=excluded.expires,edition=excluded.edition,updated=excluded.updated`,
    id,
    'family:' + id,
    JSON.stringify(payload),
    row.targets,
    start,
    end,
    Date.now(),
    row.edition,
    id,
    row.text,
    row.type,
    row.start_time,
    row.end_time,
    row.targets,
    row.edition
  );
  notify([...(old?.targets || []), ...JSON.parse(row.targets)]);
}
async function newsCards(deviceId, now = Date.now()) {
  const rows = await db.all(`SELECT * FROM briefing_events
    WHERE state='published' AND kind IN ('news','ranking') AND starts<=? AND expires>?
      AND (targets='[]' OR EXISTS(SELECT 1 FROM json_each(targets) WHERE value=?))
    ORDER BY json_extract(payload,'$.important') DESC,updated DESC`, now, now, deviceId);
  const policy = await settings();
  const cards = await filterEvents(rows.map(unpack),policy);
  if (!cards.length) return cards;
  const components = await db.all(`SELECT DISTINCT c.id,c.config FROM components c
    JOIN device_scenes ds ON ds.scene_id=c.scene_id WHERE ds.device_id=? AND ds.enabled=1 AND c.type='headlines'`, deviceId);
  for (const {id,config} of components) {
    const cfg = JSON.parse(config);
    const words = Array.isArray(cfg.keywords) ? cfg.keywords : String(cfg.theme || '').split(/[,，、\n]/);
    const interests = words.map(s=>String(s).trim().toLowerCase()).filter(Boolean);
    if (!interests.length) continue;
    const componentPolicy = {...policy, interests, dislikes:[], blocked:''};
    const matched = await filterEvents(cards,componentPolicy);
    for (const card of cards) card.topicComponents ||= [];
    for (const card of matched) card.topicComponents.push(id);
  }
  return cards;
}
async function feed(deviceId, now = Date.now(), component) {
  const {id:componentId,prefs:d} = await boundPig(deviceId,component);
  const events = (await db.all(`SELECT * FROM briefing_events WHERE kind IN ('family','weather')
    AND state='published' AND starts<=? AND expires>? AND json_extract(payload,'$.speak')=1
    AND EXISTS(SELECT 1 FROM json_each(targets) WHERE value=?)
    ORDER BY json_extract(payload,'$.urgent') DESC,updated DESC`,now,now,deviceId)).map(unpack);
  const local = rules.localTime(now, d.zone);
  const quiet = rules.between(local.time, d.quietFrom, d.quietTo);
  const weatherKey = [
    'cold',
    deviceId,
    componentId,
    require('./weatherCity').weatherCityKey(d),
    local.day
  ].join(':');
  const allowCold = d.cold && rules.between(local.time, d.from, d.to) && (!d.weekdays || local.weekday);
  const cards = await newsCards(deviceId, now);
  if (d.news && d.enabled) events.push(...await require('./household').relevant(cards,now));
  const receipts = new Map((await db.all(`SELECT c.* FROM briefing_claims c JOIN briefing_events e
    ON c.event=e.id AND c.edition=e.edition WHERE device=? AND c.component=? AND e.expires>?`,deviceId,componentId,now)).map(c=>[c.event,c]));
  const weatherContext=events.some(e=>e.payload.weatherAgent)?require('./weather-agent').contextKey(await require('./household').household(),d):null;
  const active = events.filter(
    (x) =>
      x.payload.speak &&
      x.payload.speakUntil > now &&
      (!x.targets.length || x.targets.includes(deviceId)) &&
      (x.kind !== 'family' || d.family) &&
      (x.kind !== 'weather' || (x.payload.weatherAgent
        ? d.cold && x.payload.component===componentId && x.payload.weatherContext===weatherContext
        : allowCold && x.identity === weatherKey && x.payload.drop >= d.threshold))
  );
  return {
    componentId,cards,
    tasks: d.enabled && !quiet ? active.flatMap(x => {
      const receipt = receipts.get(x.id);
      const repeatable = x.payload.repeatable || x.kind==='weather' || (x.kind==='family' && x.payload.urgent);
      if (receipt && (!repeatable || receipt.occurrence>=d.maxPlays || now-receipt.claimed<d.repeatMinutes*60000)) return [];
      return [{...x, occurrence:(receipt?.occurrence || 0)+1}];
    }) : [],
    active:
      d.enabled && !quiet
        ? active.map((x) => ({ id: x.id, edition: x.edition, speech: x.payload.speech }))
        : [],
    preferences: d,
    now
  };
}
async function claim(deviceId, id, edition, now = Date.now(), occurrence = 1, component) {
  const data = await feed(deviceId, now,component);
  const job = data.tasks.find((x) => x.id === id && x.edition === edition && x.occurrence === occurrence);
  if (!job) throw p.fault('任务已领取、撤回或不在播报窗口', 409);
  const ok = await db.run(
    `INSERT INTO briefing_claims(device,component,event,edition,claimed,occurrence)
    SELECT ?,?,id,edition,?,? FROM briefing_events WHERE id=? AND edition=? AND state='published' AND starts<=? AND expires>? AND version=?
    AND (kind IN ('family','weather') OR EXISTS(SELECT 1 FROM pig_impact WHERE event=briefing_events.id AND version=briefing_events.version AND speech=? AND until_ms>?))
    AND NOT EXISTS(SELECT 1 FROM briefing_claims WHERE device=? AND component=? AND claimed>?)
    ON CONFLICT(device,component,event,edition) DO UPDATE SET claimed=excluded.claimed,result='claimed',occurrence=excluded.occurrence
    WHERE briefing_claims.occurrence=excluded.occurrence-1 AND briefing_claims.claimed<=?`,
    deviceId,data.componentId,now,job.occurrence,id,edition,now,now,job.version,job.payload.speech,now,
    deviceId,data.componentId,job.payload.urgent ? now : now-data.preferences.gap*60000,now-data.preferences.repeatMinutes*60000
  );
  if (!ok) throw p.fault('已领取或在提醒间隔内', 409);
  return {...job,componentId:data.componentId};
}
async function result(device, id, edition, status, occurrence = 1, component) {
  if (!['subtitle', 'spoken', 'interrupted'].includes(status)) throw p.fault('无效播放结果');
  const ok = await db.run(
    "UPDATE briefing_claims SET result=? WHERE device=? AND component=? AND event=? AND edition=? AND occurrence=? AND result IN ('claimed',?)",
    status,
    device,
    component ?? (await boundPig(device)).id,
    id,
    edition,
    occurrence,
    status
  );
  if (!ok) throw p.fault('无此领取记录或已结束', 409);
}
module.exports = {
  filterEvents,
  newsCards,
  settings,
  prefs,
  boundPig,
  validTargets,
  generate,
  saveSource,
  record,
  scan,
  review,
  syncFamily,
  feed,
  claim,
  result,
  unpack,
  notify,
  reserve
};
