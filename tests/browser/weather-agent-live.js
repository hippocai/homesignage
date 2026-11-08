/* Real provider + GLM acceptance. Only opens a disposable copy of a consistent backup. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
if(!process.env.PIG_CONTEXT_SNAPSHOT || !path.isAbsolute(process.env.PIG_CONTEXT_SNAPSHOT))throw Error('Require absolute consistent SQLite backup path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'homesignage-weather-test-'));fs.chmodSync(dir,0o700);
process.env.SQLITE_PATH=path.join(dir,'test.db');fs.copyFileSync(process.env.PIG_CONTEXT_SNAPSHOT,process.env.SQLITE_PATH);
process.env.NODE_ENV='test';process.env.LOG_LEVEL='error';process.env.FILE_REPO_PATH=path.join(dir,'files');
const db=require('../../src/services/briefing/storage'),household=require('../../src/services/briefing/household');
const agent=require('../../src/services/briefing/weather-agent'),future=require('../../src/services/briefing/future-weather'),api=require('../../src/services/briefing/service');
const fixture=require('../pig-fixture');
const report={runAt:new Date().toISOString(),database:'disposable copy',checks:[]};
const pass=(name,details={})=>{report.checks.push({name,passed:true,...details});console.log('PASS '+name);};
async function run(){
  await require('../../src/config/database').initDatabase();
  let now=Date.now();const iso=t=>new Date(t).toISOString();
  const rows=await db.all("SELECT config FROM components WHERE type='companion' AND json_extract(config,'$.reminders.cold')=1 LIMIT 1");
  const city=JSON.parse(rows[0].config).reminders.city;
  const live=await future.get({city},now);
  assert.equal(live.daily.status,'fresh');assert.equal(live.hourly.status,'fresh');assert.equal(live.alerts.status,'fresh');
  assert.ok(live.daily.items.length>=7);assert.ok(live.hourly.items.length>=47);
  pass('real-weather-apis',{city,daily:live.daily.items.length,hourly:live.hourly.items.length,alerts:live.alerts.items.map(a=>({id:a.id,issuer:a.issuer,title:a.title,start:a.start,end:a.end,messageType:a.messageType}))});
  // Actual household and actual weather are evaluated in the disposable database only.
  await agent.tick(now);
  pass('real-household-analysis',{generated:(await db.one("SELECT count(*) AS n FROM briefing_events WHERE state='published' AND json_extract(payload,'$.weatherAgent')=1")).n});
  // Deterministic weather scenario; model remains the real configured GLM throughout.
  const today=require('../../src/services/briefing/rules').localTime(now,'Asia/Shanghai').day;
  const next=n=>new Date(Date.parse(today+'T12:00Z')+n*86400000).toISOString().slice(0,10);
  const start=Date.parse(next(1)+'T08:00+08:00'),end=Date.parse(next(1)+'T18:00+08:00');
  // Run the scenario 30 minutes before departure; the model may legitimately defer a late-night reminder.
  now=start-30*60000;
  const memory='常住江苏苏州市，每天早上8点骑车经过青禾路上班。';
  const provider=require('../../src/services/briefing/providers'),original=provider.jsonCompletion;
  provider.jsonCompletion=async(...args)=>{const result=await original(...args);const input=JSON.parse(args[1][1].content);
    if(input.profile?.memory===memory)report.syntheticModelOutput=result.data;return result;};
  const plans=[{id:'weather-test-trip',text:next(1)+'到'+next(2)+'去北京市旅游，在户外步行游览。',start:next(1),end:next(2)}];
  await db.run('UPDATE pig_household SET profile=?,plans=?,revision=revision+1',JSON.stringify({memory,zone:'Asia/Shanghai'}),JSON.stringify(plans));
  await db.run("INSERT INTO devices(id,name,device_key) VALUES('weather-live-screen','隔离天气测试屏','fixture-only')");
  const component=await fixture.bindPig('weather-live-screen');await fixture.setRules(component,{enabled:true,cold:true,city:'苏州',quietFrom:'00:00',quietTo:'00:00',weekdays:false,gap:0});
  const d=(await api.boundPig('weather-live-screen',component)).prefs,h=await household.household();
  const section=items=>({status:'fresh',source:'QWeather测试场景',fetchedAt:iso(now),items,attributions:[]});
  const home={city:'苏州',scopes:['memory'],daily:section([{start:today+'T00:00+08:00',end:next(1)+'T00:00+08:00',highC:22,lowC:16},{start:next(1)+'T00:00+08:00',end:next(2)+'T00:00+08:00',highC:12,lowC:6}]),
    hourly:section([{time:iso(start),tempC:8,rainPercent:90,rainMm:3,windMs:4,gustMs:6}]),alerts:section([])};
  const warning={id:'fixture-official',issuer:'测试气象台',event:'大风',title:'测试：北京大风橙色预警',description:'预计明天白天北京出现强阵风，户外步行请注意避开临时搭建物。',issued:iso(now),start:iso(now),onset:iso(start),end:iso(end),messageType:'alert',severity:'severe',color:'orange',supersedes:[]};
  const travel={city:'北京',scopes:['weather-test-trip'],daily:section([]),hourly:section([]),alerts:section([warning])};
  await agent.analyzeComponent(component,['weather-live-screen'],d,h,[home,travel],now);
  const data=await api.feed('weather-live-screen',now,component);
  assert.ok(data.tasks.some(x=>x.payload.scope==='memory'),'Real model must associate commute forecast');
  assert.ok(data.tasks.some(x=>x.payload.scope==='weather-test-trip'),'Real model must associate travel warning');
  pass('glm-commute-and-trip',{tasks:data.tasks.map(x=>({id:x.id,scope:x.payload.scope,officialId:x.payload.officialId,starts:x.starts,expires:x.expires}))});
  const selected=data.tasks[0];await api.claim('weather-live-screen',selected.id,selected.edition,now,1,component);await api.result('weather-live-screen',selected.id,selected.edition,'subtitle',1,component);
  assert.equal((await db.one('SELECT result FROM briefing_claims WHERE event=?',selected.id)).result,'subtitle');pass('screen-claim-and-receipt');
  const before=await db.all("SELECT id,edition FROM briefing_events WHERE json_extract(payload,'$.component')=? ORDER BY id",component);
  await agent.analyzeComponent(component,['weather-live-screen'],d,h,[home,travel],now+1000);
  assert.deepEqual(await db.all("SELECT id,edition FROM briefing_events WHERE json_extract(payload,'$.component')=? ORDER BY id",component),before);pass('stable-reminders-no-duplicates');
  await db.run("UPDATE pig_household SET plans='[]',revision=revision+1");
  assert.equal((await api.feed('weather-live-screen',now,component)).tasks.length,0);pass('canceled-trip-invalidates-queued-context');
  travel.alerts=section([{...warning,id:'fixture-cancel',messageType:'cancel',supersedes:['fixture-official']}]);
  await agent.analyzeComponent(component,['weather-live-screen'],d,await household.household(),[travel],now);
  const active=await db.all("SELECT payload FROM briefing_events WHERE state='published' AND json_extract(payload,'$.component')=?",component);
  assert.equal(active.length,0);pass('official-cancellation-withdraws-warning');
}
run().then(()=>{report.passed=true;},e=>{report.passed=false;report.error={type:e.name,code:e.code||'',message:e.name==='AssertionError'?e.message.split('\n')[0]:'live acceptance failed'};console.error(report.error);process.exitCode=1;}).finally(async()=>{
  if(process.env.PIG_CONTEXT_REPORT)fs.writeFileSync(process.env.PIG_CONTEXT_REPORT,JSON.stringify(report,null,2),{mode:0o600});
  await new Promise(resolve=>require('../../src/config/database').db.close(resolve));
  if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('homesignage-weather-test-'))throw Error('Unexpected test directory');
  fs.rmSync(dir,{recursive:true,force:true});process.exit(process.exitCode||0);
});
