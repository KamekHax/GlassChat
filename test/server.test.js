const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function event(socket, name, predicate = () => true, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timed out waiting for ${name}`)); }, timeout);
    function handler(value) { if (predicate(value)) { clearTimeout(timer); socket.off(name, handler); resolve(value); } }
    socket.on(name, handler);
  });
}

test('server supports health, room chat, channel creation and durable history', async t => {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glasschat-test-'));
  const db = path.join(dir, 'data.json');
  const child = spawn(process.execPath, [path.join(__dirname, '../server/index.js')], {
    env: { ...process.env, PORT: String(port), GLASSCHAT_DATA_FILE: db, HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', d => logs += d);
  child.stderr.on('data', d => logs += d);
  const clients = [];
  t.after(async () => {
    clients.forEach(c => c.close());
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1500).unref(); } });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  let health;
  for (let i = 0; i < 40; i++) {
    try { health = await fetch(`http://127.0.0.1:${port}/health`); break; }
    catch { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(health, `server did not start: ${logs}`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  const client = io(`http://127.0.0.1:${port}`, { reconnection: false, timeout: 2000 }); clients.push(client);
  const ready = event(client, 'init');
  await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
  client.emit('join', { name: 'Test User', channel: 'general' });
  const initial = await ready;
  assert.ok(initial.channels.includes('general'));
  assert.equal(initial.channel, 'general');

  const received = event(client, 'message', m => m.text === 'beta smoke test');
  client.emit('message', 'beta smoke test');
  const message = await received;
  assert.equal(message.user, 'Test User');
  assert.ok(message.id);

  const newChannels = event(client, 'channels', list => list.includes('beta-room'));
  client.emit('create-channel', 'beta-room');
  assert.ok((await newChannels).includes('beta-room'));
  const stored = JSON.parse(fs.readFileSync(db, 'utf8'));
  assert.equal(stored.messages.general.at(-1).text, 'beta smoke test');
});
