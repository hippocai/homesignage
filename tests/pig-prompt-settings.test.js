const request=require('supertest');
const {setupTestApp,getAdminToken}=require('./testApp');
const db=require('../src/services/briefing/storage');
const prompts=require('../src/services/briefing/narration-prompt');
const narrator=require('../src/services/briefing/narrator');
const memory=require('../src/services/briefing/agent-memory');
const providers=require('../src/services/briefing/providers');
const api=require('../src/services/briefing/service');
const weather=require('../src/services/briefing/weather-context');
const {bindPig,setRules}=require('./pig-fixture');
let app,auth,component,now;
const url='/api/v1/companion/agent/narration-prompt';
beforeAll(async()=>{app=await setupTestApp();auth='Bearer '+await getAdminToken(app);
  await db.run("INSERT INTO devices(id,name,device_key) VALUES('prompt-screen','测试','test-key')");component=await bindPig('prompt-screen');
  await setRules(component,{enabled:true,quietFrom:'00:00',quietTo:'00:00'});
});
beforeEach(async()=>{
  now=Date.now();
  for(const table of ['pig_narration_delivery','pig_narration','pig_chat_audit','pig_agent_memory','pig_memory_audit','briefing_usage'])await db.run('DELETE FROM '+table);
  await db.run("DELETE FROM settings WHERE key='pig.narrationPrompt'");
  jest.spyOn(api,'newsCards').mockResolvedValue([]);jest.spyOn(weather,'build').mockResolvedValue({status:'unconfigured',future:[]});
});
afterEach(()=>jest.restoreAllMocks());
function model(){return jest.spyOn(providers,'jsonCompletion').mockResolvedValue({tokens:10,data:{speech:'模型问候',intent:'greeting',urgency:'normal',action:'wave',references:[],reason:'测试',nextReviewAt:new Date(now+300000).toISOString(),validUntil:new Date(now+600000).toISOString()}});}
test('管理员读取完整默认内容，保存自定义原文，再恢复默认；配置可重新读取',async()=>{
  const initial=(await request(app).get(url).set('Authorization',auth).expect(200)).body.data;
  expect(initial).toMatchObject({isDefault:true,revision:0,prompt:prompts.defaultPrompt(),defaultPrompt:prompts.defaultPrompt()});
  const text=initial.prompt+'\n\n请使用简洁温暖的语气。\n';
  const saved=(await request(app).put(url).set('Authorization',auth).send({prompt:text,revision:0}).expect(200)).body.data;
  expect(saved).toMatchObject({prompt:text,isDefault:false,revision:1});expect((await prompts.get()).prompt).toBe(text);
  const restored=(await request(app).put(url).set('Authorization',auth).send({reset:true,revision:1}).expect(200)).body.data;
  expect(restored).toMatchObject({prompt:initial.defaultPrompt,isDefault:true,revision:2});
  expect(JSON.parse((await db.one("SELECT value FROM settings WHERE key='pig.narrationPrompt'")).value).prompt).toBeNull();
});
test('匿名不能读取/写入；空白、超长和错误版本参数不覆盖已保存内容',async()=>{
  await request(app).get(url).expect(401);await request(app).put(url).send({prompt:'test',revision:0}).expect(401);
  for(const body of [{prompt:' ',revision:0},{prompt:'a'.repeat(20001),revision:0},{prompt:1,revision:0},{prompt:'a'},{reset:'true',revision:0},{reset:true,revision:-1}])
    await request(app).put(url).set('Authorization',auth).send(body).expect(400);
  expect((await prompts.get()).revision).toBe(0);
});
test('并发保存只有一个成功；旧版本恢复默认不覆盖新内容',async()=>{
  const results=await Promise.allSettled([prompts.save({prompt:'版本甲',revision:0}),prompts.save({prompt:'版本乙',revision:0})]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.find(r=>r.status==='rejected').reason.status).toBe(409);
  const saved=await prompts.get();await expect(prompts.save({reset:true,revision:0})).rejects.toMatchObject({status:409});
  expect((await prompts.get()).prompt).toBe(saved.prompt);
});
test('保存立即使有效缓存失效，新请求实际使用新prompt并写入审计；恢复默认也立即更新',async()=>{
  const spy=model();const first=await narrator.feed('prompt-screen',component,now);
  const custom=prompts.defaultPrompt()+'\n使用新的测试语气。';await prompts.save({prompt:custom,revision:0});
  await expect(narrator.claim('prompt-screen',component,first.id,now+10)).rejects.toMatchObject({status:409});
  const next=await narrator.feed('prompt-screen',component,now+20);expect(next.id).not.toBe(first.id);
  expect(spy.mock.calls[1][1][0].content).toBe(custom);
  expect((await db.one("SELECT system_prompt FROM pig_chat_audit WHERE turn_id=?",next.id)).system_prompt).toBe(custom);
  await prompts.save({reset:true,revision:1});await narrator.feed('prompt-screen',component,now+30);
  expect(spy.mock.calls[2][1][0].content).toBe(prompts.defaultPrompt());
});
test('模型生成期间保存提示词，迟到的旧版本话语不得发布',async()=>{
  const spy=model(),response=await spy.getMockImplementation()();
  spy.mockImplementationOnce(async()=>{await prompts.save({prompt:prompts.defaultPrompt()+'\n新版本',revision:0});return response;});
  await expect(narrator.feed('prompt-screen',component,now)).rejects.toMatchObject({status:409});
  expect(await db.all('SELECT * FROM pig_narration')).toHaveLength(0);
});
test('修正提示词后不会继续受旧提示词失败退避阻塞',async()=>{
  const spy=model(),good=await spy.getMockImplementation()();
  spy.mockRejectedValueOnce(providers.fault('格式无效',502)).mockRejectedValueOnce(providers.fault('格式无效',502));
  await expect(narrator.feed('prompt-screen',component,now)).rejects.toMatchObject({status:502});
  await prompts.save({prompt:prompts.defaultPrompt()+'\n已修正',revision:0});spy.mockResolvedValue(good);
  expect((await narrator.feed('prompt-screen',component,now+1)).speech).toBe('模型问候');
});
test('独立记忆文本与文件格式一致，读取时清除到期条目；空记忆仍可读',async()=>{
  await db.run("INSERT INTO pig_agent_memory(id,scope,text,starts,expires,created) VALUES('active','admin','第一行\n第二行',?,?,?)",now-1000,now+600000,now);
  await db.run("INSERT INTO pig_agent_memory(id,scope,text,starts,expires,created) VALUES('expired','admin','已过期测试',?,?,?)",now-2000,now-1,now);
  const res=(await request(app).get('/api/v1/companion/agent/memory').set('Authorization',auth).expect(200)).body.data;
  expect(res.text).toBe(memory.format(res.entries));expect(res.text).toContain('第一行\n第二行');expect(res.text).not.toContain('已过期测试');
  await memory.project();expect(await require('node:fs/promises').readFile(memory.file(),'utf8')).toBe(res.text);
  await db.run('DELETE FROM pig_agent_memory');expect((await request(app).get('/api/v1/companion/agent/memory').set('Authorization',auth)).body.data.text).toContain('目前没有有效');
});
