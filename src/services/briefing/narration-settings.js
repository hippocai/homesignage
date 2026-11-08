const db=require('./storage'),rules=require('./rules'),{fault}=require('./providers');
const key='pig.narrationSettings';
async function get(){
  const [saved,legacy,household,component]=await Promise.all([
    db.one('SELECT value FROM settings WHERE key=?',key),db.one("SELECT value FROM settings WHERE key='pig.greetingMinutes'"),
    db.one('SELECT profile FROM pig_household WHERE id=1'),db.one("SELECT c.config FROM components c JOIN device_scenes ds ON ds.scene_id=c.scene_id WHERE ds.enabled=1 AND c.type='companion' ORDER BY c.id LIMIT 1")
  ]);
  const minutes=legacy?JSON.parse(legacy.value):5;
  const old=component?JSON.parse(component.config).reminders||{}:{};
  const value={greetingSchedule:Array(12).fill(Number.isInteger(minutes)?Math.min(120,Math.max(1,minutes)):5),quietEnabled:true,
    quietFrom:old.quietFrom||'22:00',quietTo:old.quietTo||'07:00',...(saved?JSON.parse(saved.value):{})};
  return {...value,zone:JSON.parse(household?.profile||'{}').zone||'Asia/Shanghai'};
}
async function save(input){
  const patch={};
  if(input.greetingMinutes!==undefined){rules.int(input.greetingMinutes,1,120,'生成间隔');patch.greetingSchedule=Array(12).fill(input.greetingMinutes);}
  if(input.greetingSchedule!==undefined){
    if(!Array.isArray(input.greetingSchedule)||input.greetingSchedule.length!==12||input.greetingSchedule.some(v=>!Number.isInteger(v)||v<0||v>120))throw fault('请填写12个时段，每段为0–120整数分钟');
    patch.greetingSchedule=input.greetingSchedule;
  }
  if(input.quietEnabled!==undefined){if(typeof input.quietEnabled!=='boolean')throw fault('免打扰开关必须为布尔值');patch.quietEnabled=input.quietEnabled;}
  for(const k of ['quietFrom','quietTo'])if(input[k]!==undefined){if(typeof input[k]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input[k]))throw fault('免打扰时间应为 HH:mm');patch[k]=input[k];}
  if(!Object.keys(patch).length)return get();
  const {zone,...defaults}=await get();
  await db.run(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=json_patch(settings.value,?),updated_at=CURRENT_TIMESTAMP`,key,JSON.stringify({...defaults,...patch}),JSON.stringify(patch));
  require('./service').notify([]);return get();
}
function state(config,now){
  const local=rules.localTime(now,config.zone),slot=Math.floor(Number(local.time.slice(0,2))/2);
  const quietAt=t=>config.quietEnabled&&rules.between(t,config.quietFrom,config.quietTo);
  const quiet=quietAt(local.time),minutes=config.greetingSchedule[slot];
  let boundary=Math.floor(now/60000)*60000+240*60000;
  // Use local clock boundaries, including DST and cross-midnight quiet periods.
  for(let i=1;i<=240;i++){
    const next=Math.floor(now/60000)*60000+i*60000,t=rules.localTime(next,config.zone);
    if(t.day!==local.day||Math.floor(Number(t.time.slice(0,2))/2)!==slot||quietAt(t.time)!==quiet){boundary=next;break;}
  }
  return {slot,minutes,quiet,paused:minutes===0,boundary,day:local.day};
}
module.exports={get,save,state};
