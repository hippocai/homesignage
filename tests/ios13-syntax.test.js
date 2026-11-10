const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('acorn');

// Both pages ship classic scripts directly. A syntax error prevents the entire file loading.
const root = path.resolve(__dirname, '..');
for (const page of ['client/index.html', 'guest-chat/index.html', 'guest-chat/login.html']) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const scripts = Array.from(html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g), m => m[1]);
  test.each(scripts)(page + ' loads %s within the ES2019 syntax baseline', src => {
    const file = src === '/socket.io/socket.io.js'
      ? path.join(path.dirname(require.resolve('socket.io')), '../client-dist/socket.io.js')
      : path.join(root, src.replace(/^\/pig-chat\/assets\//, '/guest-chat/assets/'));
    parse(fs.readFileSync(file, 'utf8'), {ecmaVersion:2019, sourceType:'script'});
  });
}
