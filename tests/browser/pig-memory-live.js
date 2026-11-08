/* Real GLM, isolated in-memory DB and controlled weather/news fixtures. Never writes production records. */
require('../setup');require('dotenv').config();
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const db=require('../../src/services/briefing/storage');
const h=require('../../src/services/briefing/household');
const memory=require('../../src/services/briefing/agent-memory');
const narrator=require('../../src/services/briefing/narrator');
const settings=require('../../src/dao/settingsDao');
const weather=require('../../src/services/briefing/weather-context');
const {bindPig,setRules}=require('../pig-fixture');
const p=require('../../src/services/briefing/providers');
async function run(){
  await require('../../src/config/database').initDatabase();
  await settings.set('briefing.settings',{provider:'glm',model:'glm-5.3-flash',dailyCalls:-1,dailyTokens:-1});
  await db.run('UPDATE pig_household SET profile=?',JSON.stringify({memory:'常住苏州，早上8点出门。',zone:'Asia/Shanghai'}));
  await db.run("INSERT INTO devices(id,name,device_key) VALUES('isolated','隔离测试','key')");
  const component=await bindPig('isolated');await setRules(component,{enabled:true,cold:true,city:'苏州',family:true,quietFrom:'00:00',quietTo:'00:00'});
  weather.build=async()=>({status:'available',observations:[{city:'苏州',status:'fresh',tempC:18,description:'晴'}],future:[]});
  const now=Date.now();
  const send=(message,time=now)=>h.chat({message,requestId:randomUUID()},time);
  await send('明天早上提醒我出门拿红包，不要在系统中创建提醒，只记在你自己的记忆里，明天中午就忘记。');
  const first=(await memory.list(now))[0];assert.ok(first&&first.text.includes('红包'));
  assert.equal(new Date(first.expires+8*3600000).getUTCHours(),12);
  assert.equal((await db.all('SELECT * FROM timed_reminders')).length,0);
  assert.equal((await db.all('SELECT * FROM info_items')).length,0);
  console.log('PASS real GLM: memory-only creation, tomorrow noon expiry, no system rows');
  await send('把刚才猪猪自己记住的拿红包事项推迟半小时，到期时间不变。');
  const updated=(await memory.list(now))[0];assert.equal(updated.id,first.id);assert.equal(updated.starts,first.starts+1800000);assert.equal(updated.expires,first.expires);
  console.log('PASS real GLM: update same memory ID, no duplicate');
  const morning=updated.starts+90*60000;
  // Real narrator request; capture payload at the actual provider boundary.
  const original=p.jsonCompletion;let captured;
  p.jsonCompletion=async(s,m,...rest)=>{captured=m;return original(s,m,...rest);};
  const bubble=await narrator.feed('isolated',component,morning);
  assert.match(bubble.speech,/红包/);
  const input=JSON.parse(captured[1].content);assert.ok(input.profile.memory.includes('苏州'));assert.equal(input.agentMemory[0].id,first.id);assert.ok(input.weather.observations.length);
  assert.equal((await db.one("SELECT status FROM pig_chat_audit WHERE kind='narration'")).status,'ok');
  assert.ok((await db.one("SELECT model_response FROM pig_chat_audit WHERE kind='narration'")).model_response.includes('红包'));
  console.log('PASS real GLM: autonomous bubble reads own memory and full prompt/response audit');
  await memory.prune(updated.expires);assert.equal((await memory.list(updated.expires)).length,0);assert.ok(!(await fs.readFile(memory.file(),'utf8')).includes('红包'));
  console.log('PASS: expiry removes active memory and Markdown, audit retained');
  console.log('All live checks passed. Production data untouched.');
}
run().then(()=>process.exit(0),e=>{console.error('FAIL',e.name,e.code||'',e.message);process.exit(1);});
