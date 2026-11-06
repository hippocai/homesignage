const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scripts = ['pig-3d.js', 'pig-greetings.js', 'briefing.js'].map(file =>
  fs.readFileSync(path.join(__dirname, '../client/js', file), 'utf8')
);

function setup(getContext) {
  function element(tag) {
    return {
      tag, children: [], setAttribute: jest.fn(), getContext,
      appendChild(child) { this.children.push(child); child.parentNode = this; },
      replaceChild(child, previous) {
        this.children[this.children.indexOf(previous)] = child;
        previous.parentNode = null;
        child.parentNode = this;
      }
    };
  }
  const window = {}, context = vm.createContext({window, document: {createElement: element}});
  scripts.forEach(source => vm.runInContext(source, context));
  const host = element('div');
  function show(config, line, action) {
    window.HomeBriefing.pig(host, config, line, action);
    return host.children[0];
  }
  return {window, show};
}

test.each([undefined, '2d', 'unknown'])('旧配置和插画外观不申请 GPU（%s）', appearance => {
  const getContext = jest.fn();
  const stage = setup(getContext).show({appearance, resident: true});
  expect(stage.children[0].src).toMatch(/peach-pig.svg#idle$/);
  expect(getContext).not.toHaveBeenCalled();
});

test.each([true,false,undefined])('待机时直接显示气泡，兼容旧常驻设置 %s', resident => {
  const stage = setup().show({appearance:'2d', resident});
  expect(stage.tag).toBe('div');
  expect(stage.onclick).toBeUndefined();
  expect(stage.children[1].className).toContain('pig-greeting');
  expect(stage.children[1].textContent.length).toBeGreaterThan(4);
});

test('同一时段每五分钟换一句，时区决定本地日期和节日', () => {
  const {greeting} = setup().window.HomePigGreetings;
  const text = (iso, zone='Asia/Shanghai') => greeting({reminders:{zone}}, new Date(iso));
  const first = text('2026-11-06T00:00Z');
  expect(text('2026-11-06T00:04Z')).toBe(first);
  expect(text('2026-11-06T00:05Z')).not.toBe(first);
  expect(text('2026-09-30T16:00Z')).toContain('国庆节快乐');
  expect(text('2026-09-30T16:00Z','America/New_York')).not.toContain('国庆');
  expect(text('2027-10-03T00:00Z')).toContain('国庆假期');
  expect(text('2027-10-09T00:00Z')).not.toContain('假期');
  expect(text('2028-10-03T00:00Z')).not.toContain('国庆假期');
});
test.each([
  ['2026-02-16','除夕快乐'], ['2026-02-17','春节快乐'], ['2026-03-03','元宵节快乐'],
  ['2026-06-19','端午安康'], ['2026-09-25','中秋快乐'], ['2027-09-15','中秋快乐']
])('%s 使用对应的农历祝福', (day, words) => {
  expect(setup().window.HomePigGreetings.greeting({},new Date(day+'T04:00Z'))).toContain(words);
});

test.each([() => null, () => { throw new Error('WebGL disabled'); }])(
  '设备拒绝创建 WebGL 上下文时保留围巾和提醒字幕', getContext => {
    const stage = setup(getContext).show({appearance:'3d'}, '降温提醒', 'scarf');
    expect(stage.children[0].src).toMatch(/peach-pig.svg#scarf$/);
    expect(stage.children[1].textContent).toBe('降温提醒');
  }
);

test('渲染中途失败时用同一动作的插画替换画布', () => {
  const {window, show} = setup();
  let fail;
  window.HomePig3D.mount = (_canvas, onFailure) => {
    fail = onFailure;
    return {setPose() {}};
  };
  const stage = show({appearance:'3d'}, '准备出门啦。','wave');
  expect(stage.children[0].tag).toBe('canvas');
  fail();
  expect(stage.children[0].tag).toBe('img');
  expect(stage.children[0].src).toMatch(/peach-pig.svg#wave$/);
  expect(stage.children[1].textContent).toBe('准备出门啦。');
});
