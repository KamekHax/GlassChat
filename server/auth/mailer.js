const nodemailer = require('nodemailer');

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const MAILBOX = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function assertMailbox(raw, name) {
  const value = String(raw || '').trim();
  if (value.length > 254 || !MAILBOX.test(value)) throw new Error(`${name} must be a valid email mailbox`);
  return value;
}

function encodeHeader(value) {
  const safe = String(value ?? '').replace(/[\r\n]+/g, ' ');
  return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
}

function base64Body(text) {
  return Buffer.from(String(text), 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
}

function createMailer(env = process.env, options = {}) {
  const base = env.APP_BASE_URL;
  if (!base) throw new Error('APP_BASE_URL is required for account email links');
  let baseUrl;
  try { baseUrl = new URL(base); } catch { throw new Error('APP_BASE_URL must be a valid URL'); }
  if (!['https:', 'http:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error('APP_BASE_URL must be an HTTP(S) base URL without credentials, query, or fragment');
  if (env.NODE_ENV === 'production' && baseUrl.protocol !== 'https:') throw new Error('APP_BASE_URL must use HTTPS in production');
  const baseHref = baseUrl.href.replace(/\/+$/, '');
  const mode = env.AUTH_EMAIL_MODE || (env.NODE_ENV === 'production' ? 'gmail-api' : 'console');
  const link = (route, token) => `${baseHref}/${route}/#token=${encodeURIComponent(token)}`;

  if (mode === 'console') {
    if (env.NODE_ENV === 'production') throw new Error('Console email delivery is forbidden in production');
    const logger = options.logger || console;
    return {
      async sendVerification({ to, username, token }) { logger.warn(`[DEV ONLY] Verify ${to} (${username}) at ${link('verify-email', token)}`); },
      async sendPasswordReset({ to, username, token }) { logger.warn(`[DEV ONLY] Reset password for ${to} (${username}) at ${link('reset-password', token)}`); }
    };
  }

  if (mode === 'gmail-api') {
    const clientId = env.GMAIL_OAUTH_CLIENT_ID;
    const clientSecret = env.GMAIL_OAUTH_CLIENT_SECRET;
    const refreshToken = env.GMAIL_OAUTH_REFRESH_TOKEN;
    const sender = assertMailbox(env.GMAIL_FROM, 'GMAIL_FROM');
    if (!clientId || !clientSecret || !refreshToken) throw new Error('GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET and GMAIL_OAUTH_REFRESH_TOKEN are required');
    const fetchImpl = options.fetch || globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('A Fetch API implementation is required for Gmail API delivery');
    let cachedAccessToken = null;
    let expiresAt = 0;
    let refreshInFlight = null;

    async function getAccessToken() {
      if (cachedAccessToken && Date.now() < expiresAt - 60_000) return cachedAccessToken;
      if (!refreshInFlight) {
        refreshInFlight = (async () => {
          const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken });
          const response = await fetchImpl(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || typeof payload.access_token !== 'string' || !payload.access_token || !Number.isFinite(Number(payload.expires_in))) throw new Error(`Gmail OAuth refresh failed (${response.status})`);
          cachedAccessToken = payload.access_token;
          expiresAt = Date.now() + Math.max(0, Number(payload.expires_in)) * 1000;
          return cachedAccessToken;
        })().finally(() => { refreshInFlight = null; });
      }
      return refreshInFlight;
    }

    async function send(to, subject, text) {
      const recipient = assertMailbox(to, 'Recipient');
      const accessToken = await getAccessToken();
      const mime = [
        `From: GlassChat <${sender}>`,
        `To: <${recipient}>`,
        `Subject: ${encodeHeader(subject)}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        base64Body(text)
      ].join('\r\n');
      const raw = Buffer.from(mime, 'utf8').toString('base64url');
      const response = await fetchImpl(SEND_ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) });
      if (!response.ok) throw new Error(`Gmail API send failed (${response.status})`);
    }

    return {
      async sendVerification({ to, username, token }) {
        await send(to, 'Verify your GlassChat email', `Hi ${username},\n\nVerify your email address using this one-time link (valid for 30 minutes):\n${link('verify-email', token)}\n\nIf you did not create this account, you can ignore this email.`);
      },
      async sendPasswordReset({ to, username, token }) {
        await send(to, 'Reset your GlassChat password', `Hi ${username},\n\nReset your password using this one-time link (valid for one hour):\n${link('reset-password', token)}\n\nIf you did not request this, you can ignore this email.`);
      }
    };
  }

  if (mode === 'smtp') {
    if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS || !env.SMTP_FROM) throw new Error('SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM are required');
    const port = Number(env.SMTP_PORT || 587);
    const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port, secure: port === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }, requireTLS: env.NODE_ENV === 'production' && port !== 465, tls: { minVersion: 'TLSv1.2' } });
    const send = (to, subject, text) => transport.sendMail({ from: env.SMTP_FROM, to, subject, text });
    return {
      async sendVerification({ to, username, token }) { await send(to, 'Verify your GlassChat email', `Hi ${username},\n\nVerify your email address using this one-time link (valid for 30 minutes):\n${link('verify-email', token)}\n\nIf you did not create this account, you can ignore this email.`); },
      async sendPasswordReset({ to, username, token }) { await send(to, 'Reset your GlassChat password', `Hi ${username},\n\nReset your password using this one-time link (valid for one hour):\n${link('reset-password', token)}\n\nIf you did not request this, you can ignore this email.`); }
    };
  }

  throw new Error(`Unsupported AUTH_EMAIL_MODE: ${mode}`);
}

module.exports = { createMailer, assertMailbox };
