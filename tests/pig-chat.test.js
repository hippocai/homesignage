const request=require('supertest');
const {setupTestApp,getAdminToken}=require('./testApp');
const db=require('../src/services/briefing/storage');
const h=require('../src/services/briefing/household');
const provider=require('../src/services/briefing/providers');
const {onLan}=require('../src/routes/pigChat');
let app,admin;
const base='/api/v1/pig-chat', manage='/api/v1/companion/agent';
beforeAll(async()=>{app=await setupTestApp();admin='Bearer '+await getAdminToken(app);});
beforeEach(async()=>{
  for(const table of ['pig_guests','pig_chat_audit','pig_conversation','briefing_usage']) await db.run('DELETE FROM '+table);
  await db.run("UPDATE pig_household SET revision=0,profile='{}',plans='[]'");
});
afterEach(()=>jest.restoreAllMocks());
async function guest() {
  const res=await request(app).post(base+'/session').send({}).expect(200);
  expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
  return res.headers['set-cookie'][0].split(';')[0];
}
const say=(cookie,message='吃饭',id='same',nickname='小明')=>request(app).post(base+'/messages')
  .set('Cookie',cookie).send({requestId:id,message,nickname});
const refresh=cookie=>request(app).post(base+'/session').set('Cookie',cookie).send({});
const model=()=>jest.spyOn(provider,'jsonCompletion').mockResolvedValue({data:{reply:'收到',add:[],remove:[]},tokens:8});
test('将旧家庭资料生成为可编辑文档；自由文本保持原样参与聊天，清除后旧资料不会重新出现',async()=>{
  await db.run('UPDATE pig_household SET profile=?',JSON.stringify({members:3,route:'青禾路',zone:'Asia/Shanghai'}));
  expect((await h.household()).profile.memory).toContain('上班路线：青禾路');
  const memory='# 每周三\n  - 去花园接外婆\n';
  await h.saveProfile({revision:0,profile:{memory}});
  const mock=model();
  await say(await guest()).expect(200);
  expect(JSON.parse(mock.mock.calls[0][1][1].content).profile.memory).toBe(memory);
  await expect(h.saveProfile({revision:0,profile:{memory:'覆盖'}})).rejects.toMatchObject({status:409});
  await expect(h.saveProfile({revision:1,profile:{memory:'a'.repeat(12001)}})).rejects.toMatchObject({status:400});
  await h.saveProfile({revision:1,profile:{memory:''}});
  expect((await h.household()).profile).toMatchObject({memory:'',route:''});
});
test('局域网范围按网卡网段判断；拒绝跨站、转发头、外部 Host',async()=>{
  const nets=[{cidr:'192.168.10.5/24'},{cidr:'fdab::5/64'}];
  for(const ip of ['127.0.0.1','::1','::ffff:192.168.10.23','fdab::18'])expect(onLan(ip,nets)).toBe(true);
  for(const ip of ['192.168.11.23','8.8.8.8','fdac::18','garbage'])expect(onLan(ip,nets)).toBe(false);
  await request(app).get('/pig-chat').expect(200);
  for(const [k,v] of [['Origin','https://other.example'],['X-Forwarded-For','127.0.0.1'],['Host','evil.example']])
    await request(app).post(base+'/session').set(k,v).send({}).expect(403);
  await request(app).post(base+'/messages').send({requestId:'x',message:'hi'}).expect(401);
  await request(app).get(manage+'/share').expect(401);
  const links=(await request(app).get(manage+'/share').set('Authorization',admin).expect(200)).body.data.links;
  expect(links[0]).toMatch(/\/pig-chat$/);
});
test('会话隔离、昵称仅作标签：相同请求号不能读到他人对话或取消他人计划',async()=>{
  const a=await guest(), b=await guest(), mock=model();
  mock.mockResolvedValueOnce({data:{reply:'已记住',add:[{text:'私人行程',start:'',end:''}],remove:[]},tokens:10});
  await say(a,'我的私人行程').expect(200);
  const plan=(await h.household()).plans[0];
  await say(b,'你好').expect(200);
  const input=JSON.parse(mock.mock.calls[1][1][1].content);
  expect(input.plans).toEqual([]);expect(input.history).toEqual([]);
  expect((await refresh(a)).body.data.history.map(t=>t.message)).toEqual(['我的私人行程']);
  expect((await refresh(b)).body.data.history.map(t=>t.message)).toEqual(['你好']);
  expect(await h.history()).toEqual([]);
  mock.mockResolvedValueOnce({data:{reply:'取消',add:[],remove:[plan.id]},tokens:5});
  await say(b,'取消','cancel').expect(409);
  expect((await h.household()).plans).toEqual([plan]);
  await say(a,'我的私人行程').expect(200);
  expect(mock).toHaveBeenCalledTimes(3);
  await request(app).get(manage+'/audit').set('Cookie',a).expect(401);
  const list=(await request(app).get(manage+'/audit').set('Authorization',admin)).body.data.items;
  expect(list).toHaveLength(4); expect(new Set(list.map(r=>r.scope)).size).toBe(2);
  expect(list[0]).toMatchObject({actor:'小明',status:'ok',message:'我的私人行程',reply:'已记住',ip:expect.any(String)});
});
test('提交已审计后再调用模型，失败保留原文，过期会话不能读取旧记录',async()=>{
  const cookie=await guest();
  jest.spyOn(provider,'jsonCompletion').mockImplementation(async()=>{
    expect(await db.one('SELECT status,message FROM pig_chat_audit')).toEqual({status:'pending',message:'明天去杭州'});
    throw provider.fault('模型暂不可用',502);
  });
  await say(cookie,'明天去杭州').expect(502);
  expect(await db.one('SELECT status,error FROM pig_chat_audit')).toEqual({status:'failed',error:'模型暂不可用'});
  await db.run('UPDATE pig_guests SET expires=0');
  await say(cookie).expect(401);
  const fresh=await refresh(cookie);
  expect(fresh.body.data.history).toEqual([]);expect(fresh.headers['set-cookie'][0].split(';')[0]).not.toBe(cookie);
});
test('审计分页不漏记录，旧对话迁移不重复，不虚构旧访问来源',async()=>{
  await db.run("INSERT INTO pig_conversation(id,created,message,reply,next_plans,scope) VALUES('old',1,'历史消息','历史回复','[]','admin')");
  await db.init();await db.init();
  expect(await db.one('SELECT count(*) AS n,actor,ip FROM pig_chat_audit')).toEqual({n:1,actor:'历史后台',ip:''});
  for(let i=0;i<31;i++) await db.run("INSERT INTO pig_chat_audit(created,scope,actor,ip,turn_id,message,status) VALUES(?,'admin','管理员','127.0.0.1',?,'消息','failed')",i,'test'+i);
  const first=(await request(app).get(manage+'/audit').set('Authorization',admin).expect(200)).body.data;
  const next=(await request(app).get(manage+'/audit?before='+first.next).set('Authorization',admin).expect(200)).body.data;
  expect(first.items.length).toBe(30);expect(next.items.length).toBe(2);expect(next.next).toBeNull();
  expect(new Set([...first.items,...next.items].map(r=>r.id)).size).toBe(32);
});
test('访客能一次创建定时提醒和限时信息；回执可追溯，重试不会再次创建，任务能触发屏幕事件',async()=>{
  const fixture=require('./pig-fixture'), schedule=require('node-schedule'), socket=require('../src/services/socketService');
  await db.run("INSERT INTO devices(id,name,device_key) VALUES('actions-screen','客厅','ak')");
  await fixture.setRules(await fixture.bindPig('actions-screen'),{enabled:true});
  const day=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  const message='提醒我去机场，同时把特斯拉充电加到信息列表';
  const mock=model().mockResolvedValue({data:{reply:'好',add:[],remove:[],actions:[
    {type:'reminder',basis:'提醒我去机场',text:'准备出门去机场',start:day+'T08:00+08:00'},
    {type:'info',basis:'特斯拉充电',text:'别忘了给特斯拉充电',start:day+'T18:00+08:00',end:day+'T23:00+08:00'}
  ]},tokens:20});
  const cookie=await guest();
  const res=await say(cookie,message).expect(200);
  expect(res.body.data.reply).toContain('已设定定时提示');expect(res.body.data.reply).toContain('23:00');
  await say(cookie,message).expect(200);
  expect(mock).toHaveBeenCalledTimes(1);
  const [reminder]=await db.all("SELECT * FROM timed_reminders WHERE created_by LIKE 'pig:%'");
  try {
    expect(JSON.parse(reminder.device_ids)).toEqual(['actions-screen']);expect(reminder.repeat).toBe('none');
    const start=schedule.scheduledJobs['reminder-start-'+reminder.id];
    expect(start.nextInvocation().getTime()).toBe(Date.parse(day+'T08:00+08:00'));
    const {activeDatedFor}=require('../src/services/schedulerService');
    expect((await activeDatedFor('actions-screen',new Date(day+'T08:02+08:00'))).map(r=>r.id)).toContain(reminder.id);
    expect(await activeDatedFor('actions-screen',new Date(day+'T08:05+08:00'))).toEqual([]);
    const emit=jest.spyOn(socket,'emitToDevice').mockImplementation(()=>{});
    await start.invoke();
    expect(emit).toHaveBeenCalledWith('actions-screen','timed-reminder-start',expect.objectContaining({content:{text:'准备出门去机场'}}));
    const items=await db.all("SELECT * FROM info_items WHERE text='别忘了给特斯拉充电'");
    expect(items).toHaveLength(1);expect(Date.parse(items[0].start_time)).toBe(Date.parse(day+'T18:00+08:00'));
    const audit=(await request(app).get(manage+'/audit').set('Authorization',admin)).body.data.items;
    expect(audit[0].actions.map(a=>a.id)).toEqual([reminder.id,items[0].id]);
  } finally {require('../src/services/schedulerService').cancelReminder(reminder.id);}
});
test('模型提出无效时间或未支持的操作时，整组不写入；只读资讯查询不能控制系统',async()=>{
  const mock=model(),before=(await db.all('SELECT id FROM info_items')).length;
  const output=actions=>({data:{reply:'请提供具体时间。',add:[],remove:[],actions},tokens:5});
  const valid={type:'info',text:'测试',basis:'信息列表',start:'2030-01-01T18:00+08:00',end:'2030-01-01T23:00+08:00'};
  for(const invalid of [{...valid,end:valid.start},{...valid,type:'delete'},{...valid,basis:'来自新闻'}]) {
    mock.mockResolvedValue(output([valid,invalid]));
    await expect(h.chat({message:'请写入信息列表',requestId:'bad'})).rejects.toMatchObject({status:422});
  }
  mock.mockResolvedValue(output([valid]));
  await h.chat({message:'最近的新闻有什么提醒？',requestId:'read'});
  expect(await db.all('SELECT id FROM info_items')).toHaveLength(before);
  expect((await db.all("SELECT status FROM pig_chat_audit WHERE status='failed'"))).toHaveLength(3);
});
test('以家庭当地日期校正模型把“明天晚上六点”误解为今天早晨六点的结果',async()=>{
  const {prepare}=require('../src/services/briefing/actions');
  const now=Date.parse('2027-01-31T16:30:00Z'); // 上海已经是 2 月 1 日
  const rows=await prepare([{type:'info',basis:'特斯拉充电',text:'特斯拉充电',
    start:'2027-02-01T06:00+08:00',end:'2027-02-01T23:00+08:00'}],
    '明天晚上6点至23点在信息列表提醒特斯拉充电',now,'Asia/Shanghai');
  expect(Date.parse(rows[0].start)).toBe(Date.parse('2027-02-02T18:00+08:00'));
  expect(Date.parse(rows[0].end)).toBe(Date.parse('2027-02-02T23:00+08:00'));
});
