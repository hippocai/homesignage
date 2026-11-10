module.exports=async function loginPig(page){
  await page.getByLabel('用户名',{exact:true}).fill('admin');
  await page.getByLabel('密码',{exact:true}).fill('admin123');
  await page.getByRole('button',{name:'登录并聊天'}).click();
  await page.getByLabel('发给猪猪',{exact:true}).waitFor();
};
