const request = require('supertest');
const { setupTestApp, getAdminToken } = require('./testApp');
const db = require('../src/services/briefing/storage');
const api = require('../src/services/briefing/service');
const rules = require('../src/services/briefing/rules');
const providers = require('../src/services/briefing/providers');
const household = require('../src/services/briefing/household');
const { weather } = require('../src/services/briefing/worker');
const settingsDao = require('../src/dao/settingsDao');
let app, token;
const {bindPig,setRules}=require('./pig-fixture');
const savePrefs=(id,fields)=>setRules(id+'-scene-pig',fields);
const admin = (method, path, body) =>
  request(app)
    [method]('/api/v1' + path)
    .set('Authorization', 'Bearer ' + token)
    .send(body);
const display = (method, path, body, device = 'hall') =>
  request(app)
    [method]('/api/v1/devices/' + device + path)
    .set('X-Device-Key', device + '-test')
    .send(body);
const cfg = rules.source({
  type: 'rss',
  name: '运营方',
  url: 'https://example.org/rss',
  region: '上海',
  keywords: '2号线',
  trusted: true,
  targets: ['hall']
});
const make = (overrides = {}) => ({
  ref: 'a',
  title: '上海地铁2号线今天暂停运营',
  excerpt: '上海地铁2号线今天暂停运营',
  time: Date.now(),
  url: 'https://example.org/a',
  ...overrides
});
const ingest = (a = make(), s = cfg, preview = true, source = 'rss') =>
  api.record(source, s, a, { ...rules.defaults, preview });
