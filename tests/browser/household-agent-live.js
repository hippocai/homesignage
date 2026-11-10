/* Isolated GLM acceptance scenario. No real household details or real device deliveries. */
require('../setup');
require('dotenv').config();
const assert = require('node:assert/strict');
const {setupTestApp} = require('../testApp');
const request=require('supertest');
const db = require('../../src/services/briefing/storage');
const service = require('../../src/services/briefing/service');
const agent = require('../../src/services/briefing/household');
const settings = require('../../src/dao/settingsDao');

async function run() {
  const app=await setupTestApp();
  await settings.set('briefing.settings',{provider:'glm',model:'glm-5.3-flash'});
  await agent.saveProfile({revision:0,profile:{memory:'# 家庭\n三人。每个工作日经过青禾路上班，周一到周五 09:00–18:00。'}});
  const trip = new Date();
  trip.setUTCDate(1);
  trip.setUTCMonth(trip.getUTCMonth()+1);
  trip.setUTCDate(12);
  const day = trip.toISOString().slice(0,10);
  const guest=request.agent(app);
  await guest.post('/api/v1/pig-chat/login').send({username:'admin',password:'admin123'}).expect(200);
  await guest.post('/api/v1/pig-chat/session').send({}).expect(200);
  const res=await guest.post('/api/v1/pig-chat/messages').send({requestId:'fixture',nickname:'测试家人',message:'我们下个月12日坐 MU5123 从上海虹桥机场去北京旅行，请帮我记住。'}).expect(200);
  assert.ok(res.body.data.reply);
  const audit=await db.one('SELECT actor,reply,status FROM pig_chat_audit');
  assert.deepEqual(audit,{actor:'账号 admin（测试家人）',reply:res.body.data.reply,status:'ok'});
  const h=await agent.household();
  assert.ok(h.plans.some(v=>v.text.includes('MU5123') && v.start===day),'remember flight and relative date');
  const now=Date.now(), end=now+86400000;
  const headlines=[
    ['road','青禾路从今天起封闭施工，为期三天，请提前绕行。'],
    ['flight',day+'上海虹桥机场地勤计划罢工，当日 MU5123 航班可能延误或取消，旅客须向航司核实。'],
    ['other','异地银杉路周末举办绘画展。'],
    ['past','去年上海虹桥机场地勤罢工事件回顾，目前航班运行正常。']
  ];
  for(const [id,title] of headlines) await db.run(`INSERT INTO briefing_events(id,identity,kind,state,payload,targets,starts,expires,updated)
    VALUES(?,?,'news','published',?,'[]',?,?,?)`,id,id,JSON.stringify({title,summary:title,source:'模拟公告'}),now,end,now);
  await agent.analyze(now);
  await db.run("INSERT INTO devices(id,name,device_key) VALUES('hall','测试屏','test-key')");
  const fixture=require('../pig-fixture');
  await fixture.setRules(await fixture.bindPig('hall'),{enabled:true,quietFrom:'00:00',quietTo:'00:00',gap:0});
  const feed=await service.feed('hall',now);
  assert.deepEqual(feed.tasks.map(x=>x.id).sort(),['flight','road']);
  assert.equal(feed.cards.length,4);
  const action=await guest.post('/api/v1/pig-chat/messages').send({requestId:'tools',message:'请设定明天早上8点的定时提醒，内容是准备出门去机场。并在信息列表添加：明天晚上别忘了用充电桩给特斯拉充电。显示时间是晚上6点至23点。'}).expect(200);
  assert.ok(action.body.data.reply.includes('已设定定时提示') && action.body.data.reply.includes('已添加信息'));
  const tools=JSON.parse((await db.one("SELECT actions FROM pig_conversation WHERE id LIKE '%:tools'")).actions);
  assert.equal(tools.length,2);
  const tomorrow=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now+86400000);
  const info=tools.find(a=>a.type==='info'),reminder=tools.find(a=>a.type==='reminder');
  assert.equal(Date.parse(info.start),Date.parse(tomorrow+'T18:00+08:00'));
  assert.equal(Date.parse(info.end),Date.parse(tomorrow+'T23:00+08:00'));
  assert.equal(Date.parse(reminder.start),Date.parse(tomorrow+'T08:00+08:00'));
  assert.ok(await db.one('SELECT id FROM timed_reminders WHERE id=?',reminder.id));
  assert.ok(await db.one('SELECT id FROM info_items WHERE id=?',info.id));
  async function say(requestId,message) {
    const response=await guest.post('/api/v1/pig-chat/messages').send({requestId,message});
    assert.equal(response.status,200,JSON.stringify(response.body));
    return response.body.data.reply;
  }
  assert.ok((await say('list','查看我的定时提示和信息列表')).includes('特斯拉'));
  const change='航班改了，明早去机场的提醒推迟半小时';
  const changed=await say('delay',change);
  assert.ok(changed.includes('08:30'),changed);
  assert.equal(await say('delay',change),changed);
  assert.equal((await db.all('SELECT id FROM timed_reminders')).length,1);
  assert.equal((await db.one('SELECT start_time FROM timed_reminders WHERE id=?',reminder.id)).start_time,reminder.start.slice(11,13)+':30');
  const edited=await say('edit-info','把充电信息的正文改成“记得给特斯拉插好充电枪”，显示时间保持原样。');
  assert.ok(edited.includes('充电枪'),edited);
  assert.equal((await db.one('SELECT end_time FROM info_items WHERE id=?',info.id)).end_time,info.end);
  const canceled=await say('cancel-info','取消充电那条信息');
  assert.ok(canceled.includes('已取消'),canceled);
  await say('cancel-reminder','取消去机场的提醒');
  assert.equal(await db.one('SELECT id FROM timed_reminders WHERE id=?',reminder.id),undefined);
  assert.equal(await db.one('SELECT id FROM info_items WHERE id=?',info.id),undefined);
  console.log('PASS: GLM guest chat listed, moved, edited and canceled original records. Replaying the delay did not move it again.');
  console.log('PASS: real GLM guest chat created a dated airport reminder and an 18:00–23:00 charging notice with audited record IDs.');
  console.log('PASS: real GLM saved the relative-date flight, selected the commute closure and flight risk, and ignored unrelated and historical news.');
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});
