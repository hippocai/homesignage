const {setupTestApp}=require('./testApp');
const db=require('../src/services/briefing/storage'),api=require('../src/services/briefing/service');
const agent=require('../src/services/briefing/weather-agent'),h=require('../src/services/briefing/household');
const p=require('../src/services/briefing/providers'),settings=require('../src/dao/settingsDao');
const destinations=require('../src/services/briefing/weather-destinations'),fixture=require('./pig-fixture');
const future=require('../src/services/briefing/future-weather');
const now=Date.parse('2026-11-08T08:00+08:00');
const iso=t=>new Date(t).toISOString();
let component,d,household,model,bundle;
const section=items=>({status:'fresh',fetchedAt:iso(now),source:'QWeather',items,attributions:[]});
beforeAll(setupTestApp);
beforeEach(async()=>{
  for(const table of ['briefing_events','pig_weather_state','briefing_usage','pig_chat_audit','pig_conversation','components','device_scenes','devices','scenes'])await db.run('DELETE FROM '+table);
  await db.run('UPDATE pig_household SET profile=?,plans=\'[]\',revision=0',JSON.stringify({memory:'住在苏州，工作日8点骑车经过青禾路上班。',zone:'Asia/Shanghai'}));
  await settings.set('briefing.settings',{dailyCalls:-1,dailyTokens:-1});
  await db.run("INSERT INTO devices(id,name,device_key) VALUES('weather-screen','天气屏','key')");component=await fixture.bindPig('weather-screen');
  await fixture.setRules(component,{enabled:true,cold:true,city:'苏州',quietFrom:'00:00',quietTo:'00:00',weekdays:false,from:'07:00',to:'09:00',gap:0});
  d=(await api.boundPig('weather-screen',component)).prefs;household=await h.household();
  bundle={city:'苏州',daily:section([{start:'2026-11-08T00:00+08:00',end:'2026-11-09T00:00+08:00',highC:20,lowC:15},{start:'2026-11-09T00:00+08:00',end:'2026-11-10T00:00+08:00',highC:12,lowC:6}]),hourly:section([{time:iso(now+3600000),rainPercent:80,rainMm:2,windMs:4,gustMs:6}]),alerts:section([])};
  model=jest.spyOn(p,'jsonCompletion').mockImplementation(async(s,m)=>{
    const input=JSON.parse(m[1].content);
    return {data:{reminders:input.candidates.filter(c=>c.city==='苏州').map(c=>({id:c.id,scope:'memory',basis:'青禾路',advice:'骑车前注意天气，准备外套和雨具。',start:iso(now),until:iso(c.end)}))},tokens:30};
  });
});
afterEach(()=>jest.restoreAllMocks());
const analyze=(time=now)=>agent.analyzeComponent(component,['weather-screen'],d,household,[bundle],time);
async function events(){return (await db.all("SELECT * FROM briefing_events WHERE state='published'")).map(api.unpack);}
test('未来降温与逐小时降雨进入模型，结合记忆提前进入屏幕领取与审计回执链路',async()=>{
  await analyze();const rows=await events();expect(rows).toHaveLength(2);
  const input=JSON.parse(model.mock.calls[0][1][1].content);expect(input.profile.memory).toBe(household.profile.memory);expect(input.weather[0].hourly.items[0].rainPercent).toBe(80);
  const feed=await api.feed('weather-screen',now,component);expect(feed.tasks).toHaveLength(2);
  const task=feed.tasks[0];await api.claim('weather-screen',task.id,task.edition,now,1,component);
  await api.result('weather-screen',task.id,task.edition,'subtitle',1,component);
  expect((await db.one('SELECT result FROM briefing_claims WHERE event=?',task.id)).result).toBe('subtitle');
});
test('不变风险不重复调用模型，不重建记录、不增加播报版本',async()=>{
  await analyze();const before=await events();await analyze(now+60000);
  expect(model).toHaveBeenCalledTimes(1);const after=await events();expect(after.map(x=>[x.id,x.edition,x.version])).toEqual(before.map(x=>[x.id,x.edition,x.version]));
});
test('官方预警更新原记录；解除后不能继续领取旧播报',async()=>{
  const warning={id:'official-1',issuer:'苏州市气象台',event:'大风',title:'大风黄色预警',description:'预计阵风增强',issued:iso(now-60000),onset:iso(now+3600000),start:iso(now),end:iso(now+86400000),messageType:'alert',severity:'moderate',color:'yellow',supersedes:[]};
  bundle.daily=section([]);bundle.hourly=section([]);bundle.alerts=section([warning]);await analyze();const [old]=await events();
  bundle.alerts=section([{...warning,id:'official-2',title:'大风橙色预警',color:'orange',onset:iso(now+25*3600000),end:iso(now+48*3600000),messageType:'update',supersedes:['official-1']}]);await analyze();
  const [updated]=await events();expect(updated.id).toBe(old.id);expect(updated.edition).toBe(2);expect(updated.payload.speech).toContain('橙色');
  bundle.alerts=section([{...warning,id:'cancel',messageType:'cancel',supersedes:['official-2']}]);await analyze();
  expect(await events()).toEqual([]);await expect(api.claim('weather-screen',old.id,1,now,1,component)).rejects.toMatchObject({status:409});
});
test('未知或过期天气不生成新的主动提醒，不把缺失说成安全',async()=>{
  bundle.daily.status='stale';bundle.hourly.status='unavailable';
  await analyze();expect(await events()).toEqual([]);expect(model).not.toHaveBeenCalled();
});
test('取消计划或修改家庭资料后，已排队提醒立即隐藏',async()=>{
  await analyze();expect((await api.feed('weather-screen',now,component)).tasks.length).toBeGreaterThan(0);
  await h.saveProfile({revision:0,profile:{memory:'已搬家到北京'}});
  expect((await api.feed('weather-screen',now,component)).tasks).toEqual([]);
});
test('免打扰与组件天气开关仍有效，提前提醒不受旧早晨时窗限制',async()=>{
  await analyze();const t=now+3600000;
  expect((await api.feed('weather-screen',t,component)).tasks.length).toBeGreaterThan(0);
  await fixture.setRules(component,{quietFrom:'08:00',quietTo:'10:00'});expect((await api.feed('weather-screen',t,component)).tasks).toEqual([]);
  await fixture.setRules(component,{cold:false});expect((await api.feed('weather-screen',t,component)).tasks).toEqual([]);
});
test('旅行日期不相交、异地scope或伪造家庭依据一律不能生成提醒',()=>{
  const c={...agent.candidates(bundle,d,now)[0],scopes:['trip']};
  const hh={...household,plans:[{id:'trip',text:'月底去苏州旅游',start:'2026-11-28',end:'2026-11-30'}]};
  const choice={scope:'trip',basis:'苏州',advice:'带外套',start:iso(now),until:iso(c.end)};
  expect(agent.validate(choice,c,hh,d,now)).toBeNull();
  expect(agent.validate({...choice,scope:'memory',basis:'青禾路'},c,hh,d,now)).toBeNull();
  expect(agent.validate({...choice,basis:'并不存在'},c,hh,d,now)).toBeNull();
});
test('旅行72小时内可提前提醒，家庭日常预报不得早于24小时',()=>{
  const c={...agent.candidates(bundle,d,now)[0],start:now+48*3600000,end:now+72*3600000,validUntil:now+2*3600000,scopes:['trip','memory']};
  const hh={...household,plans:[{id:'trip',text:'11月10日去苏州',start:'2026-11-10',end:'2026-11-11'}]};
  const choice={scope:'trip',basis:'苏州',advice:'提前带外套',start:iso(now),until:iso(c.end)};
  expect(agent.validate(choice,c,hh,d,now).start).toBe(now);
  expect(agent.validate({...choice,scope:'memory',basis:'青禾路'},c,hh,d,now).start).toBe(now+24*3600000);
});
test('额度不足不写伪造成功记录，天气模型失败不会修改家庭记忆',async()=>{
  model.mockRejectedValue(p.fault('额度不足',429));await expect(analyze()).rejects.toMatchObject({status:429});
  expect(await events()).toEqual([]);expect((await h.household()).profile.memory).toBe(household.profile.memory);
});
test('风险内容改变而模型失败时，不继续播报已被替代的旧结论',async()=>{
  await analyze();bundle.daily.items[1].highC=9;
  model.mockRejectedValue(p.fault('服务不可用',502));await expect(analyze()).rejects.toMatchObject({status:502});
  expect((await events()).some(x=>x.payload.candidateId.startsWith('cold:'))).toBe(false);
});
test('城市提取使用模型、核验原文并缓存；取消或过期计划不查询目的地',async()=>{
  household.plans=[{id:'trip',text:'11月9日去北京旅游',start:'2026-11-09',end:'2026-11-10'},{id:'old',text:'去年去杭州',start:'2025-01-01',end:'2025-01-02'}];
  model.mockResolvedValue({data:{locations:[{city:'北京',scope:'trip',basis:'北京旅游'},{city:'伦敦',scope:'memory',basis:'青禾路'}]},tokens:20});
  const result=await destinations.discover(household,now);expect(result.map(v=>v.city)).toEqual(['北京']);
  await destinations.discover(household,now+60000);expect(model).toHaveBeenCalledTimes(1);
  expect(await destinations.cached(household,now,[])).toEqual([]);
  expect(await destinations.cached({...household,plans:[]},now)).toEqual([]);
  expect(JSON.parse(model.mock.calls[0][1][1].content).plans.map(v=>v.id)).toEqual(['trip']);
});
test('后台周期把旅行目的地的7天预报传入模型并投递相关提醒',async()=>{
  const plans=[{id:'trip',text:'11月9日去北京旅游',start:'2026-11-09',end:'2026-11-10'}];
  await db.run('UPDATE pig_household SET plans=?',JSON.stringify(plans));
  jest.spyOn(destinations,'discover').mockResolvedValue([{city:'北京',scope:'trip',basis:'北京旅游'}]);
  jest.spyOn(future,'get').mockImplementation(async loc=>({...bundle,city:loc.city}));
  model.mockImplementation(async(s,m)=>{const input=JSON.parse(m[1].content);const c=input.candidates.find(v=>v.city==='北京' && v.kind==='cold');return {data:{reminders:[{id:c.id,scope:'trip',basis:'北京旅游',advice:'出行前备好外套',start:iso(now),until:iso(c.end)}]},tokens:20};});
  await agent.tick(now);expect((await events())[0].payload.speech).toContain('北京');
  expect((await api.feed('weather-screen',now,component)).tasks).toHaveLength(1);
});
test('聊天的实际模型请求包含逐日、逐小时、官方预警数据及可用状态',async()=>{
  jest.spyOn(future,'get').mockResolvedValue(bundle);
  jest.spyOn(require('../src/services/weatherService'),'getWeather').mockResolvedValue({data:{tempC:12},fetchedAt:now,stale:false});
  model.mockResolvedValue({data:{reply:'请结合预报带雨具',add:[],remove:[],actions:[]},tokens:20});
  await h.chat({message:'明天的天气如何？',requestId:'future-context'},now);
  const input=JSON.parse(model.mock.calls[0][1][1].content);
  expect(input.weather.future[0].daily.items).toHaveLength(2);
  expect(input.weather.future[0].hourly.items[0].rainPercent).toBe(80);
  expect(input.weather.future[0].alerts).toMatchObject({status:'fresh',items:[]});
});
