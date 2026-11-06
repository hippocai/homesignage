const assert = require('node:assert/strict');

// Use a second device so these checks cannot consume the companion's reminders.
module.exports = async function checkCoreDisplay({browser,page,api,url,errors}) {
  if (page) for (const route of ['dashboard','devices','scenes','reminders','emergency','info-items','file-repo','api-keys','settings']) {
    await page.goto(url + '/admin/' + route);
    await page.locator('h2.page-title').waitFor();
    assert.ok(page.url().endsWith('/'+route),route);
  }
  const device = await api('POST','/devices',{name:'基础组件测试屏'});
  const scene = await api('POST','/scenes',{name:'基础组件测试画面'});
  const configs = {
    clock:{timezone:'Asia/Shanghai'},text:{content:'屏幕文字验收'},image:{url:'/client/assets/peach-pig.svg'},
    weather:{city:'Beijing'},iframe:{url:'/api/v1/health',useProxy:false},
    video:{src:'/missing-test-video.mp4'},'info-list':{},stock:{symbol:'AAPL',market:'us',scaleMode:'auto'},
    companion:{appearance:'3d'},headlines:{seconds:2}
  };
  for (const [i,[type,config]] of Object.entries(configs).entries()) {
    await api('POST','/scenes/'+scene.id+'/components',{type,config,
      position:{x:i%4*25,y:Math.floor(i/4)*33,width:25,height:33}});
  }
  const notice = await api('POST','/info-items',{text:'基础屏公告验收',type:'info'});
  await api('PUT','/devices/'+device.id+'/scenes',{scenes:[{sceneId:scene.id,duration:60}]});
  const display = await browser.newPage({viewport:{width:1200,height:720}});
  await display.route('**/api/v1/devices/*/briefing*',route=>route.fulfill({json:{data:{
    tasks:[],active:[],preferences:{enabled:true},cards:['第一条资讯','第二条资讯'].map((title,i)=>({
      id:'test-'+i,kind:'news',expires:Date.now()+60000,payload:{title,source:'测试来源',summary:'测试简述'}
    }))
  }}}));
  display.on('pageerror',e=>errors.push(e.message));
  await display.route('**/api/v1/weather?**',route=>route.fulfill({json:{data:{city:'Beijing',tempC:19,tempF:66,icon:'☀',description:'晴'},fetchedAt:Date.now()}}));
  await display.route('**/api/v1/stocks?**',route=>route.fulfill({json:{data:{
    symbol:'AAPL',market:'us',name:'测试股票',displaySymbol:'AAPL',currency:'USD',timeZone:'America/New_York',
    price:123.45,previousClose:120,open:121,high:124,low:120,change:3.45,changePercent:2.875,
    sessions:[[570,960]],points:[{minute:570,price:121},{minute:571,price:123.45}],quoteTime:'09:31',source:'测试源'
  }}}));
  try {
    await display.goto(url+'/client/?deviceId='+device.id+'&deviceKey='+device.device_key);
    await display.locator('.text-component').getByText('屏幕文字验收').waitFor();
    await display.locator('.weather-component').getByText('19°C').waitFor();
    await display.locator('.stock-component').getByText('123.45',{exact:true}).waitFor();
    await display.locator('.stock-chart svg path').waitFor();
    await display.locator('.pig-portrait').waitFor();
    assert.ok(await display.locator('.pig-greeting').innerText());
    await display.getByText('第一条资讯',{exact:true}).waitFor();
    await display.getByText('第二条资讯',{exact:true}).waitFor();
    await display.locator('.info-list-component').getByText(notice.text,{exact:true}).first().waitFor();
    await display.locator('.video-component').getByText('视频加载失败').waitFor();
    assert.match(await display.locator('.clock-time').innerText(),/\d{2}:\d{2}/);
    assert.ok(await display.locator('.image-component img').evaluate(img=>img.decode().then(()=>img.naturalWidth>0)));
    assert.match(await display.frameLocator('.iframe-component iframe').locator('body').innerText(),/"status":"ok"/);
  } finally {
    await display.close();
    await api('DELETE','/info-items/'+notice.id);
    await api('DELETE','/devices/'+device.id);
    await api('DELETE','/scenes/'+scene.id);
  }
};
