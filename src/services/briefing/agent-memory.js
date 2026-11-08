const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const db=require('./storage');
const p=require('./providers');
const file=()=>process.env.PIG_MEMORY_PATH || (process.env.NODE_ENV==='test'
  ? path.join(os.tmpdir(),'homesignage-memory-'+process.pid+'.md')
  : path.resolve('data/pig-agent-memory.md'));
async function install(exec) {
  await exec(`
    CREATE TABLE IF NOT EXISTS pig_agent_memory(id TEXT PRIMARY KEY,scope TEXT NOT NULL,text TEXT NOT NULL,
      starts INTEGER NOT NULL,expires INTEGER,revision INTEGER NOT NULL DEFAULT 1,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS pig_memory_audit(id INTEGER PRIMARY KEY,memory_id TEXT,op TEXT,at INTEGER,scope TEXT,turn_id TEXT,content TEXT);
    CREATE TABLE IF NOT EXISTS pig_memory_sweep(at INTEGER);
    DROP TRIGGER IF EXISTS pig_memory_expire;
    CREATE TRIGGER IF NOT EXISTS pig_memory_cleanup AFTER INSERT ON pig_memory_sweep BEGIN
      INSERT INTO pig_memory_audit(memory_id,op,at,scope,content)
        SELECT id,'expire',NEW.at,scope,json_object('text',text,'expires',expires) FROM pig_agent_memory WHERE expires<=NEW.at;
      DELETE FROM pig_agent_memory WHERE expires<=NEW.at;
      DELETE FROM pig_memory_sweep;
    END;
    DROP TRIGGER IF EXISTS pig_memory_turn;
    CREATE TRIGGER pig_memory_turn AFTER INSERT ON pig_conversation WHEN NEW.memory_actions!='[]' BEGIN
      SELECT RAISE(ABORT,'pig_memory_conflict') FROM json_each(NEW.memory_actions) a
        WHERE a.value->>'$.op' IN ('update','forget') AND NOT EXISTS(
          SELECT 1 FROM pig_agent_memory m WHERE m.id=a.value->>'$.id' AND m.scope=NEW.scope AND m.revision=a.value->>'$.revision');
      INSERT INTO pig_agent_memory(id,scope,text,starts,expires,created)
        SELECT value->>'$.id',NEW.scope,value->>'$.text',value->>'$.starts',value->>'$.expires',NEW.created
        FROM json_each(NEW.memory_actions) WHERE value->>'$.op'='remember';
      UPDATE pig_agent_memory SET text=a.value->>'$.text',starts=a.value->>'$.starts',expires=a.value->>'$.expires',revision=revision+1
        FROM json_each(NEW.memory_actions) a WHERE a.value->>'$.op'='update' AND pig_agent_memory.id=a.value->>'$.id';
      DELETE FROM pig_agent_memory WHERE id IN (SELECT value->>'$.id' FROM json_each(NEW.memory_actions) WHERE value->>'$.op'='forget');
      INSERT INTO pig_memory_audit(memory_id,op,at,scope,turn_id,content)
        SELECT value->>'$.id',value->>'$.op',NEW.created,NEW.scope,NEW.id,value FROM json_each(NEW.memory_actions);
      UPDATE pig_household SET revision=revision+1 WHERE id=1;
    END;`);
}
let writing=Promise.resolve();
function project() {
  const next=writing.catch(()=>{}).then(async()=>{
    const rows=await db.all('SELECT * FROM pig_agent_memory ORDER BY starts,id');
    const content='# 猪猪伙伴的独立记忆\n\n由聊天管理；到期自动移除。此文件是数据库的可读镜像，请通过聊天修改。审计另行保留。\n\n'+rows.map(r=>
      '## '+r.id+'\n\n'+r.text+'\n\n- 生效：'+new Date(r.starts).toISOString()+'\n- 到期：'+(r.expires?new Date(r.expires).toISOString():'长期')+'\n').join('\n');
    const target=file();
    await fs.mkdir(path.dirname(target),{recursive:true});
    const temp=target+'.'+randomUUID()+'.tmp';
    await fs.writeFile(temp,content,{mode:0o600});
    await fs.rename(temp,target);
  });
  writing=next;return next;
}
async function prune(now=Date.now()) {
  const removed=(await db.one('SELECT count(*) AS n FROM pig_agent_memory WHERE expires<=?',now)).n;
  if(removed)await db.run('INSERT INTO pig_memory_sweep VALUES(?)',now);
  if(removed)await project();
  return removed;
}
async function list(now=Date.now(),scope) {
  await prune(now);
  return scope===undefined?db.all('SELECT * FROM pig_agent_memory ORDER BY starts,id'):
    db.all('SELECT * FROM pig_agent_memory WHERE scope=? ORDER BY starts,id',scope);
}
function onlyMemory(message) {
  return /(?:不要|不希望|无需|别|不需要).{0,15}(?:系统|定时|信息列表)|(?:只|仅).{0,12}(?:你自己|自己记|你的记忆|猪猪记忆)|(?:独立|临时)记忆/.test(message);
}
function prepare(actions,message,rows,now) {
  if(!Array.isArray(actions)||actions.length>6)throw p.fault('猪猪记忆操作格式无效',502);
  return actions.map(a=>{
    if(!a||!['remember','update','forget'].includes(a.op)||typeof a.basis!=='string'||a.basis.trim().length<2||!message.includes(a.basis))
      throw p.fault('猪猪记忆缺少本条消息的依据',502);
    const old=rows.find(r=>r.id===a.id);
    if(a.op==='remember'&&rows.length&&['update','cancel'].includes(require('./owned-records').requestMode(message)))throw p.fault('修改或取消记忆必须使用原编号，未创建新记忆',409);
    if(a.op!=='remember'&&!old)throw p.fault('这条猪猪记忆不存在或无权修改',409);
    if(a.op==='forget')return {op:a.op,id:old.id,revision:old.revision,before:{text:old.text,starts:old.starts,expires:old.expires}};
    const text=a.text??old?.text;
    if(typeof text!=='string'||!text.trim()||text.length>1500)throw p.fault('猪猪记忆内容无效',502);
    const parse=(v)=>typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
    let starts=a.start===undefined?(old?.starts??now):parse(a.start);
    let expires=a.end===undefined?old?.expires??null:a.end===null?null:parse(a.end);
    if(old){
      const shift=require('./actions').minuteShift(message);
      const startUnchanged=/(开始|起始)(?:时间)?(?:保持)?不变/.test(message);
      const endUnchanged=/(到期|结束)(?:时间)?(?:保持)?不变/.test(message);
      if(shift!==null){
        starts=startUnchanged?old.starts:old.starts+shift*60000;
        expires=endUnchanged||old.expires===null?old.expires:old.expires+shift*60000;
      }
      if(startUnchanged)starts=old.starts;if(endUnchanged)expires=old.expires;
    }
    if(!Number.isFinite(starts)||(expires!==null&&(!Number.isFinite(expires)||expires<=now||expires<=starts)))
      throw p.fault('临时记忆的有效时段不明确，请补充时间',502);
    if(a.temporary===true&&expires===null)throw p.fault('临时记忆需要到期时间',502);
    return {op:a.op,id:old?.id??randomUUID(),revision:old?.revision,text:text.trim(),starts,expires,...(old?{before:{text:old.text,starts:old.starts,expires:old.expires}}:{})};
  });
}
const prompt='你还拥有独立的 agentMemory（与 profile.memory 家庭资料不同）。用户让你自己记住、自己在气泡中提醒，不要系统提醒时，只操作 memoryActions，actions/add/remove 必须为空，不创建系统定时提示或信息列表。普通提醒未指定渠道时优先保存在独立记忆；只有明确要求系统定时提示或信息列表才使用 actions。'+
  '用户可查看、修改、取消自己的记忆；修改必须用原 id，不能重复新增；不明确指向哪条时询问。历史已到期记忆不可恢复，只有当前用户重新要求才新增。'+
  '相对日期按 now 和 profile.zone 解析。临时事项必须 temporary=true 并给出 start/end（带时区偏移ISO），到期自动删除。例如明早没有具体时间，使用次日06:00到12:00；明确出门时间或作息时结合资料。长期事实可 temporary=false/end=null。'+
  '额外返回 memoryActions 数组，元素 {op:"remember|update|forget",id:"修改删除用原id",basis:"逐字引用本条用户消息",text:"记住的事项",temporary:true,start:"含时区ISO",end:"含时区ISO或null"}；无操作返回空数组。成功答复区分记入自己的记忆与创建系统记录，提醒依赖在线屏幕和可用模型，不承诺精确闹钟。';
function clock(ms,zone){
  const {day,time}=require('./rules').localTime(ms,zone);
  const offset=(Date.parse(day+'T'+time+':00Z')-Math.floor(ms/60000)*60000)/60000;
  const pad=v=>String(v).padStart(2,'0');
  return day+'T'+time+':00'+(offset>=0?'+':'-')+pad(Math.floor(Math.abs(offset)/60))+':'+pad(Math.abs(offset)%60);
}
function context(rows,now,zone='Asia/Shanghai'){return rows.map(r=>({...r,startAt:clock(r.starts,zone),expiresAt:r.expires?clock(r.expires,zone):null,state:now>=r.starts?'active':'upcoming'}));}
module.exports={install,file,project,prune,list,onlyMemory,prepare,prompt,context};
