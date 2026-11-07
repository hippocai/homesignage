/* Real-model CRUD acceptance. Only an in-memory database and synthetic devices are used.
   Run with GLM_API_KEY or DEEPSEEK_API_KEY and optionally PIG_TEST_MODEL/PIG_TEST_PROVIDER. */
require('../setup');
require('dotenv').config();
const assert=require('node:assert/strict');
const fs=require('node:fs');
const request=require('supertest');
const {setupTestApp,getAdminToken}=require('../testApp');
const db=require('../../src/services/briefing/storage');
const provider=require('../../src/services/briefing/providers');
const records=require('../../src/services/briefing/owned-records');
const scheduler=require('../../src/services/schedulerService');
const {bindPig}=require('../pig-fixture');
const results=[];
let sequence=0, modelCalls=[];
async function run() {
  const app=await setupTestApp(), token=await getAdminToken(app);
  await require('../../src/dao/settingsDao').set('briefing.settings',{
    provider:process.env.PIG_TEST_PROVIDER || 'glm',model:process.env.PIG_TEST_MODEL || 'glm-5.3-flash',dailyCalls:-1,dailyTokens:-1
  });
  await db.run("INSERT INTO devices(id,name,device_key) VALUES('control-screen','隔离测试屏','fixture')");
  await bindPig('control-screen');
  const tomorrow=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(Date.now()+86400000));
  const original=provider.jsonCompletion;
  provider.jsonCompletion=async(...args)=>{
    try {
      const result=await original(...args);
      modelCalls.push(result.data);
      return result;
    } catch(e) {
      modelCalls.push({error:e.message,code:e.code,status:e.status});
      throw e;
    }
  };
  const guest=request.agent(app);
  await guest.post('/api/v1/pig-chat/session').send({}).expect(200);
  const visitor=(await db.one('SELECT id FROM pig_guests')).id;
  async function say(message,who='admin',requestId='live-'+(++sequence)) {
    const req=who==='admin'?request(app).post('/api/v1/companion/agent/messages').set('Authorization','Bearer '+token)
      :guest.post('/api/v1/pig-chat/messages');
    const response=await req.send({message,requestId,nickname:'测试家人'});
    assert.equal(response.status,200,response.body.error || JSON.stringify(response.body));
    return response.body.data;
  }
  const owned=(who='admin')=>records.owned(who==='admin'?'admin':visitor);
  async function check(name,fn) {
    modelCalls=[];
    try {await fn();results.push({name,status:'pass',model:modelCalls});console.log('PASS '+name);}
    catch(e){results.push({name,status:'fail',error:e.message,model:modelCalls});console.log('FAIL '+name+' '+e.message);}
  }
  let info,reminder,second;
  await check('I01 创建限时信息，正文与家庭时区准确',async()=>{
    await say('请在信息列表添加“给特斯拉充电”，明天18点到23点显示。');
    [info]=await owned();
    assert.equal(info?.text,'给特斯拉充电');
    assert.equal(Date.parse(info.start),Date.parse(tomorrow+'T18:00+08:00'));
    assert.equal(Date.parse(info.end),Date.parse(tomorrow+'T23:00+08:00'));
  });
  await check('I02 查询特定信息及不存在的主题',async()=>{
    assert.match((await say('查看我的充电信息')).reply,/特斯拉/);
    assert.match((await say('查看我的买菜信息')).reply,/没有符合条件/);
  });
  await check('I03 修改原信息正文，保留编号和显示时间',async()=>{
    await say('把特斯拉信息的正文改成“出门前拔掉充电枪”，显示时间不变。');
    const row=(await owned()).find(r=>r.id===info.id);
    assert.equal(row.text,'出门前拔掉充电枪');assert.equal(row.start,info.start);assert.equal(row.end,info.end);
  });
  await check('I04 修改开始时间，明确保持结束时间',async()=>{
    await say('把充电枪信息的开始时间改为明天19点，结束时间不变。');
    const row=(await owned()).find(r=>r.id===info.id);
    assert.equal(Date.parse(row.start),Date.parse(tomorrow+'T19:00+08:00'));assert.equal(row.end,info.end);
  });
  await check('I05 仅延长结束半小时',async()=>{
    await say('把充电枪信息结束时间推迟半小时，开始时间不变。');
    const row=(await owned()).find(r=>r.id===info.id);
    assert.equal(Date.parse(row.start),Date.parse(tomorrow+'T19:00+08:00'));
    assert.equal(Date.parse(row.end),Date.parse(tomorrow+'T23:30+08:00'));
  });
  await check('I06 新正文包含取消字样也只更新文案',async()=>{
    await say('把充电枪信息的正文改成“取消今晚充电，改到明天”，时间不变。');
    assert.equal((await owned()).find(r=>r.id===info.id).text,'取消今晚充电，改到明天');
  });
  await check('I07 创建第二条信息并通过刚才那条取消',async()=>{
    await say('在信息列表新增“记得买牛奶”，明天18点到20点显示。');
    second=(await owned()).find(r=>r.text==='记得买牛奶');
    assert.ok(second);
    await say('取消刚才那条信息。');
    assert.ok(!(await owned()).some(r=>r.id===second.id));
    assert.ok((await owned()).some(r=>r.id===info.id));
  });
  await check('I08 通过明确编号删除原信息',async()=>{
    await say('删除信息 #'+info.id.slice(0,8));
    assert.ok(!(await owned()).some(r=>r.id===info.id));
  });
  await check('R01 创建明早定时提示',async()=>{
    await say('请设置明天早上8点的定时提醒，内容为“准备出门去机场”。');
    reminder=(await owned()).find(r=>r.type==='reminder');
    assert.equal(Date.parse(reminder.start),Date.parse(tomorrow+'T08:00+08:00'));
    assert.equal(Date.parse(reminder.end)-Date.parse(reminder.start),300000);
  });
  await check('R02 推迟原提示并重放同一请求',async()=>{
    const message='航班改了，明早去机场的提醒推迟半小时';
    const result=await say(message,'admin','delay-replay');
    assert.equal((await say(message,'admin','delay-replay')).reply,result.reply);
    const rows=(await owned()).filter(r=>r.type==='reminder');
    assert.equal(rows.length,1);assert.equal(rows[0].id,reminder.id);
    assert.equal(Date.parse(rows[0].start),Date.parse(tomorrow+'T08:30+08:00'));
  });
  await check('R03 查询定时提示',async()=>{
    assert.match((await say('查看明早的机场提醒')).reply,/08:30/);
  });
  await check('R04 取消定时提示，任务一同移除',async()=>{
    await say('取消去机场的定时提醒');
    assert.ok(!(await owned()).some(r=>r.id===reminder.id));
    assert.ok(!require('node-schedule').scheduledJobs['reminder-start-'+reminder.id]);
  });
  await check('G01 访客也能创建与查看信息',async()=>{
    await say('在信息列表添加“晚饭留一份”，明天17点到21点显示。','guest');
    assert.equal((await owned('guest')).length,1);
    assert.match((await say('看看我的信息列表','guest')).reply,/晚饭/);
  });
  await check('G02 访客修改原文案及取消，编号可审计',async()=>{
    const [old]=await owned('guest');
    await say('把晚饭信息改成“晚饭留两份”，显示时间不变。','guest');
    assert.equal((await owned('guest'))[0].id,old.id);
    assert.equal((await owned('guest'))[0].text,'晚饭留两份');
    await say('取消晚饭信息','guest');
    assert.equal((await owned('guest')).length,0);
    const audit=await require('../../src/routes/pigChat').audit({});
    assert.ok(audit.items.some(r=>r.scope===visitor && r.actions.some(a=>a.id===old.id && a.op==='cancel' && a.before && a.after===null)));
  });
  await check('S01 否定和假设句不创建系统记录',async()=>{
    const before=await owned();
    await say('假设我想明天8点收到去机场提醒，你会怎么操作？现在不要创建。');
    await say('不要设置明早8点的机场提醒。');
    assert.deepEqual(await owned(),before);
  });
  await check('S02 时间不清楚时澄清并保持数据库',async()=>{
    const before=await owned();
    const reply=await say('帮我设置一个去机场的提醒，时间还没定。');
    assert.deepEqual(await owned(),before);assert.ok(reply.reply.length);
  });
  await check('A01 所有成功与失败请求都有审计，成功操作关联实际编号',async()=>{
    const turns=await db.all('SELECT id,actions FROM pig_conversation');
    for(const turn of turns) {
      const audit=await db.one("SELECT status FROM pig_chat_audit WHERE turn_id=? AND status='ok'",turn.id);
      assert.ok(audit);
      for(const action of JSON.parse(turn.actions)) assert.ok(action.id);
    }
    assert.equal((await db.one("SELECT count(*) n FROM pig_chat_audit WHERE status='pending'")).n,0);
  });
  for(const row of await db.all('SELECT id FROM timed_reminders')) scheduler.cancelReminder(row.id);
}
run().catch(e=>{results.push({name:'harness',status:'fail',error:e.message});console.error(e.message);}).finally(()=>{
  if(process.env.PIG_LIVE_REPORT) fs.writeFileSync(process.env.PIG_LIVE_REPORT,JSON.stringify(results,null,2));
  const failed=results.filter(r=>r.status==='fail');
  console.log(JSON.stringify({cases:results.length,passed:results.length-failed.length,failed:failed.length}));
  process.exit(failed.length?1:0);
});
