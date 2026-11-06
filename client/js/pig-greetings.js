/* Local greetings for the display. Public holiday ranges come from the State Council's
   2026 and 2027 notices (国办发明电〔2025〕7号 and 国办发明电〔2026〕10号). */
(function (root) {
  const holidayRanges = {
    2026: [
      [101,103,'元旦'], [215,223,'春节'], [404,406,'清明'], [501,505,'劳动节'],
      [619,621,'端午'], [925,927,'中秋'], [1001,1007,'国庆']
    ],
    2027: [
      [101,103,'元旦'], [205,213,'春节'], [403,405,'清明'], [501,505,'劳动节'],
      [609,609,'端午'], [915,915,'中秋'], [1001,1007,'国庆']
    ]
  };
  const periods = [
    [5, ['夜深啦，猪猪轻声陪着你。','夜里好，愿你睡个好觉。','晚安，猪猪也放轻了脚步。']],
    [11, ['早上好，猪猪来报到啦！','早呀，伸个懒腰，一起醒醒神。','早安，今天也请多关照！']],
    [14, ['中午好，今天想吃点什么？','午安，猪猪陪你歇一会儿。','到中午啦，慢慢享用午餐吧。']],
    [18, ['下午好，要不要一起伸个懒腰？','忙了半天，给眼睛放个小假吧。','下午好，猪猪在这儿陪你。']],
    [22, ['傍晚好，今天有什么开心事？','晚上好，猪猪来陪你聊会儿天。','忙了一天，歇歇脚吧。']],
    [24, ['夜深啦，猪猪轻声陪着你。','晚安，愿你做个好梦。','辛苦啦，让今天慢慢收尾吧。']]
  ];
  const solar = {101:'元旦快乐！',501:'劳动节快乐！',601:'儿童节快乐！',910:'教师节快乐！',1001:'国庆节快乐！'};
  const lunar = {'1/1':'春节快乐，给大家拜年啦！','1/15':'元宵节快乐！','5/5':'端午安康！',
    '7/7':'七夕快乐！','8/15':'中秋快乐！','9/9':'重阳安康！'};
  const clocks = new Map();
  let lunarClock;
  function lunarGreeting(year, month, day) {
    try {
      lunarClock ||= new Intl.DateTimeFormat('en-US-u-ca-chinese', {timeZone:'UTC', month:'numeric', day:'numeric'});
      if (lunarClock.resolvedOptions().calendar !== 'chinese') return '';
      const date = Date.UTC(year,month-1,day,12);
      // Keep the leap-month suffix so a festival is celebrated only once.
      const lunarDay = (time) => {
        const parts = lunarClock.formatToParts(time);
        return ['month','day'].map(key => parts.find(p => p.type === key).value).join('/');
      };
      return lunar[lunarDay(date)] || (lunarDay(date + 86400000) === '1/1' ? '除夕快乐，愿你和家人团团圆圆！' : '');
    } catch { return ''; }
  }
  function greeting(config, now = root.getServerNow ? root.getServerNow() : new Date()) {
    const zone = config.reminders?.zone || 'Asia/Shanghai';
    if (!clocks.has(zone)) clocks.set(zone, new Intl.DateTimeFormat('en-GB', {
      timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'
    }));
    const local = Object.fromEntries(clocks.get(zone).formatToParts(now).map(p => [p.type,Number(p.value)]));
    const date = local.month * 100 + local.day;
    const lines = periods.find(([end]) => local.hour < end)[1];
    const line = lines[(Math.floor((local.hour * 60 + local.minute) / 5) + local.day) % lines.length];
    const festival = lunarGreeting(local.year,local.month,local.day) || solar[date];
    if (festival) return festival + line;
    const holiday = holidayRanges[local.year]?.find(([from,to]) => date >= from && date <= to);
    if (!holiday) return line;
    const wish = holiday[2] === '清明' ? '清明假期，愿家人平安。' : holiday[2] + '假期愉快！';
    return wish + line;
  }
  root.HomePigGreetings = {greeting};
})(window);
