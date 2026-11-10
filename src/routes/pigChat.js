const express = require('express');
const path = require('node:path');
const {randomBytes,randomUUID,createHash} = require('node:crypto');
const access = require('../services/briefing/chat-access');
const rateLimit = require('express-rate-limit');
const db = require('../services/briefing/storage');
const agent = require('../services/briefing/household');
const {fault} = require('../services/briefing/providers');

function requestOrigin(req) {
  const host=req.get('host');
  if (!host || /[^a-zA-Z0-9.:_\[\]-]/.test(host)) throw fault('无效的访问地址');
  return new URL(req.protocol+'://'+host).origin;
}

function configuredOrigin() {
  if (!process.env.PIG_CHAT_PUBLIC_ORIGIN) return null;
  const url=new URL(process.env.PIG_CHAT_PUBLIC_ORIGIN);
  if (!['http:','https:'].includes(url.protocol) || url.href!==url.origin+'/') {
    throw new Error('PIG_CHAT_PUBLIC_ORIGIN 必须是 HTTP(S) 站点地址');
  }
  return url.origin;
}

function guestAccess(req,res,next) {
  res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  if (req.method==='GET' || req.method==='HEAD') return next();
  const origin=req.get('origin'), site=req.get('sec-fetch-site');
  if ((site && !['same-origin','none'].includes(site)) ||
      (origin && origin!==requestOrigin(req) && origin!==configuredOrigin() && !(req.get('x-forwarded-proto')==='https'&&origin==='https://'+req.get('host')))) {
    return res.status(403).json({error:'请从猪猪聊天页面发送消息'});
  }
  if (req.method==='POST' && !req.is('application/json')) {
    return res.status(415).json({error:'请使用 JSON 发送消息'});
  }
  next();
}

