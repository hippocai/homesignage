/* Run after building admin. Uses only an in-memory DB and a loopback port. */
require('../setup');
const live = process.argv.includes('--live');
if (live) require('dotenv').config();
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { setupTestApp, getAdminToken } = require('../testApp');
const socket = require('../../src/services/socketService');
const service = require('../../src/services/briefing/service');
const rules = require('../../src/services/briefing/rules');
const providers = require('../../src/services/briefing/providers');
const scenePlanner = require('../../src/services/scenePlannerService');
async function main() {
  const app = await setupTestApp(),
    token = await getAdminToken(app),
    server = http.createServer(app);
  socket.initSocketService(server);
  scenePlanner.setSocketService(socket);
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + server.address().port;
  async function api(method, route, body) {
    const r = await fetch(url + '/api/v1' + route, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const b = await r.json();
    assert.ok(r.ok, route + ' ' + r.status + ' ' + (b.error || ''));
    return b.data;
  }
  let browser;
  try {
    const device = await api('POST', '/devices', { name: '玄关测试屏' });
    const scene = await api('POST', '/scenes', { name: '猪猪与资讯' });
    for (const [type, y, height, config] of [
      ['headlines', 5, 40, { count: 3, fontSize: 20 }],
      ['companion', 48, 48, { resident: true, reminders:{enabled:true,quietFrom:'00:00',quietTo:'00:00',gap:0} }]
    ]) {
      await api('POST', '/scenes/' + scene.id + '/components', {
        type,
        position: { x: 10, y, width: 80, height },
        config
      });
    }
    await api('PUT', '/devices/' + device.id + '/scenes', {
      scenes: [{ sceneId: scene.id, duration: 60 }]
    });
    const feedUrl = 'https://www.chinanews.com.cn/rss/scroll-news.xml';
    const zaobao = process.argv.includes('--zaobao');
    const source = rules.source({
      type: zaobao ? 'zaobao' : 'rss',
      url: feedUrl,
      name: zaobao ? '联合早报' : '中国新闻网',
      enabled: false,
      targets: [device.id]
    });
    let title = '青禾路周三封路',
      id;
    if (live) {
      const sample = (await providers.collect(source)).articles.find(
        (a) => a.time > Date.now() - 86400000
      );
      assert.ok(sample, 'RSS should contain a recent item');
      const saved = await api('POST', '/news/sources', { ...source, keywords: sample.title });
      await api('POST', '/news/sources/' + saved.id + '/scan');
      const hits = await api('GET', '/news/events');
      assert.equal(hits.length, 1);
      assert.ok(!/供应商|未通过|预算/.test(hits[0].payload.reason), hits[0].payload.reason);
      const usage = (await api('GET', '/news/settings')).usage;
      assert.ok(
        usage.some((x) => x.provider === 'glm' && x.calls === 1 && x.tokens > 0 && x.tokens !== 2400),
        'GLM usage was reconciled: ' + JSON.stringify(usage) + ' ' + hits[0].payload.reason
      );
      id = hits[0].id;
      title = hits[0].payload.title;
    } else {
      id = await service.record(
        'fixture',
        source,
        { ref: 'fixture', title, url: 'https://example.org/notice', time: Date.now(), excerpt: title },
        { ...rules.defaults, dailyCalls: 0 }
      );
    }
    browser = await chromium.launch({
      headless: true,
      args: ['--enable-unsafe-swiftshader'],
      executablePath: process.env.CHROME_PATH || undefined
    });
    const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url + '/admin/login');
    await page.locator('input[autocomplete=username]').fill('admin');
    await page.locator('input[type=password]').fill('admin123');
    await page.locator('button.login-btn').click();
    await page.waitForURL('**/dashboard');
    await require('./core-display')({browser,page,api,url,errors});
    await page.goto(url + '/admin/briefing');
    await page.waitForURL('**/admin/news');
    await page.getByRole('heading',{name:'资讯',exact:true}).waitFor();
    await page.getByText(title, { exact: true }).first().waitFor();
    await page.getByText('已发布', { exact: true }).first().waitFor();
    await page.goto(url + '/admin/news?tab=sources');
    await page.locator('.preset-picker').click();
    await page.getByRole('option', {name:'IT之家',exact:true}).click();
    await page.getByRole('button', {name:'订阅所选来源'}).click();
    await page.getByRole('row').filter({hasText:'IT之家'}).getByText('已启用').waitFor();
    await page.locator('.preset-picker').click();
    assert.equal(await page.getByRole('option',{name:'IT之家（已订阅）'}).getAttribute('aria-disabled'), 'true');
    await page.keyboard.press('Escape');
    await page.getByRole('tab',{name:'话题偏好'}).click();
    const topicInputs = page.getByRole('textbox',{name:'感兴趣的话题'});
    await topicInputs.first().fill(title);
    await topicInputs.first().press('Enter');
    await page.getByRole('button',{name:'保存话题偏好'}).click();
    await page.getByText('话题偏好已保存',{exact:true}).waitFor();
    assert.deepEqual((await api('GET','/news/settings')).interests,[title.toLowerCase()]);
    await page.getByRole('menuitem',{name:'猪猪伙伴'}).click();
    await page.waitForURL('**/admin/companion');
    if (!live) {
      providers.jsonCompletion = async () => ({data:{reply:'已记住测试航班。',
        add:[{text:'下个月坐 MU5123 去上海',start:'',end:''}],remove:[]},tokens:30});
      await page.getByRole('tab',{name:'家庭记忆'}).click();
      await page.getByRole('textbox',{name:'记忆文档'}).fill('# 出行\n每周三经过青禾路');
      await page.getByRole('button',{name:'保存家庭记忆'}).click();
      await page.getByText('家庭记忆已保存',{exact:true}).waitFor();
      await page.getByRole('tab',{name:'和猪猪聊天'}).click();
      await page.getByRole('textbox',{name:'发给猪猪的消息'}).fill('下个月坐 MU5123 去上海');
      await page.getByRole('button',{name:'发送',exact:true}).click();
      await page.getByText('已记住测试航班。',{exact:false}).waitFor();
      assert.equal((await api('GET','/companion/agent')).plans.length,1);
      await page.getByRole('button',{name:'取消跟进'}).click();
      await page.getByRole('button',{name:'取消跟进'}).waitFor({state:'detached'});
      const guest=await browser.newPage({viewport:{width:390,height:740}});
      await guest.goto(url+'/pig-chat');
      await guest.getByLabel('如何称呼你？').fill('爷爷');
      await guest.getByLabel('发给猪猪').fill('周三在家吃晚饭');
      await guest.getByRole('button',{name:'发送'}).click();
      await guest.getByText('已记录',{exact:true}).waitFor();
      await guest.reload();
      await guest.getByText('周三在家吃晚饭',{exact:true}).waitFor();
      const guest2=await browser.newPage();
      await guest2.goto(url+'/pig-chat');
      await guest2.getByText('还没有对话。',{exact:false}).waitFor();
      await page.getByRole('tab',{name:'聊天审计'}).click();
      await page.getByText('爷爷',{exact:true}).waitFor();
      await page.getByText('周三在家吃晚饭',{exact:false}).waitFor();
      providers.jsonCompletion=async(_settings,messages)=>{
        const input=JSON.parse(messages[1].content);
        const action=input.mode?{op:input.mode,type:'info',id:input.ownedRecords[0].id,basis:'充电',selector:'充电'}:
          {op:'create',type:'info',text:'家用充电',basis:'充电',start:'2035-01-09T18:00+08:00',end:'2035-01-09T23:00+08:00'};
        return {data:{reply:'收到',add:[],remove:[],actions:[action]},tokens:10};
      };
      async function chat(text,reply) {
        await guest.getByLabel('发给猪猪').fill(text);
        await guest.getByRole('button',{name:'发送'}).click();
        await guest.locator('#history article:last-child p').filter({hasText:reply}).waitFor();
      }
      await chat('在信息列表添加充电消息','已添加信息');
      await chat('充电信息推迟半小时','18:30');
      await chat('查看我的信息列表','18:30');
      await chat('取消充电信息','已取消');
      await page.getByRole('button',{name:'刷新记录'}).click();
      const update=page.locator('.audit-action').filter({hasText:'修改'});
      await update.getByText(/原记录：家用充电/).waitFor();
      await update.getByText(/新记录：家用充电/).waitFor();
      await guest.close();await guest2.close();
    }
    assert.equal(await page.getByRole('heading',{name:'设备提醒'}).count(),0);
    await page.goto(url + '/admin/scenes/' + scene.id + '/edit');
    await page.locator('img.pig-portrait').first().waitFor();
    await page.locator('.preview-component .news-sheet').getByText(title, { exact: true }).first().waitFor();
    await page.locator('.preview-component').filter({has:page.locator('.news-sheet')}).click();
    const keywords = page.getByRole('textbox',{name:'组件关注词'});
    for (const word of [title,'热搜样例']) { await keywords.fill(word); await keywords.press('Enter'); }
    const newsType = page.getByRole('checkbox',{name:'新闻',exact:true});
    const label = newsType.locator('xpath=ancestor::label');
    await label.click();
    assert.equal(await newsType.isChecked(),false);
    await label.click();
    const seconds = page.getByText('每条停留',{exact:true}).locator('..').getByRole('spinbutton');
    await seconds.fill('2');
    await seconds.blur();
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/components/') && r.request().method() === 'PUT' && r.ok()),
      page.getByRole('button',{name:'应用更改'}).click()
    ]);
    const newsConfig = (await api('GET','/scenes/'+scene.id+'/components')).find(c=>c.type==='headlines').config;
    assert.deepEqual(newsConfig.keywords,[title,'热搜样例']);
    assert.deepEqual([...newsConfig.categories].sort(),['news','ranking']);
    assert.equal(newsConfig.seconds,2);
    // A pre-existing component with no appearance can be upgraded in the editor.
    await page.locator('.preview-component').filter({has:page.locator('img.pig-portrait')}).click();
    await page.getByText('提醒、声音与免打扰',{exact:true}).click();
    assert.equal(await page.getByRole('checkbox',{name:'家庭事项'}).isChecked(),true);
    await page.locator('.pig-rules label.el-checkbox').filter({hasText:'降温提醒'}).click();
    await page.getByPlaceholder('例如：深圳市').fill('深圳市');
    assert.equal(await page.getByText(/纬度|经度/).count(),0);
    if (!live) {
      const remote = providers.remote;
      providers.remote = (url, ...rest) => url.startsWith('https://geocoding-api.open-meteo.com/')
        ? Promise.resolve({results:[{name:'深圳',feature_code:'PPLA2',latitude:22.54,longitude:114.06}]})
        : remote(url, ...rest);
    }
    await page.getByRole('button',{name:'预览提醒'}).click();
    await page.getByText('今晚八点停水，记得提前接水。',{exact:false}).first().waitFor();
    const gap=page.getByText('同一事项间隔',{exact:true}).locator('..').getByRole('spinbutton');
    await gap.fill('35');await gap.blur();
    await page.getByText('3D 玩偶', { exact: true }).click();
    await page.locator('canvas.pig-portrait[data-pose=scarf]').first().waitFor();
    await page.getByText('选择样貌',{exact:true}).locator('..').locator('.el-select').click();
    await page.getByRole('option',{name:'兔耳猪'}).click();
    await page.locator('canvas[aria-label="3D 兔耳猪"]').first().waitFor();
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/components/') && r.request().method() === 'PUT' && r.ok()),
      page.getByRole('button',{name:'应用更改'}).click()
    ]);
    const savedRules=(await api('GET','/scenes/'+scene.id+'/components')).find(c=>c.type==='companion').config.reminders;
    assert.equal(savedRules.repeatMinutes,35);
    assert.equal(savedRules.city,'深圳市');
    assert.ok(savedRules.cold && !('latitude' in savedRules) && !('longitude' in savedRules));
    const screen = await browser.newPage({ viewport: { width: 1000, height: 650 } });
    screen.on('pageerror', (e) => errors.push(e.message));
    await screen.goto(url + '/client/?deviceId=' + device.id + '&deviceKey=' + device.device_key);
    await screen.getByText(title, { exact: true }).first().waitFor();
    await screen.waitForFunction(() => typeof socket !== 'undefined' && socket && socket.connected);
    // Exercise the same playback renderer with two eligible items and one non-match.
    await screen.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'rotation-check';
      host.style.cssText = 'position:fixed;top:0;width:205px;height:99px;z-index:10000;pointer-events:none';
      document.body.append(host);
      const items = ['北京发布新规划','长三角夜跑热搜','应被过滤'].map((title,i)=>({
        id:String(i),kind:i === 1 ? 'ranking':'news',expires:Date.now()+60000,
        payload:{title,source:'测试来源',summary:'简介内容'.repeat(100)}
      }));
      const config = {keywords:['北京','夜跑'],categories:['news','ranking'],seconds:2,fontSize:72};
      host.updateFeed = (entries, options=config) => HomeBriefing.cards(host,options,entries,Date.now());
      host.updateFeed(items);
      host.simulateSync = () => host.updateFeed(items);
      host.onlyRankings = () => host.updateFeed(items,{category:'ranking',theme:'夜跑'});
    });
    const demo = screen.locator('#rotation-check');
    await screen.waitForFunction(() => {
      const el = document.querySelector('#rotation-check .news-leaving');
      return el && Number(getComputedStyle(el).opacity) < .95;
    }, null, {timeout:4000});
    await demo.getByText('长三角夜跑热搜',{exact:true}).waitFor({timeout:4500});
    await demo.evaluate(el=>el.simulateSync());
    assert.equal(await demo.locator('.news-title').innerText(),'长三角夜跑热搜');
    assert.equal(await demo.locator('.news-title').count(),1);
    assert.equal(await demo.locator('details,a,button').count(),0);
    assert.equal(await demo.locator('.news-sheet').evaluate(el=>el.scrollWidth===el.clientWidth && el.scrollHeight===el.clientHeight),true);
    await demo.getByText('北京发布新规划',{exact:true}).waitFor({timeout:4500});
    await demo.evaluate(el=>el.onlyRankings());
    assert.equal(await demo.locator('.news-kind').innerText(),'热搜');
    await demo.evaluate(el=>{el.updateFeed([]);HomeBriefing.disposeCards(el);el.remove();});
    const bubble = screen.locator('.pig-stage .pig-bubble');
    const idleBubble = screen.locator('.pig-stage .pig-greeting');
    await idleBubble.waitFor();
    const portrait = screen.locator('canvas.pig-portrait');
    await portrait.waitFor();
    const pixels = () => portrait.evaluate(c => c.toDataURL());
    const idlePixels = await pixels();
    assert.ok(idlePixels.length > 15000, '3D idle portrait contains shaded geometry');
    const distinctPoses = await screen.evaluate(() => {
      const host = document.createElement('div');
      const poses = ['', 'point', 'wave', 'scarf', 'serious'];
      return new Set(poses.map(pose => {
        HomeBriefing.pig(host, { appearance: '3d' }, '预览', pose);
        return host.querySelector('canvas').toDataURL();
      })).size;
    });
    assert.equal(distinctPoses, 5, 'all five actions have distinct 3D geometry');
    const uniqueLooks = await screen.evaluate(() => {
      const host = document.createElement('div');
      return new Set(HomePigLooks.looks.map(look => {
        HomeBriefing.pig(host, {appearance:'3d',look:look.id});
        return host.querySelector('canvas').toDataURL();
      })).size;
    });
    assert.equal(uniqueLooks,16);
    if (process.env.PIG3D_SCREENSHOT)
      await portrait.screenshot({ path: path.resolve(process.env.PIG3D_SCREENSHOT) });
    await portrait.click();
    assert.ok(await idleBubble.innerText());
    assert.equal(await screen.getByRole('button',{name:/看看资讯|查看资讯|下一条资讯/}).count(),0);
    const fallback = await browser.newPage();
    await fallback.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type === 'webgl' ? null : original.call(this, type, ...args);
      };
    });
    await fallback.goto(url + '/client/?deviceId=' + device.id + '&deviceKey=' + device.device_key);
    await fallback.locator('img.pig-portrait[src$="bunny.svg#idle"]').waitFor();
    assert.ok(await fallback.locator('img.pig-portrait').evaluate(img => img.decode().then(()=>img.naturalWidth > 0)));
    await fallback.locator('.pig-stage .pig-greeting').waitFor();
    await fallback.close();
    const item = await api('POST', '/info-items', {
      type: 'urgent',
      text: '今天要降温，出门带件外套吧。',
      companion_targets: [device.id]
    });
    await screen.getByText(item.text, { exact: true }).waitFor({ timeout: 5000 });
    if (process.env.BRIEFING_SCREENSHOT)
      await screen.screenshot({ path: path.resolve(process.env.BRIEFING_SCREENSHOT) });
    const alarm = await api('POST', '/reminders/emergency', {
      device_ids: [device.id],
      content: { text: '测试紧急插播' },
      sound: { file: null, loop: false }
    });
    await screen.locator('#emergency-overlay.active').waitFor();
    await bubble.filter({hasText:item.text}).waitFor({state:'detached'});
    await api('DELETE', '/reminders/emergency/' + alarm.id);
    await screen.reload();
    await screen.getByText(title, { exact: true }).first().waitFor();
    assert.equal((await api('GET', '/news/events/' + item.id)).deliveries[0].result, 'interrupted');
    for (let i = 0; i < 100; i++)
      await screen.evaluate(() => {
        applyConfig(currentConfig);
        showScene(0);
      });
    assert.equal(await screen.locator('.pig-portrait').count(), 1);
    const components=await api('GET','/scenes/'+scene.id+'/components');
    const news=components.find(c=>c.type==='headlines'), pig=components.find(c=>c.type==='companion');
    await api('DELETE','/scenes/'+scene.id+'/components/'+news.id);
    await screen.locator('.news-sheet').waitFor({state:'detached'});
    await idleBubble.waitFor();
    if (!live) {
      providers.jsonCompletion = async () => ({tokens:20,data:{impacts:[
        {id,basis:'青禾路',evidence:title,advice:'出门前看看绕行路线。',repeat:false}
      ]}});
      await require('../../src/services/briefing/household').analyze();
      await bubble.filter({hasText:'出门前看看绕行路线。'}).waitFor();
      await idleBubble.waitFor();
    }
    await api('DELETE','/scenes/'+scene.id+'/components/'+pig.id);
    await api('POST','/scenes/'+scene.id+'/components',{type:'headlines',position:news.position,config:news.config});
    await screen.locator('.news-sheet').getByText(title,{exact:true}).first().waitFor();
    assert.equal(await screen.locator('.pig-portrait').count(),0);
    const updated = await api('GET', '/news/events/' + id);
    await api('POST', '/news/events/' + id + '/actions', {
      action: 'withdraw',
      version: updated.version
    });
    await screen.getByText('暂无符合条件的资讯').first().waitFor();
    assert.deepEqual(errors, []);
    console.log(
      'PASS: ' +
        (live ? source.name + ' + GLM' : 'fixture') +
        ' → automatic publication → editor → targeted screen, pig subtitle, emergency interruption, reload, 100 rebuilds and withdrawal'
    );
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    server.close();
  }
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e.message);
    process.exit(1);
  }
);
