const request = require('supertest');
const {setupTestApp, getAdminToken} = require('./testApp');
const {baiduRanking} = require('../src/services/briefing/providers');
let app, token;
beforeAll(async () => {
  app = await setupTestApp();
  token = await getAdminToken(app);
});
const admin = (method, path) => request(app)[method]('/api/v1/news/' + path)
  .set('Authorization', 'Bearer ' + token);

test('catalog requires admin and lists news and hot searches without auto-subscribing', async () => {
  await request(app).get('/api/v1/news/presets').expect(401);
  await request(app).post('/api/v1/news/presets/ithome/subscribe').expect(401);
  const {body:{data}} = await admin('get','presets').expect(200);
  expect(data).toEqual(expect.arrayContaining([
    expect.objectContaining({key:'cns-china',type:'rss',subscribedId:null}),
    expect.objectContaining({key:'baidu',type:'ranking',subscribedId:null}),
    expect.objectContaining({key:'zaobao',type:'zaobao',subscribedId:null})
  ]));
  await admin('post','presets/unknown/subscribe').expect(404);
});
test('simultaneous subscriptions create one row, preserve customization, and allow resubscription after removal', async () => {
  const subscribe = () => admin('post','presets/ithome/subscribe').expect(200);
  const results = (await Promise.all([subscribe(), subscribe()])).map(r => r.body.data);
  const id = results[0].id;
  expect(results[1].id).toBe(id);
  expect(results.filter(r => r.added)).toHaveLength(1);
  await admin('patch','sources/'+id).send({name:'我的技术频道', enabled:false, keywords:'手机'}).expect(200);
  expect((await subscribe()).body.data).toEqual({id,added:false});
  expect((await admin('get','sources')).body.data).toEqual([expect.objectContaining({
    id, name:'我的技术频道', enabled:false, keywords:'手机'
  })]);
  const getPreset = async () => (await admin('get','presets')).body.data.find(p=>p.key==='ithome');
  expect((await getPreset()).subscribedId).toBe(id);
  await admin('delete','sources/'+id).expect(200);
  expect((await getPreset()).subscribedId).toBeNull();
  expect((await subscribe()).body.data).toMatchObject({added:true});
});
test('a custom Zaobao section can coexist with the preset for all sections', async () => {
  const manual = (await admin('post','sources').send({name:'早报中国',type:'zaobao',section:'china'}).expect(200)).body.data;
  const all = (await admin('post','presets/zaobao/subscribe').expect(200)).body.data;
  expect(all.added).toBe(true);
  expect(all.id).not.toBe(manual.id);
});
test('Baidu preserves real ranking and summary, skips pinned stories, and rejects malformed responses', () => {
  const data={cards:[{content:[
    {index:0,isTop:true,word:'置顶'},
    {index:0,word:'第一',desc:'简述',rawUrl:'https://example.org/story',url:'https://example.org/redirect'},
    {index:2,query:'第三',url:'https://example.org/three'}
  ]}]};
  expect(baiduRanking({success:true,data})).toEqual([
    {rank:1,title:'第一',summary:'简述',url:'https://example.org/story'},
    {rank:3,title:'第三',summary:undefined,url:'https://example.org/three'}
  ]);
  expect(()=>baiduRanking({success:true,data:{cards:[]}})).toThrow('格式无效');
});