function shareLinks(req) {
  return [new URL('/pig-chat',configuredOrigin() || requestOrigin(req)).href];
}
const router=express.Router();
router.use(['/pig-chat','/api/v1/pig-chat'],guestAccess);
router.get('/pig-chat',async(req,res,next)=>{try{
  const allowed=await access.identify(req);
  res.sendFile(path.resolve(__dirname,'../../guest-chat/'+(allowed?'index.html':'login.html')));
}catch(e){next(e);}});
router.use('/pig-chat/assets',express.static(path.resolve(__dirname,'../../guest-chat/assets')));
router.use('/api/v1/pig-chat',express.json({limit:'16kb'}));
const scoped=express.Router();
router.use('/api/v1/pig-chat',scoped);
const run=fn=>async(req,res)=>{
  try {res.json({data:await fn(req,res)});}
  catch(e) {res.status(e.status || 500).json({error:e.status?e.message:'暂时无法处理这条消息'});}
};
const limit=(max)=>rateLimit({windowMs:60000,max,keyGenerator:req=>req.socket.remoteAddress,standardHeaders:true,legacyHeaders:false,message:{error:'消息太频繁，请稍后再试'}});
const loginLimit=rateLimit({windowMs:15*60000,max:20,keyGenerator:req=>req.socket.remoteAddress,standardHeaders:true,legacyHeaders:false,message:{error:'登录尝试过于频繁，请15分钟后再试'}});
scoped.post('/login',loginLimit,run(access.login));
scoped.post('/logout',run(access.logout));
scoped.use(async(req,res,next)=>{try{
  if(!await access.identify(req))return res.status(401).json({error:'非家庭局域网访问，请先登录',code:'PIG_CHAT_LOGIN_REQUIRED'});
  next();
}catch(e){next(e);}});
const cookieName='pig_guest', cookiePath='/api/v1/pig-chat', lifetime=30*86400000;
const hash=value=>createHash('sha256').update(value).digest('hex');
async function session(req) {
  const raw=(req.headers.cookie || '').match(/(?:^|;\s*)pig_guest=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(raw){
    const visitor=await db.one('SELECT id,user_id FROM pig_guests WHERE token_hash=? AND expires>?',hash(raw),Date.now());
    if(visitor&&(!visitor.user_id||visitor.user_id===req.pigUser?.id)){
      if(req.pigUser&&!visitor.user_id){
        await db.run('UPDATE pig_guests SET user_id=? WHERE id=? AND user_id IS NULL',req.pigUser.id,visitor.id);
        return db.one('SELECT id,user_id FROM pig_guests WHERE id=? AND user_id=?',visitor.id,req.pigUser.id);
      }
      return visitor;
    }
  }
}
scoped.post('/session',limit(30),run(async(req,res)=>{
  let visitor=await session(req);
  if(!visitor) {
    const token=randomBytes(32).toString('hex');
    visitor={id:randomUUID()};
    await db.run('DELETE FROM pig_guests WHERE expires<=?',Date.now());
    await db.run('INSERT INTO pig_guests(id,token_hash,expires,user_id) VALUES(?,?,?,?)',visitor.id,hash(token),Date.now()+lifetime,req.pigUser?.id||null);
    res.cookie(cookieName,token,{httpOnly:true,sameSite:'strict',secure:req.secure||req.get('x-forwarded-proto')==='https',path:cookiePath,maxAge:lifetime});
  }
  return {alias:req.pigUser?.username||'访客 '+visitor.id.slice(0,8),authenticated:!!req.pigUser,history:await agent.history(40,visitor.id)};
}));
scoped.post('/messages',limit(12),run(async req=>{
  const visitor=await session(req);
  if(!visitor) throw fault('访客会话已过期，请刷新聊天页面',401);
  const nickname=req.body?.nickname;
  if(nickname!=null && (typeof nickname!=='string' || nickname.length>32)) throw fault('称呼最多 32 个字符');
  const name=req.pigUser?'账号 '+req.pigUser.username+(nickname?.trim()?'（'+nickname.trim()+'）':''):nickname?.trim()||'访客 '+visitor.id.slice(0,8);
  return agent.chat(req.body,Date.now(),{scope:visitor.id,name,ip:access.address(req)});
}));
async function audit(query) {
  const before=query.before===undefined?Number.MAX_SAFE_INTEGER:Number(query.before);
  if(!Number.isSafeInteger(before) || before<1) throw fault('无效审计分页');
  const type=query.type||'all',scope=query.scope||'';
  if(!['all','chat','narration','system_prompt','model_context','model_response'].includes(type)||typeof scope!=='string'||scope.length>200)throw fault('无效审计筛选');
  const kind=['system_prompt','model_context','model_response'].includes(type)?'narration':type;
  const rows=await db.all(`SELECT a.id,a.created,a.finished,a.actor,a.scope,a.ip,a.message,a.reply,a.status,a.error,a.kind,a.system_prompt,a.model_context,a.model_response,a.model,
    CASE WHEN a.status='ok' THEN c.actions END AS actions,CASE WHEN a.status='ok' THEN c.memory_actions END AS memoryActions FROM pig_chat_audit a LEFT JOIN pig_conversation c ON a.turn_id=c.id
    WHERE a.id<? AND (?='all' OR a.kind=?) AND (?='' OR a.scope=?) ORDER BY a.id DESC LIMIT 31`,before,kind,kind,scope,scope);
  for(const row of rows) {row.actions=JSON.parse(row.actions || '[]');row.memoryActions=JSON.parse(row.memoryActions || '[]');}
  for(const row of rows)if(['system_prompt','model_context','model_response'].includes(type))for(const field of ['system_prompt','model_context','model_response','message','reply'])if(field!==type)delete row[field];
  const users=await db.all("SELECT scope,max(actor) AS actor FROM pig_chat_audit WHERE kind='chat' GROUP BY scope ORDER BY actor");
  return {items:rows.slice(0,30),next:rows.length>30?rows[29].id:null,users};
}
module.exports={router,shareLinks,audit};
