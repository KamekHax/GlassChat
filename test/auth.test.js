const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { io: socketClient } = require('socket.io-client');
const { PGlite } = require('@electric-sql/pglite');
const { createAuthApp } = require('../server/auth/app');
const { migrate } = require('../server/auth/migrate');

function pglitePool(db) {
  const query = (...args) => args.length === 1 && typeof args[0] === 'string' && args[0].includes(';')
    ? db.exec(args[0]).then(() => ({ rows: [], rowCount: null }))
    : db.query(...args);
  return {
    query,
    async connect() { return { query, release() {} }; }
  };
}
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; }
async function json(url, route, body, headers = {}) {
  const response = await fetch(`${url}/api/auth${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { response, body: response.status === 204 ? null : await response.json() };
}

test('central auth lifecycle hashes credentials and never returns credential material', async t => {
  process.env.NODE_ENV = 'test';
  const db = new PGlite();
  const pool = pglitePool(db), sent = { verify: null, reset: null };
  await migrate(pool);
  await migrate(pool); // verifies applied migrations are skipped on repeat runs
  const mailer = { sendVerification: async m => { sent.verify = m; }, sendPasswordReset: async m => { sent.reset = m; } };
  const app = createAuthApp({ pool, mailer, logger: { error() {} } });
  const server = http.createServer(app), base = await listen(server);
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); });

  const reg = await json(base, '/register', { username: 'alice_test', email: 'alice@example.test', password: 'correct horse battery staple' });
  assert.equal(reg.response.status, 202);
  assert.ok(sent.verify?.token);
  assert.ok(!JSON.stringify(reg.body).includes(sent.verify.token));
  const unverified = await json(base, '/login', { identity: 'alice_test', password: 'correct horse battery staple' });
  assert.equal(unverified.response.status, 401);
  assert.deepEqual((await db.query('SELECT password_hash FROM users')).rows[0].password_hash.startsWith('$argon2id$'), true);

  const oldVerificationToken = sent.verify.token;
  const resent = await json(base, '/verification/resend', { email: 'alice@example.test' });
  assert.equal(resent.response.status, 202);
  assert.notEqual(sent.verify.token, oldVerificationToken);
  assert.equal((await json(base, '/verify-email', { token: oldVerificationToken })).response.status, 400);
  const verified = await json(base, '/verify-email', { token: sent.verify.token });
  assert.equal(verified.response.status, 200);
  assert.equal(verified.body.user.username, 'alice_test');
  assert.ok(verified.body.csrfToken);
  assert.ok(!JSON.stringify(verified.body).includes('password_hash'));
  const cookie = verified.response.headers.getSetCookie().find(x => x.startsWith('glasschat_session=')).split(';')[0];
  assert.ok(cookie);

  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.equal(meBody.user.email, 'alice@example.test');
  assert.ok(!JSON.stringify(meBody).includes('password_hash'));
  const noCsrf = await json(base, '/logout', {}, { cookie });
  assert.equal(noCsrf.response.status, 403);
  const logout = await json(base, '/logout', {}, { cookie, 'x-csrf-token': verified.body.csrfToken });
  assert.equal(logout.response.status, 204);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie } })).status, 401);

  const active = await json(base, '/login', { identity: 'alice_test', password: 'correct horse battery staple' });
  assert.equal(active.response.status, 200);
  const activeCookie = active.response.headers.getSetCookie().find(x => x.startsWith('glasschat_session=')).split(';')[0];
  const forgot = await json(base, '/password/forgot', { email: 'alice@example.test' });
  assert.equal(forgot.response.status, 202);
  assert.ok(sent.reset?.token);
  const changed = await json(base, '/password/reset', { token: sent.reset.token, password: 'new and secure battery horse' });
  assert.equal(changed.response.status, 200);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie: activeCookie } })).status, 401);
  assert.equal((await json(base, '/login', { identity: 'alice@example.test', password: 'correct horse battery staple' })).response.status, 401);
  const login = await json(base, '/login', { identity: 'alice_test', password: 'new and secure battery horse' });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.user.id, verified.body.user.id);
  assert.ok(!JSON.stringify(login.body).includes('password_hash'));
  assert.ok(!JSON.stringify(login.body).includes('$argon2id$'));
});

test('browser email-action CORS is restricted to the configured public website', async t => {
  process.env.NODE_ENV = 'test';
  const previousOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'https://kamekhax.github.io';
  const db = new PGlite();
  const pool = pglitePool(db);
  await migrate(pool);
  const app = createAuthApp({ pool, mailer: { sendVerification: async () => {}, sendPasswordReset: async () => {} }, logger: { error() {} } });
  const server = http.createServer(app), base = await listen(server);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await db.close();
    if (previousOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previousOrigin;
  });

  const allowed = await fetch(`${base}/api/auth/verify-email`, { method: 'OPTIONS', headers: { Origin: 'https://kamekhax.github.io', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://kamekhax.github.io');
  assert.match(allowed.headers.get('access-control-allow-methods'), /POST/);
  assert.equal(allowed.headers.get('access-control-allow-credentials'), null);

  const denied = await fetch(`${base}/api/auth/verify-email`, { method: 'OPTIONS', headers: { Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('community chat enforces membership and persists socket messages under the session identity', async t => {
  process.env.NODE_ENV = 'test';
  const db = new PGlite();
  const pool = pglitePool(db), sent = [];
  await migrate(pool);
  const mailer = { sendVerification: async m => sent.push(m), sendPasswordReset: async () => {} };
  const app = createAuthApp({ pool, mailer, logger: { error() {} } });
  const server = http.createServer(app), base = await listen(server);
  const { attachRealtime } = require('../server/auth/realtime');
  const ioServer = attachRealtime(server, { pool, logger: { error() {} } });
  app.locals.realtime = ioServer;
  t.after(async () => { await new Promise(resolve => ioServer.close(resolve)); await db.close(); });

  async function makeUser(username) {
    const reg = await json(base, '/register', { username, email: `${username}@example.test`, password: 'correct horse battery staple' });
    assert.equal(reg.response.status, 202);
    const verify = await json(base, '/verify-email', { token: sent.at(-1).token });
    assert.equal(verify.response.status, 200);
    const cookie = verify.response.headers.getSetCookie().find(x => x.startsWith('glasschat_session=')).split(';')[0];
    return { user: verify.body.user, cookie };
  }
  const alice = await makeUser('alice_chat');
  const bob = await makeUser('bob_chat');
  const commons = (await fetch(`${base}/api/auth/communities`, { headers: { cookie: alice.cookie } })).json();
  const communities = await commons;
  assert.equal(communities.communities.length, 1);
  assert.equal(communities.communities[0].slug, 'commons');
  const channel = communities.communities[0].channels[0];
  assert.equal(channel.name, 'general');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migrations WHERE name='002_community_chat.sql'")).rows[0].n, 1);

  await pool.query('DELETE FROM community_memberships WHERE user_id=$1', [bob.user.id]);
  const bobCommunities = await (await fetch(`${base}/api/auth/communities`, { headers: { cookie: bob.cookie } })).json();
  assert.deepEqual(bobCommunities.communities, []);
  assert.equal((await fetch(`${base}/api/auth/channels/${channel.id}/messages`, { headers: { cookie: bob.cookie } })).status, 404);

  const connect = cookie => socketClient(base, { transports: ['websocket'], extraHeaders: cookie ? { cookie } : {} });
  const bad = connect(null);
  const rejected = new Promise(resolve => bad.once('connect_error', resolve));
  const error = await rejected;
  assert.match(error.message, /unauthorized/);
  bad.close();

  await pool.query("UPDATE auth_sessions SET expires_at=now()+interval '4 seconds' WHERE user_id=$1", [alice.user.id]);
  const aliceSocket = connect(alice.cookie);
  const aliceInitPromise = new Promise(resolve => aliceSocket.once('channel:init', resolve));
  await new Promise((resolve, reject) => { aliceSocket.once('connect', resolve); aliceSocket.once('connect_error', reject); });
  aliceSocket.emit('channel:join', channel.id);
  const init = await aliceInitPromise;
  assert.equal(init.channel.id, channel.id);
  assert.ok(init.users.includes('alice_chat'));
  const bobSocket = connect(bob.cookie);
  await new Promise((resolve, reject) => { bobSocket.once('connect', resolve); bobSocket.once('connect_error', reject); });
  const denied = new Promise(resolve => bobSocket.once('channel:error', resolve));
  bobSocket.emit('channel:join', channel.id);
  assert.equal((await denied).error, 'CHANNEL_NOT_FOUND');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages')).rows[0].n, 0);

  const received = new Promise(resolve => aliceSocket.once('message', resolve));
  aliceSocket.emit('message:send', 'hello Commons');
  const message = await received;
  assert.equal(message.user, 'alice_chat');
  const stored = (await pool.query('SELECT author_id,text FROM messages')).rows[0];
  assert.equal(stored.author_id, alice.user.id);
  assert.equal(stored.text, 'hello Commons');
  const history = await (await fetch(`${base}/api/auth/channels/${channel.id}/messages`, { headers: { cookie: alice.cookie } })).json();
  assert.equal(history.messages[0].user, 'alice_chat');
  const expired = new Promise(resolve => aliceSocket.once('session:expired', resolve));
  const disconnected = new Promise(resolve => aliceSocket.once('disconnect', resolve));
  await expired;
  await disconnected;
  assert.equal(aliceSocket.connected, false);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages')).rows[0].n, 1);
  aliceSocket.close(); bobSocket.close();
});
