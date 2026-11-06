const {randomUUID}=require('node:crypto');
const db=require('./storage');
const {fault}=require('./providers');
const scheduler=require('../schedulerService');
const reminders=require('../../dao/reminderDao');
const socket=require('../socketService');
const records=require('./owned-records');
// Only a household conversation can propose writes; news/background analysis has no tools.
function intent(message) {
  if(/(?:不要|不用|不必|别再|无需|不需要|暂不).{0,12}(?:提醒|设置|创建|添加|发布|安排)|^(?:假如|假设|举例|如何|怎么设置)|只是问|do not (?:set|schedule)|don't remind/i.test(message)) return false;
  return /提醒|定时|闹钟|出门|出发|去机场|赶飞机|信息列表|留言|公告|充电|请记得|别忘|点钟|\d\s*[:：点时]|[一二三四五六七八九十两]点|remind|schedule|notice|airport/i.test(message);
}
function instant(value) {
  if(typeof value!=='string' || !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::00)?(?:Z|[+-]\d\d:\d\d)$/.test(value))
    throw fault('请明确日期、时间和时区后再安排',422);
  const ms=Date.parse(value);
  if(!Number.isFinite(ms) || new Date(value.slice(0,10)+'T12:00Z').toISOString().slice(0,10)!==value.slice(0,10)) throw fault('日期无效',422);
  return ms;
}
const pad=n=>String(n).padStart(2,'0');
function parts(ms,zone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ms).map(v=>[v.type,v.value]));
}
function relativeDays(text) {
  return [...new Set((text.match(/后天|明天|明早|明晚|明晨|今天|今日|今晚|今早|今晨/g)||[]).map(s=>s==='后天'?2:s.startsWith('明')?1:0))];
}
// Ground a model's timestamp in explicit relative dates, in the household timezone, even when
// the model picks today's date for "tomorrow evening" in the second half of a multi-action turn.
function groundTime(ms,now,zone,day,evening,extra=0,morningHour=null) {
  if(day===undefined && !evening && morningHour===null) return ms;
  const clock=parts(ms,zone), base=day===undefined?clock:parts(now,zone);
  let hr=Number(clock.hour);
  if(evening && hr>=1 && hr<=11) hr+=12;
  if(morningHour!==null && morningHour<12 && hr%12===morningHour) hr=morningHour;
  const desired=Date.UTC(+base.year,+base.month-1,+base.day+(day===undefined?0:day+extra),hr,+clock.minute);
  const wall=t=>{const p=parts(t,zone);return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);};
  let t=ms;
  for(let i=0;i<3 && wall(t)!==desired;i++) t+=desired-wall(t);
  if(wall(t)!==desired) throw fault('所选当地时间不存在，请换一个时间',422);
  return t;
}
function local(ms) {
  const d=new Date(ms);
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())+':00';
}
function minuteShift(message) {
  const hit=message.match(/(推迟|延迟|顺延|延后|延长|缩短|往后[挪移]|提前|提早|往前[挪移])(?:了|约|大约)?\s*(半|\d+|[一二两三四五六七八九十]+)\s*(?:个)?(小时|分钟|分(?:钟)?)/);
  if(!hit) return null;
  const digits='零一二三四五六七八九';
  const number=hit[2].replace('两','二');
  let amount=Number(number);
  if(number==='半') amount=0.5;
  else if(number.includes('十')) {
    const [tens,ones]=number.split('十');
    amount=(tens?digits.indexOf(tens):1)*10+(ones?digits.indexOf(ones):0);
  } else if(!Number.isFinite(amount)) amount=digits.indexOf(number);
  if(amount<=0) throw fault('请说明要调整多少分钟',422);
  return amount*(hit[3]==='小时'?60:1)*(/提前|提早|往前|缩短/.test(hit[1])?-1:1);
}
function changeExisting(proposal,message,now,zone,context) {
  const old=records.select(context.rows,proposal,message,now,zone);
  const before={text:old.text,start:old.start,end:old.end,targets:old.targets};
  const action={...old,op:context.mode,before};
  if(context.mode==='cancel') {
    return {...action,after:null,receipt:'已取消 '+records.display(old,zone)};
  }
  if(old.type==='reminder' && old.repeat!=='none') throw fault('这条提示已改为重复任务，请在定时提示页面修改。',422);
  const timingInstruction=message.replace(/[“「‘"][^”」’"]*[”」’"]/g,'');
  const shift=minuteShift(timingInstruction);
  let start=old.start, end=old.end;
  const textRequest=/正文|文案|内容|文字|改成[“‘「"]/.test(message);
  const timeRequest=/时间|时段|推迟|提前|延后|顺延|延长|缩短|明天|后天|明早|明晚|[\d一二两三四五六七八九十]\s*[:：点时]/.test(timingInstruction) &&
    !/(?:时间|时段)(?:保持)?不变/.test(timingInstruction);
  if(shift!==null) {
    if(!start || !end) throw fault('原记录没有完整时段，请提供新的开始和结束时间',422);
    const endOnly=/结束.{0,5}(推迟|延后|提前)|延长|缩短/.test(message);
    if(!endOnly) start=local(Date.parse(start)+shift*60000);
    if(!/结束(?:时间)?不变/.test(message)) end=local(Date.parse(end)+shift*60000);
  } else if(timeRequest && (proposal.start || proposal.end)) {
    if(proposal.start) {
      const next=instant(proposal.start);
      if(!proposal.end && old.start && old.end) end=local(next+Date.parse(old.end)-Date.parse(old.start));
      start=local(next);
    }
    if(proposal.end) end=local(instant(proposal.end));
  }
  const rescheduling=shift!==null || timeRequest && Boolean(proposal.start || proposal.end);
  const text=proposal.text==null || rescheduling && !textRequest?old.text:proposal.text;
  if(typeof text!=='string' || !text.trim() || text.length>360) throw fault('信息正文需在 1 至 360 个字符之间',422);
  if(start && end && Date.parse(end)<=Date.parse(start) || end && Date.parse(end)<=now ||
     old.type==='reminder' && (!start || !end || Date.parse(end)-Date.parse(start)>=86400000))
    throw fault('新时段无效或已过，请提供有效时间',422);
  const after={text:text.trim(),start,end,targets:old.targets};
  if(start===before.start && end===before.end && after.text===before.text) throw fault('请说明要更改的时间或正文',422);
  Object.assign(action,after,{after});
  action.receipt='已更新 '+records.display(old,zone)+'\n改为 '+records.display(action,zone);
  return action;
}
async function prepare(proposals,message,now,zone,context={mode:null,rows:[]}) {
  if(proposals==null) return [];
  if(!Array.isArray(proposals) || proposals.length>4) throw fault('单次最多创建四项提醒或信息',422);
  if(proposals.length && !context.mode && !intent(message)) throw fault('请说明要创建的提醒或信息',422);
  const actions=[];
  for(const a of proposals) {
    if(!a || !['reminder','info'].includes(a.type) ||
      typeof a.basis!=='string' || a.basis.trim().length<2 || !message.includes(a.basis)) throw fault('操作缺少本条消息中的依据，未创建',422);
    if(context.mode) {
      if(a.op!==context.mode) throw fault('请指定已有记录的编号和变更，我会更新原记录。',422);
      const changed=changeExisting(a,message,now,zone,context);
      if(actions.some(existing=>existing.id===changed.id)) throw fault('请将同一项的改动合并为一次',422);
      actions.push(changed);
      continue;
    }
    if(a.op && a.op!=='create' || typeof a.text!=='string' || !a.text.trim() || a.text.length>360)
      throw fault('操作类型或正文无效',422);
    const clauses=message.split(/[。；;\n]|(?:[，,]\s*)?并(?=在信息列表|设置|设定)/).filter(Boolean);
    const clause=clauses.find(s=>s.includes(a.basis)) ||
      clauses.find(s=>(a.type==='reminder'?/定时|提醒我/:/信息列表|留言/).test(s)) || message;
    const days=relativeDays(clause), allDays=relativeDays(message);
    const day=days.length===1?days[0]:!days.length && allDays.length===1?allDays[0]:undefined;
    const evening=/(?:晚上|今晚|傍晚|下午)\s*[1-9一二三四五六七八九十两]+\s*[:：点时]/.test(clause) ||
      (a.type==='info' && /(?:显示时间|时段)[^。]{0,8}(?:晚上|下午)\s*[1-9一二三四五六七八九十两]+\s*[:：点时]/.test(message));
    const rawStart=instant(a.start),rawEnd=a.end?instant(a.end):null;
    const explicitMorning=clause.match(/(?:明早|早上|上午|凌晨|清晨|早晨)\s*(\d{1,2})\s*[:：点时]/);
    const morningHour=explicitMorning?Number(explicitMorning[1]):null;
    const start=groundTime(rawStart,now,zone,day,evening,0,morningHour);
    const cross=rawEnd!=null && parts(rawEnd,zone).hour<parts(rawStart,zone).hour;
    const endDay=rawEnd!=null && rawEnd-rawStart>=86400000 ? undefined:day;
    const eveningEnd=evening && !cross && !/(?:至|到)[^。；]{0,8}(?:早上|凌晨|明早|上午)/.test(clause);
    const end=rawEnd!=null?groundTime(rawEnd,now,zone,endDay,eveningEnd,cross?1:0,a.type==='reminder'?morningHour:null):a.type==='reminder'?start+5*60000:NaN;
    if(!Number.isFinite(end) || end<=start || end<=now || (a.type==='reminder' && (start<now || end-start>=86400000)))
      throw fault('提示时段无效或已过，请提供有效时间',422);
    let targets=[];
    if(a.type==='reminder') {
      targets=(await db.all(`SELECT DISTINCT ds.device_id FROM device_scenes ds JOIN components c ON ds.scene_id=c.scene_id
        WHERE ds.enabled=1 AND c.type='companion' AND coalesce(json_extract(c.config,'$.reminders.enabled'),1)=1 ORDER BY ds.device_id`)).map(r=>r.device_id);
      if(!targets.length) throw fault('还没有绑定已启用猪猪组件的屏幕，定时提示未创建',422);
    }
    const fmt=new Intl.DateTimeFormat('zh-CN',{timeZone:zone,month:'2-digit',day:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    const text=a.text.trim(), receipt=(a.type==='info'?'已添加信息':'已设定定时提示')+'：'+text+'（'+fmt.format(start)+' 至 '+fmt.format(end)+'，'+zone+(targets.length?'；'+targets.length+' 块屏幕':'')+'）';
    actions.push({id:randomUUID(),op:'create',type:a.type,text,start:local(start),end:local(end),targets,receipt});
  }
  return actions;
}
const pendingTimers=new Map();
async function syncTimer(action) {
  if(action.op==='update' || action.op==='cancel') {
    scheduler.cancelReminder(action.id);
    for(const id of action.targets) socket.emitToDevice(id,'timed-reminder-end',{reminderId:action.id});
  }
  const row=await reminders.findById(action.id);
  if(!row?.enabled) return;
  scheduler.scheduleReminder(row);
  if(action.op==='update') {
    for(const id of row.device_ids) {
      const active=await scheduler.activeDatedFor(id);
      if(active.some(r=>r.id===row.id)) socket.emitToDevice(id,'timed-reminder-start',{reminderId:row.id,
        content:row.content,sound:row.sound,start_time:row.start_time,end_time:row.end_time});
    }
  }
}
async function activate(actions) {
  for(const action of actions) {
    if(action.op==='view') continue;
    if(action.type==='info') {socket.emitToAll('info-items-updated',{});continue;}
    // Serialize timer replacement for the same record even when two chats commit close together.
    const previous=pendingTimers.get(action.id) || Promise.resolve();
    const next=previous.catch(()=>{}).then(()=>syncTimer(action));
    pendingTimers.set(action.id,next);
    try {await next;} finally {if(pendingTimers.get(action.id)===next) pendingTimers.delete(action.id);}
  }
}
module.exports={intent,prepare,activate};
