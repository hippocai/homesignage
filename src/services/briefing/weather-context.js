const db=require('./storage');
const rules=require('./rules');
const weather=require('../weatherService');
const settings=require('../../dao/settingsDao');
const {weatherCityKey}=require('./weatherCity');

// Reuse the display's provider/cache. A slow weather service must not hold up chat.
async function observation(location,source,now) {
  let timer;
  try {
    const result=await Promise.race([
      weather.getWeather(location),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2500);})
    ]);
    if(!result || !Number.isFinite(result.data?.tempC) || !Number.isFinite(result.fetchedAt))
      return {city:location.city,source,status:'unavailable'};
    const stale=result.stale || now-result.fetchedAt>=weather.getIntervalMinutes()*60000;
    return {city:location.city,source,status:stale?'stale':'fresh',
      fetchedAt:new Date(result.fetchedAt).toISOString(),tempC:result.data.tempC,
      description:String(result.data.description || '').slice(0,120),
      humidity:result.data.humidity ?? null,windKmph:result.data.windKmph ?? null};
  } catch {
    return {city:location.city,source,status:'unavailable'};
  } finally {clearTimeout(timer);}
}
async function build(now=Date.now(),options={}) {
  const components=await db.all(`SELECT DISTINCT c.id,c.type,c.config FROM components c
    JOIN device_scenes ds ON ds.scene_id=c.scene_id WHERE ds.enabled=1
    AND c.type IN ('weather','companion') ORDER BY c.id`);
  const locations=new Map(),cities=new Map();
  for(const row of components) {
    const config=JSON.parse(row.config);
    if(row.type==='weather' && typeof config.city==='string' && config.city.trim()) {
      const location={city:config.city.trim(),locationId:config.locationId || null};
      locations.set(String(location.locationId || location.city).toLowerCase(),location);
    }
    if(row.type==='companion') {
      const d=rules.component(config.reminders);
      if(d.enabled && d.cold && d.city) cities.set(weatherCityKey(d),d);
    }
  }
  if(!locations.size)for(const d of cities.values()) {
    const city=d.city.split('/').at(-1).trim();
    locations.set(city,{city,locationId:null});
  }
  const source=await settings.get('weather.provider') || 'wttr';
  const futureLocations=new Map();
  for(const d of cities.values())futureLocations.set(d.city,{city:d.city,locationId:null});
  for(const location of locations.values())if(!futureLocations.has(location.city))futureLocations.set(location.city,location);
  const h=options.household;
  if(h)for(const location of await require('./weather-destinations').cached(h,now,options.plans||h.plans))
    if(!futureLocations.has(location.city))futureLocations.set(location.city,{city:location.city,locationId:null});
  const futurePromise=Promise.all([...futureLocations.values()].slice(0,8).map(async location=>{
    let timer;
    try{return await Promise.race([require('./future-weather').get(location,now),new Promise(resolve=>{timer=setTimeout(()=>resolve({city:location.city,status:'unavailable',reason:'天气服务暂未返回'}),2500);})]);}
    finally{clearTimeout(timer);}
  }));
  const forecasts=await Promise.all([...cities.entries()].slice(0,4).map(async([key,d])=>{
    const day=rules.localTime(now,d.zone).day;
    const yesterday=new Date(Date.parse(day+'T12:00Z')-86400000).toISOString().slice(0,10);
    const rows=await db.all('SELECT day,high FROM briefing_weather WHERE city=? AND day IN (?,?)',key,day,yesterday);
    const high=date=>{const row=rows.find(v=>v.day===date);return Number.isFinite(row?.high)?row.high:null;};
    const todayHighC=high(day),yesterdayForecastHighC=high(yesterday);
    return {city:d.city,zone:d.zone,source:'Open-Meteo',day,status:todayHighC===null?'unavailable':'available',
      todayHighC,yesterdayForecastHighC,
      dropC:todayHighC!==null && yesterdayForecastHighC!==null?Math.round((yesterdayForecastHighC-todayHighC)*10)/10:null};
  }));
  const observations=await Promise.all([...locations.values()].slice(0,4).map(location=>observation(location,source,now)));
  return {asOf:new Date(now).toISOString(),status:!locations.size && !cities.size?'unconfigured':
    observations.some(v=>v.status==='fresh') || forecasts.some(v=>v.status==='available')?'available':'unavailable',
    observations,forecasts,future:await futurePromise,truncated:locations.size>4 || cities.size>4 || futureLocations.size>8};
}
module.exports={build};
