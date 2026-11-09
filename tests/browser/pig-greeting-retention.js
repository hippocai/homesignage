/* Real renderer/runtime in Chromium and WebKit; controlled device responses, no production writes. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright-core');
const root=path.resolve(__dirname,'../..');
async function check(browser,name){
  const page=await browser.newPage({viewport:{width:768,height:1024}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.setContent('<style>'+fs.readFileSync(path.join(root,'client/css/briefing.css'),'utf8')+'</style><div id="layer" class="active"><div id="pig" data-component-id="pig" style="width:500px;height:300px"></div></div>');
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'client/js/briefing.js'),'utf8')});
    await page.evaluate(()=>{
      Object.assign(window,{CONFIG:{SERVER_URL:''},deviceId:'test',deviceKey:'key',sceneLayers:[document.getElementById('layer')],currentSceneIndex:0,
        activeEmergency:null,state:'NORMAL',reminderPool:{},audioUnlocked:false});
      window.testState={claims:0,calls:0,pending:false,resolve:null,fail:false,changes:[],data:{id:'first',componentId:'pig',speech:'早安，今天也要开心呀。',action:'idle',intent:'greeting',retainUntilReplaced:true,
        validUntil:Date.now()+100,nextReviewAt:Date.now()+1500,preferences:{sound:false}}};
      new MutationObserver(()=>testState.changes.push(document.getElementById('pig').textContent)).observe(document.getElementById('pig'),{subtree:true,childList:true,characterData:true});
      window.fetch=async url=>{
        let data;
        if(url.includes('/narration?')){
          testState.calls++;
          if(testState.pending)await new Promise(resolve=>{testState.resolve=resolve;});
          if(testState.fail)throw Error('offline');
          data={...testState.data};
        }else if(url.endsWith('/claim')){testState.claims++;data={accepted:true,sound:false};}
        else data=url.endsWith('/news')?{cards:[]}:{ok:true};
        return {ok:true,json:async()=>({data})};
      };
    });
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'client/js/briefing-runtime.js'),'utf8')});
    await page.evaluate(()=>briefingRuntime.mount(document.getElementById('pig'),{appearance:'2d',fontSize:32},'companion'));
    const bubble=page.locator('.pig-bubble');await bubble.getByText('早安，今天也要开心呀。',{exact:true}).waitFor();
    await page.evaluate(()=>{testState.pending=true;});
    await page.waitForFunction(()=>testState.resolve!==null);
    assert.equal(await bubble.innerText(),'早安，今天也要开心呀。','Old expiry and scheduled call must not erase greeting');
    await page.evaluate(()=>{testState.fail=true;testState.pending=false;testState.resolve();});
    await page.waitForTimeout(100);assert.equal(await bubble.innerText(),'早安，今天也要开心呀。','Network failure keeps greeting');
    await page.evaluate(()=>{testState.fail=false;testState.data.nextReviewAt=Date.now()+60000;briefingRuntime.sync();});
    await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>testState.claims),1,'No duplicate claim on same ID');
    assert.equal(await page.evaluate(()=>testState.changes.some(text=>/等待下一次|重新判断|暂不可用/.test(text))),false);
    await page.evaluate(()=>{testState.data.paused=true;briefingRuntime.sync();});
    await page.waitForTimeout(100);assert.equal(await bubble.innerText(),'早安，今天也要开心呀。');
    // Reload/rebuild during a paused period still receives the same retained greeting.
    await page.evaluate(()=>{briefingRuntime.reset();briefingRuntime.mount(document.getElementById('pig'),{appearance:'2d'},'companion');});
    await bubble.getByText('早安，今天也要开心呀。',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>testState.claims),1);
    await page.evaluate(()=>{Object.assign(testState.data,{id:'reminder',speech:'出门请带身份证。',intent:'reminder',retainUntilReplaced:false,paused:false,validUntil:Date.now()+1200});briefingRuntime.sync();});
    await bubble.getByText('出门请带身份证。',{exact:true}).waitFor();
    await page.evaluate(()=>{testState.data={waiting:true,preferences:{sound:false}};});
    await bubble.getByText('等待下一次问候更新。',{exact:true}).waitFor();
    await page.evaluate(()=>{testState.data={id:'next',speech:'午后也记得休息一下。',retainUntilReplaced:true,validUntil:Date.now()-1000,nextReviewAt:Date.now()+60000,preferences:{sound:false}};briefingRuntime.sync();});
    await bubble.getByText('午后也记得休息一下。',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>briefingRuntime.reset());
    console.log('PASS '+name+': short validity, pending generation, failure, same-ID polling, paused reload, expired reminder withdrawal, new greeting replacement');
  }finally{await page.close();}
}
(async()=>{for(const [name,type] of [['Chromium',chromium],['WebKit',webkit]]){
  const browser=await type.launch(name==='Chromium'?{executablePath:process.env.CHROME_PATH}:{});
  try{await check(browser,name);}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
