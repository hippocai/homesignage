const {randomUUID}=require('node:crypto');
const db=require('./storage');
const rules=require('./rules');
const {fault,zaobaoUrl,baiduBoardUrl}=require('./providers');

const catalog=[
  {key:'cns-china',group:'国内新闻',name:'中新网 · 国内',url:'https://www.chinanews.com.cn/rss/china.xml'},
  {key:'cns-society',group:'国内新闻',name:'中新网 · 社会',url:'https://www.chinanews.com.cn/rss/society.xml'},
  {key:'cns-finance',group:'财经',name:'中新网 · 财经',url:'https://www.chinanews.com.cn/rss/finance.xml'},
  {key:'ithome',group:'科技与生活',name:'IT之家',url:'https://www.ithome.com/rss/'},
  {key:'sspai',group:'科技与生活',name:'少数派',url:'https://sspai.com/feed',interval:60},
  {key:'solidot',group:'科技与生活',name:'Solidot · 科技资讯',url:'https://www.solidot.org/index.rss',interval:60},
  {key:'baidu',group:'热搜',name:'百度热搜',type:'ranking',url:baiduBoardUrl,interval:15},
  {key:'zaobao',group:'综合新闻',name:'联合早报',type:'zaobao',url:zaobaoUrl},
];
// Keep an existing subscription's name, filters, targets and enabled state.
const sameSource=`json_extract(config,'$.type')=? AND json_extract(config,'$.url')=?
  AND (?!='zaobao' OR coalesce(json_extract(config,'$.section'),'all')='all')`;
async function list() {
  const existing=await db.all('SELECT id,config FROM briefing_sources');
  const sources=existing.map(row=>({id:row.id,...JSON.parse(row.config)}));
  return catalog.map(p=>{
    const type=p.type || 'rss';
    const match=sources.find(s=>s.type===type && s.url===p.url && (type!=='zaobao' || (s.section || 'all')==='all'));
    return {key:p.key,name:p.name,group:p.group,type,subscribedId:match?.id || null};
  });
}
async function subscribe(key) {
  const preset=catalog.find(p=>p.key===key);
  if(!preset) throw fault('常用来源不存在',404);
  const config=rules.source({type:'rss',interval:30,...preset});
  const identity=[config.type,config.url,config.type];
  const added=await db.run(`INSERT INTO briefing_sources(id,config) SELECT ?,?
    WHERE NOT EXISTS(SELECT 1 FROM briefing_sources WHERE ${sameSource})`,randomUUID(),JSON.stringify(config),...identity);
  const row=await db.one('SELECT id FROM briefing_sources WHERE '+sameSource,...identity);
  return {id:row.id,added:Boolean(added)};
}
module.exports={list,subscribe};
