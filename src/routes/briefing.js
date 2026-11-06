const router = require('express').Router();
const api = require('../services/briefing/service');
const db = require('../services/briefing/storage');
const rules = require('../services/briefing/rules');
const p = require('../services/briefing/providers');
const { authenticateJWT } = require('../middleware/auth');
const handle = (fn) => async (req, res) => {
  try {
    res.json({ data: await fn(req) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : '操作失败，请检查来源或服务状态' });
  }
};
router.use('/news', authenticateJWT);
router.use('/companion', authenticateJWT);
router.use('/companion/agent',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
const household = require('../services/briefing/household');
router.get('/companion/agent', handle(async () => ({ ...await household.household(), history:await household.history() })));
router.get('/companion/agent/impacts', handle(() => household.impacts()));
router.put('/companion/agent/profile', handle(r => household.saveProfile(r.body)));
router.post('/companion/agent/messages', handle(r => household.chat(r.body,Date.now(),{scope:'admin',name:r.user.username,ip:r.socket.remoteAddress})));
const guestChat=require('./pigChat');
router.get('/companion/agent/share',handle(r=>({links:guestChat.shareLinks(r)})));
router.get('/companion/agent/audit',handle(r=>guestChat.audit(r.query)));
router.delete('/companion/agent/plans/:id', handle(r => household.removePlan(r.params.id)));
router.get(
  '/news/settings',
  handle(async () => ({
    ...(await api.settings()),
    ready: Object.fromEntries(Object.entries(p.providers).map(([k, v]) => [k, !!process.env[v[1]]])),
    braveReady: !!process.env.BRAVE_API_KEY,
    usage: await db.all("SELECT * FROM briefing_usage WHERE day=date('now')")
  }))
);
router.put(
  '/news/settings',
  handle(async (r) => {
    const previous = await api.settings();
    const s = rules.config({ ...previous, ...r.body });
    const fields = Object.fromEntries(Object.entries(s).filter(([key]) => Object.hasOwn(r.body,key)));
    await patchSettings(fields);
    if (['interests', 'dislikes', 'blocked'].some(key => JSON.stringify(s[key]) !== JSON.stringify(previous[key]))) {
      await db.run('UPDATE briefing_sources SET etag=NULL,modified=NULL,due=0');
      api.notify([]);
    }
    return api.settings();
  })
);
router.post(
  '/news/model/test',
  handle(async () =>
    api.generate(await api.settings(), { title: '猪猪提醒', excerpt: '今天有雨，出门记得带伞。' })
  )
);
const presets=require('../services/briefing/presets');
router.get('/news/presets',handle(()=>presets.list()));
router.post('/news/presets/:key/subscribe',handle(r=>presets.subscribe(r.params.key)));
router.get(
  '/news/sources',
  handle(async () =>
    (await db.all('SELECT * FROM briefing_sources ORDER BY rowid DESC')).map((x) => ({
      ...x,
      ...JSON.parse(x.config),
      config: undefined
    }))
  )
);
router.post(
  '/news/sources',
  handle(async (r) => ({ id: await api.saveSource(r.body) }))
);
router.patch(
  '/news/sources/:id',
  handle(async (r) => {
    const old = await db.one('SELECT config FROM briefing_sources WHERE id=?', r.params.id);
    if (!old) throw p.fault('来源不存在', 404);
    return { id: await api.saveSource({ ...JSON.parse(old.config), ...r.body }, r.params.id) };
  })
);
router.delete(
  '/news/sources/:id',
  handle((r) => db.run('DELETE FROM briefing_sources WHERE id=?', r.params.id))
);
for (const op of ['test', 'scan'])
  router.post(
    '/news/sources/:id/' + op,
    handle((r) => api.scan(r.params.id, op === 'test'))
  );
router.get(
  '/news/events',
  handle(async (r) => {
    const offset = rules.int(Number(r.query.offset || 0), 0, 1000000, '分页');
    const state = r.query.state || '';
    if (r.query.scope === 'news') {
      const policy = await api.settings();
      if (policy.interests.length || policy.dislikes.length || policy.blocked) {
        const matches = [];
        let skipped = 0;
        for (let start = 0; matches.length < 100; start += 200) {
          const batch = await db.all("SELECT * FROM briefing_events WHERE kind IN ('news','ranking') AND (?='' OR state=?) ORDER BY updated DESC,id LIMIT 200 OFFSET ?", state,state,start);
          for (const row of batch.map(api.unpack)) {
            if (!rules.topicMatches(policy,row.payload)) continue;
            if (skipped++ >= offset) matches.push(row);
            if (matches.length === 100) break;
          }
          if (batch.length < 200) break;
        }
        return matches;
      }
    }
    return (
      await db.all(
        "SELECT * FROM briefing_events WHERE (?='' OR state=?) AND (?=0 OR kind IN ('news','ranking')) ORDER BY updated DESC LIMIT 100 OFFSET ?",
        state,
        state,
        r.query.scope === 'news' ? 1 : 0,
        offset
      )
    ).map(api.unpack);
  })
);
router.get(
  '/news/events/:id',
  handle(async (r) => {
    const event = api.unpack(await db.one('SELECT * FROM briefing_events WHERE id=?', r.params.id));
    if (!event) throw p.fault('事件不存在', 404);
    return {
      ...event,
      evidence: (
        await db.all('SELECT source_id,article FROM briefing_evidence WHERE event_id=?', event.id)
      ).map((x) => ({ ...JSON.parse(x.article), sourceId: x.source_id })),
      history: await db.all(
        'SELECT version,state,at FROM briefing_history WHERE event_id=? ORDER BY version DESC',
        event.id
      ),
      deliveries: await db.all(
        'SELECT device,component,edition,occurrence,result,claimed FROM briefing_claims WHERE event=?',
        event.id
      )
    };
  })
);
router.post(
  '/news/events/:id/actions',
  handle((r) => api.review(r.params.id, r.body))
);
async function patchSettings(fields) {
  await db.run(`INSERT INTO settings(key,value) VALUES('briefing.settings',?)
    ON CONFLICT(key) DO UPDATE SET value=json_patch(settings.value,excluded.value),updated_at=CURRENT_TIMESTAMP`,JSON.stringify(fields));
}
router.get('/companion/settings', handle(async () => ({familyAI:(await api.settings()).familyAI})));
router.put('/companion/settings', handle(async r => {
  if(typeof r.body.familyAI!=='boolean') throw p.fault('请输入家庭提醒润色开关');
  const fields={familyAI:r.body.familyAI};
  await patchSettings(fields);
  return fields;
}));
router.get(
  '/companion/rules/:id',
  handle(async (r) => {
    await api.validTargets([r.params.id]);
    return api.prefs(r.params.id);
  })
);
router.put(
  '/companion/rules/:id',
  handle(async (r) => {
    throw p.fault('请在画面编辑器中保存猪猪组件的提醒规则',410);
  })
);
router.get(
  '/companion/info/:id',
  handle(async (r) =>
    JSON.parse(
      (await db.one('SELECT targets FROM briefing_info WHERE item=?', r.params.id))?.targets || '[]'
    )
  )
);
router.post(
  '/companion/preview',
  handle(async (r) => {
    await api.validTargets([r.body.deviceId]);
    const d = await api.prefs(r.body.deviceId),
      kind = r.body.kind || 'family';
    const local = rules.localTime(Date.now(), d.zone);
    if (!['family', 'weather', 'news'].includes(kind)) throw p.fault('预览类型无效');
    const sample = {
      family: ['wave', '今晚八点停水，记得提前接水。'],
      weather: ['scarf', '今天预计最高 12℃，出门带件外套吧。'],
      news: ['point', '你关注的地铁线路有新公告。']
    }[kind];
    return {
      sample: true,
      action: sample[0],
      speech: sample[1],
      status: !d.enabled
        ? '设备提醒已关闭'
        : !d[kind === 'weather' ? 'cold' : kind] ? '此类提醒已关闭'
        : rules.between(local.time, d.quietFrom, d.quietTo)
          ? '当前处于免打扰时段'
          : d.sound
            ? '允许字幕和朗读'
            : '仅显示字幕'
    };
  })
);
async function device(req, res, next) {
  try {
    const row = await db.one('SELECT device_key FROM devices WHERE id=?', req.params.id);
    if (!row || row.device_key !== req.get('X-Device-Key'))
      return res.status(403).json({ error: '设备凭据无效' });
    next();
  } catch (e) {
    next(e);
  }
}
router.get(
  '/devices/:id/news',
  device,
  handle(async r => ({cards:await api.newsCards(r.params.id)}))
);
router.get(
  '/devices/:id/briefing',
  device,
  handle((r) => api.feed(r.params.id,Date.now(),r.query.componentId))
);
router.post(
  '/devices/:id/deliveries/:event/claim',
  device,
  handle((r) => api.claim(r.params.id, r.params.event, r.body.edition, Date.now(), r.body.occurrence,r.body.componentId))
);
router.post(
  '/devices/:id/deliveries/:event/result',
  device,
  handle(async (r) => {
    await api.result(r.params.id, r.params.event, r.body.edition, r.body.result, r.body.occurrence,r.body.componentId);
    return { ok: true };
  })
);
module.exports = router;
