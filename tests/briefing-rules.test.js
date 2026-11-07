const r = require('../src/services/briefing/rules');
const p = require('../src/services/briefing/providers');
const article = { title: '上海地铁2号线今天恢复运营', excerpt: '今天10点恢复运营', time: Date.now() };
const source = r.source({
  type: 'rss',
  name: '通勤',
  url: 'https://example.com/rss',
  trusted: true,
  keywords: '2号线，机场',
  region: '上海',
  targets: ['hall']
});
const opts = { ...r.defaults, preview: false };
describe('来源与发布规则', () => {
  test.each([
    ['可信来源、近期及定向主题', {}, {}, {}, false, true],
    ['旧预览设置也自动发布', {}, { preview: true }, {}, false, true],
    ['缺时间', {}, {}, { time: null }, false, false],
    ['旧闻', {}, {}, { time: Date.now() - 25 * 3600000 }, true, false],
    ['未来稿件', {}, {}, { time: Date.now() + 3600000 }, true, false],
    ['来源屏蔽词', { blocked: '恢复' }, {}, {}, true, true],
    ['全局屏蔽词', {}, { blocked: '地铁' }, {}, true, true],
    ['不同地区', { region: '深圳' }, {}, {}, true, false],
    ['无关注词', { keywords: '' }, {}, {}, false, false],
    ['未指定设备', { targets: [] }, {}, {}, false, true],
    ['榜单只上卡片', { type: 'ranking' }, {}, {}, false, false],
    ['非权威订阅', { trusted: false }, {}, {}, false, true]
  ])('%s', (_, s, o, a, skip, speak) =>
    expect(
      r.evaluate({ ...source, ...s }, { ...opts, ...o }, { ...article, ...a }, Date.now())
    ).toMatchObject({ skip, speak })
  );
  test.each([
    ['22:00', true],
    ['23:59', true],
    ['00:00', true],
    ['06:59', true],
    ['07:00', false],
    ['12:00', false]
  ])('跨午夜免打扰 %s', (t, on) => expect(r.between(t, '22:00', '07:00')).toBe(on));
  test('无免打扰窗口', () => expect(r.between('00:00', '00:00', '00:00')).toBe(false));
  test('跨国设备当地日期与周末', () => {
    let t = Date.parse('2026-11-06T22:00Z');
    expect(r.localTime(t, 'Asia/Shanghai')).toMatchObject({ day: '2026-11-07', weekday: false });
    expect(r.localTime(t, 'America/New_York')).toMatchObject({ day: '2026-11-06', weekday: true });
  });
  test.each([
    { zone: 'Wrong/Zone' },
    { quietFrom: '24:00' },
    { gap: -1 },
    { threshold: 0 },
    { volume: 2 },
    { cold: true, city: '   ' }
  ])('拒绝无效设备参数 %j', (bad) => expect(() => r.device(bad)).toThrow());
  test('旧配置只保留城市，坐标不再是配置字段', () => {
    const d=r.component({cold:true,city:' 北京市 ',latitude:null,longitude:116});
    expect(d.city).toBe('北京市');
    expect(d).not.toHaveProperty('latitude');
    expect(d).not.toHaveProperty('longitude');
  });
  test.each([
    { provider: '__proto__' },
    { model: 'a?token=b' },
    { dailyCalls: -2 },
    { dailyTokens: 0.5 }
  ])('拒绝无效模型设置 %j', (bad) => expect(() => r.config(bad)).toThrow());
  test('榜单不能自报权威', () => expect(r.source({ ...source, type: 'ranking' }).trusted).toBe(false));
});
describe('网络与订阅边界', () => {
  test.each([
    '127.0.0.1',
    '192.168.1.1',
    '10.0.0.1',
    '169.254.169.254',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::42',
    '224.0.0.1',
    'not-an-ip'
  ])('阻止非公网地址 %s', (ip) => expect(p.publicIP(ip)).toBe(false));
  test('允许公网地址并移除跟踪参数', () => {
    expect(p.publicIP('1.1.1.1')).toBe(true);
    expect(p.webUrl('https://example.com/a?id=2&utm_source=x#p')).toBe('https://example.com/a?id=2');
  });
  test.each(['file:///a', 'javascript:alert(1)', 'https://u:p@example.com', 'invalid'])(
    '拒绝危险链接 %s',
    (u) => expect(p.webUrl(u)).toBe('')
  );
  test('RSS 清理 HTML、相对链接及缺时间', () => {
    const xml =
      '<rss><channel><item><guid>42</guid><title>公告</title><link>/a</link><description><![CDATA[<b>今天</b> 停水]]></description></item></channel></rss>';
    expect(p.parseFeed(xml, 'https://example.com/f')).toEqual([
      { ref: '42', title: '公告', url: 'https://example.com/a', excerpt: '今天 停水', time: null }
    ]);
  });
  test('Atom 选择 alternate，忽略危险 URL', () => {
    const xml =
      '<feed><entry><id>a</id><title>事件</title><link rel="self" href="/feed/a"/><link rel="alternate" href="/a"/></entry><entry><title>坏</title><link href="javascript:bad"/></entry></feed>';
    expect(p.parseFeed(xml, 'https://example.com')).toHaveLength(1);
    expect(p.parseFeed(xml, 'https://example.com')[0].url).toBe('https://example.com/a');
  });
  test.each(['<!DOCTYPE x><rss/>', '<!ENTITY e "x"><rss/>', '<rss><bad></rss>', '<html/>'])(
    '拒绝非法 XML %s',
    (xml) => expect(() => p.parseFeed(xml, 'https://example.com')).toThrow()
  );
});
describe('模型与第三方失败', () => {
  beforeAll(() => require('../src/config/database').initDatabase());
  const orig = global.fetch,
    key = process.env.GLM_API_KEY;
  beforeEach(() => {
    process.env.GLM_API_KEY = 'unit-test';
  });
  afterEach(() => {
    global.fetch = orig;
    if (key === undefined) delete process.env.GLM_API_KEY;
    else process.env.GLM_API_KEY = key;
  });
  test('模型网络断连转换为可重试的502，错误不暴露密钥或内部地址',async()=>{
    global.fetch=jest.fn().mockRejectedValue(Object.assign(new Error('fetch failed'),{cause:{code:'ECONNRESET'}}));
    await expect(p.jsonCompletion(opts,[{role:'user',content:'测试'}],1000)).rejects.toMatchObject({
      status:502,code:'MODEL_UNAVAILABLE',message:'模型与来源的连接失败，请稍后重试'
    });
  });
  test.each(['not json', JSON.stringify({ summary: '编造的时间' }), '{}'])(
    '拒绝无依据或无效回答 %s',
    (content) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
      return expect(p.model(opts, article)).rejects.toThrow();
    }
  );
  test('不支持的台词回退至已验证摘要', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: JSON.stringify({ summary: '今天10点恢复运营', speech: '改为12点' }) } }
          ]
        })
      });
    expect((await p.model(opts, article)).speech).toBe('今天10点恢复运营');
    const previous = process.env.DEEPSEEK_API_KEY;
    try {
      process.env.DEEPSEEK_API_KEY = 'test-only';
      const result = await p.model({provider:'deepseek', model:'deepseek-chat'}, article);
      expect(result.speech).toBe('今天10点恢复运营');
      const [url, request] = global.fetch.mock.calls[1];
      expect(url).toBe('https://api.deepseek.com/chat/completions');
      expect(JSON.parse(request.body)).not.toHaveProperty('thinking');
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previous;
    }
  });
  test('上游鉴权错误脱敏，不回传原始错误文本', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Map(),
        json: async () => ({ error: { code: 123, message: 'private test value' } })
      });
    await expect(p.model(opts, article)).rejects.toThrow('供应商 HTTP 401（123）');
  });
  test('Brave 请求包含关键词、新鲜度和独立鉴权', async () => {
    const k = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = 'test';
    try {
      global.fetch = jest
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            results: [{ title: '新闻', url: 'https://example.com/a', description: '正文' }]
          })
        });
      const out = await p.collect({ type: 'brave', query: '地铁' });
      expect(out.articles[0].title).toBe('新闻');
      expect(global.fetch.mock.calls[0][0].searchParams.get('freshness')).toBe('pd');
    } finally {
      if (k === undefined) delete process.env.BRAVE_API_KEY;
      else process.env.BRAVE_API_KEY = k;
    }
  });
});
