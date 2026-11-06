const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../client/js/briefing-runtime.js'), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));
function setup({ sound = false, unlocked = true, blocked = false, delayClaim = false } = {}) {
  const now = Date.now(),
    el = { querySelector: jest.fn() },
    job = {
      id: 'family',
      edition: 1,
      payload: { speech: '今晚八点停水', action: 'wave', speakUntil: now + 3600000 },
      expires: now + 3600000
    };
  const data = {
    cards: [],
    preferences: { enabled: true, sound, volume: 0.4 },
    tasks: [job],
    active: [{ id: job.id, edition: 1, speech: job.payload.speech }]
  };
  const results = [],
    timers = new Map();
  let voice,
    resolveClaim,
    claims = 0;
  const renderer = { pig: jest.fn(), cards: jest.fn() };
  const speak = jest.fn((v) => {
      voice = v;
    }),
    cancel = jest.fn();
  const ctx = {
    window: { speechSynthesis: { speak, cancel }, SpeechSynthesisUtterance: true },
    SpeechSynthesisUtterance: class {
      constructor(text) {
        this.text = text;
      }
    },
    Date,
    getServerNow: () => new Date('2026-10-01T00:04:59Z'),
    HomePigGreetings: {greeting: () => '国庆节快乐！'},
    Promise,
    CONFIG: { SERVER_URL: 'http://localhost' },
    deviceId: 'test',
    deviceKey: 'fixture',
    document: { hidden: false },
    activeEmergency: blocked,
    audioUnlocked: unlocked,
    reminderPool: {},
    state: 'NORMAL',
    sceneLayers: [{ contains: (n) => n === el, classList: { contains: () => true } }],
    currentSceneIndex: 0,
    HomeBriefing: renderer,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn, ms) => {
      const id = Symbol();
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (key) => timers.delete(key),
    fetch: async (url, opts) => {
      let response;
      if (url.endsWith('/briefing')) response = JSON.parse(JSON.stringify(data));
      else if (url.endsWith('/claim')) {
        claims++;
        if (delayClaim) await new Promise((r) => (resolveClaim = r));
        response = data.tasks.find(t => url.includes('/'+t.id+'/claim')) || job;
      } else {
        results.push(JSON.parse(opts.body).result);
        response = { ok: true };
      }
      return { ok: true, json: async () => ({ data: response }) };
    }
  };
  vm.runInNewContext(source, ctx);
  const runtime = ctx.briefingRuntime;
  runtime.mount(el, { resident: true }, 'companion');
  return {
    runtime,
    ctx,
    renderer,
    results,
    timers,
    speak,
    cancel,
    data,
    claims: () => claims,
    voice: () => voice,
    confirmClaim: () => resolveClaim()
  };
}
test('声音关闭：完整字幕出现并回执，不调用 TTS', async () => {
  const f = setup();
  f.runtime.sync();
  await flush();
  expect(f.renderer.pig.mock.calls.at(-1)[2]).toBe('今晚八点停水');
  expect(f.speak).not.toHaveBeenCalled();
  [...f.timers.values()].find((t) => t.ms === 10000).fn();
  await flush();
  expect(f.results).toEqual(['subtitle']);
});
test('设备解锁后按设定音量中文朗读，朗读结束只回执一次', async () => {
  const f = setup({ sound: true });
  f.runtime.sync();
  await flush();
  expect(f.voice()).toMatchObject({ lang: 'zh-CN', volume: 0.4, text: '今晚八点停水' });
  f.voice().onend();
  f.voice().onend();
  await flush();
  expect(f.results).toEqual(['spoken']);
});
test('假期切换问候的时钟不覆盖正在播报的字幕；紧急任务抢先，播完回到待机', async () => {
  const f = setup({sound:true});
  const clock = [...f.timers.values()].find(t => t.ms === 1000);
  const host = f.renderer.pig.mock.calls[0][0];
  const bubble = {textContent:'上一句问候'};
  host.querySelector.mockReturnValueOnce(bubble);
  clock.fn();
  expect(bubble.textContent).toContain('国庆');
  f.runtime.sync();
  await flush();
  host.querySelector.mockReturnValue(null);
  clock.fn();
  expect(f.voice().text).toBe('今晚八点停水');
  const urgent = {...f.data.tasks[0],id:'urgent',payload:{...f.data.tasks[0].payload,urgent:true,speech:'请及时取药'}};
  const important = {...urgent,id:'important',payload:{...urgent.payload,urgent:false,important:true,speech:'重要提醒'}};
  f.data.tasks.push(important,urgent);
  f.data.active.push(...[important,urgent].map(t=>({id:t.id,edition:1,speech:t.payload.speech})));
  f.runtime.sync();
  await flush();
  expect(f.voice().text).toBe('请及时取药');
  expect(f.results).toEqual(['interrupted']);
  f.voice().onend();
  await flush();
  expect(f.results).toEqual(['interrupted','spoken']);
  expect(f.renderer.pig.mock.calls.at(-1)[2]).toBeUndefined();
});
test('声音未解锁时仅字幕', async () => {
  const f = setup({ sound: true, unlocked: false });
  f.runtime.sync();
  await flush();
  expect(f.speak).not.toHaveBeenCalled();
  expect(f.renderer.pig.mock.calls.at(-1)[2]).toBe('今晚八点停水');
});
test('紧急插播期间及非当前场景不会领取', async () => {
  const f = setup({ blocked: true });
  f.runtime.sync();
  await flush();
  expect(f.claims()).toBe(0);
  f.ctx.activeEmergency = false;
  f.ctx.currentSceneIndex = 1;
  f.runtime.scene();
  expect(f.claims()).toBe(0);
});
test('领取中场景被卸载，迟到响应不得发声', async () => {
  const f = setup({ sound: true, delayClaim: true });
  f.runtime.sync();
  await flush();
  f.runtime.reset();
  f.confirmClaim();
  await flush();
  expect(f.speak).not.toHaveBeenCalled();
  expect(f.results).toEqual(['interrupted']);
});
test('撤回中止当前语音并恢复待机气泡', async () => {
  const f = setup({ sound: true });
  f.runtime.sync();
  await flush();
  f.data.tasks = [];
  f.data.active = [];
  f.runtime.sync();
  await flush();
  expect(f.cancel).toHaveBeenCalledTimes(1);
  expect(f.results).toEqual(['interrupted']);
  expect(f.renderer.pig.mock.calls.at(-1)[2]).toBeUndefined();
});
test('浏览器拒绝朗读后字幕保留到时限', async () => {
  const f = setup({ sound: true });
  f.runtime.sync();
  await flush();
  f.voice().onerror();
  expect(f.results).toEqual([]);
  [...f.timers.values()].find((t) => t.ms === 10000).fn();
  await flush();
  expect(f.results).toEqual(['subtitle']);
});
test('隐藏页面及有定时提醒时不争用音频', async () => {
  const f = setup();
  f.ctx.document.hidden = true;
  f.runtime.sync();
  await flush();
  expect(f.claims()).toBe(0);
  f.ctx.document.hidden = false;
  f.ctx.reminderPool = { r: {} };
  f.runtime.scene();
  expect(f.claims()).toBe(0);
});
