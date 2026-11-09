/* Actual GLM output, synthetic family/weather/news, in-memory DB; simulated 30-minute clock. */
require('../setup');require('dotenv').config();
const assert=require('node:assert/strict');
const db=require('../../src/services/briefing/storage'),settings=require('../../src/dao/settingsDao');
const narrator=require('../../src/services/briefing/narrator'),schedule=require('../../src/services/briefing/narration-settings');
const weather=require('../../src/services/briefing/weather-context'),api=require('../../src/services/briefing/service');
const provider=require('../../src/services/briefing/providers'),{bindPig,setRules}=require('../pig-fixture');
(async()=>{
  await require('../../src/config/database').initDatabase();
  await settings.set('briefing.settings',{provider:'glm',model:'glm-5.3-flash',dailyCalls:-1,dailyTokens:-1});
  await db.run('UPDATE pig_household SET profile=?',JSON.stringify({memory:'测试家庭住苏州，早上八点出门，喜欢简短的关心。',zone:'Asia/Shanghai'}));
  await db.run("INSERT INTO devices(id,name,device_key) VALUES('cadence-live','隔离测试','test')");
  const component=await bindPig('cadence-live');await setRules(component,{enabled:true,cold:true,city:'苏州',family:true,quietFrom:'00:00',quietTo:'00:00'});
  await schedule.save({greetingSchedule:Array(12).fill(30),quietEnabled:false});
  let temp=15,news=[];
  weather.build=async()=>({status:'available',observations:[{city:'苏州',status:'fresh',tempC:temp,description:'晴'}],future:[]});
  api.newsCards=async()=>news;
  const original=provider.jsonCompletion;let calls=0;
  provider.jsonCompletion=async(...args)=>{calls++;return original(...args);};
  const start=Date.now();
  const first=await narrator.feed('cadence-live',component,start);
  assert.ok(first.id);assert.ok(Array.from(first.speech).length<=40);const initialCalls=calls;
  for(let i=1;i<30;i++){
    temp=15+i/10;news=[{id:'local-'+i,expires:start+7200000,payload:{title:'隔离测试资讯'+i}}];
    const d=await narrator.feed('cadence-live',component,start+i*60000);
    assert.ok(d.id===first.id||d.waiting);assert.equal(calls,initialCalls);
  }
  const next=await narrator.feed('cadence-live',component,start+1800000);
  assert.ok(next.id&&next.id!==first.id);assert.ok(Array.from(next.speech).length<=40);
  const rows=await db.all("SELECT created,reply FROM pig_chat_audit WHERE kind='narration' AND status='ok' ORDER BY created");
  assert.equal(rows.length,2);assert.equal(rows[1].created-rows[0].created,1800000);
  console.log(JSON.stringify({model:'glm-5.3-flash',successfulGreetings:rows.length,characters:rows.map(r=>Array.from(r.reply).length),intervalMinutes:30,changedContextPolls:29,earlyCalls:0,clock:'simulated',productionData:'untouched'}));
})().then(()=>process.exit(0),e=>{console.error(e.name,e.message);process.exit(1);});
