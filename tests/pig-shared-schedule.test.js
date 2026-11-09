const request=require('supertest');
const {setupTestApp,getAdminToken}=require('./testApp');
const db=require('../src/services/briefing/storage'),api=require('../src/services/briefing/service');
const narrator=require('../src/services/briefing/narrator'),schedule=require('../src/services/briefing/narration-settings');
const prompts=require('../src/services/briefing/narration-prompt'),p=require('../src/services/briefing/providers');
const {bindPig,setRules}=require('./pig-fixture');
let app,auth,a,b,c,now,model;
beforeAll(async()=>{
  app=await setupTestApp();auth='Bearer '+await getAdminToken(app);
  for(const id of ['shared-a','shared-b'])await db.run('INSERT INTO devices(id,name,device_key) VALUES(?,?,?)',id,id,id);
  a=await bindPig('shared-a');b=await bindPig('shared-b');c=await bindPig('shared-a','shared-extra');
});
beforeEach(async()=>{
  now=Date.parse('2030-01-02T09:00:00+08:00');
  for(const table of ['pig_narration','pig_chat_audit','briefing_usage','pig_agent_memory'])await db.run('DELETE FROM '+table);
  await db.run("DELETE FROM settings WHERE key IN ('pig.narrationSettings','pig.greetingMinutes','pig.narrationPrompt')");
  await db.run("UPDATE pig_household SET profile=?,plans='[]'",JSON.stringify({zone:'Asia/Shanghai',memory:'住在苏州'}));
  for(const id of [a,b,c])await setRules(id,{enabled:true,quietFrom:'00:00',quietTo:'00:00',sound:true});
  jest.spyOn(require('../src/services/briefing/weather-context'),'build').mockResolvedValue({future:[],status:'unconfigured'});
  jest.spyOn(api,'newsCards').mockResolvedValue([]);
  model=jest.spyOn(p,'jsonCompletion').mockImplementation(async(s,m)=>{
    const t=Date.parse(JSON.parse(m[1].content).clock.now);
    return {tokens:8,data:{speech:'全家的共享问候',intent:'greeting',urgency:'normal',action:'wave',references:[],reason:'共享',nextReviewAt:new Date(t+300000).toISOString(),validUntil:new Date(t+7200000).toISOString()}};
  });
});
afterEach(()=>jest.restoreAllMocks());
test('12时段0与120边界、全局免打扰保存回读；非法整组拒绝',async()=>{
  const data={greetingSchedule:Array.from({length:12},(_,i)=>i%2?120:0),quietEnabled:true,quietFrom:'23:00',quietTo:'06:30'};
  await request(app).put('/api/v1/companion/settings').set('Authorization',auth).send(data).expect(200);
  expect((await request(app).get('/api/v1/companion/settings').set('Authorization',auth)).body.data).toMatchObject({...data,zone:'Asia/Shanghai'});
  for(const invalid of [Array(11).fill(5),Array(13).fill(5),[121,...Array(11).fill(5)],[-1,...Array(11).fill(5)],[1.5,...Array(11).fill(5)],['5',...Array(11).fill(5)]])
    await request(app).put('/api/v1/companion/settings').set('Authorization',auth).send({greetingSchedule:invalid,quietFrom:'01:00'}).expect(400);
  for(const body of [{quietFrom:'24:00'},{quietTo:'7:00'},{quietEnabled:'true'}])await request(app).put('/api/v1/companion/settings').set('Authorization',auth).send(body).expect(400);
  expect(await schedule.get()).toMatchObject(data);
});
test('旧单一频率铺满12段，超出120只在读取时兼容截断，不修改旧配置',async()=>{
  await db.run("INSERT INTO settings(key,value) VALUES('pig.greetingMinutes','180')");
  expect((await schedule.get()).greetingSchedule).toEqual(Array(12).fill(120));
  expect((await db.one("SELECT value FROM settings WHERE key='pig.greetingMinutes'")).value).toBe('180');
});
test('家庭当地时区切换时段，跨午夜免打扰，起止相同及关闭免打扰',()=>{
  const cfg={greetingSchedule:Array(12).fill(5),zone:'Asia/Shanghai',quietEnabled:true,quietFrom:'22:00',quietTo:'07:00'};
  for(const [iso,slot,quiet] of [['2030-01-01T15:59:59Z',11,true],['2030-01-01T16:00:00Z',0,true],['2030-01-01T22:59:59Z',3,true],['2030-01-01T23:00:00Z',3,false]])
    expect(schedule.state(cfg,Date.parse(iso))).toMatchObject({slot,quiet});
  expect(schedule.state({...cfg,quietFrom:'00:00',quietTo:'00:00'},now).quiet).toBe(false);
  expect(schedule.state({...cfg,quietEnabled:false},Date.parse('2030-01-01T16:00:00Z')).quiet).toBe(false);
});
test('多设备多组件并发与后续轮询共享一个ID、一次调用和一份审计',async()=>{
  const values=await Promise.all([narrator.feed('shared-a',a,now),narrator.feed('shared-b',b,now),narrator.feed('shared-a',c,now)]);
  expect(new Set(values.map(v=>v.id)).size).toBe(1);expect(new Set(values.map(v=>v.speech)).size).toBe(1);
  expect(values.map(v=>v.componentId)).toEqual([a,b,c]);expect(model).toHaveBeenCalledTimes(1);
  expect((await narrator.feed('shared-b',b,now+1000)).id).toBe(values[0].id);expect(model).toHaveBeenCalledTimes(1);
  expect(await db.all("SELECT id FROM pig_chat_audit WHERE kind='narration'")).toHaveLength(1);
  expect(api.newsCards).toHaveBeenCalledWith(null,now);
});
test('新增相同功能组件不产生另一份问候；同屏不同组件只朗读一次，不阻止其他屏展示',async()=>{
  const first=await narrator.feed('shared-a',a,now);
  const extra=await bindPig('shared-b','new-identical-pig');await setRules(extra,{enabled:true,quietFrom:'00:00',quietTo:'00:00',sound:false});
  const same=await narrator.feed('shared-b',extra,now+10);expect(same.id).toBe(first.id);expect(model).toHaveBeenCalledTimes(1);
  expect(await narrator.claim('shared-a',a,first.id,now)).toMatchObject({accepted:true,sound:true});
  expect(await narrator.claim('shared-a',c,first.id,now)).toMatchObject({accepted:false});
  expect(await narrator.claim('shared-b',extra,first.id,now)).toMatchObject({accepted:true,sound:false});
  await narrator.result('shared-a',a,first.id,'subtitle');
  expect((await db.one('SELECT result FROM pig_shared_delivery WHERE id=? AND device=?',first.id,'shared-a')).result).toBe('subtitle');
});
test('0时段不采集气泡上下文、不调用模型；资料变化和prompt修改也不能绕过暂停',async()=>{
  await schedule.save({greetingSchedule:Array(12).fill(0)});
  expect(await narrator.feed('shared-a',a,now)).toMatchObject({paused:true,preferences:{sound:false}});
  await prompts.save({prompt:prompts.defaultPrompt()+'\n新版本',revision:0});
  await db.run("UPDATE pig_household SET revision=revision+1");
  expect(await narrator.feed('shared-b',b,now+60000)).toMatchObject({paused:true});
  expect(model).not.toHaveBeenCalled();expect(api.newsCards).not.toHaveBeenCalled();
  expect(await db.all("SELECT id FROM pig_chat_audit WHERE kind='narration'")).toHaveLength(0);
});
test('10点停止、12点恢复；时段边界截断旧话语，120分钟不会越过时段',async()=>{
  const slots=Array(12).fill(120);slots[5]=0;await schedule.save({greetingSchedule:slots});
  const t=Date.parse('2030-01-02T09:59:00+08:00'),stop=Date.parse('2030-01-02T10:00:00+08:00'),resume=Date.parse('2030-01-02T12:00:00+08:00');
  const first=await narrator.feed('shared-a',a,t);expect(first.validUntil).toBe(t+120*60000);expect(first.nextReviewAt).toBe(t+120*60000);
  expect(await narrator.feed('shared-b',b,stop)).toMatchObject({paused:true});
  await expect(narrator.claim('shared-a',a,first.id,stop)).rejects.toMatchObject({status:409});
  const next=await narrator.feed('shared-b',b,resume);expect(next.id).not.toBe(first.id);expect(model).toHaveBeenCalledTimes(2);
  expect(next.nextReviewAt).toBe(resume+120*60000);
});
test('全局免打扰覆盖组件旧静默配置，所有屏都禁音，模型上下文也收到quiet',async()=>{
  await schedule.save({quietEnabled:true,quietFrom:'08:00',quietTo:'10:00'});
  const [first,second]=await Promise.all([narrator.feed('shared-a',a,now),narrator.feed('shared-b',b,now)]);
  expect(first.preferences.sound).toBe(false);expect(second.preferences.sound).toBe(false);
  expect(JSON.parse(model.mock.calls[0][1][1].content).preferences.quiet).toBe(true);
  expect(await narrator.claim('shared-b',b,first.id,now)).toMatchObject({sound:false});
});
test('模型调用期间改为暂停，不发布迟到话语；未绑定设备即使暂停也不能读取',async()=>{
  const original=model.getMockImplementation();model.mockImplementationOnce(async(...args)=>{await schedule.save({greetingSchedule:Array(12).fill(0)});return original(...args);});
  await expect(narrator.feed('shared-a',a,now)).rejects.toMatchObject({status:409});
  expect(await db.all('SELECT * FROM pig_narration')).toHaveLength(0);
  await expect(narrator.feed('shared-a',b,now)).rejects.toMatchObject({status:403});
});
test('领取期间改变免打扰，旧请求不能获得朗读权',async()=>{
  const d=await narrator.feed('shared-a',a,now);
  require('../src/services/briefing/weather-context').build.mockImplementationOnce(async()=>{
    await schedule.save({quietEnabled:true,quietFrom:'08:00',quietTo:'10:00'});return {future:[],status:'unconfigured'};
  });
  await expect(narrator.claim('shared-a',a,d.id,now)).rejects.toMatchObject({status:409});
  expect(await db.all('SELECT * FROM pig_shared_delivery')).toHaveLength(0);
});
