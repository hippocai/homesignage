const {setupTestApp}=require('./testApp');
const db=require('../src/services/briefing/storage');
const household=require('../src/services/briefing/household');
const provider=require('../src/services/briefing/providers');
const records=require('../src/services/briefing/owned-records');
const scheduler=require('../src/services/schedulerService');
const nodeSchedule=require('node-schedule');
const {bindPig}=require('./pig-fixture');
const fixedNow=Date.parse('2030-03-10T10:00+08:00');
const owner={scope:'alice',name:'家人',ip:'127.0.0.1'};
const other={...owner,scope:'bob'};
const morning='2030-03-11T08:00+08:00';
const say=(id,message,actor=owner)=>household.chat({requestId:id,message},fixedNow,actor);
let model;
function propose(actions) {
  model.mockResolvedValue({data:{reply:'请核对记录',add:[],remove:[],actions},tokens:5});
}
async function create(type,text,id='first',actor=owner) {
  const message=type==='info'?'加入信息列表：'+text:'提醒我'+text;
  propose([{type,op:'create',text,basis:text,start:morning,end:'2030-03-11T08:05+08:00'}]);
  await say(id,message,actor);
  const row=await db.one('SELECT actions FROM pig_conversation WHERE scope=? AND message=? ORDER BY rowid DESC',actor.scope,message);
  return JSON.parse(row.actions)[0].id;
}
beforeAll(async()=>{
  await setupTestApp();
  await db.run("INSERT INTO devices(id,name,device_key) VALUES('hall','测试屏','hk')");
  await bindPig('hall');
});
beforeEach(async()=>{
  for(const table of ['timed_reminders','info_items','pig_conversation','pig_chat_audit','briefing_usage']) await db.run('DELETE FROM '+table);
  model=jest.spyOn(provider,'jsonCompletion');
});
afterEach(async()=>{
  for(const row of await db.all('SELECT id FROM timed_reminders')) scheduler.cancelReminder(row.id);
  jest.restoreAllMocks();
});
test('推迟读取旧开始时间，保留时长与 ID；重复发送不重复推迟，取消解除原定时任务',async()=>{
  const id=await create('reminder','去机场');
  const start=()=>nodeSchedule.scheduledJobs['reminder-start-'+id];
  const original=start();
  propose([{op:'update',type:'reminder',id,basis:'推迟半小时',selector:'机场',start:'2030-03-11T12:00+08:00'}]);
  const message='航班改了，明早去机场的提醒推迟半小时';
  const result=await say('move',message);
  expect(result.reply).toContain('08:30');
  expect(await say('move',message)).toEqual(result);
  const [row]=await records.owned(owner.scope);
  expect(row.id).toBe(id);
  expect(Date.parse(row.start)).toBe(Date.parse(morning)+1800000);
  expect(Date.parse(row.end)-Date.parse(row.start)).toBe(300000);
  expect(original.nextInvocation()).toBeNull();
  const emit=jest.spyOn(require('../src/services/socketService'),'emitToDevice');
  await original.invoke();
  expect(emit).not.toHaveBeenCalled();
  expect(start().nextInvocation().getTime()).toBe(Date.parse(row.start));
  const audit=require('../src/routes/pigChat').audit;
  expect((await audit({})).items[0].actions[0]).toMatchObject({id,op:'update',before:{text:'去机场'},after:{start:row.start}});
  expect((await say('read','查看我的提醒')).reply).toContain('08:30');
  propose([{op:'cancel',id,type:'reminder',basis:'取消',selector:'机场'}]);
  await say('cancel','取消机场提醒');
  expect(start()).toBeUndefined();
  expect(await records.owned(owner.scope)).toEqual([]);
  expect((await audit({})).items[0].actions[0]).toMatchObject({id,op:'cancel',before:{start:row.start},after:null});
});
test('访客只能查看和操作自己创建的记录；正文修改保留信息时段；遇到相似目标先澄清',async()=>{
  const a=await create('info','特斯拉充电');
  const b=await create('info','自行车充电','bike');
  await create('info','私人的充电消息','other',other);
  await db.run("INSERT INTO info_items(id,type,text) VALUES('manual','info','后台充电事项')");
  const shown=await say('read','看看我的信息列表');
  expect(shown.reply).toContain('特斯拉');expect(shown.reply).not.toMatch(/私人的|后台充电/);
  propose([{op:'cancel',type:'info',id:a,basis:'充电',selector:'充电'}]);
  await expect(say('ambiguous','取消充电信息')).rejects.toMatchObject({status:422});
  expect(await records.owned(owner.scope)).toHaveLength(2);
  propose([{op:'update',type:'info',id:a,basis:'特斯拉',selector:'特斯拉',text:'记得拔充电枪'}]);
  const [original]= (await records.owned(owner.scope)).filter(r=>r.id===a);
  await say('edit','把特斯拉信息改成“记得拔充电枪”');
  const changed=await db.one('SELECT text,start_time,end_time FROM info_items WHERE id=?',a);
  expect(changed).toEqual({text:'记得拔充电枪',start_time:original.start,end_time:original.end});
  propose([{op:'cancel',type:'info',id:a,basis:'取消',selector:'充电'}]);
  await expect(say('foreign','取消信息 #'+a,other)).rejects.toMatchObject({status:422});
  await expect(say('manual','取消信息 #manual',other)).rejects.toMatchObject({status:422});
  expect(await db.one('SELECT id FROM info_items WHERE id=?',b)).toBeTruthy();
  expect(await db.one("SELECT id FROM info_items WHERE id='manual'")).toBeTruthy();
});
test('模型误提议新建、或分析期间记录被后台改动时，保留原记录并审计失败',async()=>{
  const id=await create('info','充电'),message='把充电信息改成明天去加油';
  propose([{op:'create',type:'info',basis:'充电',text:'加油',start:morning,end:'2030-03-11T10:00+08:00'}]);
  await expect(say('wrong',message)).rejects.toMatchObject({status:422});
  model.mockImplementationOnce(async()=>{
    await db.run("UPDATE info_items SET text='后台最新更正' WHERE id=?",id);
    return {data:{reply:'好',add:[],remove:[],actions:[{op:'update',id,type:'info',basis:'充电',selector:'充电',text:'去加油'}]},tokens:7};
  });
  await expect(say('race',message)).rejects.toMatchObject({status:409});
  expect(await db.all('SELECT id,text FROM info_items')).toEqual([{id,text:'后台最新更正'}]);
  expect(await db.all("SELECT status FROM pig_chat_audit WHERE status='failed'")).toHaveLength(2);
});
test('旧版对话创建的记录升级后仍归原会话，已删除和手工新建的项目不会混入',async()=>{
  const kept=await create('info','晚饭留言');
  const removed=await create('info','已过期留言','gone');
  await db.run('DELETE FROM info_items WHERE id=?',removed);
  await db.run("INSERT INTO info_items(id,type,text) VALUES('manual','info','手工添加')");
  // Reproduce the pre-upgrade database: creation turns persisted, ownership table absent.
  await db.run('DROP TABLE pig_record_owner');
  await db.init();
  expect((await records.owned(owner.scope)).map(r=>r.id)).toEqual([kept]);
  expect(await records.owned(other.scope)).toEqual([]);
  await db.run('DELETE FROM info_items WHERE id=?',kept);
  await db.run("INSERT INTO info_items(id,type,text) VALUES(?,'info','重新手工创建')",kept);
  await db.init();
  expect(await records.owned(owner.scope)).toEqual([]);
});
