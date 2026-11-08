/* Real layout/animation checks in Chromium and WebKit; no API or production data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium, webkit} = require('playwright-core');
const root = path.resolve(__dirname, '../..');
const css = fs.readFileSync(path.join(root, 'client/css/briefing.css'), 'utf8');
const script = fs.readFileSync(path.join(root, 'client/js/briefing.js'), 'utf8');
const long = '今天出门请记得带好外套和雨伞。上午去机场前请再次核对航班动态，提前检查身份证和随身行李。'.repeat(3) + '这是最后一句，祝你一路平安。';

async function check(browser, name, fallback) {
  const page = await browser.newPage({viewport:{width:768,height:1024},hasTouch:true});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.route('http://pig.test/**',route=>route.fulfill(route.request().url().includes('/client/assets/')?
      {contentType:'image/svg+xml',body:fs.readFileSync(path.join(root,'client/assets/peach-pig.svg'),'utf8')}:
      {contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
    await page.goto('http://pig.test/');
    await page.setContent('<style>' + css + '</style><div id="host" style="width:360px;height:220px"></div>');
    if (fallback) await page.evaluate(()=>{window.ResizeObserver=undefined;});
    // Instrument cleanup, without changing the browser's real clocks or layout.
    await page.evaluate(()=>{
      const active=new Set(),start=window.setInterval,stop=window.clearInterval;
      window.setInterval=function(fn,ms){const id=start(fn,ms);active.add(id);return id;};
      window.clearInterval=function(id){active.delete(id);return stop(id);};
      window.activeBubbleTimers=active;
    });
    await page.addScriptTag({content:script});
    const render = async text=>{
      await page.evaluate(async text=>{
        HomeBriefing.pig(document.getElementById('host'),{appearance:'2d',fontSize:32},text,'wave');
        await document.querySelector('.pig-portrait').decode();
      },text);
      await page.waitForTimeout(fallback?1100:50);
    };
    const metrics = ()=>page.evaluate(()=>{
      const bubble=document.querySelector('.pig-bubble'),view=document.querySelector('.pig-bubble-viewport'),text=document.querySelector('.pig-bubble-text');
      const rect=bubble.getBoundingClientRect(),v=view.getBoundingClientRect(),t=text.getBoundingClientRect(),style=getComputedStyle(text);
      return {width:rect.width,height:rect.height,font:getComputedStyle(bubble).fontSize,overflow:getComputedStyle(bubble).overflowY,
        distance:text.scrollHeight-view.clientHeight,animation:style.animationName,duration:parseFloat(style.animationDuration),
        top:t.top-v.top,bottom:t.bottom-v.bottom,timers:activeBubbleTimers.size};
    });
    await render('早上好！');
    assert.equal((await metrics()).animation,'none');
    await render(long);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.pig-bubble-text')).animationName==='pig-bubble-scroll');
    const initial=await metrics();
    assert.equal(initial.font,'32px');assert.equal(initial.overflow,'hidden');assert.ok(initial.distance>50);assert.equal(initial.timers,1);
    assert.ok(initial.height<=220*.92+1);
    // Compare to the original plain bubble layout, before adding the scrolling wrapper.
    const original=await page.evaluate(async text=>{
      const host=document.getElementById('host'),clone=host.cloneNode(true);clone.id='original';
      const bubble=clone.querySelector('.pig-bubble');bubble.textContent=text;bubble.style.display='block';bubble.style.overflow='auto';
      document.body.appendChild(clone);await clone.querySelector('img').decode();const r=bubble.getBoundingClientRect();clone.remove();return {width:r.width,height:r.height};
    },long);
    assert.ok(Math.abs(original.width-initial.width)<=1,JSON.stringify({original,initial}));assert.ok(Math.abs(original.height-initial.height)<=1);
    // Sample the actual CSS animation at head hold, middle, tail hold and next cycle.
    async function at(fraction) {
      await page.evaluate(fraction=>{
        const text=document.querySelector('.pig-bubble-text'),duration=parseFloat(getComputedStyle(text).animationDuration);
        text.style.animationPlayState='paused';text.style.animationDelay=(-duration*fraction)+'s';
      },fraction);
      await page.waitForTimeout(50);return metrics();
    }
    assert.ok(Math.abs((await at(.05)).top)<2);
    const middle=await at(.5);assert.ok(middle.top < -initial.distance*.4 && middle.top > -initial.distance*.6);
    const tail=await at(.95);assert.ok(Math.abs(tail.bottom)<=2,'Last line is fully visible');
    assert.equal(tail.font,initial.font);assert.equal(tail.height,initial.height);assert.equal(tail.width,initial.width);
    assert.ok(Math.abs((await at(1.05)).top)<2,'Loops to the first line');
    // A fresh sentence starts at the top, and a fitting sentence stops scrolling.
    await render(long+'新提醒');assert.ok(Math.abs((await metrics()).top)<2);assert.equal((await metrics()).timers,1);
    await render('新提醒');assert.equal((await metrics()).animation,'none');assert.ok(Math.abs((await metrics()).top)<2);
    await render(long);
    await page.evaluate(()=>{document.getElementById('host').style.height='2400px';});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.pig-bubble-text')).animationName==='none');
    await page.evaluate(()=>{document.getElementById('host').style.height='220px';});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.pig-bubble-text')).animationName==='pig-bubble-scroll');
    // Hidden scene becomes measurable when shown, including the no-ResizeObserver path.
    await page.evaluate(()=>{document.getElementById('host').style.display='none';});
    await render(long);
    await page.evaluate(()=>{document.getElementById('host').style.display='block';});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.pig-bubble-text')).animationName==='pig-bubble-scroll');
    await page.evaluate(()=>{document.getElementById('host').remove();});
    await page.waitForFunction(()=>activeBubbleTimers.size===0);
    assert.deepEqual(errors,[]);
    console.log('PASS '+name+(fallback?' without ResizeObserver':'')+': overflow, fixed geometry/font, complete tail, loop, replacement, resize, hidden scene, cleanup');
  } finally { await page.close(); }
}
(async()=>{
  for(const [name,type] of [['Chromium',chromium],['WebKit',webkit]]){
    const browser=await type.launch(name==='Chromium'?{executablePath:process.env.CHROME_PATH}:{});
    try { await check(browser,name,false);await check(browser,name,true); } finally { await browser.close(); }
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
