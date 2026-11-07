const {setupTestApp}=require('./testApp');
const db=require('../src/services/briefing/storage');
const agent=require('../src/services/briefing/household');
const provider=require('../src/services/briefing/providers');
const records=require('../src/services/briefing/owned-records');
const {prepare}=require('../src/services/briefing/actions');
const scheduler=require('../src/services/schedulerService');
const {bindPig}=require('./pig-fixture');
const now=Date.parse('2030-03-10T10:00+08:00');
const actor={scope:'control-acceptance',name:'测试家人',ip:'127.0.0.1'};
const say=(id,message)=>agent.chat({requestId:id,message},now,actor);
let model;
const response=actions=>({data:{reply:'收到',add:[],remove:[],actions},tokens:5});
async function create(text,key='seed') {
  model.mockResolvedValue(response([{type:'info',op:'create',basis:text,text,
    start:'2030-03-10T18:00+08:00',end:'2030-03-10T23:00+08:00'}]));
  await say(key,'在信息列表添加“'+text+'”，今天18点到23点显示');
  return (await records.owned(actor.scope)).find(r=>r.text===text);
}
beforeAll(async()=>{
  await setupTestApp();
  await db.run("INSERT INTO devices(id,name,device_key) VALUES('control-screen','测试屏','control-key')");
  await bindPig('control-screen');
});
beforeEach(async()=>{
  for(const t of ['timed_reminders','info_items','pig_conversation','pig_chat_audit','briefing_usage'])
    await db.run('DELETE FROM '+t);
  await db.run("UPDATE pig_household SET revision=0,profile='{}',plans='[]'");
  model=jest.spyOn(provider,'jsonCompletion');
});
afterEach(async()=>{
  for(const r of await db.all('SELECT id FROM timed_reminders')) scheduler.cancelReminder(r.id);
  jest.restoreAllMocks();
});