beforeAll(async () => {
  app = await setupTestApp();
  token = await getAdminToken(app);
  for (const id of ['hall', 'living'])
    await db.run('INSERT INTO devices(id,name,device_key) VALUES(?,?,?)', id, id, id + '-test');
  await bindPig('hall');
});
beforeEach(async () => {
  await db.run("UPDATE components SET config='{}' WHERE id='hall-scene-pig'");
  await db.run("UPDATE pig_household SET profile='{}',plans='[]',revision=0");
  await db.run('DELETE FROM pig_conversation');
  jest.spyOn(providers, 'zaobaoDescription').mockResolvedValue('');
  for (const t of [
    'briefing_evidence',
    'briefing_claims',
    'briefing_events',
    'briefing_history',
    'briefing_sources',
    'briefing_topic_cache',
    'briefing_usage',
    'briefing_weather',
    'briefing_info',
    'info_items',
    'settings'
  ])
    await db.run('DELETE FROM ' + t);
  jest.spyOn(providers, 'model').mockImplementation(async (s, a) => ({
    summary: a.title,
    speech: a.title,
    topic: '通勤',
    tokens: 50
  }));
  await savePrefs('hall', { enabled: true, quietFrom: '00:00', quietTo: '00:00', gap: 0 });
});
afterEach(() => jest.restoreAllMocks());
async function assessRoute(newsId, now=Date.now()) {
  await household.saveProfile({revision:0,profile:{route:'上海地铁2号线'}});
  jest.spyOn(providers,'jsonCompletion').mockResolvedValue({data:{impacts:[
    {id:newsId,basis:'地铁2号线',evidence:'暂停运营',advice:'出门前查看绕行安排',repeat:true}
  ]},tokens:40});
  await household.analyze(now);
}
test('独立资讯列表使用设备范围和发布状态，开启或关闭猪猪不影响读取', async () => {
  const id = await ingest();
  await savePrefs('hall', {enabled:false});
  expect((await display('get','/news')).body.data.cards).toHaveLength(1);
  const family = await admin('post','/info-items',{type:'important',text:'家庭提醒',companion_targets:['hall']});
  expect(family.status).toBe(201);
  const result = (await display('get','/news')).body.data;
  expect(Object.keys(result)).toEqual(['cards']);
  expect(result.cards.map(x=>x.id)).toEqual([id]);
  expect((await display('get','/news',undefined,'living')).body.data.cards).toHaveLength(0);
  expect((await admin('get','/news/events?scope=news')).body.data.map(x=>x.id)).toEqual([id]);
  await api.review(id,{action:'withdraw',version:1});
  expect((await display('get','/news')).body.data.cards).toEqual([]);
});
test('保存资讯设置和家庭提醒设置互不覆盖', async () => {
  await admin('put','/companion/settings',{familyAI:true});
  await admin('put','/news/settings',{provider:'glm',model:'glm-5.3-flash',preview:false});
  expect((await admin('get','/companion/settings')).body.data.familyAI).toBe(true);
  await admin('put','/companion/settings',{familyAI:false});
  expect((await admin('get','/news/settings')).body.data).toMatchObject({model:'glm-5.3-flash',preview:false});
});
test('话题保存后立即过滤旧卡片、已排队新闻和模型调用，撤回的资讯不会恢复', async () => {
  const s = {...cfg, type:'zaobao', region:'', keywords:'', targets:[]};
  const singapore = make({ref:'sg', url:'https://www.zaobao.com.sg/news/singapore/a', title:'新加坡实行重大交通改革', excerpt:''});
  const beijing = make({ref:'cn', url:'https://www.zaobao.com.sg/news/china/b', title:'国务院发布重大交通改革', excerpt:''});
  const sg = await ingest(singapore, s), cn = await ingest(beijing, s);
  expect((await api.feed('hall')).tasks).toHaveLength(0);
  await admin('put','/news/settings',{interests:['中国'], dislikes:['娱乐']}).expect(200);
  expect((await api.feed('hall')).cards.map(e=>e.id)).toEqual([cn]);
  expect((await admin('get','/news/events?scope=news')).body.data.map(e=>e.id)).toEqual([cn]);
  await expect(api.claim('hall',sg,1)).rejects.toThrow();
  await api.review(cn,{action:'withdraw',version:1});
  const calls = providers.model.mock.calls.length;
  await api.record('other',s,{...beijing,ref:'mixed',title:'北京娱乐新闻'},await api.settings());
  expect(providers.model).toHaveBeenCalledTimes(calls);
  await admin('put','/news/settings',{interests:[],dislikes:[]}).expect(200);
  expect((await api.feed('hall')).cards.map(e=>e.id)).toEqual([sg]);
});
test('联合早报先筛选再截取，最新十二条本地报道不会挤掉中国栏目', async () => {
  providers.zaobaoDescription.mockResolvedValue('新规划将覆盖三个工业园区。');
  await admin('put','/news/settings',{interests:['中国'],dislikes:['娱乐']}).expect(200);
  const id = await api.saveSource({type:'zaobao',name:'联合早报'});
  const local = Array.from({length:12},(_,i)=>make({ref:String(i),title:'本地社区活动'+i,
    excerpt:'新加坡', url:'https://www.zaobao.com.sg/news/singapore/story'+i}));
  const china = make({title:'发布新产业规划',excerpt:'',url:'https://www.zaobao.com.sg/news/china/story13'});
  jest.spyOn(providers,'collect').mockResolvedValue({articles:[...local,china]});
  expect((await api.scan(id,true)).map(e=>e.title)).toEqual([china.title]);
  expect(await api.scan(id)).toEqual({count:1,received:13,unchanged:false,topicFallback:'模型密钥未配置'});
  expect((await api.newsCards('hall')).map(e=>e.payload.title)).toEqual([china.title]);
  expect((await api.newsCards('hall'))[0].payload.excerpt).toBe('新规划将覆盖三个工业园区。');
  await api.scan(id);
  expect(providers.zaobaoDescription).toHaveBeenCalledTimes(1);
  expect(providers.model).toHaveBeenCalledTimes(1);
});
test('语义命中贯穿试采集、自动发布、设备和后台；同文同偏好复用肯定及否定判断', async () => {
  await admin('put','/news/settings',{interests:['影响苏州通勤的事件'],dislikes:['娱乐花边']});
  const id = await api.saveSource({type:'rss',name:'市政',url:'https://example.org/news'});
  const road = make({title:'姑苏区人民路明早封闭施工',excerpt:'车辆请绕行。'});
  const show = make({ref:'show',url:'https://example.org/show',title:'影响苏州通勤的事件？艺人借此炒作',excerpt:''});
  const old = make({ref:'old',title:'昨日施工',time:Date.now()-2*86400000});
  jest.spyOn(providers,'collect').mockResolvedValue({articles:[road,show,old]});
  jest.spyOn(providers,'credential').mockResolvedValue('fixture');
  const model = jest.spyOn(providers,'jsonCompletion').mockImplementation(async (s,m)=>{
    const input = JSON.parse(m[1].content);
    expect(input.articles.map(a=>a.title)).toEqual([road.title,show.title]);
    expect(input.exclude).toEqual(['娱乐花边']);
    return {data:{matches:input.include.includes('影响苏州通勤的事件') ? [true,false] : [false,false]},tokens:70};
  });
  expect(await api.scan(id,true)).toEqual([road]);
  expect(await api.scan(id)).toEqual({count:1,received:3,unchanged:false});
  expect((await display('get','/news')).body.data.cards.map(e=>e.payload.title)).toEqual([road.title]);
  expect((await admin('get','/news/events?scope=news')).body.data.map(e=>e.payload.title)).toEqual([road.title]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(providers.model).toHaveBeenCalledTimes(1);
  await admin('put','/news/settings',{interests:['航空']});
  expect(await api.scan(id)).toMatchObject({count:0});
  expect((await api.feed('hall')).cards).toEqual([]);
  expect(model).toHaveBeenCalledTimes(2);
});
test.each(['次数','令牌','服务错误','响应不完整'])('话题判断遇到%s回退，模型恢复后重读相同 RSS 并发布非字面命中', async failure=>{
  await admin('put','/news/settings',{interests:['苏州'],dailyCalls:failure==='次数'?0:500,dailyTokens:failure==='令牌'?0:-1});
  const id = await api.saveSource({type:'rss',name:'本地',url:'https://example.org/rss'});
  const articles = [make({title:'苏州公交调整',excerpt:''}),make({ref:'b',url:'https://example.org/b',title:'姑苏区明早交通管制',excerpt:''})];
  const collector = jest.spyOn(providers,'collect').mockResolvedValue({articles,etag:'tag'});
  jest.spyOn(providers,'credential').mockResolvedValue('fixture');
  const model = jest.spyOn(providers,'jsonCompletion').mockResolvedValue({data:{matches:[true,true]},tokens:44});
  if (failure==='服务错误') model.mockRejectedValueOnce(providers.fault('供应商 HTTP 503',502));
  if (failure==='响应不完整') {
    const invalid = {data:{matches:[true]},tokens:25};
    model.mockResolvedValueOnce(invalid).mockResolvedValueOnce(invalid);
  }
  const first = await api.scan(id);
  expect(first).toMatchObject({count:1,topicFallback:expect.any(String)});
  expect(model).toHaveBeenCalledTimes(['次数','令牌'].includes(failure)?0:failure==='响应不完整'?2:1);
  await admin('put','/news/settings',{dailyCalls:500,dailyTokens:-1});
  expect(await api.scan(id)).toEqual({count:2,received:2,unchanged:false});
  expect(collector.mock.calls[1][1]).toEqual({});
  expect((await api.newsCards('hall')).map(e=>e.payload.title).sort()).toEqual(articles.map(a=>a.title).sort());
});
test('GLM 截断 JSON 时按实际用量结算并重试，成功判断覆盖字面规则',async()=>{
  await admin('put','/news/settings',{interests:['苏州'],dailyCalls:2,dailyTokens:-1});
  const id = await api.saveSource({type:'rss',name:'本地',url:'https://example.org/rss'});
  const road = make({title:'姑苏区明早交通管制',excerpt:''});
  jest.spyOn(providers,'collect').mockResolvedValue({articles:[road]});
  jest.spyOn(providers,'credential').mockResolvedValue('fixture');
  const model = jest.spyOn(providers,'jsonCompletion')
    .mockRejectedValueOnce(Object.assign(new Error('截断'),{code:'MODEL_JSON_FORMAT',tokens:1050}))
    .mockResolvedValueOnce({data:{matches:[true]},tokens:900});
  expect(await api.scan(id,true)).toEqual([road]);
  expect(model.mock.calls.map(call=>call[2])).toEqual([1024,2048]);
  expect(await db.one('SELECT calls,tokens FROM briefing_usage')).toEqual({calls:2,tokens:1950});
});
test('来源地区和关注词支持同义表达，设备上多个资讯组件按各自的语义偏好播放',async()=>{
  const id = await api.saveSource({type:'ranking',name:'热搜',url:'https://example.org/rank',region:'苏州',keywords:'交通管制'});
  const road = make({title:'姑苏区人民路车辆请绕行',excerpt:'明早临时封闭。',rank:1});
  jest.spyOn(providers,'collect').mockResolvedValue({articles:[road]});
  jest.spyOn(providers,'credential').mockResolvedValue('fixture');
  const model = jest.spyOn(providers,'jsonCompletion').mockImplementation(async(s,m)=>{
    const input = JSON.parse(m[1].content);
    if (input.include.includes('交通管制')) expect(input.region).toBe('苏州');
    return {data:{matches:[!input.include.includes('体育')]},tokens:32};
  });
  for (const [cid,keyword] of [['commute','出行'],['sports','体育']]) {
    await db.run("INSERT INTO components(id,scene_id,type,position,config) VALUES(?,'hall-scene','headlines','{}',?)",cid,JSON.stringify({keywords:[keyword]}));
  }
  try {
    expect(await api.scan(id)).toMatchObject({count:1});
    expect((await display('get','/news')).body.data.cards[0].topicComponents).toEqual(['commute']);
    expect((await api.feed('hall')).cards[0].topicComponents).toEqual(['commute']);
    expect(model).toHaveBeenCalledTimes(3);
  } finally { await db.run("DELETE FROM components WHERE id IN ('commute','sports')"); }
});
test('同一设备可领取三类提醒，关闭某类立即停止该类，资讯卡仍可读', async () => {
  const now = Date.parse('2026-11-05T00:00:00Z');
  const d = {...await api.prefs('hall'),cold:true,city:'北京'};
  await savePrefs('hall', d);
  for(const [day,t] of [['2026-11-04',18],['2026-11-05',10]])
    await db.run('INSERT INTO briefing_weather VALUES(?,?,?)','open-meteo-city||北京|Asia/Shanghai',day,t);
  await weather('hall', d, now);
  const news = await api.record('source',cfg,make({time:now}),rules.defaults,now);
  await assessRoute(news,now);
  await db.run(`INSERT INTO briefing_events(id,kind,identity,state,payload,targets,starts,expires,updated)
    VALUES('family-test','family','family-test','published',?,'["hall"]',?,?,?)`,
    JSON.stringify({speak:true,speakUntil:now+3600000,speech:'家庭提醒'}),now,now+3600000,now);
  expect((await api.feed('hall',now)).tasks.map(e=>e.kind).sort()).toEqual(['family','news','weather']);
  await savePrefs('hall',{family:false,news:false});
  const feed = await api.feed('hall',now);
  expect(feed.tasks.map(e=>e.kind)).toEqual(['weather']);
  expect(feed.cards.map(e=>e.id)).toEqual([news]);
  await expect(api.claim('hall',news,1,now)).rejects.toThrow();
});
test('管理员鉴权、设备鉴权及凭据隔离', async () => {
  expect((await request(app).get('/api/v1/news/settings')).status).toBe(401);
  expect(
    (await request(app).get('/api/v1/devices/hall/briefing').set('X-Device-Key', 'living-test')).status
  ).toBe(403);
  const s = (await admin('get', '/news/settings')).body.data;
  expect(s.ready).toHaveProperty('glm');
  expect(s).not.toHaveProperty('apiKey');
});
test('新建订阅、仅试采集、正式采集、304 及启动后去重', async () => {
  const res = await admin('post', '/news/sources', cfg);
  const id = res.body.data.id;
  const article = make();
  const fetcher = jest
    .spyOn(providers, 'collect')
    .mockResolvedValue({ articles: [article], etag: 'tag' });
  expect((await admin('post', '/news/sources/' + id + '/test')).body.data).toHaveLength(1);
  expect(await db.all('SELECT * FROM briefing_events')).toHaveLength(0);
  expect((await admin('post', '/news/sources/' + id + '/scan')).body.data).toEqual({count:1,received:1,unchanged:false,topicFallback:'模型密钥未配置'});
  await api.scan(id);
  fetcher.mockResolvedValueOnce({ articles: [], unchanged: true });
  await api.scan(id);
  expect(await db.all('SELECT * FROM briefing_events')).toHaveLength(1);
  expect(providers.model).toHaveBeenCalledTimes(1);
  expect((await db.one('SELECT etag FROM briefing_sources')).etag).toBe('tag');
});
test('聊天保存航班、请求幂等，只有与计划及新闻原文均有依据的资讯能提醒',async()=>{
  expect((await request(app).get('/api/v1/companion/agent')).status).toBe(401);
  const message={requestId:'trip',message:'下个月搭乘 MU5123 去上海'};
  const model=jest.spyOn(providers,'jsonCompletion').mockResolvedValueOnce({data:{
    reply:'记下了。',add:[{text:'搭乘 MU5123 去上海',start:'',end:''}],remove:[]},tokens:50});
  const url='/companion/agent/messages';
  await admin('post',url,message).expect(200);
  await admin('post',url,message).expect(200);
  await admin('post',url,{...message,message:'另一条消息'}).expect(409);
  expect(model).toHaveBeenCalledTimes(1);
  const h=(await admin('get','/companion/agent')).body.data;
  expect(h.plans).toHaveLength(1);expect(h.history).toHaveLength(1);
  const s={...cfg,keywords:'',region:''};
  const flight=await ingest(make({title:'MU5123 可能因罢工延误',excerpt:'请向航司核实'}),s);
  const other=await ingest(make({ref:'other',url:'https://example.org/other',title:'绘画展开展',excerpt:'周末开放'}),s);
  model.mockResolvedValue({data:{impacts:[
    {id:flight,basis:'MU5123',evidence:'可能因罢工延误',advice:'先核实航班状态。',repeat:true},
    {id:other,basis:'MU5123',evidence:'航班取消',advice:'不要出发。',repeat:true}
  ]},tokens:30});
  await household.analyze();
  await household.analyze();
  expect(model).toHaveBeenCalledTimes(2);
  expect((await api.feed('hall')).tasks.map(e=>e.id)).toEqual([flight]);
  expect((await api.feed('living')).tasks).toEqual([]);
  await admin('delete','/companion/agent/plans/'+h.plans[0].id).expect(200);
  expect((await api.feed('hall')).tasks).toEqual([]);
  await expect(api.claim('hall',flight,1)).rejects.toThrow();
});
test('模型不可用时保留原资料与计划，旧版本资料不能覆盖更新',async()=>{
  await admin('put','/companion/agent/profile',{revision:0,profile:{members:2,home:'甲小区',route:'青禾路'}}).expect(200);
  await admin('put','/companion/agent/profile',{revision:0,profile:{members:6}}).expect(409);
  jest.spyOn(providers,'jsonCompletion').mockRejectedValue(providers.fault('供应商不可用',502));
  await admin('post','/companion/agent/messages',{requestId:'error',message:'坐航班去上海'}).expect(502);
  const h=(await admin('get','/companion/agent')).body.data;
  expect(h.history).toHaveLength(0);expect(h.plans).toHaveLength(0);expect(h.profile.members).toBe(2);
});
test('重复提醒按设备间隔及上限执行，双屏竞争和迟到回执不会冲掉下一次播放',async()=>{
  const now=Date.now();
  await savePrefs('hall',{repeatMinutes:1,maxPlays:2,gap:0});
  const id=await api.record('fixture',cfg,make({time:now}),rules.defaults,now);
  await assessRoute(id,now);
  const first=await api.claim('hall',id,1,now);
  expect(first.occurrence).toBe(1);
  await api.result('hall',id,1,'subtitle',1);
  expect((await api.feed('hall',now+59999)).tasks).toHaveLength(0);
  await expect(api.claim('hall',id,1,now+60000,1)).rejects.toThrow();
  const claims=await Promise.allSettled([1,2].map(()=>api.claim('hall',id,1,now+60000,2)));
  expect(claims.filter(x=>x.status==='fulfilled').map(x=>x.value.occurrence)).toEqual([2]);
  await expect(api.result('hall',id,1,'interrupted',1)).rejects.toThrow();
  await api.result('hall',id,1,'subtitle',2);
  expect((await api.feed('hall',now+120000)).tasks).toHaveLength(0);
  await household.saveProfile({revision:1,profile:{route:'其他路线'}});
  expect((await api.feed('hall',now+120000)).active).toEqual([]);
});
test('同屏两只猪分别领取和回执；共享同一组件的另一屏使用同一配置，但拥有独立播放次数',async()=>{
  const second=await bindPig('hall','other-scene'), pig='hall-scene-pig';
  try {
    await db.run("INSERT INTO device_scenes(device_id,scene_id) VALUES('living','hall-scene')");
    await setRules(second,{enabled:true,family:false,quietFrom:'00:00',quietTo:'00:00',gap:0});
    const item=(await admin('post','/info-items',{type:'urgent',text:'今晚停水',companion_targets:['hall','living']})).body.data;
    expect((await api.feed('hall',Date.now(),second)).tasks).toEqual([]);
    expect((await api.feed('hall')).tasks).toEqual([]);
    expect((await api.feed('living',Date.now(),pig)).preferences).toEqual((await api.feed('hall',Date.now(),pig)).preferences);
    await expect(api.feed('living',Date.now(),second)).rejects.toMatchObject({status:403});
    await api.claim('hall',item.id,1,Date.now(),1,pig);
    await setRules(second,{family:true});
    await api.claim('hall',item.id,1,Date.now(),1,second);
    await api.result('hall',item.id,1,'subtitle',1,pig);
    expect(await db.one('SELECT result FROM briefing_claims WHERE component=?',second)).toEqual({result:'claimed'});
    expect((await api.feed('living',Date.now(),pig)).tasks).toHaveLength(1);
    await admin('put','/companion/rules/hall',{enabled:false}).expect(410);
    await admin('put','/scenes/hall-scene/components/'+pig,{config:{reminders:{repeatMinutes:0}}}).expect(400);
  } finally {
    await db.run("DELETE FROM device_scenes WHERE device_id='living' AND scene_id='hall-scene'");
    await db.run("DELETE FROM scenes WHERE id='other-scene'");
  }
});
test('新恢复公告使旧结论失效，重新判断后播报停止但新闻仍可阅读',async()=>{
  const now=Date.parse('2026-11-05T03:00:00Z');
  const closed=await api.record('test',cfg,make({time:now}),rules.defaults,now);
  await assessRoute(closed,now);
  expect((await api.feed('hall',now)).tasks).toHaveLength(1);
  await api.record('test',cfg,make({ref:'open',url:'https://example.org/open',title:'上海地铁2号线恢复运营',excerpt:'恢复通行',time:now+1000}),rules.defaults,now+1000);
  expect((await api.feed('hall',now+1000)).active).toEqual([]);
  providers.jsonCompletion.mockResolvedValue({data:{impacts:[]},tokens:30});
  await household.analyze(now+1000);
  const args=JSON.parse(providers.jsonCompletion.mock.lastCall[1][1].content);
  expect(args.updates.some(e=>e.title.includes('恢复运营'))).toBe(true);
  const feed=await api.feed('hall',now+1000);
  expect(feed.tasks).toEqual([]);expect(feed.cards.length).toBeGreaterThan(0);
});
test('到期行程不作为判断依据，没有有效计划或地址就不调用模型',async()=>{
  const now=Date.parse('2026-11-05T03:00:00Z');
  await db.run('UPDATE pig_household SET plans=?',JSON.stringify([{id:'old',text:'搭乘 MU5123',end:'2026-11-04'}]));
  await api.record('test',cfg,make({time:now}),rules.defaults,now);
  const model=jest.spyOn(providers,'jsonCompletion');
  await household.analyze(now);
  expect(model).not.toHaveBeenCalled();
  expect((await api.feed('hall',now)).active).toEqual([]);
});
test('采集失败保留原记录并退避', async () => {
  const id = await api.saveSource(cfg);
  jest.spyOn(providers, 'collect').mockRejectedValue(new Error('订阅超时'));
  await expect(api.scan(id)).rejects.toThrow();
  expect(await db.one('SELECT error,due FROM briefing_sources WHERE id=?', id)).toMatchObject({
    error: '订阅超时',
    due: expect.any(Number)
  });
});
test('来源连接异常在试采集和手动采集返回具体原因，不泄露底层地址', async () => {
  const id=await api.saveSource(cfg);
  jest.spyOn(providers,'collect').mockRejectedValue(Object.assign(new TypeError('fetch failed'),{cause:{code:'EAI_AGAIN'}}));
  for (const op of ['test','scan']) {
    const res=await admin('post','/news/sources/'+id+'/'+op);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain(cfg.name+'：域名解析失败');
  }
});
test('自动发布定向、领取竞争、回执幂等、撤回', async () => {
  const id = await ingest();
  await assessRoute(id);
  expect((await api.feed('hall')).cards).toHaveLength(1);
  expect((await display('get', '/briefing')).body.data.cards).toHaveLength(1);
  expect((await api.feed('living')).cards).toHaveLength(0);
  const jobs = await Promise.all(
    [1, 2].map(() => display('post', '/deliveries/' + id + '/claim', { edition: 1 }))
  );
  expect(jobs.map((r) => r.status).sort()).toEqual([200, 409]);
  for (let i = 0; i < 2; i++)
    expect(
      (await display('post', '/deliveries/' + id + '/result', { edition: 1, result: 'subtitle' })).status
    ).toBe(200);
  expect(
    (await display('post', '/deliveries/' + id + '/result', { edition: 1, result: 'spoken' }, 'living'))
      .status
  ).toBe(409);
  expect(
    (await admin('post', '/news/events/' + id + '/actions', { action: 'withdraw', version: 0 })).status
  ).toBe(409);
  await api.review(id, { action: 'withdraw', version: 1 });
  expect((await api.feed('hall')).active).toEqual([]);
});
test('同一公告多来源并发入库只调模型一次，恢复公告生成新版', async () => {
  const a = make();
  await Promise.all([
    ingest(a, cfg, false),
    ingest({ ...a, ref: 'b', url: 'https://example.org/b' }, cfg, false, 'other')
  ]);
  expect(await db.all('SELECT * FROM briefing_events')).toHaveLength(1);
  expect(await db.all('SELECT * FROM briefing_evidence')).toHaveLength(2);
  expect(providers.model).toHaveBeenCalledTimes(1);
  await ingest(
    make({
      ref: 'c',
      url: 'https://example.org/c',
      title: '上海地铁2号线今天恢复运营',
      time: a.time + 1000
    }),
    cfg,
    false
  );
  expect((await api.feed('hall')).cards[0]).toMatchObject({
    edition: 2,
    payload: { title: '上海地铁2号线今天恢复运营' }
  });
});
test('不同地区分开，冲突更新显示卡片并暂停主动提醒', async () => {
  const a = make();
  await ingest(a, cfg, false);
  await ingest(
    make({ title: '深圳地铁2号线今天暂停运营', ref: 'sz', url: 'https://example.org/sz' }),
    { ...cfg, region: '深圳' },
    false
  );
  expect(await db.all('SELECT * FROM briefing_events')).toHaveLength(2);
  await ingest(
    make({ title: '上海地铁2号线今天恢复运营', ref: 'b', url: 'https://example.org/b' }),
    { ...cfg, trusted: false },
    false,
    'media'
  );
  expect((await db.one("SELECT state FROM briefing_events WHERE identity LIKE '%上海%'")).state).toBe(
    'published'
  );
  expect((await api.feed('hall')).tasks.some(e => e.payload.title.includes('上海'))).toBe(false);
});
test('手动合并、拆分保留来源并使旧版本失效', async () => {
  const a = await ingest();
  const b = await ingest(make({ ref: 'b', url: 'https://example.org/b', title: '上海2号线公告更正' }));
  await api.review(b, { action: 'merge', version: 1, destination: a, destinationVersion: 1 });
  expect(await db.all('SELECT ref FROM briefing_evidence WHERE event_id=?', a)).toHaveLength(2);
  const split = await api.review(a, { action: 'split', version: 2, source: 'rss', ref: 'b' });
  expect(split.state).toBe('published');
  expect(split.payload.title).toBe('上海2号线公告更正');
});
test('预算并发预留不会透支，模型失败自动使用新闻标题', async () => {
  const calls = await Promise.allSettled([
    api.reserve('test', 1, 1000, 500),
    api.reserve('test', 1, 1000, 500)
  ]);
  expect(calls.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  providers.model.mockRejectedValueOnce(new Error('供应商不可用'));
  const id = await ingest(make(), cfg, false);
  expect((await admin('get', '/news/events/' + id)).body.data).toMatchObject({
    state: 'published',
    payload: { summary: make().title, speak: true }
  });
});
test('不限额时仍累计次数和令牌，两项可独立限额', async () => {
  const saved = await admin('put','/news/settings',{dailyCalls:-1,dailyTokens:-1});
  expect(saved.body.data).toMatchObject({dailyCalls:-1,dailyTokens:-1});
  await Promise.all([api.reserve('glm',-1,-1,2000),api.reserve('glm',-1,-1,3000)]);
  await expect(api.reserve('glm',2,-1,1)).rejects.toThrow('调用次数');
  await expect(api.reserve('glm',-1,5000,1)).rejects.toThrow('剩余令牌');
  await expect(api.reserve('glm',0,-1,1)).rejects.toThrow('调用次数');
  await expect(api.reserve('glm',-1,0,1)).rejects.toThrow('剩余令牌');
  expect(await db.one("SELECT calls,tokens FROM briefing_usage WHERE provider='glm'")).toEqual({calls:2,tokens:5000});
});
test('管理员可轮换服务商密钥，新调用读取新值，访客不能写入，设置接口不回显', async () => {
  const url='/model/credentials/deepseek';
  await request(app).put('/api/v1'+url).send({apiKey:'anonymous'}).expect(401);
  const upstream=jest.spyOn(global,'fetch').mockResolvedValue({
    ok:true, json:async()=>({choices:[{message:{content:'{}'}}],usage:{total_tokens:8}})
  });
  try {
    for(const key of ['unit-test-first','unit-test-second']) {
      const saved=await admin('put',url,{apiKey:key});
      expect(saved.body).toEqual({data:{ready:true}});
      expect(await providers.credential('deepseek')).toBe(key);
      await providers.jsonCompletion({provider:'deepseek',model:'deepseek-chat'},[],20);
      expect(upstream.mock.lastCall[1].headers.Authorization).toBe('Bearer '+key);
      const settings=await admin('get','/news/settings');
      expect(settings.body.data.ready.deepseek).toBe(true);
      expect(settings.text).not.toContain(key);
    }
    expect((await admin('put',url,{apiKey:'   '})).status).toBe(400);
    expect(await providers.credential('deepseek')).toBe('unit-test-second');
  } finally { await db.run("DELETE FROM provider_credentials WHERE provider='deepseek'"); }
});
test('排行名次变更只更新卡片，同一版本不产生新提醒', async () => {
  const s = { ...cfg, type: 'ranking', trusted: false, keywords: '', region: '' };
  await ingest(make({ rank: 3 }), s, false);
  await ingest(make({ rank: 1 }), s, false);
  expect((await api.feed('hall')).cards[0]).toMatchObject({
    edition: 1,
    payload: { rank: 1, speak: false }
  });
});
test('家庭信息保存、生效、显式重播、降级与删除', async () => {
  const start = new Date(Date.now() + 600000).toISOString();
  let res = await admin('post', '/info-items', {
    type: 'urgent',
    text: '晚上八点停水',
    start_time: start,
    companion_targets: ['hall']
  });
  expect(res.status).toBe(201);
  const id = res.body.data.id;
  expect((await api.feed('hall')).tasks).toEqual([]);
  await admin('put', '/info-items/' + id, { start_time: new Date(Date.now() - 1000).toISOString() });
  await api.claim('hall', id, 1);
  await admin('put', '/info-items/' + id, { text: '晚上八点停水。', companion_targets: ['hall'] });
  expect((await api.feed('hall')).tasks).toEqual([]);
  await admin('put', '/info-items/' + id, { replay: true, companion_targets: ['hall'] });
  expect((await api.feed('hall')).tasks[0].edition).toBe(2);
  await admin('put', '/info-items/' + id, { type: 'info' });
  expect((await api.feed('hall')).active).toEqual([]);
  await admin('delete', '/info-items/' + id);
  expect(providers.model).not.toHaveBeenCalled();
});
test('家庭信息非法时间及未知设备均不写入', async () => {
  for (const fields of [
    { start_time: 'bad' },
    { start_time: '2026-11-06', end_time: '2026-11-03' },
    { companion_targets: ['unknown'] }
  ]) {
    expect((await admin('post', '/info-items', { text: 'test', ...fields })).status).toBe(400);
  }
  expect(await db.all('SELECT * FROM info_items')).toEqual([]);
});
test('普通卡片到期移除，免打扰、设备关闭、播报过期不能领取', async () => {
  const now = Date.now(),
    id = await ingest(make(), cfg, false);
  const t = rules.localTime(now, 'Asia/Shanghai').time;
  await savePrefs('hall', {
    enabled: true,
    quietFrom: t,
    quietTo: t === '00:00' ? '23:59' : '00:00'
  });
  await expect(api.claim('hall', id, 1, now)).rejects.toThrow();
  await savePrefs('hall', { enabled: false });
  expect((await api.feed('hall', now)).tasks).toEqual([]);
  expect((await api.feed('hall', now + 26 * 3600000)).cards).toEqual([]);
});
test.each([
  [18, 13, 1],
  [18, 14, 0],
  [null, 13, 0]
])('天气昨日 %s 今日 %s → %i 个任务', async (y, t, count) => {
  const d = rules.device({
    enabled: true,
    cold: true,
    city: '北京',
    weekdays: true
  });
  const city = 'open-meteo-city||北京|Asia/Shanghai',
    now = Date.parse('2026-11-05T00:00:00Z');
  if (y !== null) await db.run('INSERT INTO briefing_weather VALUES(?,?,?)', city, '2026-11-04', y);
  await db.run('INSERT INTO briefing_weather VALUES(?,?,?)', city, '2026-11-05', t);
  await weather('hall', d, now);
  await weather('hall', d, now);
  expect(await db.all("SELECT * FROM briefing_events WHERE kind='weather'")).toHaveLength(count);
});
test('晨间快照验证供应商单位、日期和城市，休息日不提醒', async () => {
  const d = rules.device({ enabled: true, cold: true, city: '深圳市' });
  const upstream = jest.spyOn(providers, 'remote').mockResolvedValueOnce({results:[
    {name:'深圳',feature_code:'PPLA2',latitude:22.54,longitude:114.06}
  ]}).mockResolvedValue({
    daily: { time: ['2026-11-07'], temperature_2m_max: [11] },
    daily_units: { temperature_2m_max: '°C' }
  });
  await weather('hall', d, Date.parse('2026-11-06T22:55Z'));
  expect(new URL(upstream.mock.calls[0][0]).searchParams.get('name')).toBe('深圳');
  expect(new URL(upstream.mock.calls[1][0]).searchParams.get('latitude')).toBe('22.54');
  expect(await db.all('SELECT * FROM briefing_weather')).toHaveLength(1);
  await weather('hall', d, Date.parse('2026-11-06T23:30Z'));
  expect(await db.all('SELECT * FROM briefing_events')).toEqual([]);
});
test('保存时核实市名，同名小村不能当城市；拼写错误或上游故障不覆盖原设置', async () => {
  const path='/scenes/hall-scene/components/hall-scene-pig';
  const save = (city) => admin('put', path, {config:{reminders:{cold:true,city}}});
  const up=jest.spyOn(providers,'remote').mockResolvedValueOnce({results:[
    {name:'朝阳',admin1:'吉林',feature_code:'PPL',latitude:40,longitude:122}
  ]}).mockResolvedValueOnce({results:[
    {name:'朝阳市',admin1:'辽宁',feature_code:'PPLA2',latitude:41.6,longitude:120.5}
  ]});
  expect((await save('辽宁/朝阳市').expect(200)).body.data.config.reminders.city).toBe('辽宁/朝阳市');
  expect(up).toHaveBeenCalledTimes(2);
  up.mockResolvedValue({results:[]});
  await save('查无此市').expect(400);
  up.mockRejectedValueOnce(new Error('offline'));
  await save('其他市').expect(502);
  expect((await api.prefs('hall')).city).toBe('辽宁/朝阳市');
});
test('同一公告只修改生效时间也必须生成新版本', async () => {
  const a = make({ excerpt: '今日10:00停运' });
  const id = await ingest(a, cfg, false);
  await ingest({ ...a, excerpt: '今日12:00停运' }, cfg, false);
  expect((await db.one('SELECT edition FROM briefing_events WHERE id=?', id)).edition).toBe(2);
});
test('更换城市、关闭天气或提高阈值后，已排队的旧降温提醒不能领取', async () => {
  const d = rules.device({
    enabled: true,
    cold: true,
    city: '北京',
    quietFrom: '00:00',
    quietTo: '00:00'
  });
  const now = Date.parse('2026-11-05T00:00:00Z');
  for (const [day, t] of [
    ['2026-11-04', 18],
    ['2026-11-05', 13]
  ])
    await db.run(
      'INSERT INTO briefing_weather VALUES(?,?,?)',
      'open-meteo-city||北京|Asia/Shanghai',
      day,
      t
    );
  await savePrefs('hall', d);
  await weather('hall', d, now);
  expect((await api.feed('hall', now)).tasks).toHaveLength(1);
  await savePrefs('hall', {city:'北京市'});
  expect((await api.feed('hall', now)).tasks).toHaveLength(1);
  for (const replacement of [{ city: '上海' }, { cold: false }, { threshold: 6 }]) {
    await savePrefs('hall', { ...d, ...replacement });
    expect((await api.feed('hall', now)).tasks).toHaveLength(0);
  }
});
test('家庭信息在模型调用中被删除时，迟到的结果不得重新发布', async () => {
  await settingsDao.set('briefing.settings', { familyAI: true });
  await db.run(
    "INSERT INTO info_items(id,type,text,companion_targets) VALUES('race','important','出门带伞',?)",
    JSON.stringify(['hall'])
  );
  let resume, start;
  const started = new Promise((r) => (start = r));
  providers.model.mockImplementationOnce(() => {
    start();
    return new Promise((r) => (resume = r));
  });
  const pending = api.syncFamily('race');
  await started;
  await db.run("DELETE FROM info_items WHERE id='race'");
  resume({ speech: '出门带伞', tokens: 8 });
  await pending;
  expect((await api.feed('hall')).tasks).toHaveLength(0);
});
test('家庭信息开启模型润色后才发送', async () => {
  await settingsDao.set('briefing.settings', { familyAI: true });
  await admin('post', '/info-items', {
    type: 'important',
    text: '记得带伞',
    companion_targets: ['hall']
  });
  expect(providers.model).toHaveBeenCalledTimes(1);
  await api.feed('hall');
  expect(providers.model).toHaveBeenCalledTimes(1);
});
