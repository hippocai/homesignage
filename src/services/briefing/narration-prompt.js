const fs=require('node:fs'),path=require('node:path');
const db=require('./storage'),{fault}=require('./providers');
const key='pig.narrationPrompt';
function defaultPrompt(){return fs.readFileSync(path.join(__dirname,'../../prompts/pig-screen-system.md'),'utf8');}
function speechLimit(prompt){
  const matches=[...prompt.matchAll(/^\s*speechMaxChars\s*[:：=]\s*(\d+)\s*$/gm)];
  if(matches.length>1)throw fault('System prompt 中 speechMaxChars 只能配置一次');
  const limit=matches.length?Number(matches[0][1]):40;
  if(!Number.isInteger(limit)||limit<1||limit>180)throw fault('speechMaxChars 必须为1–180整数');
  if(/speechMaxChars\s*[:：=]/.test(prompt)&&!matches.length)throw fault('请单独一行填写 speechMaxChars: 40（1–180整数）');
  return limit;
}
async function get(){
  const row=await db.one('SELECT value FROM settings WHERE key=?',key);
  const saved=row?JSON.parse(row.value):{prompt:null,revision:0};
  const standard=defaultPrompt();
  return {prompt:saved.prompt??standard,defaultPrompt:standard,isDefault:saved.prompt===null,revision:saved.revision};
}
async function save(input){
  if(!Number.isSafeInteger(input?.revision)||input.revision<0)throw fault('请载入当前提示词版本');
  if(input.reset!==undefined&&typeof input.reset!=='boolean')throw fault('恢复默认参数无效');
  if(!input.reset&&(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>20000))throw fault('System prompt 必须为1–20000个字符');
  if(!input.reset)speechLimit(input.prompt);
  const value=JSON.stringify({prompt:input.reset?null:input.prompt,revision:input.revision+1});
  const changed=await db.run(`INSERT INTO settings(key,value) SELECT ?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM settings WHERE key=?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP
    WHERE json_extract(settings.value,'$.revision')=?`,key,value,input.revision,key,input.revision);
  if(!changed)throw fault('提示词已被修改，请重新载入后核对你的草稿',409);
  require('./service').notify([]);
  return get();
}
module.exports={get,save,defaultPrompt,speechLimit};
