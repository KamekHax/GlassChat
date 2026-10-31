const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMailer } = require('../server/auth/mailer');

const env = () => ({
  NODE_ENV: 'production',
  AUTH_EMAIL_MODE: 'gmail-api',
  APP_BASE_URL: 'https://kamekhax.github.io/GlassChat',
  GMAIL_OAUTH_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GMAIL_OAUTH_CLIENT_SECRET: 'client-secret-test-value',
  GMAIL_OAUTH_REFRESH_TOKEN: 'refresh-token-test-value',
  GMAIL_FROM: 'kamekfnbr@gmail.com'
});
const response = (status, payload = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });

function decodeMessage(raw) {
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  const body = mime.split(/\r?\n\r?\n/).slice(1).join('\r\n').replace(/\r?\n/g, '');
  return { mime, text: Buffer.from(body, 'base64').toString('utf8') };
}

test('Gmail API mailer caches OAuth access tokens and keeps one-use tokens in URL fragments', async () => {
  let tokenCalls = 0;
  const sent = [];
  const fakeFetch = async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenCalls++;
      assert.equal(init.method, 'POST');
      const form = new URLSearchParams(init.body);
      assert.equal(form.get('grant_type'), 'refresh_token');
      assert.equal(form.get('refresh_token'), 'refresh-token-test-value');
      return response(200, { access_token: 'short-lived-access-token', expires_in: 3600 });
    }
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
      assert.equal(init.headers.Authorization, 'Bearer short-lived-access-token');
      sent.push(JSON.parse(init.body));
      return response(200, { id: 'message-id' });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const mailer = createMailer(env(), { fetch: fakeFetch });
  await Promise.all([
    mailer.sendVerification({ to: 'alice@example.test', username: 'alice', token: 'A'.repeat(43) }),
    mailer.sendPasswordReset({ to: 'bob@example.test', username: 'bob', token: 'B'.repeat(43) })
  ]);
  assert.equal(tokenCalls, 1);
  assert.equal(sent.length, 2);
  const verification = decodeMessage(sent[0].raw);
  const reset = decodeMessage(sent[1].raw);
  assert.match(verification.mime, /From: GlassChat <kamekfnbr@gmail\.com>/);
  assert.match(verification.mime, /To: <alice@example\.test>/);
  assert.match(verification.text, /https:\/\/kamekhax\.github\.io\/GlassChat\/verify-email\/#token=A{43}/);
  assert.doesNotMatch(verification.text, /\?token=/);
  assert.match(reset.text, /https:\/\/kamekhax\.github\.io\/GlassChat\/reset-password\/#token=B{43}/);
  assert.doesNotMatch(reset.text, /refresh-token-test-value|client-secret-test-value/);
});

test('Gmail API mailer rejects missing credentials and unsafe recipients before sending', async () => {
  const broken = env();
  delete broken.GMAIL_OAUTH_REFRESH_TOKEN;
  assert.throws(() => createMailer(broken, { fetch: async () => response(200) }), /GMAIL_OAUTH_CLIENT_ID.*GMAIL_OAUTH_REFRESH_TOKEN/);
  const mailer = createMailer(env(), { fetch: async () => { throw new Error('fetch must not be called'); } });
  await assert.rejects(mailer.sendVerification({ to: 'victim@example.test\r\nBcc:evil@example.test', username: 'x', token: 'C'.repeat(43) }), /valid email mailbox/);
});

test('production cannot use the console-only email adapter', () => {
  assert.throws(() => createMailer({ NODE_ENV: 'production', AUTH_EMAIL_MODE: 'console', APP_BASE_URL: 'https://kamekhax.github.io/GlassChat' }), /forbidden in production/);
});
