/* OpenAPI definitions for the news desk, display feed, and playback receipts. */
module.exports = function extend(spec) {
  const schemas = spec.components.schemas;
  const str = { type: 'string' },
    bool = { type: 'boolean' },
    num = { type: 'integer' },
    ids = { type: 'array', items: str };
  const obj = (properties, required = []) => ({
    type: 'object',
    properties,
    ...(required.length ? { required } : {})
  });
  const ref = (name) => ({ $ref: '#/components/schemas/' + name });
  const list = (items) => ({ type: 'array', items });
  const choice = (...values) => ({ type: 'string', enum: values });
  const settings = obj({
    provider: choice('glm', 'deepseek'),
    model: { ...str, example: 'glm-4.6' },
    preview: {...bool, deprecated:true, description:'兼容旧配置，始终为 false'},
    interests: {...list(str), description:'按语义判断相关性，任一话题相关即可。模型不可用或额度不足时回退关键词规则。'},
    dislikes: {...list(str), description:'任意一项命中即排除，优先于关注列表'},
    blocked: str,
    familyAI: bool,
    dailyCalls: {...num, minimum:-1, maximum:10000, description:'UTC 每日模型调用次数，-1 不限额，0 为零额度'},
    dailyTokens: {...num, minimum:-1, maximum:10000000, description:'UTC 每日模型令牌数，-1 不限额，0 为零额度'},
    braveCalls: num
  });
  const source = obj(
    {
      type: choice('rss', 'brave', 'ranking', 'zaobao'),
      section: choice('all', 'china', 'world', 'singapore', 'finance'),
      name: str,
      url: { ...str, format: 'uri' },
      query: str,
      language: str,
      country: str,
      interval: { ...num, minimum: 2, maximum: 1440 },
      keywords: str,
      blocked: str,
      region: str,
      trusted: bool,
      enabled: bool,
      targets: ids
    },
    ['name', 'type']
  );
  const article = obj({
    title: str,
    ref: str,
    url: str,
    excerpt: str,
    time: { ...num, nullable: true },
    rank: num,
    sourceId: str
  });
  const rules = obj({
    enabled: bool,
    sound: bool,
    volume: { type: 'number', minimum: 0, maximum: 1 },
    gap: num,
    repeatMinutes: {...num, minimum:1,maximum:1440,default:60},
    maxPlays: {...num,minimum:1,maximum:12,default:3,description:'每事项每设备的播放上限，含首次'},
    zone: str,
    quietFrom: str,
    quietTo: str,
    family: bool,
    cold: bool,
    news: bool,
    city: {...str, maxLength:80, example:'深圳市', description:'降温提醒启用时必填，仅需市名，同名时可用“省份/城市”。'},
    weekdays: bool,
    from: str,
    to: str,
    threshold: num
  });
  const event = obj({
    id: str,
    kind: choice('news', 'ranking', 'family', 'weather'),
    state: choice('review', 'published', 'withdrawn'),
    version: num,
    edition: num,
    occurrence: {...num,description:'可领取任务的播放序号，从 1 开始'},
    targets: ids,
    starts: num,
    topicComponents: {...ids, description:'设备资讯中，设置了关注词且匹配本条资讯的组件 ID'},
    expires: num,
    updated: num,
    payload: obj({
      title: str,
      summary: str,
      source: str,
      speech: str,
      action: str,
      speak: bool,
      speakUntil: num,
      reason: str,
      important: bool,
      url: str,
      time: num,
      rank: num,
      topic: str
    })
  });
  const action = obj(
    {
      action: choice('publish', 'edit', 'withdraw', 'merge', 'split'),
      version: num,
      title: str,
      summary: str,
      speech: str,
      speak: bool,
      targets: ids,
      replay: bool,
      destination: str,
      destinationVersion: num,
      source: str,
      ref: str
    },
    ['action', 'version']
  );
  Object.assign(schemas, {
    BriefingSource: source,
    BriefingEvent: event,
    BriefingArticle: article,
    CompanionRules: rules,
    BriefingSettings: settings,
    BriefingAction: action
  });
  schemas.CreateInfoItemRequest.properties.companion_targets = {
    ...ids,
    description: '定向播报设备，空数组取消'
  };
  schemas.CreateInfoItemRequest.properties.replay = {
    ...bool,
    description: '更新家庭事项时创建新的播报版本'
  };
  for (const k of ['Component', 'CreateComponentRequest']) {
    schemas[k].properties.type.enum.push('headlines', 'companion');
    schemas[k].properties.config.description += '。headlines 自动轮播全部匹配资讯。keywords 为关注词数组（命中任一项），categories 可选 news、ranking 或两者，seconds 为每条停留秒数（2–600，默认 10），fontSize 为显示字号。';
    schemas[k].properties.config.description += '。companion 的玩偶和气泡常驻，自动显示提醒。支持 appearance（2d 插画或 3d 玩偶）和 look（样貌 ID，默认 peach）。省略 appearance 时显示插画，3D 渲染不可用时自动显示插画。';
    schemas[k].properties.config.description += '。companion 的 config.reminders 为 CompanionRules，在场景组件新增或修改接口保存。相同组件在所有绑定屏幕共享这些规则；播放次数按屏幕和组件分别统计。';
    schemas[k].properties.config.description += ' config.fontSize 用于猪猪问候和提醒气泡，取 16–72 的整数（px），省略时显示为 28 px。';
  }
  spec.tags.push({
    name: '资讯与伙伴',
    description: '热点采集、模型测试、定向发布及播放状态。时间戳为 Unix 毫秒。'
  });
  function path(method, url, summary, out, input, description = '') {
    const device = url.startsWith('/devices/');
    const parameters = Array.from(url.matchAll(/\{(\w+)\}/g), (m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: str
    }));
    const response = (schema) => ({ 'application/json': { schema } });
    const errors = {};
    for (const [code, message] of [
      [400, '输入无效'],
      [401, '管理员未登录'],
      [403, '设备密钥不匹配'],
      [404, '找不到记录'],
      [409, '版本冲突、已领取或不可投递'],
      [422, '模型回答未经证据支持'],
      [429, '预算耗尽'],
      [502, '上游调用失败'],
      [503, '缺少供应商凭据']
    ])
      errors[code] = { description: message, content: response(ref('Error')) };
    (spec.paths[url] ||= {})[method] = {
      tags: ['资讯与伙伴'],
      summary,
      description,
      security: [device ? { deviceKeyAuth: [] } : { bearerAuth: [] }],
      parameters,
      ...(input ? { requestBody: { required: true, content: response(input) } } : {}),
      responses: { 200: { description: '操作成功', content: response(obj({ data: out })) }, ...errors }
    };
  }
  path(
    'get',
    '/news/settings',
    '模型、密钥就绪状态及今日用量',
    obj({
      ...settings.properties,
      ready: obj({ glm: bool, deepseek: bool }),
      braveReady: bool,
      usage: list(obj({ provider: str, calls: num, tokens: num, day: str }))
    })
  );
  path('put', '/news/settings', '保存模型和发布设置', settings, settings);
  path('put', '/model/credentials/{provider}', '设置或更换服务商 API Key', obj({ready:bool}),
    obj({apiKey:{...str,writeOnly:true}},['apiKey']), '支持 glm、deepseek、brave。保存后立即生效，优先于环境变量。');
  path('get', '/news/presets', '常用订阅来源及当前订阅状态',
    list(obj({key:str, name:str, group:str, type:choice('rss','ranking','zaobao'), subscribedId:{...str,nullable:true}})));
  path('post', '/news/presets/{key}/subscribe', '订阅一个常用来源', obj({id:str, added:bool}), null,
    '已订阅时返回已有 id、added=false；保留原有名称、启停状态、设备及筛选配置。');
  path(
    'post',
    '/news/model/test',
    '使用已保存模型真实生成并校验一条提醒',
    obj({ summary: str, speech: str, topic: str, tokens: num })
  );
  path(
    'get',
    '/news/sources',
    '列表及最近采集状态',
    list(obj({ ...source.properties, id: str, last_ok: num, due: num, error: str }))
  );
  path(
    'post',
    '/news/sources',
    '添加来源',
    obj({ id: str }),
    source,
    'RSS/榜单填 url，Brave 填 query。榜单格式为 [{title,url,rank}]。'
  );
  path('patch', '/news/sources/{id}', '更新部分来源配置', obj({ id: str }), obj(source.properties));
  path('delete', '/news/sources/{id}', '移除订阅，保留已发布事件', num);
  path('post', '/news/sources/{id}/test', '试采集最多三条，不创建事件', list(article));
  path('post', '/news/sources/{id}/scan', '立即采集并处理', obj({ count: num, received:num, unchanged:bool,
    topicFallback:{...str,description:'本次有条目使用关键词回退时给出原因'},
    eventCount:{...num,description:'热搜命中条目合并后用于轮播的事件数'},groupFallback:{...str,description:'模型归并不可用时的原因；已知关联沿用，新条目单列'} }));
  path('get', '/news/events', '按更新时间列出最近一页事件', list(event));
  spec.paths['/news/events'].get.parameters.push(
    { name: 'scope', in: 'query', schema: choice('news'), description: '资讯管理页仅显示新闻和榜单' },
    { name: 'state', in: 'query', schema: choice('review', 'published', 'withdrawn') },
    { name: 'offset', in: 'query', schema: { ...num, minimum: 0 }, description: '每页最多 100 条' }
  );
  path(
    'get',
    '/news/events/{id}',
    '证据、历史版本及设备回执',
    obj({
      ...event.properties,
      evidence: list(article),
      history: list(obj({ version: num, state: str, at: num })),
      deliveries: list(obj({ device: str, edition: num, occurrence:num, result: str, claimed: num }))
    })
  );
  path(
    'post',
    '/news/events/{id}/actions',
    '编辑、撤回、合并或拆分已发布资讯',
    event,
    action,
    '使用当前 version。merge 指定 destination 及 destinationVersion，split 指定证据 source、ref；实质更正可显式 replay。'
  );
  path('get', '/companion/rules/{id}', '旧接口：只读兼容单个绑定组件', rules);
  spec.paths['/companion/rules/{id}'].get.deprecated=true;
  const profile=obj({memory:{...str,maxLength:12000,description:'家庭共享的自由文本，支持 Markdown 写法，空串清空'},zone:str,
    members:{...num,nullable:true,deprecated:true},home:{...str,deprecated:true},work:{...str,deprecated:true},route:{...str,deprecated:true},hours:{...str,deprecated:true}});
  const plan=obj({id:str,text:str,start:str,end:str});
  const turn=obj({id:str,message:str,reply:str,created:num});
  const household=obj({profile,plans:list(plan),revision:num});
  path('get','/companion/agent','家庭资料、已记计划及最近 40 次对话',obj({...household.properties,history:list(turn)}));
  const memoryEntry=obj({id:str,scope:str,text:str,starts:num,expires:{...num,nullable:true},revision:num,created:num});
  path('get','/companion/agent/memory','查看猪猪独立记忆及最近50条记忆审计',obj({entries:list(memoryEntry),text:{...str,description:'与Markdown镜像同格式的有效记忆文本；读取时先清理到期条目'},file:str,audit:list({type:'object',additionalProperties:true})}),null,
    '独立于家庭资料、系统定时提示和信息列表。通过聊天新增修改删除，当前访客只能管理自己写入的记忆；屏幕以家庭共享上下文读取。到期在读取/30秒后台扫描/启动时清理，审计保留。data/pig-agent-memory.md 是自动重建的可读镜像。');
  const promptConfig=obj({prompt:str,defaultPrompt:str,isDefault:bool,revision:num});
  path('get','/companion/agent/narration-prompt','读取当前气泡system prompt、默认文本及版本',promptConfig);
  path('put','/companion/agent/narration-prompt','保存气泡system prompt或恢复默认，立即生效',promptConfig,
    obj({prompt:{...str,minLength:1,maxLength:20000},reset:bool,revision:{...num,minimum:0}},['revision']),
    '保存传prompt；恢复默认传reset=true。必须提交读取到的revision，过期版本409。prompt中单独一行speechMaxChars: 40配置话语字符上限（1–180，省略为40，含标点/空格等Unicode码点），超限拒绝发布并最多重写一次。保存后通知屏幕，旧决策失效；此显式操作可立即使用新prompt生成，暂停时段除外。无需重启，不改家庭资料或独立记忆。');
  path('get','/companion/agent/narrations','查看最近30条模型气泡决策与展示回执',obj({items:list({type:'object',additionalProperties:true})}));
  const narration=obj({id:str,componentId:str,paused:bool,waiting:bool,retainUntilReplaced:{...bool,description:'普通问候（含normal级greeting/companion引用新闻/热搜）保留到替换；按成功审计的原上下文确认引用类型。资讯缓存续期、排名及列表变化不撤下普通陪伴。validUntil/nextReviewAt到点只请求更新，不清空文字。暂停时仍可返回旧问候且不领取朗读权'},speech:str,intent:str,urgency:str,action:str,validUntil:num,nextReviewAt:num,preferences:rules});
  path('get','/devices/{id}/narration','取得模型生成的气泡，包括普通问候',narration,null,
    '全部猪猪组件共享一个模型决策和id。0返回paused=true且不调用模型；1–120是两轮自动生成的最小分钟间隔，以数据库中上次生成尝试时间加当前时段间隔计算。上下文变化、失效、时段边界、失败及重启均不能提前触发。普通问候retainUntilReplaced=true保留到成功替换，失败或暂停也可返回原id/speech，暂停不领取、不朗读。实际提醒仍按validUntil和引用事项有效性撤下，间隔未到返回waiting=true，无id/speech。显式保存/恢复prompt可立即重新生成（0时段除外）。同轮格式校验最多重试一次，每次请求单独审计，只有合格话语发布。30秒轮询兜底，新话语通知所有屏幕。同屏多个组件只领取一次，不同屏幕各自回执。');
  spec.paths['/devices/{id}/narration'].get.parameters.push({in:'query',name:'componentId',required:true,schema:str});
  path('post','/devices/{id}/narration/{event}/claim','校验最新上下文并领取朗读权',obj({accepted:bool,sound:bool}),obj({componentId:str},['componentId']));
  path('post','/devices/{id}/narration/{event}/result','记录气泡实际展示/朗读/中断',obj({ok:bool}),obj({componentId:str,result:choice('subtitle','spoken','interrupted')},['componentId','result']));
  path('put','/companion/agent/profile','保存家庭资料，版本变化时返回 409',household,obj({profile,revision:num},['profile','revision']));
  path('post','/companion/agent/messages','与猪猪对话，回复和计划一起保存；同一 requestId 可重试',turn,obj({message:str,requestId:str},['message','requestId']));
  const contextDescription='调用聊天模型时完整传入已保存的 profile.memory、当前会话历史及可见计划；同时提供已启用屏幕场景中的天气城市（最多4个观测城市和4个降温城市，含来源、获取时间和过期/缺失状态）、降温预报，以及最多60条当前有效且符合兴趣设置的资讯，优先已判断的家庭影响，超限明确标记覆盖范围。天气请求最多等待2.5秒，缺失时不编造。天气和资讯是每轮的临时上下文，不写入长期家庭记忆。查询自建系统记录由数据库直接返回，不调用模型。';
  spec.paths['/companion/agent/messages'].post.description=contextDescription;
  path('get','/companion/agent/weather','查看天气上下文及自动判断状态',obj({status:str,weather:{type:'object',additionalProperties:true}}),null,
    '管理员读取。weather.future最多8个已配置或由家庭资料/近期计划明确提取的城市，每个含daily（今天加未来7天）、hourly（48小时）、alerts（官方预警）。每类独立返回status=fresh/stale/unavailable、fetchedAt、items、attributions。只有fresh且alerts.items为空才表示查询成功但无有效预警。官方预警保留发布单位、级别、生效/结束时间和更新/解除关系。自动提醒复用组件cold开关、免打扰、重复间隔与次数；模型判断关联并校验原文依据、城市归属及计划日期，数据失效或计划变更后旧任务不可领取。');
  spec.paths['/companion/agent/messages'].post.description+=' weather.future还包含今天加未来7天、未来48小时及官方预警；仅在有明确城市且数据可用时回答未来天气。';
  path('get','/companion/agent/share','获取访客可打开的家庭聊天链接',obj({links:list(str)}));
  const recordSnapshot=obj({text:str,start:str,end:str,targets:ids});
  const systemAction=obj({id:str,type:choice('info','reminder'),op:choice('create','view','update','cancel'),
    text:str,start:str,end:str,targets:ids,receipt:str,before:recordSnapshot,after:{...recordSnapshot,nullable:true}});
  const auditRow=obj({id:num,created:num,finished:{...num,nullable:true},scope:str,actor:str,ip:str,message:str,reply:str,status:choice('pending','ok','failed'),error:str,actions:list(systemAction),kind:choice('chat','narration'),system_prompt:str,model_context:str,model_response:str,model:str,memoryActions:list({type:'object',additionalProperties:true})});
  path('get','/companion/agent/audit','管理员查看用户聊天与气泡模型完整审计，支持筛选',obj({items:list(auditRow),next:{...num,nullable:true},users:list(obj({scope:str,actor:str}))}));
  spec.paths['/companion/agent/audit'].get.parameters.push({in:'query',name:'before',schema:num,description:'传上页 next，最多返回 30 条'});
  spec.paths['/companion/agent/audit'].get.parameters.push({in:'query',name:'type',schema:choice('all','chat','narration','system_prompt','model_context','model_response'),description:'只看指定信息；字段类型仅返回选定字段与元数据。'},{in:'query',name:'scope',schema:str,description:'精确会话编号，admin或访客scope；system:narration为自动气泡。昵称不用于授权或隔离。'});
  spec.components.securitySchemes.pigChatLogin={type:'apiKey',in:'cookie',name:'pig_chat_login',description:'非192.168.10局域网直连入口必须先登录；12小时HttpOnly会话，退出、密码修改和账号删除即失效。'};
  path('post','/pig-chat/login','使用系统账号登录猪猪聊天',obj({username:str}),obj({username:{...str,maxLength:128},password:{...str,maxLength:1024,writeOnly:true}},['username','password']),
    '同源JSON提交；正确账号密码后设置pig_chat_login Cookie。仅授权聊天，不授予后台JWT权限。20次/15分钟按实际连接地址限速，错误凭据统一401，限速429。');
  spec.paths['/pig-chat/login'].post.security=[];
  path('post','/pig-chat/logout','退出猪猪聊天并撤销本次登录会话',obj({ok:bool}),null,'同源JSON提交；清除登录和访客Cookie，保留聊天历史和审计。');
  spec.paths['/pig-chat/logout'].post.security=[];
  path('post','/pig-chat/session','建立或恢复聊天访客会话',obj({alias:str,authenticated:bool,history:list(turn)}),null,
    '客户端实际IP属于192.168.10.0/24、Host为该网段IP且不含代理转发头时免登录；其他入口必须持有pig_chat_login，否则401和code=PIG_CHAT_LOGIN_REQUIRED。不信任X-Forwarded-For来授予免登录权限。响应设置30天HttpOnly、SameSite=Strict的pig_guest，只返回本会话最近40次成功对话。已登录访客绑定账号，换账号不能复用原访客Cookie读取他人历史。');
  spec.paths['/pig-chat/session'].post.security=[{}, {pigChatLogin:[]}];
  path('post','/pig-chat/messages','访客发送消息（先审计，后调用模型）',turn,obj({message:{...str,maxLength:1600},requestId:{...str,maxLength:100},nickname:{...str,maxLength:32}},['message','requestId']),
    '每次请求都检查入口/登录权限，旧访客Cookie不能绕过外部登录。使用本会话Cookie可查看、原位修改或取消本会话创建的定时提示和信息。重复requestId返回已保存回复。登录用户审计包含真实账号及可选昵称。修改与取消审计包含原ID与前后快照。“刚才那条”仅在近期操作唯一指向一条当前自建记录时可执行；正文引号内的“取消”“删除”作为内容保存。明确保持开始或结束时间时仅修改另一端。查询具体主题无匹配返回空结果。目标不明确返回422，并发变化返回409，模型连接失败最多重试一次。');
  spec.components.securitySchemes.pigGuest={type:'apiKey',in:'cookie',name:'pig_guest'};
  spec.paths['/pig-chat/messages'].post.security=[{pigGuest:[]},{pigGuest:[],pigChatLogin:[]}];
  spec.paths['/pig-chat/messages'].post.description+=' '+contextDescription;
  spec.paths['/pig-chat/messages'].post.description+=' weather.future按同一规则提供未来预报和官方预警；目的地仅使用共享记忆或本会话可见计划。';
  path('delete','/companion/agent/plans/{id}','取消计划并重新判断资讯影响',household);
  path('get','/companion/agent/impacts','读取当前家庭生活影响和判断状态',obj({status:str,
    items:list(obj({id:str,title:str,source:str,url:str,speech:str,until:num,repeatable:bool}))}));
  path('get', '/devices/{id}/news', '读取本设备已发布且有效的资讯列表', obj({cards:list(event)}));
  const pigSettings=obj({familyAI:{...bool,deprecated:true},greetingMinutes:{...num,minimum:0,maximum:120,deprecated:true,description:'读取为当前时段值；旧客户端写入1–120时填充全部时段'},
    greetingSchedule:{type:'array',minItems:12,maxItems:12,items:{...num,minimum:0,maximum:120},description:'索引0为00–02时，依次至22–24时。0暂停气泡生成，其他值为分钟。'},quietEnabled:bool,quietFrom:str,quietTo:str,zone:{...str,readOnly:true,description:'家庭时区'}});
  path('get', '/companion/settings', '读取猪猪设置', pigSettings);
  path('put', '/companion/settings', '保存全局免打扰及12时段生成设置；每段0–120整数', pigSettings,pigSettings);
  path('put', '/companion/rules/{id}', '已停用，返回 410；改用场景组件接口保存 config.reminders', rules, rules);
  spec.paths['/companion/rules/{id}'].put.deprecated=true;
  delete spec.paths['/companion/rules/{id}'].put.responses[200];
  spec.paths['/companion/rules/{id}'].put.responses[410]={description:'设备不再保存猪猪配置'};
  path('get', '/companion/info/{id}', '读取家庭信息的播报设备', ids);
  path(
    'post',
    '/companion/preview',
    '只在后台预览当前设备规则',
    obj({ sample: bool, action: str, speech: str, status: str }),
    obj({ deviceId: str, kind: choice('family', 'weather', 'news') }, ['deviceId'])
  );
  path(
    'get',
    '/devices/{id}/briefing',
    '同步当前设备卡片与任务',
    obj({
      componentId:str,
      cards: list(event),
      tasks: list(event),
      active: list(obj({ id: str, edition: num, speech: str })),
      preferences: rules,
      now: num
    }),
    null,
    '启动、重连和收到 briefing-updated 后读取，60 秒兜底同步。'
  );
  spec.paths['/devices/{id}/briefing'].get.parameters.push({name:'componentId',in:'query',schema:str,description:'当前场景中的猪猪组件；不属于该屏幕的组件返回 403。旧客户端省略且有多个组件时只返回卡片。'});
  spec.paths['/devices/{id}/briefing'].get.deprecated=true;
  path(
    'post',
    '/devices/{id}/deliveries/{event}/claim',
    '领取一个有效版本',
    event,
    obj({ componentId:str,edition: num, occurrence:{...num,description:'传入任务中的播放序号，缺省为首次'} }, ['edition'])
  );
  path(
    'post',
    '/devices/{id}/deliveries/{event}/result',
    '上报播放终态',
    obj({ ok: bool }),
    obj({ componentId:str,edition: num, occurrence:{...num,description:'领取响应中的播放序号，缺省为首次'}, result: choice('subtitle', 'spoken', 'interrupted') }, ['edition', 'result'])
  );
};
