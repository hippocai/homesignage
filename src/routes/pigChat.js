const express = require('express');
const os = require('node:os');
const path = require('node:path');
const {randomBytes,randomUUID,createHash} = require('node:crypto');
const ipaddr = require('ipaddr.js');
const rateLimit = require('express-rate-limit');
const db = require('../services/briefing/storage');
const agent = require('../services/briefing/household');
const {fault} = require('../services/briefing/providers');

function interfaces() {
  return Object.entries(os.networkInterfaces()).flatMap(([name,list])=>
    (list || []).filter(v=>!v.internal && v.cidr).map(v=>({...v,name})));
}
function address(value) {
  try { return ipaddr.process(String(value).replace(/^\[|\]$/g,'').split('%')[0]); } catch {return null;}
}
function onLan(value, nets=interfaces()) {
  const peer=address(value);
  if(!peer) return false;
  if(peer.range()==='loopback') return true;
  return nets.some(n=>{
    try {
      const [net,bits]=ipaddr.parseCIDR(n.cidr);
      return peer.kind()===net.kind() && peer.match(net,bits) && bits>0;
    } catch {return false;}
  });
}
function localHost(host,nets) {
  const name=host.toLowerCase(), peer=address(name);
  return name==='localhost' || [os.hostname().toLowerCase(),os.hostname().toLowerCase()+'.local'].includes(name) ||
    (peer && (peer.range()==='loopback' || nets.some(n=>address(n.address)?.toString()===peer.toString())));
}
function lanOnly(req,res,next) {
  const nets=interfaces();
  res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  let url;
  try {url=new URL(req.protocol+'://'+req.headers.host);} catch {}
  if(!url || !localHost(url.hostname,nets) || !onLan(req.socket.remoteAddress,nets) ||
    ['forwarded','x-forwarded-for','x-forwarded-host','x-real-ip','cf-connecting-ip'].some(k=>k in req.headers) ||
    (req.headers.origin && req.headers.origin!==url.origin) || req.headers['sec-fetch-site']==='cross-site' && req.headers['sec-fetch-mode']!=='navigate')
    return res.status(403).json({error:'请连接家庭局域网，直接使用猪猪聊天链接'});
  next();
}
function shareLinks(req) {
  const nets=interfaces(), port=req.socket.localPort;
  const host=req.hostname.replace(/^\[|\]$/g,'');
  const candidates=nets.filter(n=>!n.address.includes('%') && address(n.address)?.range()!=='linkLocal')
    .sort((a,b)=>Number(b.address===host)-Number(a.address===host) ||
      Number(/virtual|docker|wsl|vpn|vethernet/i.test(a.name))-Number(/virtual|docker|wsl|vpn|vethernet/i.test(b.name)) ||
      Number(b.family==='IPv4')-Number(a.family==='IPv4'));
  return [...new Set((candidates.length?candidates.map(n=>n.address):['127.0.0.1'])
    .map(ip=>req.protocol+'://'+(ip.includes(':')?'['+ip+']':ip)+':'+port+'/pig-chat'))];
}
const router=express.Router();
router.use(['/pig-chat','/api/v1/pig-chat'],lanOnly);
router.get('/pig-chat',(req,res)=>res.sendFile(path.resolve(__dirname,'../../guest-chat/index.html')));
router.use('/pig-chat/assets',express.static(path.resolve(__dirname,'../../guest-chat/assets')));
router.use('/api/v1/pig-chat',express.json({limit:'16kb'}));
const scoped=express.Router();
router.use('/api/v1/pig-chat',scoped);
const run=fn=>async(req,res)=>{
  try {res.json({data:await fn(req,res)});}
  catch(e) {res.status(e.status || 500).json({error:e.status?e.message:'暂时无法处理这条消息'});}
};
const limit=(max)=>rateLimit({windowMs:60000,max,standardHeaders:true,legacyHeaders:false,message:{error:'消息太频繁，请稍后再试'}});
const cookieName='pig_guest', cookiePath='/api/v1/pig-chat', lifetime=30*86400000;
const hash=value=>createHash('sha256').update(value).digest('hex');
async function session(req) {
  const raw=(req.headers.cookie || '').match(/(?:^|;\s*)pig_guest=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(raw) return db.one('SELECT id FROM pig_guests WHERE token_hash=? AND expires>?',hash(raw),Date.now());
}
scoped.post('/session',limit(30),run(async(req,res)=>{
  let visitor=await session(req);
  if(!visitor) {
    const token=randomBytes(32).toString('hex');
    visitor={id:randomUUID()};
    await db.run('DELETE FROM pig_guests WHERE expires<=?',Date.now());
    await db.run('INSERT INTO pig_guests VALUES(?,?,?)',visitor.id,hash(token),Date.now()+lifetime);
    res.cookie(cookieName,token,{httpOnly:true,sameSite:'strict',secure:req.secure,path:cookiePath,maxAge:lifetime});
  }
  return {alias:'访客 '+visitor.id.slice(0,8),history:await agent.history(40,visitor.id)};
}));
scoped.post('/messages',limit(12),run(async req=>{
  const visitor=await session(req);
  if(!visitor) throw fault('访客会话已过期，请刷新聊天页面',401);
  const nickname=req.body?.nickname;
  if(nickname!=null && (typeof nickname!=='string' || nickname.length>32)) throw fault('称呼最多 32 个字符');
  return agent.chat(req.body,Date.now(),{scope:visitor.id,name:nickname?.trim() || '访客 '+visitor.id.slice(0,8),
    ip:address(req.socket.remoteAddress).toString()});
}));
async function audit(query) {
  const before=query.before===undefined?Number.MAX_SAFE_INTEGER:Number(query.before);
  if(!Number.isSafeInteger(before) || before<1) throw fault('无效审计分页');
  const rows=await db.all(`SELECT a.id,a.created,a.finished,a.actor,a.scope,a.ip,a.message,a.reply,a.status,a.error,
    CASE WHEN a.status='ok' THEN c.actions END AS actions FROM pig_chat_audit a LEFT JOIN pig_conversation c ON a.turn_id=c.id
    WHERE a.id<? ORDER BY a.id DESC LIMIT 31`,before);
  for(const row of rows) row.actions=JSON.parse(row.actions || '[]');
  return {items:rows.slice(0,30),next:rows.length>30?rows[29].id:null};
}
module.exports={router,onLan,lanOnly,shareLinks,audit};
