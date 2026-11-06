const db=require('../src/services/briefing/storage');
const rules=require('../src/services/briefing/rules');
async function bindPig(device,scene=device+'-scene') {
  await db.run("INSERT OR IGNORE INTO scenes(id,name) VALUES(?,?)",scene,scene);
  const id=scene+'-pig';
  await db.run("INSERT OR IGNORE INTO components(id,scene_id,type,position,config) VALUES(?,?,'companion','{}','{}')",id,scene);
  await db.run("INSERT OR IGNORE INTO device_scenes(device_id,scene_id) VALUES(?,?)",device,scene);
  return id;
}
async function setRules(id,fields) {
  const c=await db.one('SELECT config FROM components WHERE id=?',id);
  const config=JSON.parse(c.config);
  config.reminders=rules.component({...config.reminders,...fields});
  await db.run('UPDATE components SET config=? WHERE id=?',JSON.stringify(config),id);
}
module.exports={bindPig,setRules};
