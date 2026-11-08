/* Model decisions drive every sentence. Polling and validity are execution constraints only. */
var briefingRuntime = (function () {
  var components=[],poll=null,expiry=null,sequence=0,shown=null,voice=null;
  function req(path,body){return fetch(CONFIG.SERVER_URL+'/api/v1/devices/'+encodeURIComponent(deviceId)+path,{
    method:body?'POST':'GET',cache:'no-store',headers:{'X-Device-Key':deviceKey,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined
  }).then(function(r){if(!r.ok)throw Error(String(r.status));return r.json();}).then(function(r){return r.data;});}
  function currentPig(){var layer=sceneLayers[currentSceneIndex];return components.find(function(c){return c.type==='companion'&&layer&&layer.contains(c.el)&&layer.classList.contains('active');});}
  function busy(){return !!activeEmergency||state==='EMERGENCY'||Object.keys(reminderPool).length>0;}
  function receipt(d,result){return req('/narration/'+encodeURIComponent(d.id)+'/result',{componentId:d.componentId,result:result}).catch(function(){});}
  function stop(){if(voice&&window.speechSynthesis)window.speechSynthesis.cancel();voice=null;}
  function status(comp,text){if(comp)HomeBriefing.pig(comp.el,comp.cfg,text,'idle');}
  function renderCards(cards){components.filter(function(c){return c.type==='headlines';}).forEach(function(c){HomeBriefing.cards(c.el,c.cfg,cards,Date.now());});}
  function show(comp,d,token){
    if(token!==sequence||comp!==currentPig()||busy()||document.hidden)return;
    if(d.paused){if(voice&&shown)receipt(shown,'interrupted');stop();clearTimeout(expiry);shown=null;status(comp,'当前时段已暂停更新。');return;}
    if(d.validUntil<=Date.now())return;
    if(shown&&shown.id===d.id){if(!d.preferences.sound)stop();return;}
    if(voice&&shown)receipt(shown,'interrupted');stop();clearTimeout(expiry);shown=d;
    HomeBriefing.pig(comp.el,comp.cfg,d.speech,d.action);
    expiry=setTimeout(function(){stop();shown=null;status(comp,'正在请模型重新判断…');sync();},Math.max(1,d.validUntil-Date.now()));
    req('/narration/'+encodeURIComponent(d.id)+'/claim',{componentId:d.componentId}).then(function(claim){
      if(token!==sequence||comp!==currentPig()||busy()||document.hidden||shown!==d){if(claim.accepted)receipt(d,'interrupted');return;}
      if(!claim.accepted)return;
      receipt(d,'subtitle');
      if(claim.sound&&d.preferences.sound&&audioUnlocked&&window.speechSynthesis&&window.SpeechSynthesisUtterance){
        var v=new SpeechSynthesisUtterance(d.speech);voice=v;v.lang='zh-CN';v.volume=d.preferences.volume;
        v.onend=function(){if(voice===v){voice=null;receipt(d,'spoken');}};
        v.onerror=function(){if(voice===v)voice=null;};
        window.speechSynthesis.speak(v);
      }
    }).catch(function(){if(shown===d){shown=null;stop();status(comp,'上下文已更新，等待模型重新判断…');}});
  }
  function sync(){
    if(!components.length||!deviceKey)return;
    var token=++sequence,comp=currentPig();
    req('/news').then(function(d){if(token===sequence)renderCards(d.cards);}).catch(function(){});
    if(!comp||busy()||document.hidden)return;
    var id=comp.el.dataset&&comp.el.dataset.componentId;
    req('/narration?componentId='+encodeURIComponent(id||'')).then(function(d){show(comp,d,token);}).catch(function(){
      if(token===sequence&&comp===currentPig()){stop();shown=null;clearTimeout(expiry);status(comp,'模型暂不可用，正在等待重试。');}
    });
  }
  function reset(){sequence++;stop();clearInterval(poll);clearTimeout(expiry);poll=null;shown=null;components.forEach(function(c){if(c.type==='headlines')HomeBriefing.disposeCards(c.el);else if(c.type==='companion')HomeBriefing.disposePig(c.el);});components=[];}
  function mount(el,cfg,type){var c={el:el,cfg:cfg,type:type};components.push(c);if(type==='companion')status(c,'正在请模型结合家庭情况想一想…');else HomeBriefing.cards(el,cfg,[],Date.now());if(!poll){poll=setInterval(sync,30000);setTimeout(sync,0);}}
  function interrupt(){sequence++;stop();if(shown)receipt(shown,'interrupted');shown=null;clearTimeout(expiry);status(currentPig(),'正在显示系统优先提示。');}
  function scene(){interrupt();sync();}
  return {reset:reset,mount:mount,sync:sync,scene:scene,interrupt:interrupt};
})();
