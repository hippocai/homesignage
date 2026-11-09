const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const {setupTestApp}=require('./testApp');
const db=require('../src/services/briefing/storage'),api=require('../src/services/briefing/service');
const narrator=require('../src/services/briefing/narrator'),schedule=require('../src/services/briefing/narration-settings');
const prompts=require('../src/services/briefing/narration-prompt'),provider=require('../src/services/briefing/providers');
const weather=require('../src/services/briefing/weather-context'),{bindPig,setRules}=require('./pig-fixture');
let a,b,now,model;
beforeAll(async()=>{
  await setupTestApp();
  for(const id of ['cadence-a','cadence-b'])await db.run('INSERT INTO devices(id,name,device_key) VALUES(?,?,?)',id,id,id);
  a=await bindPig('cadence-a');b=await bindPig('cadence-b');
});
beforeEach(async()=>{
  now=Date.parse('2030-01-02T09:00:00+08:00');
  for(const table of ['pig_narration','pig_chat_audit','briefing_usage','pig_agent_memory','info_items'])await db.run('DELETE FROM '+table);
  await db.run("DELETE FROM settings WHERE key IN ('pig.narrationSettings','pig.narrationPrompt')");
  await db.run("UPDATE pig_household SET profile=?,plans='[]'",JSON.stringify({memory:'住苏州',zone:'Asia/Shanghai'}));
  for(const c of [a,b])await setRules(c,{enabled:true,sound:true,quietFrom:'00:00',quietTo:'00:00'});
  await schedule.save({greetingSchedule:Array(12).fill(30),quietEnabled:false});
  jest.spyOn(weather,'build').mockResolvedValue({status:'available',observations:[{tempC:10}],future:[]});
  jest.spyOn(api,'newsCards').mockResolvedValue([]);
  model=jest.spyOn(provider,'jsonCompletion').mockImplementation(async(s,m)=>{
    const t=Date.parse(JSON.parse(m[1].content).clock.now);
    return {tokens:8,data:{speech:'今天也要照顾好自己。',intent:'greeting',urgency:'normal',action:'wave',references:[],reason:'测试',nextReviewAt:new Date(t+60000).toISOString(),validUntil:new Date(t+7200000).toISOString()}};
  });
});
afterEach(()=>jest.restoreAllMocks());
test('30分钟内60次多屏轮询，天气/新闻/家庭资料变化不会提前生成；30分钟边界只生成一条',async()=>{
  const first=await narrator.feed('cadence-a',a,now);
  for(let i=1;i<60;i++){
    weather.build.mockResolvedValue({status:'available',observations:[{tempC:10+i}],future:[]});
    api.newsCards.mockResolvedValue([{id:'news-'+i,payload:{title:'新增资讯'+i},expires:now+7200000}]);
    if(i===2)await db.run('UPDATE pig_household SET profile=?',JSON.stringify({memory:'资料已更新',zone:'Asia/Shanghai'}));
    const results=await Promise.all([narrator.feed('cadence-a',a,now+i*30000),narrator.feed('cadence-b',b,now+i*30000)]);
    expect(results.map(r=>r.id)).toEqual([first.id,first.id]);
  }
  expect(model).toHaveBeenCalledTimes(1);
  expect(await narrator.claim('cadence-b',b,first.id,now+29*60000)).toMatchObject({accepted:true});
  const next=await Promise.all([narrator.feed('cadence-a',a,now+1800000),narrator.feed('cadence-b',b,now+1800000)]);
  expect(next[0].id).not.toBe(first.id);expect(next[1].id).toBe(next[0].id);expect(model).toHaveBeenCalledTimes(2);
  expect((await db.all("SELECT created FROM pig_chat_audit WHERE kind='narration' ORDER BY id")).map(r=>r.created)).toEqual([now,now+1800000]);
});
test('模型给出1分钟有效期也不缩短30分钟间隔，过期期间无话语、不领取、不调用模型',async()=>{
  const original=model.getMockImplementation();model.mockImplementation(async(...args)=>{const r=await original(...args);r.data.validUntil=r.data.nextReviewAt;return r;});
  const first=await narrator.feed('cadence-a',a,now);
  expect(first.validUntil).toBe(now+60000);expect(first.nextReviewAt).toBe(now+1800000);
  for(const offset of [60000,120000,299000,1799999])expect(await narrator.feed('cadence-b',b,now+offset)).toMatchObject({waiting:true,nextReviewAt:now+1800000});
  await expect(narrator.claim('cadence-b',b,first.id,now+60000)).rejects.toMatchObject({status:409});
  expect(model).toHaveBeenCalledTimes(1);expect((await narrator.feed('cadence-a',a,now+1800000)).id).toBeTruthy();expect(model).toHaveBeenCalledTimes(2);
});
test('模型生成过程中天气/无关资讯刷新不会误判整轮失败并再次生成',async()=>{
  const original=model.getMockImplementation();model.mockImplementationOnce(async(...args)=>{
    weather.build.mockResolvedValue({status:'available',observations:[{tempC:11}],future:[]});
    api.newsCards.mockResolvedValue([{id:'new',expires:now+7200000,payload:{title:'新增资讯'}}]);
    const r=await original(...args);r.data.references=['weather'];return r;
  });
  const first=await narrator.feed('cadence-a',a,now);
  expect((await narrator.feed('cadence-b',b,now+60000)).id).toBe(first.id);expect(model).toHaveBeenCalledTimes(1);
  expect((await db.all("SELECT status FROM pig_chat_audit WHERE kind='narration'")).map(r=>r.status)).toEqual(['ok']);
});
test('已引用事项修改或取消后立即停止展示，但不能提前生成',async()=>{
  await db.run("INSERT INTO info_items(id,text) VALUES('trip','9点出门去机场')");
  const original=model.getMockImplementation();model.mockImplementation(async(...args)=>{const r=await original(...args);Object.assign(r.data,{intent:'reminder',references:['trip']});return r;});
  const first=await narrator.feed('cadence-a',a,now);
  await db.run("UPDATE info_items SET text='改为10点出门' WHERE id='trip'");
  expect(await narrator.feed('cadence-b',b,now+60000)).toMatchObject({waiting:true});
  await expect(narrator.claim('cadence-b',b,first.id,now+60000)).rejects.toMatchObject({status:409});
  await db.run("DELETE FROM info_items WHERE id='trip'");
  expect(await narrator.feed('cadence-a',a,now+120000)).toMatchObject({waiting:true});expect(model).toHaveBeenCalledTimes(1);
});
test('跨两小时时段与午夜不重置30分钟计时',async()=>{
  for(const start of ['2030-01-02T09:59:00+08:00','2030-01-02T23:59:00+08:00']){
    await db.run('DELETE FROM pig_chat_audit');await db.run('DELETE FROM pig_narration');
    const t=Date.parse(start),count=model.mock.calls.length;
    await narrator.feed('cadence-a',a,t);
    expect(await narrator.feed('cadence-b',b,t+60000)).toMatchObject({waiting:true,nextReviewAt:t+1800000});
    expect(model).toHaveBeenCalledTimes(count+1);
    expect((await narrator.feed('cadence-a',a,t+1800000)).id).toBeTruthy();expect(model).toHaveBeenCalledTimes(count+2);
  }
});
test('时段0暂停后恢复、配置修改均以上次调用时间计算新间隔',async()=>{
  const t=Date.parse('2030-01-02T09:59:00+08:00');await narrator.feed('cadence-a',a,t);
  await schedule.save({greetingSchedule:Array(12).fill(0)});expect(await narrator.feed('cadence-b',b,t+60000)).toMatchObject({paused:true});
  await schedule.save({greetingSchedule:Array(12).fill(30)});expect(await narrator.feed('cadence-b',b,t+120000)).toMatchObject({waiting:true,nextReviewAt:t+1800000});
  await schedule.save({greetingSchedule:Array(12).fill(60)});expect(await narrator.feed('cadence-b',b,t+1800000)).toMatchObject({waiting:true,nextReviewAt:t+3600000});
  expect(model).toHaveBeenCalledTimes(1);
  await schedule.save({greetingSchedule:Array(12).fill(15)});expect((await narrator.feed('cadence-b',b,t+1800000)).id).toBeTruthy();expect(model).toHaveBeenCalledTimes(2);
});
test('失败、天气变化和重新加载服务模块不能绕过数据库中的30分钟计时',async()=>{
  model.mockRejectedValueOnce(provider.fault('服务超时',503));
  await expect(narrator.feed('cadence-a',a,now)).rejects.toMatchObject({status:503});
  weather.build.mockResolvedValue({status:'unavailable'});
  const file=path.resolve(__dirname,'../src/services/briefing/narrator.js'),resolve=createRequire(file),fresh={exports:{}};
  new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>require(resolve.resolve(id)),fresh,fresh.exports);
  expect(await fresh.exports.feed('cadence-b',b,now+60000)).toMatchObject({waiting:true,nextReviewAt:now+1800000});
  expect(model).toHaveBeenCalledTimes(1);
  expect((await fresh.exports.feed('cadence-b',b,now+1800000)).id).toBeTruthy();expect(model).toHaveBeenCalledTimes(2);
});
test('40字符包含标点、空格、数字、英文及emoji；超长重写而非截断，失败与成功均审计',async()=>{
  const original=model.getMockImplementation();
  model.mockImplementationOnce(async(...args)=>{const r=await original(...args);r.data.speech='中'.repeat(39)+'！ ';return r;});
  const result=await narrator.feed('cadence-a',a,now);expect(result.speech).toBe('今天也要照顾好自己。');expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[1][1][0].content).toContain('speechMaxChars=40');
  expect((await db.all("SELECT status FROM pig_chat_audit WHERE kind='narration' ORDER BY id")).map(r=>r.status)).toEqual(['failed','ok']);
  const ctx=await narrator.context('cadence-a',a,now),value=(await original(null,[null,{content:JSON.stringify(ctx.input)}])).data;
  expect(()=>narrator.validate({...value,speech:'猪'.repeat(35)+'，A1 🐷'},ctx,now)).not.toThrow();
  expect(()=>narrator.validate({...value,speech:'猪'.repeat(36)+'，A1 🐷'},ctx,now)).toThrow('speechMaxChars=40');
  expect((await narrator.feed('cadence-b',b,now+60000)).id).toBe(result.id);expect(model).toHaveBeenCalledTimes(2);
});
test('system prompt可配置字符上限并立即生效；重复超长不发布、不在轮询中继续重试',async()=>{
  const original=model.getMockImplementation();model.mockImplementation(async(...args)=>{const r=await original(...args);r.data.speech='猪'.repeat(45);return r;});
  await expect(narrator.feed('cadence-a',a,now)).rejects.toMatchObject({status:502});
  expect(await db.all('SELECT * FROM pig_narration')).toHaveLength(0);
  expect(await narrator.feed('cadence-b',b,now+1000)).toMatchObject({waiting:true});expect(model).toHaveBeenCalledTimes(2);
  await prompts.save({prompt:prompts.defaultPrompt().replace('speechMaxChars: 40','speechMaxChars: 50'),revision:0});
  expect((await narrator.feed('cadence-b',b,now+2000)).speech).toHaveLength(45);expect(model).toHaveBeenCalledTimes(3);
  for(const limit of ['0','181','1.5','abc'])await expect(prompts.save({prompt:'speechMaxChars: '+limit,revision:1})).rejects.toMatchObject({status:400});
  await expect(prompts.save({prompt:'speechMaxChars: 40\nspeechMaxChars: 50',revision:1})).rejects.toMatchObject({status:400});
});
