'use strict';
const form=document.getElementById('login'),button=document.getElementById('submit'),status=document.getElementById('status');
form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled)return;button.disabled=true;status.textContent='正在登录…';
  try{
    const response=await fetch('/api/v1/pig-chat/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:document.getElementById('username').value,password:document.getElementById('password').value})});
    const data=await response.json();if(!response.ok)throw Error(data.error||'登录失败，请重试');
    document.getElementById('password').value='';location.replace('/pig-chat');
  }catch(e){status.textContent=e.message;button.disabled=false;}
});
