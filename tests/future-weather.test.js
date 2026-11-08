const {setupTestApp}=require('./testApp');
const settings=require('../src/dao/settingsDao'),p=require('../src/services/briefing/providers');
const future=require('../src/services/briefing/future-weather');
const now=Date.parse('2026-11-08T08:00+08:00');
let mock,sequence=0;
const measure=(value,unit)=>({value,unit});
const day=i=>({forecastStartTime:`2026-11-${String(8+i).padStart(2,'0')}T00:00+08:00`,forecastEndTime:`2026-11-${String(9+i).padStart(2,'0')}T00:00+08:00`,temperatureMax:measure(20-i,'°C'),temperatureMin:measure(10-i,'°C'),daytime:{condition:{text:'小雨'},precipitation:{amount:measure(1,'mm'),probability:0.75},wind:{speed:measure(3,'m/s')}}});
const hour={forecastTime:'2026-11-08T09:00+08:00',temperature:measure(15,'°C'),windGust:measure(12,'m/s'),precipitation:{probability:0.8,amount:measure(1,'mm')}};
const alert=(id='a',type='alert',supersedes=[])=>({id,senderName:'苏州市气象台',issuedTime:'2026-11-08T07:00+08:00',effectiveTime:'2026-11-08T07:00+08:00',onsetTime:'2026-11-08T09:00+08:00',expireTime:'2026-11-09T10:00+08:00',messageType:{code:type,supersedes},eventType:{name:'大风'},severity:'severe',color:{code:'orange'},headline:'大风橙色预警',description:'阵风较强',instruction:'注意防风'});
beforeAll(setupTestApp);
beforeEach(async()=>{
  await settings.set('weather.qweather.apiKey','fixture-'+(++sequence));await settings.set('weather.qweather.host','fixture.qweather.com');
  mock=jest.spyOn(p,'remote').mockImplementation(async url=>{
    if(url.includes('/city/lookup'))return {code:'200',location:[{id:'101',name:'苏州',adm1:'江苏',lat:'31.3',lon:'120.6'}]};
    if(url.includes('/daily/'))return {metadata:{attributions:['source']},days:Array.from({length:8},(_,i)=>day(i))};
    if(url.includes('/hourly/'))return {metadata:{},hours:[hour]};
    return {metadata:{zeroResult:false},alerts:[alert()]};
  });
});
afterEach(()=>jest.restoreAllMocks());
test('新版接口请求今天加未来7天、48小时、官方预警；保留单位和来源',async()=>{
  const result=await future.get({city:'江苏/苏州市'},now);
  expect(result.daily.items).toHaveLength(8);expect(result.daily.items[0]).toMatchObject({highC:20,day:{rainPercent:75,rainMm:1,windMs:3}});
  expect(result.hourly.items[0]).toMatchObject({tempC:15,gustMs:12,rainPercent:80});
  expect(result.alerts.items[0]).toMatchObject({id:'a',issuer:'苏州市气象台',color:'orange',messageType:'alert'});
  expect(mock.mock.calls.some(([url])=>url.includes('days=8'))).toBe(true);expect(mock.mock.calls.some(([url])=>url.includes('hours=48'))).toBe(true);
  expect(JSON.stringify(result)).not.toContain('fixture-'+sequence);
});
test('并发查询复用请求；预警5分钟更新而预报一小时更新',async()=>{
  const location={city:'苏州'};await future.get(location,now);mock.mockClear();
  await Promise.all([future.get(location,now+60000),future.get(location,now+60000)]);expect(mock).not.toHaveBeenCalled();
  await Promise.all([future.get(location,now+300001),future.get(location,now+300001)]);
  expect(mock).toHaveBeenCalledTimes(1);expect(mock.mock.calls[0][0]).toContain('/weatheralert/');
});
test('有旧数据的网络失败标记stale，不伪装成无预警；无数据失败为unavailable',async()=>{
  const location={city:'苏州'};await future.get(location,now);mock.mockRejectedValue(new Error('secret-key'));
  expect((await future.get(location,now+300001)).alerts.status).toBe('stale');
  const unknown=await future.get({city:'北京'},now);expect(unknown.alerts.status).toBe('unavailable');expect(JSON.stringify(unknown)).not.toContain('secret-key');
});
test('成功空预警和失败明确不同，失败短缓存也不是fresh',async()=>{
  const impl=mock.getMockImplementation();mock.mockImplementation(async url=>url.includes('/weatheralert/')?{metadata:{zeroResult:true},alerts:[]}:impl(url));
  expect((await future.get({city:'苏州'},now)).alerts).toMatchObject({status:'fresh',items:[]});
  mock.mockImplementation(async url=>{if(url.includes('/weatheralert/'))throw Error('unavailable');return impl(url);});
  await settings.set('weather.qweather.apiKey','another-'+sequence);
  expect((await future.get({city:'苏州'},now)).alerts.status).toBe('unavailable');
  expect((await future.get({city:'苏州'},now+1000)).alerts.status).toBe('unavailable');
});
test('解除及替代消息删除被替代的旧预警，不保留过期条目',async()=>{
  const impl=mock.getMockImplementation();mock.mockImplementation(async url=>url.includes('/weatheralert/')?{metadata:{},alerts:[alert(),alert('b','cancel',['a']),{...alert('expired'),expireTime:'2026-11-08T07:00+08:00'}]}:impl(url));
  expect((await future.get({city:'苏州'},now)).alerts.items.map(v=>v.id)).toEqual(['b']);
});
test('同名城市拒绝静默猜测；带省份可消歧',async()=>{
  const impl=mock.getMockImplementation();mock.mockImplementation(async url=>url.includes('/city/lookup')?{code:'200',location:[{id:'a',name:'苏州',adm1:'江苏',lat:'31',lon:'120'},{id:'b',name:'苏州',adm1:'其他省',lat:'32',lon:'121'}]}:impl(url));
  expect((await future.get({city:'苏州'},now)).daily.status).toBe('unavailable');
  expect((await future.get({city:'江苏/苏州'},now)).daily.status).toBe('fresh');
});
test('错误温度单位和缺失时间不能进入模型',()=>{
  expect(()=>future.normalize('days',{metadata:{},days:[{...day(0),temperatureMax:measure(68,'°F')}]})).toThrow();
  expect(()=>future.normalize('hours',{metadata:{},hours:[{...hour,forecastTime:'bad'}]})).toThrow();
});
