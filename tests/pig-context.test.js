const request=require('supertest');
const {setupTestApp,getAdminToken}=require('./testApp');
const db=require('../src/services/briefing/storage');
const agent=require('../src/services/briefing/household');
const provider=require('../src/services/briefing/providers');
const weather=require('../src/services/weatherService');
const settings=require('../src/dao/settingsDao');
const fixture=require('./pig-fixture');
const {weatherCityKey}=require('../src/services/briefing/weatherCity');
const now=Date.parse('2026-11-08T09:00:00+08:00');
const memory='# 家庭资料\n家庭人数：3人\n常住城市：苏州市\n通勤路线：青禾路\n特别约定：出门带蓝色保温杯\n';
let app,token,captured,model,weatherMock;
beforeAll(async()=>{app=await setupTestApp();token='Bearer '+await getAdminToken(app);});
beforeEach(async()=>{
  jest.spyOn(require('../src/services/briefing/chat-access'),'identify').mockImplementation(async req=>{req.pigLocal=true;req.pigUser=null;return true;});
  for(const table of ['pig_chat_audit','pig_conversation','pig_guests','briefing_events','briefing_weather','briefing_usage','components','device_scenes','devices','scenes'])await db.run('DELETE FROM '+table);
  await db.run('UPDATE pig_household SET profile=?,plans=\'[]\',revision=0',JSON.stringify({memory,zone:'Asia/Shanghai'}));
  await settings.set('briefing.settings',{dailyCalls:-1,dailyTokens:-1});
  await settings.set('weather.provider','qweather');
  captured=[];
  model=jest.spyOn(provider,'jsonCompletion').mockImplementation(async(s,m)=>{
    captured.push({system:m[0].content,input:JSON.parse(m[1].content)});
    return {data:{reply:'上下文已读取',add:[],remove:[],actions:[],impacts:[]},tokens:20};
  });
  weatherMock=jest.spyOn(weather,'getWeather').mockResolvedValue({data:{city:'苏州',tempC:12,description:'小雨',humidity:'80',windKmph:'15',apiKey:'must-not-leak'},fetchedAt:now-60000,stale:false});
});
afterEach(()=>jest.restoreAllMocks());
async function bindWeather(){
  await db.run("INSERT INTO devices(id,name,device_key) VALUES('context-screen','测试屏','context-key')");
  const pig=await fixture.bindPig('context-screen');
  await fixture.setRules(pig,{enabled:true,cold:true,city:'江苏/苏州市'});
  await db.run("INSERT INTO components(id,scene_id,type,position,config) VALUES('context-weather','context-screen-scene','weather','{}',?)",JSON.stringify({city:'苏州',locationId:'fixture-city'}));
  const key=weatherCityKey({city:'江苏/苏州市',zone:'Asia/Shanghai'});
  await db.run('INSERT INTO briefing_weather VALUES(?,?,?)',key,'2026-11-08',15);
  await db.run('INSERT INTO briefing_weather VALUES(?,?,?)',key,'2026-11-07',22);
}
async function news(id,options={}){
  await db.run('INSERT INTO briefing_events(id,identity,kind,state,payload,targets,starts,expires,updated) VALUES(?,?,?,?,?,\'[]\',?,?,?)',
    id,id,options.kind||'news',options.state||'published',JSON.stringify({title:options.title||'青禾路封路 '+id,excerpt:'今天09:00至17:00封闭施工，请绕行。',source:'测试交管公告',time:now-3600000}),options.starts??now-60000,options.expires??now+86400000,options.updated??now);
}
async function chat(message='今天生活上有什么需要注意的？',id='context'){
  await agent.chat({message,requestId:id},now);
  return captured.at(-1).input;
}
test.each(['admin','guest'])('%s HTTP聊天完整传入开放记忆，包括任意自定义信息',async role=>{
  const caller=request.agent(app);
  if(role==='guest')await caller.post('/api/v1/pig-chat/session').send({}).expect(200);
  const call=caller.post(role==='admin'?'/api/v1/companion/agent/messages':'/api/v1/pig-chat/messages');
  if(role==='admin')call.set('Authorization',token);
  await call.send({message:'请复述家庭人数和特别约定',requestId:'memory'}).expect(200);
  expect(captured.at(-1).input.profile).toEqual({memory,zone:'Asia/Shanghai'});
});
test('“查看我的基础信息”读取家庭记忆，不被当成查询信息列表',async()=>{
  await agent.chat({message:'查看我的基础信息',requestId:'basic'},now);
  expect(model).toHaveBeenCalledTimes(1);
  expect(captured[0].input.profile.memory).toBe(memory);
});
test('修改和清空记忆下一轮立即生效，不混入旧资料',async()=>{
  await agent.saveProfile({revision:0,profile:{memory:'新的习惯：骑车通勤'}});
  expect((await chat('我的通勤习惯是什么？','changed')).profile.memory).toBe('新的习惯：骑车通勤');
  await agent.saveProfile({revision:1,profile:{memory:''}});
  expect((await chat('你记住了什么？','cleared')).profile.memory).toBe('');
});
test('天气进入实际模型输入，区分实时温度、今日最高预报和昨日最高预报',async()=>{
  await bindWeather();const input=await chat('今天的天气怎样，出门穿什么？');
  expect(weatherMock).toHaveBeenCalledWith({city:'苏州',locationId:'fixture-city'});
  expect(input.weather.observations).toEqual([expect.objectContaining({city:'苏州',status:'fresh',tempC:12,description:'小雨',source:'qweather',fetchedAt:new Date(now-60000).toISOString()})]);
  expect(input.weather.forecasts).toEqual([expect.objectContaining({city:'江苏/苏州市',day:'2026-11-08',todayHighC:15,yesterdayForecastHighC:22,dropC:7,source:'Open-Meteo'})]);
  expect(JSON.stringify(input)).not.toContain('must-not-leak');
  expect(captured.at(-1).system).toContain('不能当作实时气温');
});
test('天气源失败仍聊天，标明不可用；昨日预报不能冒充今天',async()=>{
  await bindWeather();weatherMock.mockRejectedValue(new Error('secret-url-and-key'));
  await db.run("DELETE FROM briefing_weather WHERE day='2026-11-08'");
  const input=await chat();
  expect(input.weather.observations[0]).toMatchObject({status:'unavailable'});
  expect(input.weather.forecasts[0]).toMatchObject({status:'unavailable',todayHighC:null,yesterdayForecastHighC:22,dropC:null});
  expect(JSON.stringify(input)).not.toContain('secret-url-and-key');
});
test('过期天气明确标注 stale，数值不伪装成当前观测',async()=>{
  await bindWeather();weatherMock.mockResolvedValue({data:{tempC:8},fetchedAt:now-7200000,stale:true});
  expect((await chat()).weather.observations[0]).toMatchObject({status:'stale',tempC:8});
});
test('没有配置城市时明确缺失，不默认北京或从家庭地址猜测城市',async()=>{
  const input=await chat();expect(weatherMock).not.toHaveBeenCalled();
  expect(input.weather).toMatchObject({status:'unconfigured',observations:[],forecasts:[]});
});
test('多个屏幕共享场景时城市去重，不读取未绑定或禁用场景',async()=>{
  await bindWeather();await db.run("INSERT INTO devices(id,name,device_key) VALUES('second','第二屏','second-key')");
  await db.run("INSERT INTO device_scenes(device_id,scene_id) VALUES('second','context-screen-scene')");
  await db.run("INSERT INTO scenes(id,name) VALUES('draft','草稿')");
  await db.run("INSERT INTO components(id,scene_id,type,position,config) VALUES('draft-weather','draft','weather','{}','{\"city\":\"上海\"}')");
  const input=await chat();expect(weatherMock).toHaveBeenCalledTimes(1);expect(input.weather.forecasts).toHaveLength(1);
});
test('资讯上下文包括较早的关联新闻和热搜，排除过期、撤下、未来资讯',async()=>{
  await news('commute',{updated:now-86400000});
  for(let i=0;i<15;i++)await news('new-'+i,{kind:i%2?'ranking':'news'});
  await news('expired',{expires:now});await news('withdrawn',{state:'withdrawn'});await news('future',{starts:now+3600000});
  const input=await chat('近期哪些新闻可能影响我的通勤？');
  expect(input.news).toHaveLength(16);expect(input.news.map(v=>v.id)).toContain('commute');
  expect(input.news[0]).toMatchObject({source:'测试交管公告',reported:now-3600000,detail:'今天09:00至17:00封闭施工，请绕行。'});
  expect(input.newsCoverage).toMatchObject({total:16,included:16,truncated:false});
});
test('涉及出门提醒的问法也提供天气和资讯，不因tools开关丢失上下文',async()=>{
  await bindWeather();await news('road');
  const input=await chat('我今天出门需要注意什么？');
  expect(input.tools).toBe(true);expect(input.news.map(v=>v.id)).toContain('road');expect(input.weather.observations[0].tempC).toBe(12);
  expect(await db.all('SELECT * FROM info_items')).toEqual([]);
});
test('资讯数量超限明确告知覆盖范围，不声称掌握所有消息',async()=>{
  for(let i=0;i<65;i++)await news('many-'+i);
  const input=await chat('今天的新闻？');
  expect(input.news).toHaveLength(60);expect(input.newsCoverage).toMatchObject({total:65,included:60,truncated:true});
});
test('后台生活影响判断确实包含开放记忆和新闻原文',async()=>{
  await news('impact');await agent.analyze(now);
  expect(captured[0].input.profile.memory).toBe(memory);
  expect(captured[0].input.articles[0]).toMatchObject({id:'impact',detail:'今天09:00至17:00封闭施工，请绕行。'});
});
test('已确认关联家庭路线的旧资讯优先进入有上限的上下文',async()=>{
  await news('important',{updated:now-86400000});
  model.mockResolvedValueOnce({data:{impacts:[{id:'important',basis:'青禾路',evidence:'封闭施工',advice:'提前绕行',repeat:true,until:new Date(now+3600000).toISOString()}]},tokens:20});
  await agent.analyze(now);
  for(let i=0;i<60;i++)await news('recent-'+i);
  const input=await chat('最近的资讯对我有哪些影响？');
  expect(input.news[0].id).toBe('important');
  expect(input.newsCoverage).toMatchObject({total:61,included:60,truncated:true});
});
test('天气请求卡住时最多等待2.5秒，仍向模型提供记忆和资讯',async()=>{
  await bindWeather();await news('timeout-road');
  jest.useFakeTimers({doNotFake:['nextTick','setImmediate']});jest.setSystemTime(now);
  let started;const ready=new Promise(resolve=>{started=resolve;});
  weatherMock.mockImplementation(()=>{started();return new Promise(()=>{});});
  try {
    const pending=chat('今天出门需要注意什么？');await ready;
    await jest.advanceTimersByTimeAsync(2500);
    const input=await pending;
    expect(input.weather.observations[0].status).toBe('unavailable');
    expect(input.profile.memory).toBe(memory);expect(input.news[0].id).toBe('timeout-road');
  } finally {jest.useRealTimers();}
});
