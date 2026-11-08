const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../client/js/briefing-runtime.js'),'utf8');
const flush=()=>new Promise(r=>setImmediate(r));
function setup({sound=false,unlocked=true,blocked=false,delayClaim=false}={}){
  const el={dataset:{componentId:'pig'}},data={id:'decision',componentId:'pig',speech:'出门记得拿红包哦。',action:'wave',validUntil:Date.now()+300000,preferences:{sound,volume:0.4}};
  const timers=new Map(),results=[],renderer={pig:jest.fn(),cards:jest.fn(),disposeCards:jest.fn(),disposePig:jest.fn()};
  let voice,resolveClaim,claims=0,fail=false;
  const speak=jest.fn(v=>{voice=v;}),cancel=jest.fn();
  const ctx={window:{speechSynthesis:{speak,cancel},SpeechSynthesisUtterance:true},SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},Date,Promise,
    CONFIG:{SERVER_URL:'http://localhost'},deviceId:'test',deviceKey:'key',document:{hidden:false},activeEmergency:blocked,audioUnlocked:unlocked,reminderPool:{},state:'NORMAL',
    sceneLayers:[{contains:n=>n===el,classList:{contains:()=>true}}],currentSceneIndex:0,HomeBriefing:renderer,
    setInterval:()=>1,clearInterval:()=>{},setTimeout:(fn,ms)=>{const id=Symbol();timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    fetch:async(url,opts)=>{let response;
      if(url.endsWith('/news'))response={cards:[]};
      else if(url.includes('/narration?')){if(fail)return {ok:false,status:503};response={...data};}
      else if(url.endsWith('/claim')){claims++;if(delayClaim)await new Promise(r=>{resolveClaim=r;});response={accepted:true,sound};}
      else{results.push(JSON.parse(opts.body).result);response={ok:true};}
      return {ok:true,json:async()=>({data:response})};
    }};
  vm.runInNewContext(source,ctx);const runtime=ctx.briefingRuntime;runtime.mount(el,{},'companion');
  return {runtime,ctx,renderer,results,timers,speak,cancel,data,claims:()=>claims,voice:()=>voice,confirmClaim:()=>resolveClaim(),fail:()=>{fail=true;}};
}
test('模型字幕持续显示，没有短暂播完回到固定问候',async()=>{
  const f=setup();f.runtime.sync();await flush();expect(f.renderer.pig.mock.calls.at(-1)[2]).toBe(f.data.speech);
  expect(f.results).toEqual(['subtitle']);expect(f.speak).not.toHaveBeenCalled();
  expect([...f.timers.values()].some(t=>t.ms>290000)).toBe(true);
});
test('按音量朗读；结束回执且气泡继续显示',async()=>{
  const f=setup({sound:true});f.runtime.sync();await flush();const v=f.voice();
  expect(v).toMatchObject({lang:'zh-CN',volume:0.4,text:f.data.speech});v.onend();v.onend();await flush();
  expect(f.results).toEqual(['subtitle','spoken']);expect(f.renderer.pig.mock.calls.at(-1)[2]).toBe(f.data.speech);
});
test('同一模型决策轮询复用，不重复朗读或领取',async()=>{
  const f=setup({sound:true});f.runtime.sync();await flush();f.runtime.sync();await flush();
  expect(f.claims()).toBe(1);expect(f.speak).toHaveBeenCalledTimes(1);
});
test('未解锁声音时仅字幕',async()=>{
  const f=setup({sound:true,unlocked:false});f.runtime.sync();await flush();expect(f.speak).not.toHaveBeenCalled();expect(f.results).toEqual(['subtitle']);
});
test('紧急插播和非当前场景不领取',async()=>{
  const f=setup({blocked:true});f.runtime.sync();await flush();expect(f.claims()).toBe(0);
  f.ctx.activeEmergency=false;f.ctx.currentSceneIndex=1;f.runtime.scene();await flush();expect(f.claims()).toBe(0);
});
test('领取途中卸载，迟到响应不会发声',async()=>{
  const f=setup({sound:true,delayClaim:true});f.runtime.sync();await flush();f.runtime.reset();f.confirmClaim();await flush();
  expect(f.speak).not.toHaveBeenCalled();expect(f.results).toEqual(['interrupted']);
  expect(f.renderer.disposePig).toHaveBeenCalledTimes(1);
});
test('模型失败清除旧提醒，显示明确状态而非伪造问候',async()=>{
  const f=setup({sound:true});f.runtime.sync();await flush();f.fail();f.runtime.sync();await flush();
  expect(f.cancel).toHaveBeenCalled();expect(f.renderer.pig.mock.calls.at(-1)[2]).toContain('模型暂不可用');
});
test('新模型决定替换原话，紧急插播中断语音',async()=>{
  const f=setup({sound:true});f.runtime.sync();await flush();f.data.id='next';f.data.speech='有新的出行安排';f.runtime.sync();await flush();
  expect(f.voice().text).toBe('有新的出行安排');f.runtime.interrupt();await flush();expect(f.results.at(-1)).toBe('interrupted');
});
test('隐藏页面及系统定时提示期间不争用声音',async()=>{
  const f=setup();f.ctx.document.hidden=true;f.runtime.sync();await flush();expect(f.claims()).toBe(0);
  f.ctx.document.hidden=false;f.ctx.reminderPool={r:{}};f.runtime.sync();await flush();expect(f.claims()).toBe(0);
});
test('暂停时段停止语音并显示暂停状态，不领取；恢复时显示共享决策',async()=>{
  const f=setup({sound:true});f.runtime.sync();await flush();f.data.paused=true;f.runtime.sync();await flush();
  expect(f.cancel).toHaveBeenCalled();expect(f.renderer.pig.mock.calls.at(-1)[2]).toBe('当前时段已暂停更新。');expect(f.claims()).toBe(1);
  f.data.paused=false;f.data.id='shared-next';f.runtime.sync();await flush();expect(f.claims()).toBe(2);expect(f.renderer.pig.mock.calls.at(-1)[2]).toBe(f.data.speech);
});
