const {randomUUID}=require('node:crypto');
const db=require('./storage'),api=require('./service'),p=require('./providers'),rules=require('./rules');
const memory=require('./agent-memory');
const promptSettings=require('./narration-prompt');
const prompt=promptSettings.defaultPrompt;
const schedule=require('./narration-settings');
async function interval(now=Date.now()){return schedule.state(await schedule.get(),now).minutes;}
const flights=new Map();
function ordinary(payload){
  return ['greeting','companion'].includes(payload.intent)&&payload.urgency==='normal'&&
    payload.references.every(id=>['clock','profile','weather'].includes(id));
}
const latestRow=()=>db.one("SELECT * FROM pig_narration WHERE device='*' AND component='*' ORDER BY created DESC,rowid DESC LIMIT 1");
async function install(exec){await exec(`
  CREATE TABLE IF NOT EXISTS pig_narration(id TEXT PRIMARY KEY,device TEXT,component TEXT,created INTEGER,context TEXT,payload TEXT,review INTEGER,expires INTEGER);
  CREATE INDEX IF NOT EXISTS pig_narration_clock ON pig_narration(device,component,created);
  CREATE TABLE IF NOT EXISTS pig_narration_delivery(id TEXT PRIMARY KEY REFERENCES pig_narration(id) ON DELETE CASCADE,claimed INTEGER,result TEXT);
  CREATE TABLE IF NOT EXISTS pig_shared_delivery(id TEXT NOT NULL REFERENCES pig_narration(id) ON DELETE CASCADE,device TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,component TEXT,claimed INTEGER,result TEXT,PRIMARY KEY(id,device));
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
  const savedPrompt=await promptSettings.get();
  const bound=await api.boundPig(device,component);
  if(!bound.id)throw p.fault('猪猪组件未绑定',403);
  const h=await require('./household').household(),globalSettings=await schedule.get(),window=schedule.state(globalSettings,now);
  const configs=(await db.all("SELECT DISTINCT c.config FROM components c JOIN device_scenes ds ON ds.scene_id=c.scene_id WHERE ds.enabled=1 AND c.type='companion'")).map(r=>rules.component(JSON.parse(r.config).reminders));
  const active=configs.filter(c=>c.enabled);
  const preferences={enabled:active.length>0,family:active.some(c=>c.family),cold:active.some(c=>c.cold),news:active.some(c=>c.news),
    gap:active.length?Math.min(...active.map(c=>c.gap)):10,repeatMinutes:active.length?Math.min(...active.map(c=>c.repeatMinutes)):60,
    maxPlays:active.length?Math.max(...active.map(c=>c.maxPlays)):3,zone:h.profile.zone};
  const local=rules.localTime(now,h.profile.zone),quiet=window.quiet;
  const [agentMemory,weather,cards,info,reminders,recent]=await Promise.all([
    memory.list(now),require('./weather-context').build(now,{household:h}),api.newsCards(null,now),
    db.all('SELECT id,text,start_time,end_time FROM info_items'),
    db.all('SELECT id,name,content,start_date,start_time,end_time,repeat FROM timed_reminders WHERE enabled=1'),
    db.all("SELECT n.id,n.created,n.payload,(SELECT result FROM pig_shared_delivery d WHERE d.id=n.id ORDER BY claimed DESC LIMIT 1) AS result,(SELECT max(claimed) FROM pig_shared_delivery d WHERE d.id=n.id) AS claimed FROM pig_narration n WHERE n.device='*' AND n.component='*' ORDER BY n.created DESC LIMIT 8")
  ]);
  const plans=h.plans.filter(v=>!v.end||v.end>=local.day);
  const input={clock:{now:memory.clock(now,h.profile.zone),...local,zone:h.profile.zone,calendar:calendar(local.day),
    lunar:new Intl.DateTimeFormat('zh-CN-u-ca-chinese',{timeZone:h.profile.zone,dateStyle:'full'}).format(now)},
    profile:{memory:h.profile.memory},plans,agentMemory:memory.context(agentMemory,now,h.profile.zone),weather,
    news:cards.slice(0,60),newsCoverage:{total:cards.length,included:Math.min(60,cards.length)},
    info:info.filter(r=>!r.end_time||Date.parse(r.end_time)>now),
    reminders:reminders.filter(r=>r.repeat!=='none'||!r.start_date||r.start_date>=local.day),
    recent:recent.map(r=>({...r,payload:JSON.parse(r.payload)})),preferences:{...preferences,shared:true,quiet,greetingMinutes:window.minutes,
      quietEnabled:globalSettings.quietEnabled,quietFrom:globalSettings.quietFrom,quietTo:globalSettings.quietTo}};
  input.generationPolicy={promptKey:p.hash(savedPrompt.prompt+'\n'+savedPrompt.revision)};
  const {clock,recent:ignored,...facts}=input;
  const key=p.hash(JSON.stringify([savedPrompt.prompt,savedPrompt.revision,local.day,window.slot,stable(facts),agentMemory.map(m=>now>=m.starts)]));
  return {input,key,systemPrompt:savedPrompt.prompt,component:bound.id,preferences,quiet,window};
}
function validate(value,ctx,now){
  const d=value;
  if(!d||typeof d.speech!=='string'||!d.speech.trim()||
    !['greeting','companion','reminder'].includes(d.intent)||!['normal','important','urgent'].includes(d.urgency)||
    !['idle','wave','scarf','point','serious'].includes(d.action)||!Array.isArray(d.references)||
    typeof d.reason!=='string'||!d.reason.trim())throw p.fault('模型气泡格式无效',502);
  const limit=promptSettings.speechLimit(ctx.systemPrompt);
  if(Array.from(d.speech).length>limit)throw p.fault('speech含标点共'+Array.from(d.speech).length+'个字符，超过speechMaxChars='+limit+'；请重新组织成一句完整短句，不要截断',502);
  d.references=d.references.map(id=>id==='profile.memory'?'profile':id==='clock.calendar'?'clock':id);
  const ids=new Set(['clock','profile','weather',...['plans','agentMemory','news','info','reminders'].flatMap(k=>ctx.input[k].map(v=>v.id))]);
  if(d.references.some(id=>!ids.has(id))||d.intent==='reminder'&&(!d.references.length||!ctx.preferences.enabled||ctx.quiet))throw p.fault('模型引用或提醒权限无效',502);
  if(d.intent==='reminder'){
    const disabled=new Set([...(ctx.preferences.cold?[]:['weather']),...(ctx.preferences.news?[]:ctx.input.news.map(v=>v.id)),
      ...(ctx.preferences.family?[]:['profile',...['plans','agentMemory','info','reminders'].flatMap(k=>ctx.input[k].map(v=>v.id))])]);
    if(d.references.some(id=>disabled.has(id)))throw p.fault('此类提醒已关闭',502);
  }
  const review=Date.parse(d.nextReviewAt),expires=Date.parse(d.validUntil);
  if(![d.nextReviewAt,d.validUntil].every(v=>typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v))||!Number.isFinite(review)||!Number.isFinite(expires)||review<=now||expires<=now)throw p.fault('模型气泡有效期无效',502);
  const expiry=Math.min(expires,ctx.window.boundary,now+Math.max(30,ctx.input.preferences.greetingMinutes)*60000,...ctx.input.agentMemory.filter(m=>d.references.includes(m.id)&&m.expires).map(m=>m.expires),
    ...ctx.input.news.filter(m=>d.references.includes(m.id)&&m.expires).map(m=>m.expires),
    ...ctx.input.info.filter(m=>d.references.includes(m.id)&&m.end_time).map(m=>Date.parse(m.end_time)).filter(Number.isFinite));
  return {payload:{speech:d.speech.trim(),intent:d.intent,urgency:d.urgency,action:d.action,references:d.references,reason:d.reason.slice(0,1000)},
    review:now+ctx.input.preferences.greetingMinutes*60000,expires:ordinary(d)?now+ctx.input.preferences.greetingMinutes*60000:expiry};
}
function samePrompt(audit,ctx){
  const previous=JSON.parse(audit.model_context||'{}');
  return previous.generationPolicy?previous.generationPolicy.promptKey===ctx.input.generationPolicy.promptKey:
    audit.system_prompt===ctx.systemPrompt||audit.system_prompt.startsWith(ctx.systemPrompt+'\n【本次重试校验反馈】');
}
function referencesCurrent(payload,previous,ctx){
  // New unrelated news/weather must not invalidate a reusable sentence. Cancelled or edited
  // referenced records must never remain on screen while waiting for the next generation.
  if(payload.intent==='reminder'&&(!ctx.preferences.enabled||ctx.quiet))return false;
  if(previous.generationPolicy&&previous.generationPolicy.promptKey!==ctx.input.generationPolicy.promptKey)return false;
  if(ordinary(payload))return true;
  return payload.references.every(id=>{
    if(id==='clock')return previous.clock.day===ctx.input.clock.day;
    if(id==='weather')return payload.intent!=='reminder'||ctx.preferences.cold;
    if(id==='profile')return (payload.intent!=='reminder'||ctx.preferences.family)&&JSON.stringify(previous.profile)===JSON.stringify(ctx.input.profile);
    for(const name of ['plans','agentMemory','news','info','reminders']){
      const before=previous[name]?.find(v=>v.id===id),after=ctx.input[name].find(v=>v.id===id);
      if(before)return !!after&&(payload.intent!=='reminder'||(name==='news'?ctx.preferences.news:ctx.preferences.family))&&JSON.stringify(stable(before))===JSON.stringify(stable(after));
    }
    return false;
  });
}
async function reusable(row,ctx,now){
  if(!row||!ordinary(JSON.parse(row.payload))&&row.expires<=now)return false;
  if((await latestRow())?.id!==row.id)return false;
  const audit=await db.one("SELECT * FROM pig_chat_audit WHERE turn_id=? AND kind='narration' AND status='ok' ORDER BY id DESC LIMIT 1",row.id);
  return !!audit&&samePrompt(audit,ctx)&&referencesCurrent(JSON.parse(row.payload),JSON.parse(audit.model_context),ctx);
}
async function decide(device,component,now=Date.now()){
  const ctx=await context(device,component,now);
  if(ctx.window.paused)return {paused:true,ctx};
  const old=await latestRow();
  // Audit is the durable generation clock, including failures and interrupted calls.
  // Context changes, expiry, slot transitions and process restarts cannot reset it.
  const last=await db.one("SELECT * FROM pig_chat_audit WHERE kind='narration' ORDER BY created DESC,id DESC LIMIT 1");
  const due=last?last.created+ctx.window.minutes*60000:now;
  if(last&&samePrompt(last,ctx)&&due>now){
    if(await reusable(old,ctx,now))return {row:{...old,review:due},ctx};
    if(old&&ordinary(JSON.parse(old.payload)))return {row:{...old,review:due},ctx,retained:true};
    return {waiting:true,nextReviewAt:due,ctx};
  }
  const settings=await api.settings();
  let correction='';
  for(let attempt=0;attempt<2;attempt++){
  const messages=[{role:'system',content:ctx.systemPrompt+correction},{role:'user',content:JSON.stringify(ctx.input)}];
  const auditId=randomUUID();
  await db.run(`INSERT INTO pig_chat_audit(attempt,created,scope,actor,ip,turn_id,message,kind,system_prompt,model_context,model)
    VALUES(?,?,'system:narration','猪猪气泡','',?,'自动生成气泡','narration',?,?,?)`,auditId,now,auditId,messages[0].content,messages[1].content,settings.provider+'/'+settings.model);
  try{
    const result=await api.generate(settings,messages,(s,m)=>p.jsonCompletion(s,m,1600),Math.ceil(JSON.stringify(messages).length*1.2)+1600);
    await db.run('UPDATE pig_chat_audit SET model_response=? WHERE attempt=?',result.raw??JSON.stringify(result.data),auditId);
    const decidedAt=Math.max(now,Date.now()),d=validate(result.data,ctx,now);
    // Reject changed referenced records, prompt revisions, cancellation and expiry during generation.
    const latest=await context(device,ctx.component,decidedAt);
    if(latest.window.paused||latest.input.generationPolicy.promptKey!==ctx.input.generationPolicy.promptKey||!referencesCurrent(d.payload,ctx.input,latest)||d.expires<=decidedAt)throw p.fault('上下文已变化，等待下一次生成',409);
    const row={id:randomUUID(),device:'*',component:'*',created:now,context:ctx.key,payload:JSON.stringify(d.payload),review:d.review,expires:d.expires};
    await db.run('INSERT INTO pig_narration VALUES(?,?,?,?,?,?,?,?)',...Object.values(row));
    await db.run("UPDATE pig_chat_audit SET status='ok',finished=?,reply=?,turn_id=? WHERE attempt=?",Date.now(),d.payload.speech,row.id,auditId);
    api.notify([]);
    return {row,ctx};
  }catch(e){
    await db.run("UPDATE pig_chat_audit SET status='failed',finished=?,error=?,model_response=CASE WHEN ?!='' THEN ? ELSE model_response END WHERE attempt=?",Date.now(),e.status?e.message:'生成失败',e.rawResponse||'',e.rawResponse||'',auditId);
    if(attempt===0&&e.status===502){
      correction='\n【本次重试校验反馈】上次输出未能通过校验：'+e.message+'。当前家庭当地时间为 '+ctx.input.clock.now+'。请重新生成完整JSON，所有时间必须晚于此刻，保持正确的当地日期和时区偏移。nextReviewAt与validUntil不能是过去；只引用本上下文实际提供的编号，并遵守免打扰及功能开关。';
      continue;
    }
    throw e;
  }
  }
}
async function feed(device,component,now=Date.now()){
  const bound=await api.boundPig(device,component);if(!bound.id)throw p.fault('猪猪组件未绑定',403);
  const config=await schedule.get(),window=schedule.state(config,now);
  const preferences={...bound.prefs,quiet:window.quiet,sound:bound.prefs.enabled&&bound.prefs.sound&&!window.quiet&&!window.paused};
  function response(row,retained=false,paused=false){
    const d=JSON.parse(row.payload),hold=ordinary(d);
    return {id:row.id,componentId:bound.id,speech:d.speech,action:d.action,intent:d.intent,urgency:d.urgency,
      retainUntilReplaced:hold,paused,validUntil:hold?row.review:row.expires,nextReviewAt:row.review,
      preferences:retained?{...preferences,sound:false}:preferences};
  }
  async function pausedResponse(boundary){
    const old=await latestRow();
    if(old&&ordinary(JSON.parse(old.payload)))return response({...old,review:boundary},true,true);
    return {paused:true,componentId:bound.id,nextReviewAt:boundary,preferences:{...preferences,sound:false}};
  }
  if(window.paused)return pausedResponse(window.boundary);
  const slot='shared';
  if(!flights.has(slot))flights.set(slot,decide(device,component,now).finally(()=>flights.delete(slot)));
  let decision;
  try{decision=await flights.get(slot);}catch(e){
    // A failed scheduled replacement does not erase an ordinary greeting. Never extend a reminder.
    const old=await latestRow();
    if(!old||!ordinary(JSON.parse(old.payload)))throw e;
    const last=await db.one("SELECT created FROM pig_chat_audit WHERE kind='narration' ORDER BY created DESC,id DESC LIMIT 1");
    return response({...old,review:(last?.created||now)+window.minutes*60000},true);
  }
  const {row,ctx,paused,waiting,nextReviewAt,retained}=decision;
  if(paused)return pausedResponse(ctx.window.boundary);
  if(waiting)return {waiting:true,componentId:bound.id,nextReviewAt,preferences:{...preferences,sound:false}};
  return response(row,retained);
}
async function claim(device,component,id,now=Date.now()){
  const ctx=await context(device,component,now);
  const checkedAt=Math.max(now,Date.now()),current=schedule.state(await schedule.get(),checkedAt);
  const row=await db.one("SELECT * FROM pig_narration WHERE id=? AND device='*' AND component='*'",id);
  if(current.paused||current.quiet!==ctx.quiet||current.slot!==ctx.window.slot||current.minutes!==ctx.window.minutes||!await reusable(row,ctx,checkedAt))throw p.fault('气泡已经失效',409);
  const changed=await db.run("INSERT OR IGNORE INTO pig_shared_delivery VALUES(?,?,?,?,'claimed')",id,device,component,now);
  const bound=await api.boundPig(device,component);
  return {accepted:!!changed,sound:bound.prefs.enabled&&bound.prefs.sound&&!ctx.quiet};
}
async function result(device,component,id,status){
  if(!['subtitle','spoken','interrupted'].includes(status))throw p.fault('无效播放结果');
  await api.boundPig(device,component);
  await db.run('UPDATE pig_shared_delivery SET result=? WHERE id=? AND device=? AND component=?',status,id,device,component);
  return {ok:true};
}
module.exports={install,prompt,interval,context,validate,feed,claim,result};
