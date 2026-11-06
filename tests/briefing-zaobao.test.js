const { parseZaobao, collect, zaobaoUrl } = require('../src/services/briefing/providers');
const { source } = require('../src/services/briefing/rules');
const row = (path, title, date) =>
  '<url><loc>' +
  path +
  '</loc><news:news><news:title>' +
  title +
  '</news:title><news:publication_date>' +
  date +
  '</news:publication_date></news:news></url>';
const base = 'https://www.zaobao.com.sg';
test('区域跳转使用官网即时新闻，按带日期的文章路径和东八区发布时间采集', async () => {
  const redirect = new Response(null,{status:302,headers:{location:'https://www.zaobao.com/googlenews.xml'}});
  const page = '<a title="测试新闻" href="/news/china/story20261106-42"><span>18:12</span></a>';
  const upstream = jest.spyOn(global,'fetch').mockResolvedValueOnce(redirect)
    .mockResolvedValueOnce(new Response(page+page+'<a href="//evil.test/story20261106-43" title="站外"><span>19:00</span></a>'));
  try {
    const result = await collect({type:'zaobao',section:'china'});
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]).toMatchObject({title:'测试新闻',url:'https://www.zaobao.com/news/china/story20261106-42',time:Date.parse('2026-11-06T10:12Z')});
    expect(upstream.mock.calls[1][0]).toBe('https://www.zaobao.com/realtime');
    upstream.mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'https://example.com/'}}));
    await expect(collect({type:'zaobao'})).rejects.toThrow('未知地址');
    expect(upstream).toHaveBeenCalledTimes(3);
  } finally {upstream.mockRestore();}
});
test('取原文公开简介时按属性识别，并限制为早报官网', async () => {
  const { zaobaoDescription } = require('../src/services/briefing/providers');
  const fetcher = jest.spyOn(global,'fetch').mockResolvedValueOnce(new Response(
    '<head><meta content="产业园 &amp; 学校联动。" property="og:description"></head>'));
  try {
    expect(await zaobaoDescription(base+'/news/china/story1')).toBe('产业园 & 学校联动。');
    expect(await zaobaoDescription('https://example.com/story')).toBe('');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockRejectedValueOnce(new Error('timeout'));
    expect(await zaobaoDescription(base+'/news/china/story2')).toBe('');
  } finally { fetcher.mockRestore(); }
});
const time = '2026-11-05T20:10:00+08:00';
const xml =
  '<urlset xmlns:news="urn:news">' +
  [
    row(base + '/news/china/story1?ai-allowed=1', '中国新闻', time),
    row(base + '/news/china/story1', '转载', time),
    row(base + '/realtime/world/story2', '国际新闻', '2026-11-05T21:00:00+08:00'),
    row(base + '/finance/singapore/story3', '财经新闻', time),
    row('https://www.zaobao.com.sg.untrusted.test/story', '非官网', time),
    row(base + '/news/china/story4', '无日期', 'unknown')
  ].join('') +
  '</urlset>';
test('官方索引保留标题、原文及东八区发布时间，忽略站外链接和重复路径', () => {
  const articles = parseZaobao(xml);
  expect(articles.map((x) => x.title)).toEqual(['国际新闻', '中国新闻', '财经新闻']);
  expect(articles[1]).toMatchObject({
    publisher: '联合早报',
    excerpt: '',
    time: Date.parse('2026-11-05T12:10Z'),
    url: base + '/news/china/story1?ai-allowed=1'
  });
});
test.each([
  ['china', '中国新闻'],
  ['world', '国际新闻'],
  ['finance', '财经新闻'],
  ['singapore', '财经新闻']
])('栏目 %s', (key, title) => expect(parseZaobao(xml, key).map((x) => x.title)).toEqual([title]));
test('来源预设固定上游，拒绝未知栏目', () => {
  expect(source({ name: '早报', type: 'zaobao', url: 'http://127.0.0.1' }).url).toBe(zaobaoUrl);
  expect(() => source({ name: '早报', type: 'zaobao', section: 'bad' })).toThrow();
});
test.each(['<html/>', '<!DOCTYPE x><urlset/>', '<bad'])('格式变化可诊断 %s', (s) =>
  expect(() => parseZaobao(s)).toThrow()
);
test('HTTP 304 保留缓存标识，只访问官网索引', async () => {
  const original = global.fetch;
  try {
    global.fetch = jest.fn().mockResolvedValue({ status: 304 });
    await expect(collect({ type: 'zaobao', url: 'http://localhost' }, { etag: 'abc' })).resolves.toEqual(
      { unchanged: true, articles: [] }
    );
    expect(global.fetch.mock.calls[0][0]).toBe(zaobaoUrl);
    expect(global.fetch.mock.calls[0][1].headers['If-None-Match']).toBe('abc');
  } finally {
    global.fetch = original;
  }
});
