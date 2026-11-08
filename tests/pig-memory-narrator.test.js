const fs=require('node:fs/promises');
const {setupTestApp}=require('./testApp');
const request=require('supertest');
const db=require('../src/services/briefing/storage');
const h=require('../src/services/briefing/household');
const memory=require('../src/services/briefing/agent-memory');
const narrator=require('../src/services/briefing/narrator');
const p=require('../src/services/briefing/providers');
const weather=require('../src/services/briefing/weather-context');
const api=require('../src/services/briefing/service');
const {bindPig,setRules}=require('./pig-fixture');
let component,now,app,token;
beforeAll(async()=>{app=await setupTestApp();token=await require('./testApp').getAdminToken(app);await db.run("INSERT INTO devices(id,name,device_key) VALUES('memory-screen','测试','key')");component=await bindPig('memory-screen');});
beforeEach(async()=>{
  now=Date.now();
  for(const table of ['pig_narration_delivery','pig_narration','pig_agent_memory','pig_memory_audit','pig_chat_audit','pig_conversation','briefing_usage','info_items','timed_reminders'])await db.run('DELETE FROM '+table);
  await db.run("UPDATE pig_household SET revision=0,profile=?,plans='[]'",JSON.stringify({memory:'常住苏州；早上8点出门',zone:'Asia/Shanghai'}));
  await db.run("DELETE FROM settings WHERE key='pig.greetingMinutes'");
  await setRules(component,{enabled:true,cold:true,city:'苏州',family:true,news:true,quietFrom:'00:00',quietTo:'00:00'});
  jest.spyOn(weather,'build').mockResolvedValue({status:'available',observations:[{city:'苏州',tempC:8}],future:[{daily:{items:[{date:'明天',low:3}]},hourly:{items:[{hour:8,rain:70}]},alerts:{status:'fresh',items:[]}}]});
  jest.spyOn(api,'newsCards').mockResolvedValue([{id:'news-test',expires:now+3600000,payload:{title:'苏州道路施工',source:'测试'}}]);
});
afterEach(()=>jest.restoreAllMocks());
const message='明早提醒我拿红包，只要你自己告诉我，不要在系统中添加提醒';
const action=()=>({op:'remember',basis:'拿红包',text:'出门拿红包',temporary:true,start:new Date(now+3600000).toISOString(),end:new Date(now+7200000).toISOString()});
function model(data){return jest.spyOn(p,'jsonCompletion').mockResolvedValue({data,tokens:20});}
async function remember(){model({reply:'记住了',memoryActions:[action()]});await h.chat({message,requestId:'remember'},now);return (await memory.list(now))[0];}
function decision(extra={}){return {speech:'出门记得拿红包哦。',intent:'reminder',urgency:'important',action:'wave',nextReviewAt:new Date(now+60000).toISOString(),validUntil:new Date(now+300000).toISOString(),references:['profile'],reason:'结合出门安排提醒',...extra};}
test('只记猪猪记忆：真实文件、聊天原子提交、系统两表零写入、请求重试不重复',async()=>{
  const row=await remember();
  expect(row.text).toBe('出门拿红包');
  expect(await fs.readFile(memory.file(),'utf8')).toContain(row.id);
  expect(await db.all('SELECT * FROM info_items')).toHaveLength(0);
  expect(await db.all('SELECT * FROM timed_reminders')).toHaveLength(0);
  await h.chat({message,requestId:'remember'},now);
  expect(await memory.list(now)).toHaveLength(1);
  expect(await db.all("SELECT * FROM pig_memory_audit WHERE op='remember'")).toHaveLength(1);
});
test('临时记忆到期自动删除文件和活动记录，审计保留；重启重建不复活',async()=>{
  const row=await remember();await memory.prune(row.expires);
  expect(await memory.list(row.expires)).toHaveLength(0);
  await memory.project();expect(await fs.readFile(memory.file(),'utf8')).not.toContain('拿红包');
  expect(await db.one("SELECT op FROM pig_memory_audit WHERE op='expire'")).toEqual({op:'expire'});
  expect((await h.history()).at(-1).reply).toContain('猪猪自己的记忆');
});
test('修改使用原ID，取消移除，修改和取消都有审计',async()=>{
  const row=await remember();
  p.jsonCompletion.mockResolvedValue({data:{reply:'更新',memoryActions:[{...action(),op:'update',id:row.id,basis:'推迟半小时',start:new Date(row.starts+1800000).toISOString(),end:new Date(row.expires+1800000).toISOString()}]},tokens:10});
  await h.chat({message:'把猪猪记忆的红包事项推迟半小时',requestId:'update'},now);
  expect(await memory.list(now)).toMatchObject([{id:row.id,starts:row.starts+1800000,revision:2}]);
  p.jsonCompletion.mockResolvedValue({data:{reply:'取消',memoryActions:[{op:'forget',id:row.id,basis:'取消红包'}]},tokens:10});
  await h.chat({message:'取消红包记忆',requestId:'forget'},now);
  expect(await memory.list(now)).toHaveLength(0);
  expect((await db.all('SELECT op FROM pig_memory_audit ORDER BY id')).map(r=>r.op)).toEqual(['remember','update','forget']);
});
test('其他访客无法修改记忆；模型缺少授权依据不得写入',async()=>{
  const row=await remember();
  p.jsonCompletion.mockResolvedValue({data:{reply:'取消',memoryActions:[{op:'forget',id:row.id,basis:'取消红包'}]},tokens:10});
  await expect(h.chat({message:'取消红包记忆',requestId:'foreign'},now,{scope:'guest-other',name:'访客',ip:''})).rejects.toMatchObject({status:409});
  p.jsonCompletion.mockResolvedValue({data:{reply:'保存',memoryActions:[{...action(),basis:'不存在的原话'}]},tokens:10});
  await expect(h.chat({message:'你好',requestId:'injection'},now)).rejects.toMatchObject({status:502});
  expect(await memory.list(now)).toHaveLength(1);
});
test('时间无效、临时记忆缺少到期时间及混合系统动作整轮回滚',async()=>{
  model({reply:'保存',memoryActions:[{...action(),end:null}]});
  await expect(h.chat({message,requestId:'invalid-time'},now)).rejects.toMatchObject({status:502});
  p.jsonCompletion.mockResolvedValue({data:{reply:'保存',memoryActions:[action()],actions:[{type:'reminder'}]},tokens:10});
  await expect(h.chat({message,requestId:'mixed'},now)).rejects.toMatchObject({status:502});
  expect(await memory.list(now)).toHaveLength(0);expect(await h.history()).toHaveLength(0);
});
test('并发旧版本记忆操作与聊天一起回滚',async()=>{
  const row=await remember();
  await expect(db.run(`INSERT INTO pig_conversation(id,created,message,reply,next_plans,scope,memory_actions) VALUES('stale',?,'取消','完成','[]','admin',?)`,now,
    JSON.stringify([{op:'forget',id:row.id,revision:0}]))).rejects.toThrow('pig_memory_conflict');
  expect(await db.one("SELECT * FROM pig_conversation WHERE id='stale'")).toBeUndefined();expect(await memory.list(now)).toHaveLength(1);
});
test('统一上下文包含完整家庭资料、独立记忆、未来天气、新闻、日期、信息和提醒',async()=>{
  const row=await remember();
  await db.run("INSERT INTO info_items(id,text) VALUES('info-test','晚上给车充电')");
  await db.run("INSERT INTO timed_reminders(id,name,device_ids,start_time,end_time,content) VALUES('reminder-test','去机场','[]','08:00','08:05','{}')");
  const c=await narrator.context('memory-screen',component,now);
  expect(c.input.profile.memory).toContain('苏州');expect(c.input.agentMemory[0].id).toBe(row.id);
  expect(c.input.weather.future[0]).toHaveProperty('hourly');expect(c.input.news[0].id).toBe('news-test');
  expect(c.input.clock.zone).toBe('Asia/Shanghai');expect(c.input.info[0].id).toBe('info-test');expect(c.input.reminders[0].id).toBe('reminder-test');
});
test('普通问候也走模型；同一有效决策复用，不因播放记录变化重复调用',async()=>{
  const m=model(decision({speech:'今天也一起好好生活吧。',intent:'greeting',references:[]}));
  const a=await narrator.feed('memory-screen',component,now);
  expect(a.speech).toContain('好好生活');expect(m.mock.calls[0][1][0].content).toContain('独立记忆');
  expect(await narrator.claim('memory-screen',component,a.id,now)).toMatchObject({accepted:true});
  expect(await narrator.claim('memory-screen',component,a.id,now)).toMatchObject({accepted:false});
  await narrator.result('memory-screen',component,a.id,'subtitle');
  expect((await narrator.feed('memory-screen',component,now+1000)).id).toBe(a.id);expect(m).toHaveBeenCalledTimes(1);
});
test('记忆到期限制气泡寿命，删除记忆后旧气泡不能领取',async()=>{
  const row=await remember();
  await db.run('UPDATE pig_agent_memory SET starts=?,expires=? WHERE id=?',now-1000,now+120000,row.id);
  p.jsonCompletion.mockResolvedValue({data:decision({references:[row.id]}),tokens:20});
  const d=await narrator.feed('memory-screen',component,now);expect(d.validUntil).toBe(now+120000);
  await memory.prune(now+120000);
  await expect(narrator.claim('memory-screen',component,d.id,now+120000)).rejects.toMatchObject({status:409});
});
test('模型调用期间记忆取消，禁止发布迟到提醒',async()=>{
  const row=await remember();
  p.jsonCompletion.mockImplementation(async()=>{await db.run('DELETE FROM pig_agent_memory WHERE id=?',row.id);return {data:decision({references:[row.id]}),tokens:10};});
  await expect(narrator.feed('memory-screen',component,now)).rejects.toMatchObject({status:409});
  expect(await db.all('SELECT * FROM pig_narration')).toHaveLength(0);
});
test('格式、引用、免打扰边界：拒绝无依据提醒与过期输出',async()=>{
  const ctx=await narrator.context('memory-screen',component,now);
  expect(()=>narrator.validate(decision({references:['fake']}),ctx,now)).toThrow();
  expect(()=>narrator.validate(decision({references:[]}),ctx,now)).toThrow();
  expect(()=>narrator.validate(decision({validUntil:new Date(now-1).toISOString()}),ctx,now)).toThrow();
  expect(()=>narrator.validate(decision(),{...ctx,quiet:true},now)).toThrow();
  expect(narrator.validate(decision({intent:'companion',references:['clock','profile.memory','weather']}),{...ctx,quiet:true},now).payload.references).toEqual(['clock','profile','weather']);
});
test('分钟间隔可保存、校验上下限，影响缓存截止时间',async()=>{
  const url='/api/v1/companion/settings',auth='Bearer '+token;
  expect((await request(app).get(url).set('Authorization',auth)).body.data.greetingMinutes).toBe(5);
  for(const greetingMinutes of [0,1.5,1441,'1'])await request(app).put(url).set('Authorization',auth).send({greetingMinutes}).expect(400);
  await request(app).put(url).set('Authorization',auth).send({greetingMinutes:2}).expect(200);
  model(decision({intent:'greeting',references:[]}));
  const d=await narrator.feed('memory-screen',component,now);expect(d.nextReviewAt).toBe(now+120000);
  expect((await narrator.feed('memory-screen',component,now+119000)).id).toBe(d.id);
  p.jsonCompletion.mockResolvedValue({data:decision({intent:'greeting',references:[],nextReviewAt:new Date(now+240000).toISOString()}),tokens:10});
  expect((await narrator.feed('memory-screen',component,now+120001)).id).not.toBe(d.id);
  expect(p.jsonCompletion).toHaveBeenCalledTimes(2);
  const a=await db.one("SELECT * FROM pig_chat_audit WHERE kind='narration'");
  expect(a.system_prompt).toBe(narrator.prompt());expect(JSON.parse(a.model_context).profile.memory).toContain('苏州');
  expect(JSON.parse(a.model_response).speech).toBe(d.speech);expect(a.status).toBe('ok');
});
test('审计类型和指定用户交叉筛选，prompt-only不混入回复，分页无遗漏',async()=>{
  model(decision({intent:'greeting',references:[]}));await narrator.feed('memory-screen',component,now);
  for(let i=0;i<32;i++)await db.run("INSERT INTO pig_chat_audit(created,scope,actor,ip,turn_id,message,status) VALUES(?,'user-a','同名','','test','A','ok')",now);
  await db.run("INSERT INTO pig_chat_audit(created,scope,actor,ip,turn_id,message,status) VALUES(?,'user-b','同名','','test','B','ok')",now);
  const get=q=>request(app).get('/api/v1/companion/agent/audit'+q).set('Authorization','Bearer '+token);
  const only=(await get('?type=system_prompt')).body.data;expect(only.items).toHaveLength(1);expect(only.items[0].system_prompt).toContain('猪猪伙伴');expect(only.items[0].model_response).toBeUndefined();
  const first=(await get('?type=chat&scope=user-a')).body.data;expect(first.items).toHaveLength(30);expect(first.items.every(r=>r.scope==='user-a')).toBe(true);
  const second=(await get('?type=chat&scope=user-a&before='+first.next)).body.data;expect(second.items).toHaveLength(2);expect(second.next).toBeNull();
  expect((await get('?type=narration&scope=user-a')).body.data.items).toHaveLength(0);
  expect(first.users.filter(u=>u.actor==='同名')).toHaveLength(2);
  await request(app).get('/api/v1/companion/agent/audit?type=system_prompt').expect(401);
  await get('?type=invalid').expect(400);
});
test('无效JSON保留模型原始返回和失败状态，不发布气泡',async()=>{
  const other=await bindPig('memory-screen','raw-error-scene');await setRules(other,{enabled:true,quietFrom:'00:00',quietTo:'00:00'});
  jest.spyOn(p,'jsonCompletion').mockRejectedValue(Object.assign(p.fault('模型未返回有效 JSON',502),{rawResponse:'not-json response',code:'MODEL_JSON_FORMAT'}));
  await expect(narrator.feed('memory-screen',other,now)).rejects.toMatchObject({status:502});
  expect(await db.one("SELECT status,model_response FROM pig_chat_audit WHERE kind='narration'")).toEqual({status:'failed',model_response:'not-json response'});
  expect(await db.all('SELECT * FROM pig_narration')).toHaveLength(0);
});
test('模型气泡设备接口拒绝错误密钥及未绑定组件',async()=>{
  const url='/api/v1/devices/memory-screen/narration?componentId=';
  await request(app).get(url+component).set('X-Device-Key','wrong').expect(403);
  await request(app).get(url+'foreign').set('X-Device-Key','key').expect(403);
  expect(await db.all("SELECT * FROM pig_chat_audit WHERE kind='narration'")).toHaveLength(0);
});
test('模型额度不足不会生成固定问候或写入伪决策，失败请求也审计',async()=>{
  jest.spyOn(api,'generate').mockRejectedValue(p.fault('今日额度用完',429));
  await expect(narrator.feed('memory-screen',component+'-bad',now)).rejects.toMatchObject({status:403});
  await expect(narrator.feed('memory-screen',component,now)).rejects.toMatchObject({status:429});
  expect(await db.all('SELECT * FROM pig_narration')).toHaveLength(0);
  expect(await db.one("SELECT status,error FROM pig_chat_audit WHERE kind='narration'")).toMatchObject({status:'failed',error:'今日额度用完'});
});
