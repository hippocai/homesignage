const {randomBytes,createHash}=require('node:crypto');
const ipaddr=require('ipaddr.js'),bcrypt=require('bcrypt');
const db=require('./storage'),{fault}=require('./providers');
const cookieName='pig_chat_login',lifetime=12*3600000;
const hash=value=>createHash('sha256').update(value).digest('hex');
function address(req){try{return ipaddr.process(req.socket.remoteAddress).toString();}catch{return '';}}
function localIP(value){try{const ip=ipaddr.process(value);return ip.kind()==='ipv4'&&ip.match(ipaddr.parse('192.168.10.0'),24);}catch{return false;}}
function isLocal(req){
  // Host alone is forgeable. Do not infer LAN access from forwarded headers or Docker subnets.
  if(['forwarded','x-forwarded-for','x-real-ip','x-forwarded-host','x-forwarded-proto'].some(k=>req.get(k)))return false;
  let host;try{host=new URL('http://'+req.get('host')).hostname;}catch{return false;}
  return localIP(module.exports.address(req))&&localIP(host);
}
function token(req){return (req.headers.cookie||'').match(/(?:^|;\s*)pig_chat_login=([a-f0-9]{64})(?:;|$)/)?.[1];}
async function user(req){
  const raw=token(req);if(!raw)return null;
  const row=await db.one(`SELECT u.id,u.username,u.password,l.password_version FROM pig_chat_logins l JOIN users u ON u.id=l.user_id
    WHERE l.token_hash=? AND l.expires>?`,hash(raw),Date.now());
  return row&&hash(row.password)===row.password_version?{id:row.id,username:row.username}:null;
}
async function identify(req){req.pigLocal=isLocal(req);req.pigUser=await user(req);return req.pigLocal||!!req.pigUser;}
async function login(req,res){
  const {username,password}=req.body||{};
  if(typeof username!=='string'||!username.trim()||username.length>128||typeof password!=='string'||!password||password.length>1024)throw fault('请输入用户名和密码');
  const account=await db.one('SELECT id,username,password FROM users WHERE username=?',username.trim());
  // Compare a valid dummy hash too, so unknown accounts do not skip password verification.
  const valid=await bcrypt.compare(password,account?.password||'$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
  if(!account||!valid)throw fault('用户名或密码错误',401);
  const previous=token(req);if(previous)await db.run('DELETE FROM pig_chat_logins WHERE token_hash=?',hash(previous));
  await db.run('DELETE FROM pig_chat_logins WHERE expires<=?',Date.now());
  const raw=randomBytes(32).toString('hex');
  await db.run('INSERT INTO pig_chat_logins(token_hash,user_id,password_version,expires) VALUES(?,?,?,?)',hash(raw),account.id,hash(account.password),Date.now()+lifetime);
  res.cookie(cookieName,raw,{httpOnly:true,sameSite:'strict',secure:req.secure||req.get('x-forwarded-proto')==='https',path:'/',maxAge:lifetime});
  return {username:account.username};
}
async function logout(req,res){
  const raw=token(req);if(raw)await db.run('DELETE FROM pig_chat_logins WHERE token_hash=?',hash(raw));
  res.clearCookie(cookieName,{path:'/',httpOnly:true,sameSite:'strict'});
  res.clearCookie('pig_guest',{path:'/api/v1/pig-chat',httpOnly:true,sameSite:'strict'});
  return {ok:true};
}
module.exports={address,isLocal,identify,login,logout};
