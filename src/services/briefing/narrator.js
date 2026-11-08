const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const db=require('./storage'),api=require('./service'),p=require('./providers'),rules=require('./rules');
const memory=require('./agent-memory');
const prompt=()=>fs.readFileSync(path.join(__dirname,'../../prompts/pig-screen-system.md'),'utf8');
async function interval(){const value=await require('../../dao/settingsDao').get('pig.greetingMinutes');return Number.isInteger(value)&&value>=1&&value<=1440?value:5;}
const flights=new Map(),retries=new Map();
async function install(exec){await exec(`
  CREATE TABLE IF NOT EXISTS pig_narration(id TEXT PRIMARY KEY,device TEXT,component TEXT,created INTEGER,context TEXT,payload TEXT,review INTEGER,expires INTEGER);
  CREATE INDEX IF NOT EXISTS pig_narration_clock ON pig_narration(device,component,created);
  CREATE TABLE IF NOT EXISTS pig_narration_delivery(id TEXT PRIMARY KEY REFERENCES pig_narration(id) ON DELETE CASCADE,claimed INTEGER,result TEXT);
`);}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['fetchedAt','asOf','now'].includes(k)).map(([k,v])=>[k,stable(v)]));
  return value;
}
function calendar(day){
  const ranges=require('../../../shared/pig-holidays.json')[day.slice(0,4)];
  const value=Number(day.slice(5,7))*100+Number(day.slice(8,10));
  return {region:'中国大陆',source:'沿用系统内置2026/2027放假日期表',covered:!!ranges,holiday:ranges?.find(([from,to])=>value>=from&&value<=to)?.[2]||null};
}
async function context(device,component,now){
  const bound=await api.boundPig(device,component);
  if(!bound.id)throw p.fault('猪猪组件未绑定',403);
  const h=await require('./household').household(),preferences=bound.prefs;
  const local=rules.localTime(now,h.profile.zone),quiet=rules.between(rules.localTime(now,preferences.zone).time,preferences.quietFrom,preferences.quietTo);
  const [agentMemory,weather,cards,info,reminders,recent]=await Promise.all([
    memory.list(now),require('./weather-context').build(now,{household:h}),api.newsCards(device,now),
    db.all('SELECT id,text,start_time,end_time FROM info_items'),
    db.all('SELECT id,name,content,start_date,start_time,end_time,repeat FROM timed_reminders WHERE enabled=1 AND (device_ids=\'[]\' OR EXISTS(SELECT 1 FROM json_each(device_ids) WHERE value=?))',device),
    db.all('SELECT n.id,n.created,n.payload,d.result,d.claimed FROM pig_narration n LEFT JOIN pig_narration_delivery d ON d.id=n.id WHERE n.device=? AND n.component=? ORDER BY n.created DESC LIMIT 8',device,bound.id)
  ]);
  const plans=h.plans.filter(v=>!v.end||v.end>=local.day);
  const input={clock:{now:new Date(now).toISOString(),...local,zone:h.profile.zone,calendar:calendar(local.day),
    lunar:new Intl.DateTimeFormat('zh-CN-u-ca-chinese',{timeZone:h.profile.zone,dateStyle:'full'}).format(now)},
    profile:{memory:h.profile.memory},plans,agentMemory:memory.context(agentMemory,now,h.profile.zone),weather,
    news:cards.slice(0,60),newsCoverage:{total:cards.length,included:Math.min(60,cards.length)},
    info:info.filter(r=>!r.end_time||Date.parse(r.end_time)>now),
    reminders:reminders.filter(r=>r.repeat!=='none'||!r.start_date||r.start_date>=local.day),
    recent:recent.map(r=>({...r,payload:JSON.parse(r.payload)})),preferences:{...preferences,quiet,greetingMinutes:await interval()}};
  const {clock,recent:ignored,...facts}=input;
  const key=p.hash(JSON.stringify([prompt(),local.day,stable(facts),agentMemory.map(m=>now>=m.starts)]));
  return {input,key,component:bound.id,preferences:{...preferences,sound:preferences.enabled&&preferences.sound&&!quiet},quiet};
}
function validate(value,ctx,now){
  const d=value;
  if(!d||typeof d.speech!=='string'||!d.speech.trim()||d.speech.length>180||
    !['greeting','companion','reminder'].includes(d.intent)||!['normal','important','urgent'].includes(d.urgency)||
    !['idle','wave','scarf','point','serious'].includes(d.action)||!Array.isArray(d.references)||
    typeof d.reason!=='string'||!d.reason.trim())throw p.fault('模型气泡格式无效',502);
  const ids=new Set(['profile','weather',...['plans','agentMemory','news','info','reminders'].flatMap(k=>ctx.input[k].map(v=>v.id))]);
  if(d.references.some(id=>!ids.has(id))||d.intent==='reminder'&&(!d.references.length||!ctx.preferences.enabled||ctx.quiet))throw p.fault('模型引用或提醒权限无效',502);
  if(d.intent==='reminder'){
    const disabled=new Set([...(ctx.preferences.cold?[]:['weather']),...(ctx.preferences.news?[]:ctx.input.news.map(v=>v.id)),
      ...(ctx.preferences.family?[]:['profile',...['plans','agentMemory','info','reminders'].flatMap(k=>ctx.input[k].map(v=>v.id))])]);
    if(d.references.some(id=>disabled.has(id)))throw p.fault('此类提醒已关闭',502);
  }
  const review=Date.parse(d.nextReviewAt),expires=Date.parse(d.validUntil);
  if(![d.nextReviewAt,d.validUntil].every(v=>typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v))||!Number.isFinite(review)||!Number.isFinite(expires)||review<=now||expires<=now)throw p.fault('模型气泡有效期无效',502);
  const expiry=Math.min(expires,now+Math.max(30,ctx.input.preferences.greetingMinutes)*60000,...ctx.input.agentMemory.filter(m=>d.references.includes(m.id)&&m.expires).map(m=>m.expires),
    ...ctx.input.news.filter(m=>d.references.includes(m.id)&&m.expires).map(m=>m.expires),
    ...ctx.input.info.filter(m=>d.references.includes(m.id)&&m.end_time).map(m=>Date.parse(m.end_time)).filter(Number.isFinite));
  return {payload:{speech:d.speech.trim(),intent:d.intent,urgency:d.urgency,action:d.action,references:d.references,reason:d.reason.slice(0,1000)},
    review:Math.min(now+ctx.input.preferences.greetingMinutes*60000,expiry),expires:expiry};
}
async function decide(device,component,now=Date.now()){
  const ctx=await context(device,component,now),slot=device+':'+ctx.component;
  const old=await db.one('SELECT * FROM pig_narration WHERE device=? AND component=? ORDER BY created DESC,rowid DESC LIMIT 1',device,ctx.component);
  if(old&&old.context===ctx.key&&old.review>now&&old.expires>now)return {row:old,ctx};
  if(retries.get(slot)>now)throw p.fault('模型暂不可用，稍后重试',503);
  const settings=await api.settings(),messages=[{role:'system',content:prompt()},{role:'user',content:JSON.stringify(ctx.input)}];
  const auditId=randomUUID();
  await db.run(`INSERT INTO pig_chat_audit(attempt,created,scope,actor,ip,turn_id,message,kind,system_prompt,model_context,model)
    VALUES(?,?,'system:narration','猪猪气泡','',?,'自动生成气泡','narration',?,?,?)`,auditId,now,auditId,messages[0].content,messages[1].content,settings.provider+'/'+settings.model);
  try{
    const result=await api.generate(settings,messages,(s,m)=>p.jsonCompletion(s,m,1600),Math.ceil(JSON.stringify(messages).length*1.2)+1600);
    await db.run('UPDATE pig_chat_audit SET model_response=? WHERE attempt=?',result.raw??JSON.stringify(result.data),auditId);
    const decidedAt=Math.max(now,Date.now()),d=validate(result.data,ctx,now);
    // Changes during the model call (including cancellation/expiry) must invalidate the generated sentence.
    const latest=await context(device,ctx.component,decidedAt);
    if(latest.key!==ctx.key||d.expires<=decidedAt)throw p.fault('上下文已变化，正在重新判断',409);
    const row={id:randomUUID(),device,component:ctx.component,created:now,context:ctx.key,payload:JSON.stringify(d.payload),review:d.review,expires:d.expires};
    await db.run('INSERT INTO pig_narration VALUES(?,?,?,?,?,?,?,?)',...Object.values(row));
    await db.run("UPDATE pig_chat_audit SET status='ok',finished=?,reply=?,turn_id=? WHERE attempt=?",Date.now(),d.payload.speech,row.id,auditId);
    return {row,ctx};
  }catch(e){await db.run("UPDATE pig_chat_audit SET status='failed',finished=?,error=?,model_response=CASE WHEN ?!='' THEN ? ELSE model_response END WHERE attempt=?",Date.now(),e.status?e.message:'生成失败',e.rawResponse||'',e.rawResponse||'',auditId);if(e.status!==409)retries.set(slot,now+(e.status===429?15:2)*60000);throw e;}
}
async function feed(device,component,now=Date.now()){
  const slot=device+':'+component;
  if(!flights.has(slot))flights.set(slot,decide(device,component,now).finally(()=>flights.delete(slot)));
  const {row,ctx}=await flights.get(slot),d=JSON.parse(row.payload);
  return {id:row.id,componentId:row.component,speech:d.speech,action:d.action,intent:d.intent,urgency:d.urgency,
    validUntil:row.expires,nextReviewAt:row.review,preferences:ctx.preferences};
}
async function claim(device,component,id,now=Date.now()){
  const ctx=await context(device,component,now);
  const row=await db.one('SELECT * FROM pig_narration WHERE id=? AND device=? AND component=?',id,device,ctx.component);
  if(!row||row.expires<=now||row.context!==ctx.key)throw p.fault('气泡已经失效',409);
  const changed=await db.run("INSERT OR IGNORE INTO pig_narration_delivery VALUES(?,?,'claimed')",id,now);
  return {accepted:!!changed,sound:ctx.preferences.sound};
}
async function result(device,component,id,status){
  if(!['subtitle','spoken','interrupted'].includes(status))throw p.fault('无效播放结果');
  await api.boundPig(device,component);
  await db.run("UPDATE pig_narration_delivery SET result=? WHERE id=? AND EXISTS(SELECT 1 FROM pig_narration n WHERE n.id=? AND n.device=? AND n.component=?)",status,id,id,device,component);
  return {ok:true};
}
module.exports={install,prompt,interval,context,validate,feed,claim,result};
