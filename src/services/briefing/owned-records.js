const db=require('./storage');
const {fault}=require('./providers');

function mentionedKind(message) {
  const reminder=/提醒|定时|闹钟/i.test(message);
  const info=/信息列表|留言|公告|信息|消息/.test(message);
  if(reminder===info) return null;
  return reminder?'reminder':'info';
}
function requestMode(message) {
  const records=mentionedKind(message) || /提示|这条|那条|这项|那项|刚才的|#\w+|reminder|notice/i.test(message);
  if(/^(?:假设|举例|怎么操作|如何|怎么才能)|(?:能否|是否可以).*(?:修改|取消)/.test(message)) return null;
  if(/(?:不要|别|不用|无需|不必)\s*(?:取消|删除|修改|调整|推迟)/.test(message)) return 'view';
  if(/取消|删掉|删了|删除|撤销|撤下|撤掉|去掉|作废|不用再提醒|别再提醒|不要再提醒|(?:不用|不想要|不要).{0,18}(?:提醒|提示|留言|信息)了/.test(message) && records) return 'cancel';
  if(/推迟|延后|顺延|往后[挪移拨]|延迟|改到|改为|改成|改一下|改写|修改|更改|更正|调整|移至|挪到|移到|换[成为]|更新|延长|缩短|(?:提醒|那条|这条).*提前|(?:把|将).*(?:设为|设到|调到|改下)/.test(message) &&
     (records || /半小时|分钟|小时|改到|改为|改成/.test(message))) return 'update';
  if((records || /安排|建过|创建过/.test(message)) && /查看|查询|查查|看一下|看看|列出|列一下|哪些|有什么|几条|多少条|查一下|显示一下|什么时候|是几点|几点[？?]|什么时间|什么内容/.test(message)) return 'view';
  return null;
}

async function owned(scope) {
  const rows=await db.all(`SELECT o.id AS id,o.kind AS type,o.revision,i.text,i.start_time AS start,i.end_time AS end,'[]' AS targets,NULL AS repeat
    FROM pig_record_owner o JOIN info_items i ON i.id=o.id WHERE o.scope=? AND o.kind='info'
    UNION ALL SELECT o.id,o.kind,o.revision,coalesce(json_extract(r.content,'$.text'),r.name),
      r.start_date||'T'||r.start_time||':00',
      CASE WHEN r.end_time<=r.start_time THEN date(r.start_date,'+1 day') ELSE r.start_date END||'T'||r.end_time||':00',r.device_ids,r.repeat
    FROM pig_record_owner o JOIN timed_reminders r ON r.id=o.id WHERE o.scope=? AND o.kind='reminder'
    ORDER BY start,id`,scope,scope);
  return rows.map(row=>({...row,targets:JSON.parse(row.targets)}));
}
function display(row,zone) {
  const fmt=new Intl.DateTimeFormat('zh-CN',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const when=value=>value?fmt.format(new Date(value)):'不限';
  return '#'+row.id.slice(0,8)+' '+(row.type==='info'?'信息':'定时提示')+'「'+row.text+'」 '+when(row.start)+' – '+when(row.end);
}
function forQuery(rows,message,now,zone) {
  const kind=mentionedKind(message);
  let found=kind?rows.filter(r=>r.type===kind):rows;
  const ref=message.match(/#([^\s，。；,;]+)/);
  if(ref) {
    const prefix=ref[1].match(/^[0-9a-f-]{8,36}/i)?.[0];
    return prefix?found.filter(r=>r.id.startsWith(prefix.toLowerCase())):[];
  }
  // A date following “改到” describes the new time, not the target record.
  const description=message.split(/推迟|提前|延后|顺延|改到|改成|改为|调整到|延长到/)[0];
  const relative=description.match(/明早|明天|明晚|今晚|今天|后天/);
  if(relative) {
    const days=relative[0]==='后天'?2:relative[0].startsWith('明')?1:0;
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:zone});
    const here=day.format(new Date(now));
    const wanted=new Date(Date.parse(here+'T12:00Z')+days*86400000).toISOString().slice(0,10);
    found=found.filter(r=>r.start && day.format(new Date(r.start))===wanted);
    const hour=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'});
    if(/明早|早上|上午/.test(description)) found=found.filter(r=>Number(hour.format(new Date(r.start)))<12);
    if(/今晚|明晚|晚上/.test(description)) found=found.filter(r=>Number(hour.format(new Date(r.start)))>=17);
  }
  const time=description.match(/(?:^|[^\d])(\d{1,2})[:：](\d\d)(?!\d)/);
  if(time) {
    const clock=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    found=found.filter(r=>r.start && clock.format(new Date(r.start))===time[1].padStart(2,'0')+':'+time[2]);
  }
  return found;
}
function wordMatches(rows,text) {
  // Match actual words from the description, excluding operation verbs and record type labels.
  const terms=text.replace(/定时提示|信息列表|定时提醒|提醒|留言|信息|查看|显示|取消|修改|推迟|提前|我的|创建的|那条|这条|明早|明天|今天|正文/g,' ')
    .match(/[\p{L}\d]{2,}/gu) || [];
  const hits=rows.filter(row=>terms.some(term=>Array.from({length:term.length-1},(_,i)=>term.slice(i,i+2)).some(word=>row.text.includes(word))));
  return hits;
}
function select(rows,action,message,now,zone) {
  let matches=forQuery(rows,message,now,zone).filter(r=>r.type===action.type);
  const proposed=typeof action.selector==='string'?action.selector.trim():'';
  const selector=message.includes(proposed) && !/^(?:这条|那条|定时提示|提醒|信息|信息列表|留言)$/.test(proposed)?proposed:'';
  if(selector) {
    const narrowed=matches.filter(row=>row.text.includes(selector));
    if(narrowed.length) matches=narrowed;
    else if(!/^(?:这条|那条|定时提示|提醒|信息|信息列表|留言)$/.test(selector) && !message.includes('#')) matches=wordMatches(matches,selector);
  }
  if(!selector && !message.includes('#') && !/这条|那条|刚才的|这个|那个/.test(message)) {
    const described=message.split(/推迟|延后|顺延|改到|改为|改成|的正文/)[0];
    if(wordMatches(matches,described).length) matches=wordMatches(matches,described);
    else if(described.trim() && !/^(?:取消|删除)(?:我的|我创建的)?(?:定时)?(?:提醒|提示|信息|留言)[。！!]?$/u.test(message)) matches=[];
  }
  const id=typeof action.id==='string'?action.id.replace(/^#/,''):'';
  if(matches.length!==1 || (id && (id.length<8 || !matches[0].id.startsWith(id)))) {
    const choices=matches.map(r=>display(r,zone)).join('\n');
    throw fault(choices?'请指定要操作的编号，再告诉我怎么改。\n'+choices:'没有找到相符的自建记录。可以先说“查看我的提醒和信息列表”。',422);
  }
  return matches[0];
}
function list(rows,message,now,zone) {
  const candidates=forQuery(rows,message,now,zone);
  const matching=wordMatches(candidates,message);
  const items=matching.length?matching:candidates;
  const reply=items.length?'共 '+items.length+' 条（'+zone+'）\n'+items.map(r=>display(r,zone)).join('\n'):'当前没有符合条件的自建提醒或信息。';
  return {reply,actions:items.map(row=>({...row,op:'view'}))};
}
module.exports={requestMode,owned,display,select,list};
