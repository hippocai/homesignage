const providers = require('./providers');

const cache = new Map();
const normalize = (s) => String(s || '').trim().toLowerCase();
const cityName = (s) => normalize(s).replace(/([\p{Script=Han}])市$/u, '$1');
const regionName = (s) => normalize(s).replace(/[省市]$/, '');
function cityParts(city) {
  const parts = normalize(city).split('/');
  return {region: parts.length > 1 ? regionName(parts[0]) : '', name: cityName(parts.at(-1))};
}
function weatherCityKey(d) {
  const {region, name} = cityParts(d.city);
  return ['open-meteo-city', region, name, d.zone].join('|');
}
async function resolveCity(city) {
  const {region, name} = cityParts(city);
  if (!name || city.split('/').length > 2)
    throw providers.fault('请输入城市名称，例如深圳市，或辽宁/朝阳市');
  const key = JSON.stringify([region,name]);
  const cached = cache.get(key);
  if (cached?.until > Date.now()) return cached.point;
  const chinese = /\p{Script=Han}/u.test(name);
  // Some Chinese city records are indexed only under the official name ending in 市.
  for (const query of chinese ? [name, name + '市'] : [name]) {
    const params = new URLSearchParams({name:query, language:chinese ? 'zh' : 'en', count:'100'});
    let results;
    try { ({results} = await providers.remote('https://geocoding-api.open-meteo.com/v1/search?' + params)); }
    catch { throw providers.fault('暂时无法查询天气城市，请稍后再试', 502); }
    const candidates = (results || []).filter(x => cityName(x.name) === name &&
      (!region || [x.admin1,x.country,x.country_code].some(r => regionName(r) === region)) &&
      Number.isFinite(x.latitude) && Number.isFinite(x.longitude));
    // Exclude same-name districts and villages rather than silently forecasting for one.
    const cities = candidates.filter(x => /^(PPLC|PPLA|PPLA2)$/.test(x.feature_code) ||
      (x.feature_code === 'PPL' && x.population >= 100000));
    if (cities.length > 1)
      throw providers.fault('有多个同名城市，请加上省份或国家，例如「辽宁/朝阳市」');
    if (cities.length === 1) {
      const {latitude,longitude} = cities[0];
      const point = {latitude,longitude};
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(key,{point,until:Date.now()+7*86400000});
      return point;
    }
  }
  throw providers.fault('未找到该城市，请检查市名，或使用「省份/城市」');
}
module.exports = {weatherCityKey, resolveCity};
