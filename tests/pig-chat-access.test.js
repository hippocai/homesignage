const request=require('supertest'),bcrypt=require('bcrypt');
const {setupTestApp}=require('./testApp'),db=require('../src/services/briefing/storage');
const access=require('../src/services/briefing/chat-access'),provider=require('../src/services/briefing/providers');
let app;
const base='/api/v1/pig-chat',lan='192.168.10.204:3000';
const cookie=(res,name)=>res.headers['set-cookie'].find(s=>s.startsWith(name+'=')).split(';')[0];
const login=(username='admin',password='admin123')=>request(app).post(base+'/login').send({username,password});
beforeAll(async()=>{app=await setupTestApp();await db.run('INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)','chat-second','second',await bcrypt.hash('second123',10),'admin');});
beforeEach(async()=>{for(const table of ['pig_chat_logins','pig_guests','pig_chat_audit','pig_conversation'])await db.run('DELETE FROM '+table);});
afterEach(()=>jest.restoreAllMocks());
test.each(['192.168.10.106','::ffff:192.168.10.106'])('真实LAN地址%s且LAN入口免登录，历史访客能力保留',async ip=>{
  jest.spyOn(access,'address').mockReturnValue(ip);
  const page=await request(app).get('/pig-chat').set('Host',lan).expect(200);expect(page.text).toContain('id="composer"');
  const res=await request(app).post(base+'/session').set('Host',lan).send({}).expect(200);
  expect(res.body.data.authenticated).toBe(false);expect(cookie(res,'pig_guest')).toBeTruthy();
});
test.each(['203.0.113.9','192.168.11.9','172.17.0.1','127.0.0.1','::1','2001:db8::1'])('来源%s不能靠私网Host绕过登录',async ip=>{
  jest.spyOn(access,'address').mockReturnValue(ip);
  const page=await request(app).get('/pig-chat').set('Host',lan).expect(200);expect(page.text).toContain('id="login"');expect(page.text).not.toContain('id="history"');
  await request(app).post(base+'/session').set('Host',lan).send({}).expect(401);
  await request(app).post(base+'/messages').set('Host',lan).send({message:'你好',requestId:'bypass'}).expect(401);
  expect(await db.all('SELECT * FROM pig_guests')).toHaveLength(0);expect(await db.all('SELECT * FROM pig_chat_audit')).toHaveLength(0);
});
test('LAN来源通过域名入口或带代理头同样要求登录，转发头不能冒充局域网',async()=>{
  jest.spyOn(access,'address').mockReturnValue('192.168.10.106');
  for(const host of ['chat.example','192.168.10.204.evil.example','172.17.0.2'])await request(app).post(base+'/session').set('Host',host).send({}).expect(401);
  for(const header of ['X-Forwarded-For','X-Real-IP','Forwarded','X-Forwarded-Host','X-Forwarded-Proto'])
    await request(app).post(base+'/session').set('Host',lan).set(header,'192.168.10.107').send({}).expect(401);
});
test('外部正确登录后才能读取页面、建会话和聊天；Cookie不授予后台权限；审计记录账号',async()=>{
  await login('admin','bad').expect(401);await login('missing','bad').expect(401);
  const res=await login().expect(200),auth=cookie(res,'pig_chat_login');
  expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);expect(res.headers['set-cookie'][0]).toMatch(/SameSite=Strict/);
  expect((await db.one('SELECT token_hash FROM pig_chat_logins')).token_hash).not.toBe(auth.split('=')[1]);
  expect((await request(app).get('/pig-chat').set('Cookie',auth).expect(200)).text).toContain('id="composer"');
  const session=await request(app).post(base+'/session').set('Cookie',auth).send({}).expect(200),guest=cookie(session,'pig_guest');
  expect(session.body.data).toMatchObject({authenticated:true,alias:'admin'});
  jest.spyOn(provider,'jsonCompletion').mockResolvedValue({data:{reply:'收到',add:[],remove:[]},tokens:5});
  await request(app).post(base+'/messages').set('Cookie',[auth,guest]).send({requestId:'auth-chat',message:'你好',nickname:'家人'}).expect(200);
  expect((await db.one('SELECT actor FROM pig_chat_audit')).actor).toBe('账号 admin（家人）');
  await request(app).get('/api/v1/companion/agent').set('Cookie',auth).expect(401);
  await request(app).post(base+'/session').set('Cookie',guest).send({}).expect(401);
});
test('退出、会话到期、密码修改均使外部旧Cookie失效；用户历史仍保留',async()=>{
  const auth=cookie(await login().expect(200),'pig_chat_login');
  const guest=cookie(await request(app).post(base+'/session').set('Cookie',auth).send({}).expect(200),'pig_guest');
  await request(app).post(base+'/logout').set('Cookie',[auth,guest]).send({}).expect(200);
  await request(app).post(base+'/session').set('Cookie',auth).send({}).expect(401);
  expect(await db.all('SELECT * FROM pig_guests')).toHaveLength(1);
  const expired=cookie(await login().expect(200),'pig_chat_login');await db.run('UPDATE pig_chat_logins SET expires=0');
  await request(app).post(base+'/session').set('Cookie',expired).send({}).expect(401);
  const fresh=cookie(await login('second','second123').expect(200),'pig_chat_login');
  const old=await db.one("SELECT password FROM users WHERE id='chat-second'");
  try{await db.run("UPDATE users SET password=? WHERE id='chat-second'",await bcrypt.hash('changed123',10));
    await request(app).post(base+'/session').set('Cookie',fresh).send({}).expect(401);
  }finally{await db.run("UPDATE users SET password=? WHERE id='chat-second'",old.password);}
});
test('账号切换不能继承他人聊天Cookie；LAN旧访客登录可绑定并保留原会话',async()=>{
  const address=jest.spyOn(access,'address').mockReturnValue('192.168.10.106');
  const guest=cookie(await request(app).post(base+'/session').set('Host',lan).send({}).expect(200),'pig_guest');
  const original=(await db.one('SELECT id FROM pig_guests')).id;
  address.mockReturnValue('203.0.113.1');
  const a=cookie(await login().expect(200),'pig_chat_login');
  await request(app).post(base+'/session').set('Cookie',[a,guest]).send({}).expect(200);
  expect((await db.one('SELECT id,user_id FROM pig_guests WHERE id=?',original)).user_id).toBeTruthy();
  const b=cookie(await login('second','second123').expect(200),'pig_chat_login');
  const next=await request(app).post(base+'/session').set('Cookie',[b,guest]).send({}).expect(200);
  expect(cookie(next,'pig_guest')).not.toBe(guest);expect(next.body.data.history).toEqual([]);
  await request(app).post(base+'/messages').set('Cookie',[b,guest]).send({message:'读旧会话',requestId:'foreign'}).expect(401);
});
test('登录拒绝跨站及非JSON提交，HTTPS代理入口可登录但不能免认证',async()=>{
  await request(app).post(base+'/login').set('Origin','https://evil.example').send({username:'admin',password:'admin123'}).expect(403);
  await request(app).post(base+'/login').type('form').send({username:'admin',password:'admin123'}).expect(415);
  const res=await request(app).post(base+'/login').set('Host','chat.example').set('Origin','https://chat.example').set('X-Forwarded-Proto','https').send({username:'admin',password:'admin123'}).expect(200);
  expect(res.headers['set-cookie'][0]).toMatch(/; Secure/);
  await request(app).post(base+'/session').set('Host','chat.example').set('X-Forwarded-For','192.168.10.1').send({}).expect(401);
});
test('两个账号并发绑定同一LAN旧会话，只有一个获得旧会话',async()=>{
  const address=jest.spyOn(access,'address').mockReturnValue('192.168.10.106');
  const guest=cookie(await request(app).post(base+'/session').set('Host',lan).send({}).expect(200),'pig_guest');
  const original=(await db.one('SELECT id FROM pig_guests')).id;address.mockReturnValue('203.0.113.2');
  const a=cookie(await login().expect(200),'pig_chat_login'),b=cookie(await login('second','second123').expect(200),'pig_chat_login');
  const responses=await Promise.all([a,b].map(auth=>request(app).post(base+'/session').set('Cookie',[auth,guest]).send({}).expect(200)));
  expect(responses.filter(r=>!r.headers['set-cookie'])).toHaveLength(1);
  expect(await db.all('SELECT id FROM pig_guests')).toHaveLength(2);expect((await db.one('SELECT user_id FROM pig_guests WHERE id=?',original)).user_id).toBeTruthy();
});
test('重复错误登录触发限速，伪造转发IP不能绕过',async()=>{
  let status;
  for(let i=0;i<21;i++){status=(await request(app).post(base+'/login').set('X-Forwarded-For','192.168.10.'+i).send({username:'admin',password:'wrong'})).status;if(status===429)break;}
  expect(status).toBe(429);await login().expect(429);
});
