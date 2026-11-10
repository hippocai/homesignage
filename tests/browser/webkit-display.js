require('../setup');
const http = require('node:http');
const assert = require('node:assert/strict');
const { webkit } = require('playwright-core');
const { setupTestApp, getAdminToken } = require('../testApp');
const socket = require('../../src/services/socketService');
const provider = require('../../src/services/briefing/providers');
const checkDisplay = require('./core-display');

async function main() {
  const app = await setupTestApp();
  const token = await getAdminToken(app);
  const server = http.createServer(app);
  socket.initSocketService(server);
  require('../../src/services/scenePlannerService').setSocketService(socket);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  async function api(method, path, body) {
    const res = await fetch(url + '/api/v1' + path, {
      method, headers: { Authorization:'Bearer ' + token, 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    assert.ok(res.ok, method + ' ' + path + ' ' + res.status);
    return (await res.json()).data;
  }

  const browser = await webkit.launch();
  try {
    const errors = [];
    await checkDisplay({browser, api, url, errors});
    const guest = await browser.newPage({viewport:{width:768,height:1024},hasTouch:true});
    guest.on('pageerror', error => errors.push(error.message));
    await guest.addInitScript(() => {
      delete Element.prototype.replaceChildren;
      delete HTMLFormElement.prototype.requestSubmit;
    });
    provider.jsonCompletion = async () => ({data:{reply:'收到问候',add:[],remove:[]},tokens:8});
    await guest.goto(url + '/pig-chat');
    await guest.getByLabel('用户名',{exact:true}).fill('admin');
    await guest.getByLabel('密码',{exact:true}).fill('wrong-password');
    await guest.getByRole('button',{name:'登录并聊天'}).click();
    await guest.getByText('用户名或密码错误',{exact:true}).waitFor();
    await require('./pig-login')(guest);
    await guest.getByText(/仅显示本浏览器的对话/).waitFor();
    const input = guest.getByLabel('发给猪猪');
    await input.fill('你好猪猪');
    await input.press('Enter');
    await guest.getByText('收到问候',{exact:true}).waitFor();
    await guest.reload();
    await guest.getByText('你好猪猪',{exact:true}).waitFor();
    const audit = await api('GET','/companion/agent/audit');
    assert.equal(audit.items[0].status,'ok');
    assert.equal(audit.items[0].actor,'账号 admin');
    await guest.getByRole('button',{name:'退出登录'}).click();
    await guest.getByRole('button',{name:'登录并聊天'}).waitFor();
    assert.equal(await guest.evaluate(async()=>{const r=await fetch('/api/v1/pig-chat/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status;}),401);
    assert.deepEqual(errors, []);
    console.log('PASS WebKit: shared scene, pig greeting, news rotation, stock chart, guest chat and audit');
  } finally {
    await browser.close();
    server.closeAllConnections();
    server.close();
  }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
