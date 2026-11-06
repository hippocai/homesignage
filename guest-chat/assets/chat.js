'use strict';
const el=id=>document.getElementById(id);
let ready=false, busy=false, turns=[], retry;
async function call(endpoint,body) {
  const response=await fetch('/api/v1/pig-chat/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
    credentials:'same-origin',body:JSON.stringify(body)});
  const json=await response.json();
  if(!response.ok) throw Error(json.error || '暂时无法连接猪猪');
  return json.data;
}
function render() {
  const box=el('history');box.textContent='';
  if(!turns.length) {
    const empty=document.createElement('p');empty.className='empty';empty.textContent='还没有对话。可以告诉我家里的安排，或问一条资讯是否会影响你。';box.append(empty);
  }
  for(const turn of turns) for(const [who,content] of [['你',turn.message],['猪猪',turn.reply]]) {
    const item=document.createElement('article'),name=document.createElement('b'),line=document.createElement('p');
    if(who==='你') item.className='user';
    name.textContent=who;line.textContent=content;item.append(name,line);box.append(item);
  }
  box.scrollTop=box.scrollHeight;
}
function button(){el('send').disabled=!ready || busy || !el('message').value.trim();}
async function openSession(){
  try {
    const session=await call('session',{});
    turns=session.history;render();ready=true;
    el('status').textContent=session.alias+' · 仅显示本浏览器的对话';
  } catch(e){el('status').textContent=e.message;}
  button();
}
try{el('nickname').value=localStorage.getItem('pig-chat.nickname') || '';}catch{}
el('message').addEventListener('input',button);
el('message').addEventListener('keydown',e=>{
  if(e.key==='Enter' && !e.shiftKey && !e.isComposing && e.keyCode!==229) {e.preventDefault();el('send').click();}
});
el('composer').addEventListener('submit',async e=>{
  e.preventDefault();const message=el('message').value.trim(),nickname=el('nickname').value.trim();
  if(!ready || busy || !message)return;
  if(!retry || retry.message!==message) {
    const bytes=crypto.getRandomValues(new Uint8Array(16));
    retry={requestId:Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join(''),message};
  }
  busy=true;button();el('status').textContent='猪猪正在回复…';
  try {
    try{localStorage.setItem('pig-chat.nickname',nickname);}catch{}
    const turn=await call('messages',{...retry,nickname});
    if(!turns.some(t=>t.id===turn.id)) turns.push(turn);
    render();if(el('message').value.trim()===message) el('message').value='';
    retry=null;el('status').textContent='已记录';
  } catch(e){el('status').textContent=e.message;}
  finally{busy=false;button();}
});
openSession();
