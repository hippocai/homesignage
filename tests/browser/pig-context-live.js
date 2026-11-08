/* Real-model context evidence against a SQLite backup. Always makes a disposable copy.
   PIG_CONTEXT_SNAPSHOT=/absolute/backup.db PIG_CONTEXT_REPORT=/absolute/report.json node ...
   The report contains fingerprints and counts, never household text, chat text or API keys. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto');
const snapshot=process.env.PIG_CONTEXT_SNAPSHOT;
if(!snapshot || !path.isAbsolute(snapshot))throw Error('Provide an absolute path to a consistent SQLite backup');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'homesignage-context-'));
fs.chmodSync(directory,0o700);
process.env.SQLITE_PATH=path.join(directory,'test.db');
fs.copyFileSync(snapshot,process.env.SQLITE_PATH);
process.env.NODE_ENV='test';process.env.LOG_LEVEL='error';
process.env.FILE_REPO_PATH=path.join(directory,'files');
const db=require('../../src/services/briefing/storage');
const household=require('../../src/services/briefing/household');
const providers=require('../../src/services/briefing/providers');
const settings=require('../../src/services/briefing/service');
const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const report={runAt:new Date().toISOString(),database:'disposable copy',cases:[]};
async function run(){
  await require('../../src/config/database').initDatabase();
  const h=await household.household(),model=await settings.settings();
  report.model={provider:model.provider,model:model.model};
  report.memory={characters:h.profile.memory.length,sha256:digest(h.profile.memory)};
  assert.ok(h.profile.memory.trim(),'Saved memory must exist for this acceptance');
  // Warm the existing weather provider/cache before model calls; no test weather is substituted.
  const configured=await db.all("SELECT DISTINCT c.config FROM components c JOIN device_scenes ds ON ds.scene_id=c.scene_id WHERE c.type='weather' AND ds.enabled=1");
  const locations=new Map(configured.map(row=>{const c=JSON.parse(row.config);return [c.locationId||c.city,{city:c.city,locationId:c.locationId||null}];}));
  await Promise.all([...locations.values()].slice(0,4).map(v=>require('../../src/services/weatherService').getWeather(v)));
  const original=providers.jsonCompletion;
  let captured;
  providers.jsonCompletion=async(s,m,...rest)=>{
    const input=JSON.parse(m[1].content);
    const chat=typeof input.message==='string' && !!input.profile;
    if(chat)captured={input,system:m[0].content};
    const result=await original(s,m,...rest);
    if(chat) {
      assert.equal((result.data.add||[]).length,0,'Read-only prompt cannot add plans');
      assert.equal((result.data.remove||[]).length,0,'Read-only prompt cannot remove plans');
      assert.equal((result.data.actions||[]).length,0,'Read-only prompt cannot propose record actions');
    }
    return result;
  };
  async function verify(id,message,check,scope='admin'){
    captured=null;
    const turn=await household.chat({message,requestId:'context-'+randomUUID()},Date.now(),{scope,name:'隔离上下文验收',ip:'127.0.0.1'});
    assert.ok(captured,'Must reach actual provider boundary');
    const input=captured.input;
    assert.equal(input.profile.memory,h.profile.memory,'Full stored memory equals model payload');
    check(input,turn.reply);
    report.cases.push({id,passed:true,memoryEqualsStored:true,memorySha256:digest(input.profile.memory),
      weather:input.weather,newsCoverage:input.newsCoverage,
      newsIds:input.news.map(v=>v.id),newsPayloadSha256:digest(input.news),
      payloadSha256:digest(input),replySha256:digest(turn.reply),replyChecksPassed:true});
    console.log('PASS '+id+': context equality and real model reply verified');
  }
  const lines=h.profile.memory.split(/\r?\n/).filter(v=>v.trim() && !v.trim().startsWith('#'));
  const first=lines[0] || h.profile.memory;
  for(const scope of ['admin','context-guest'])await verify('memory-'+scope,
    '这是只读核对，不新增或修改任何计划。请逐字复述已保存的家庭基础资料中第一条非标题、非空行，保留原文文字和标点，不要概括。',
    (input,reply)=>assert.ok(reply.includes(first.trim()),'Reply quotes the saved memory line'),scope);
  await verify('weather',
    '只读核对天气上下文，不改计划。请按原始字段值回答weather.observations第一条可用观测的city、status、tempC、fetchedAt，并列出weather.forecasts第一条可用预报的city、day、todayHighC、yesterdayForecastHighC。明确实时温度和最高温预报不同；没有可用数据就说缺失，不猜测。',
    (input,reply)=>{
      const obs=input.weather.observations.find(v=>v.status==='fresh');
      const forecast=input.weather.forecasts.find(v=>v.status==='available');
      assert.ok(obs || forecast,'Actual weather must be available');
      if(obs)for(const v of [obs.city,obs.tempC,obs.fetchedAt])assert.ok(reply.includes(String(v)),'Reply uses actual observation');
      if(forecast)for(const v of [forecast.city,forecast.todayHighC,forecast.day])assert.ok(reply.includes(String(v)),'Reply uses actual forecast');
    });
  await verify('news',
    '只读核对资讯，不改计划。请逐字列出当前上下文news中第一条资讯的id、标题和source，并依据我的家庭资料说明该条是否有明确生活影响；没有具体关联就明确说没有依据，不要牵强关联。',
    (input,reply)=>{
      assert.ok(input.news.length,'Actual published news must exist');
      for(const v of [input.news[0].id,input.news[0].title,input.news[0].source])assert.ok(reply.includes(v),'Reply references an actual supplied article');
    });
  const after=await household.household();
  assert.equal(after.profile.memory,h.profile.memory);
  assert.deepEqual(after.plans,h.plans);
  report.readOnlyConversation=true;
}
run().then(()=>{report.passed=true;},error=>{
  report.passed=false;report.error=error.name+': '+(error.code||'acceptance failed');
  console.error('FAIL '+report.error);process.exitCode=1;
}).finally(async()=>{
  if(process.env.PIG_CONTEXT_REPORT)fs.writeFileSync(process.env.PIG_CONTEXT_REPORT,JSON.stringify(report,null,2),{mode:0o600});
  await new Promise(resolve=>require('../../src/config/database').db.close(resolve));
  if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('homesignage-context-'))throw Error('Unexpected test directory');
  fs.rmSync(directory,{recursive:true,force:true});
  process.exit(process.exitCode||0);
});