test('修改正文中的“取消”属于新文案，不能把原信息删掉',async()=>{
  const old=await create('特斯拉充电');
  model.mockResolvedValue(response([{type:'info',op:'update',id:old.id,selector:'特斯拉',basis:'特斯拉',
    text:'取消今晚充电，改到明天'}]));
  await say('quoted','把特斯拉信息的正文改成“取消今晚充电，改到明天”，显示时间保持不变');
  expect(await db.one('SELECT text,start_time,end_time FROM info_items WHERE id=?',old.id))
    .toEqual({text:'取消今晚充电，改到明天',start_time:old.start,end_time:old.end});
});
test('创建包含删除字样的公告不会被当成删除现有记录',async()=>{
  const old=await create('保留原信息');
  const message='在信息列表新增“取消今晚活动”，今天18点到23点显示';
  model.mockResolvedValue(response([{type:'info',op:'create',basis:'取消今晚活动',text:'取消今晚活动',
    start:'2030-03-10T18:00+08:00',end:'2030-03-10T23:00+08:00'}]));
  await say('quoted-create',message);
  expect((await records.owned(actor.scope)).map(r=>r.text).sort()).toEqual(['保留原信息','取消今晚活动'].sort());
  expect(await db.one('SELECT id FROM info_items WHERE id=?',old.id)).toBeTruthy();
});
test('结束时间推迟保留开始；只改开始时间且结束不变，必须保留原结束',async()=>{
  const old=await create('特斯拉充电');
  model.mockResolvedValue(response([{type:'info',op:'update',id:old.id,selector:'特斯拉',basis:'推迟半小时'}]));
  await say('end','把特斯拉信息结束时间推迟半小时，开始时间不变');
  expect(Date.parse((await records.owned(actor.scope))[0].end)).toBe(Date.parse(old.end)+1800000);
  model.mockResolvedValue(response([{type:'info',op:'update',id:old.id,selector:'特斯拉',basis:'特斯拉',
    start:'2030-03-10T19:00+08:00'}]));
  await say('start','把特斯拉信息的开始时间改为今天19点，结束时间不变');
  const [changed]=await records.owned(actor.scope);
  expect(Date.parse(changed.start)).toBe(Date.parse('2030-03-10T19:00+08:00'));
  expect(Date.parse(changed.end)).toBe(Date.parse(old.end)+1800000);
});
test('最近一次只创建一条时，“刚才那条”只操作该条；最近一次列出多条时先澄清',async()=>{
  const first=await create('买牛奶','milk'), second=await create('特斯拉充电','car');
  model.mockResolvedValue(response([{type:'info',op:'cancel',id:second.id,selector:'刚才那条',basis:'取消'}]));
  await say('last','取消刚才那条信息');
  expect((await records.owned(actor.scope)).map(r=>r.id)).toEqual([first.id]);
  await create('自行车充电','bike');
  await say('show','查看我的信息列表');
  model.mockResolvedValue(response([{type:'info',op:'cancel',id:first.id,selector:'那条',basis:'取消'}]));
  await expect(say('ambiguous','取消那条信息')).rejects.toMatchObject({status:422});
  expect(await records.owned(actor.scope)).toHaveLength(2);
});
test('查询不存在的主题应返回空结果，不能用全部记录冒充命中',async()=>{
  const car=await create('特斯拉充电');
  expect((await say('missing','查看我的买菜信息')).reply).toContain('没有符合条件');
  model.mockResolvedValue(response([{type:'info',op:'cancel',id:car.id,selector:'刚才那条',basis:'取消'}]));
  await expect(say('missing-reference','取消刚才那条信息')).rejects.toMatchObject({status:422});
  expect(await records.owned(actor.scope)).toHaveLength(1);
  expect((await say('all','查看我的信息列表')).reply).toContain('特斯拉');
});
test('改期中的相对日期以家庭时区为准，不接受模型误选今天',async()=>{
  const old=await create('特斯拉充电');
  model.mockResolvedValue(response([{type:'info',op:'update',id:old.id,selector:'特斯拉',basis:'特斯拉',
    start:'2030-03-10T19:00+08:00',end:'2030-03-10T23:00+08:00'}]));
  await say('tomorrow','把特斯拉信息显示时间改为明天晚上19点到23点');
  const [row]=await records.owned(actor.scope);
  expect(Date.parse(row.start)).toBe(Date.parse('2030-03-11T19:00+08:00'));
  expect(Date.parse(row.end)).toBe(Date.parse('2030-03-11T23:00+08:00'));
});
test('多操作中一个时段非法时全部不落库，失败审计不记录成功动作',async()=>{
  const good={type:'info',op:'create',basis:'牛奶',text:'买牛奶',start:'2030-03-11T18:00+08:00',end:'2030-03-11T19:00+08:00'};
  model.mockResolvedValue(response([good,{...good,basis:'充电',text:'充电',end:good.start}]));
  await expect(say('atomic','在信息列表添加牛奶和充电两项')).rejects.toMatchObject({status:422});
  expect(await records.owned(actor.scope)).toEqual([]);
  expect(await db.all('SELECT id FROM pig_conversation')).toEqual([]);
  expect(await db.one('SELECT status FROM pig_chat_audit')).toEqual({status:'failed'});
});
test('并发重放同一请求只建立一条信息；同一编号更换正文返回冲突',async()=>{
  const message='请在信息列表添加买牛奶';
  model.mockResolvedValue(response([{type:'info',op:'create',basis:'买牛奶',text:'买牛奶',
    start:'2030-03-11T18:00+08:00',end:'2030-03-11T23:00+08:00'}]));
  const [a,b]=await Promise.all([say('replay',message),say('replay',message)]);
  expect(a).toEqual(b);
  expect(await records.owned(actor.scope)).toHaveLength(1);
  await expect(say('replay','改成买面包')).rejects.toMatchObject({status:409});
});
test('没有发生操作时，不能在回复里宣称已删除或已修改',async()=>{
  await create('特斯拉充电');
  model.mockResolvedValue({data:{reply:'已删除特斯拉信息。',actions:[],add:[],remove:[]},tokens:3});
  const answer=await say('empty','删除特斯拉信息');
  expect(answer.reply).not.toContain('已删除');
  expect(await records.owned(actor.scope)).toHaveLength(1);
});
test('无屏幕不能创建定时提示，但信息列表仍可独立创建',async()=>{
  await db.run("UPDATE device_scenes SET enabled=0 WHERE device_id='control-screen'");
  try {
    const action={type:'reminder',text:'去机场',basis:'去机场',start:'2030-03-11T08:00+08:00'};
    await expect(prepare([action],'明早8点提醒我去机场',now,'Asia/Shanghai')).rejects.toMatchObject({status:422});
    await create('特斯拉充电');
    expect(await records.owned(actor.scope)).toHaveLength(1);
  } finally {await db.run("UPDATE device_scenes SET enabled=1 WHERE device_id='control-screen'");}
});
test('批量修改中一条被并发编辑，两条都不能部分提交',async()=>{
  const first=await create('特斯拉充电','car'), second=await create('自行车充电','bike');
  model.mockImplementationOnce(async()=>{
    await db.run("UPDATE info_items SET text='后台更正内容' WHERE id=?",second.id);
    return response([first,second].map(row=>({
      type:'info',op:'update',id:row.id,selector:row.text,basis:row.text,text:row.text+'完成'
    })));
  });
  await expect(say('conflict','把特斯拉充电和自行车充电两条信息正文都改成完成')).rejects.toMatchObject({status:409});
  expect((await records.owned(actor.scope)).map(r=>r.text).sort()).toEqual(['特斯拉充电','后台更正内容'].sort());
  expect((await db.one("SELECT status FROM pig_chat_audit WHERE turn_id LIKE '%:conflict'")).status).toBe('failed');
});
test('模型超额或服务失败时已有记录保持一致并记录失败原因',async()=>{
  const first=await create('特斯拉充电');
  for(const [index,status] of [429,502].entries()) {
    model.mockRejectedValueOnce(provider.fault(status===429?'供应商额度用完':'模型服务异常',status));
    await expect(say('provider-'+index,'把特斯拉充电信息推迟半小时')).rejects.toMatchObject({status});
    const row=(await records.owned(actor.scope))[0];
    expect(row.start).toBe(first.start);expect(row.end).toBe(first.end);
  }
  expect(await db.all("SELECT id FROM pig_chat_audit WHERE status='failed'")).toHaveLength(2);
});
test('模型修改已知编号时省略类型，按原记录类型处理；不可凭陌生编号推断',async()=>{
  const old=await create('特斯拉充电');
  model.mockResolvedValue(response([{op:'update',id:old.id,selector:'特斯拉',basis:'特斯拉',
    start:'2030-03-11T19:00+08:00',end:'2030-03-11T23:00+08:00'}]));
  await say('missing-type','把特斯拉信息开始时间改为明天19点，结束时间改为明天23点');
  expect((await records.owned(actor.scope))[0].id).toBe(old.id);
  expect(Date.parse((await records.owned(actor.scope))[0].end)).toBe(Date.parse('2030-03-11T23:00+08:00'));
  model.mockResolvedValue(response([{op:'cancel',id:'00000000',basis:'取消'}]));
  await expect(say('missing-type-invalid','取消信息 #00000000')).rejects.toMatchObject({status:422});
});
test('模型连接短暂失败重试一次，只有最终操作提交；连续失败保持原记录',async()=>{
  const old=await create('特斯拉充电');
  const unavailable=Object.assign(provider.fault('模型连接超时',502),{code:'MODEL_UNAVAILABLE'});
  model.mockRejectedValueOnce(unavailable).mockResolvedValueOnce(response([
    {op:'cancel',type:'info',id:old.id,basis:'取消',selector:'特斯拉'}
  ]));
  await say('retry','取消特斯拉信息');
  expect(await records.owned(actor.scope)).toEqual([]);
  expect(await db.all("SELECT id FROM pig_conversation WHERE id LIKE '%:retry'")).toHaveLength(1);
  const current=await create('自行车充电','bike');
  const calls=model.mock.calls.length;
  model.mockRejectedValue(unavailable);
  await expect(say('retry-fail','取消自行车信息')).rejects.toMatchObject({status:502});
  expect(model.mock.calls.length-calls).toBe(2);
  expect((await records.owned(actor.scope)).map(r=>r.id)).toEqual([current.id]);
});
