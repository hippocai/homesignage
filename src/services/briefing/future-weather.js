const p=require('./providers');
const settings=require('../../dao/settingsDao');
const cache=new Map(), inflight=new Map(),geoCache=new Map();
const HOUR=3600000;
const clean=s=>String(s||'').trim();
const norm=s=>clean(s).toLowerCase().replace(/[省市区县]$/u,'');
const measurement=(v,unit)=>v?.unit===unit && Number.isFinite(v.value)?v.value:null;
const probability=v=>Number.isFinite(v) && v>=0 && v<=1?Math.round(v*100):null;
const validTime=s=>typeof s==='string' && Number.isFinite(Date.parse(s));
function period(x){return validTime(x.forecastStartTime) && validTime(x.forecastEndTime) && Date.parse(x.forecastEndTime)>Date.parse(x.forecastStartTime);}
function part(x={}){return {condition:clean(x.condition?.text),rainMm:measurement(x.precipitation?.amount,'mm'),rainPercent:probability(x.precipitation?.probability),windMs:measurement(x.wind?.speed,'m/s'),gustMs:measurement(x.windGustMax||x.windGust,'m/s')};}
function normalize(kind,b){
  if(!b?.metadata || !Array.isArray(b[kind]))throw Error('天气响应格式不完整');
  let items;
  if(kind==='days') items=b.days.map(x=>{
    if(!period(x) || measurement(x.temperatureMax,'°C')===null || measurement(x.temperatureMin,'°C')===null)throw Error('每日预报时间或单位无效');
    return {start:x.forecastStartTime,end:x.forecastEndTime,highC:x.temperatureMax.value,lowC:x.temperatureMin.value,day:part(x.daytime),night:part(x.nighttime)};
  });
  if(kind==='hours') items=b.hours.map(x=>{
    if(!validTime(x.forecastTime) || measurement(x.temperature,'°C')===null)throw Error('逐小时预报时间或单位无效');
    return {time:x.forecastTime,tempC:x.temperature.value,feelsLikeC:measurement(x.feelsLike,'°C'),...part(x)};
  });
  if(kind==='alerts') items=b.alerts.map(x=>{
    if(!x.id || !validTime(x.issuedTime) || !validTime(x.effectiveTime) || !validTime(x.expireTime) || !['alert','update','cancel'].includes(x.messageType?.code))throw Error('官方预警时间或类型无效');
    return {id:String(x.id),issuer:clean(x.senderName),issued:x.issuedTime,start:x.effectiveTime,onset:validTime(x.onsetTime)?x.onsetTime:x.effectiveTime,end:x.expireTime,
      messageType:x.messageType.code,supersedes:Array.isArray(x.messageType.supersedes)?x.messageType.supersedes.map(String):[],
      event:clean(x.eventType?.name),severity:clean(x.severity),color:clean(x.color?.code),title:clean(x.headline),description:clean(x.description),instruction:clean(x.instruction)};
  });
  if(kind!=='alerts' && !items.length)throw Error('预报为空');
  return {items,attributions:Array.isArray(b.metadata.attributions)?b.metadata.attributions.map(String):[]};
}
async function configuration(){
  return {host:await settings.get('weather.qweather.host')||'devapi.qweather.com',key:await settings.get('weather.qweather.apiKey')||''};
}
async function resolve(location,cfg){
  const key=p.hash(JSON.stringify([location,cfg]));
  if(geoCache.get(key)?.until>Date.now())return geoCache.get(key).value;
  const pieces=location.city.split('/'),name=pieces.at(-1),region=pieces.length>1?pieces[0]:'';
  const query=new URLSearchParams({location:location.locationId||name,key:cfg.key,lang:/\p{Script=Han}/u.test(location.city)?'zh':'en',number:'20'});
  const b=await p.remote('https://geoapi.qweather.com/v2/city/lookup?'+query);
  if(b.code!=='200' || !Array.isArray(b.location))throw Error('城市查询不可用');
  const choices=b.location.filter(x=>(location.locationId?x.id===location.locationId:norm(x.name)===norm(name)) &&
    (!region || [x.adm1,x.country].some(v=>norm(v)===norm(region))) && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lon)));
  if(choices.length!==1)throw Error('城市不明确，请使用省份/城市');
  const x=choices[0],value={latitude:Number(x.lat),longitude:Number(x.lon),name:x.name,region:x.adm1};
  if(Math.abs(value.latitude)>90 || Math.abs(value.longitude)>180)throw Error('城市坐标无效');
  if(geoCache.size>=128)geoCache.delete(geoCache.keys().next().value);
  geoCache.set(key,{value,until:Date.now()+7*24*HOUR});return value;
}
async function section(kind,location,point,cfg,now){
  const key=p.hash(JSON.stringify([kind,point,cfg])),ttl=kind==='alerts'?5*60000:HOUR;
  const prior=cache.get(key);
  const format=(value,status)=>({status,source:'QWeather',fetchedAt:value?.fetchedAt||null,items:value?.items||[],attributions:value?.attributions||[]});
  if(prior?.next>now)return format(prior,prior.error?(prior.fetchedAt?'stale':'unavailable'):'fresh');
  if(inflight.has(key))return inflight.get(key);
  const promise=(async()=>{
    try{
      const endpoint=kind==='alerts'?'weatheralert/v1/current':kind==='days'?'weather/v1/daily':'weather/v1/hourly';
      const query=new URLSearchParams({key:cfg.key,lang:'zh',localTime:'true',...(kind==='days'?{days:'8'}:kind==='hours'?{hours:'48'}:{})});
      const data=normalize(kind,await p.remote('https://'+cfg.host+'/'+endpoint+'/'+point.latitude+'/'+point.longitude+'?'+query));
      const entry={...data,fetchedAt:new Date(now).toISOString(),next:now+ttl};
      if(cache.size>=256)cache.delete(cache.keys().next().value);
      cache.set(key,entry);return format(entry,'fresh');
    }catch{
      const keep=prior?.fetchedAt && now-Date.parse(prior.fetchedAt)<(kind==='alerts'?15*60000:6*HOUR)?prior:null;
      cache.set(key,{...(keep||{}),next:now+60000,error:true});
      return format(keep,keep?'stale':'unavailable');
    }finally{inflight.delete(key);}
  })();inflight.set(key,promise);return promise;
}
async function get(location,now=Date.now()){
  const unavailable={status:'unavailable',source:'QWeather',fetchedAt:null,items:[],attributions:[]};
  try{
    const cfg=await configuration();
    if(!cfg.key || !/^[a-z0-9.-]+$/i.test(cfg.host))throw Error('未配置和风天气');
    const point=await resolve(location,cfg);
    const [daily,hourly,alerts]=await Promise.all(['days','hours','alerts'].map(k=>section(k,location,point,cfg,now)));
    const superseded=new Set(alerts.items.flatMap(x=>x.supersedes));
    return {city:location.city,region:point.region,locationKey:p.hash(point.latitude+','+point.longitude),daily:{...daily,items:daily.items.filter(x=>Date.parse(x.end)>now)},
      hourly:{...hourly,items:hourly.items.filter(x=>Date.parse(x.time)>=now-3600000)},
      alerts:{...alerts,items:alerts.items.filter(x=>Date.parse(x.end)>now && !superseded.has(x.id))}};
  }catch{return {city:location.city,daily:{...unavailable},hourly:{...unavailable},alerts:{...unavailable}};}
}
module.exports={get,normalize,resolve};
