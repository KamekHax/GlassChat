const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const argon2 = require('argon2');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const randomBytes = promisify(crypto.randomBytes);

const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 };
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const TOKEN_TTL = { verify: '30 minutes', reset: '1 hour' };
const SESSION_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-glasschat_session' : 'glasschat_session';
const sha256 = value => crypto.createHash('sha256').update(value).digest();
const equalHex = (a, b) => {
  const aa = Buffer.from(String(a || ''), 'hex'), bb = Buffer.from(String(b || ''), 'hex');
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
};
const cookieValue = (req, name) => {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
};
const setCookie = (res, token, maxAgeSeconds) => {
  const bits = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
  if (process.env.NODE_ENV === 'production') bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
};
const clearCookie = res => {
  const bits = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
};
const publicUser = row => ({ id: row.id, username: row.username, email: row.email, emailVerified: Boolean(row.email_verified_at), profile: row.profile || {}, createdAt: row.created_at });
const usernameValid = x => /^[a-z0-9_]{3,24}$/.test(x);
const emailValid = x => x.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
const jsonOnly = (req, res, next) => req.is('application/json') ? next() : res.status(415).json({ error: 'JSON_REQUIRED' });
const appOriginCheck = (req, res, next) => {
  const origin = req.get('origin');
  const expected = process.env.APP_ORIGIN;
  if (origin && expected && origin !== expected) return res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
  if (process.env.NODE_ENV === 'production' && !expected) return res.status(500).json({ error: 'AUTH_ORIGIN_NOT_CONFIGURED' });
  next();
};
const testSkip = () => process.env.NODE_ENV === 'test';
const emailLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, skip: testSkip, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'TOO_MANY_REQUESTS' } });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skip: testSkip, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'TOO_MANY_REQUESTS' } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, skip: testSkip, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'TOO_MANY_REQUESTS' } });
const dummyHash = argon2.hash(crypto.randomBytes(32).toString('hex'), ARGON_OPTIONS);

function createAuthApp({ pool, mailer, logger = console }) {
  if (!pool || !mailer) throw new Error('createAuthApp requires a PostgreSQL pool and email adapter');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
  app.use(helmet());
  app.use((req, res, next) => {
    const origin = req.get('origin');
    const expected = process.env.APP_ORIGIN;
    if (origin && origin !== expected) return res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
    if (origin && expected) {
      res.setHeader('Access-Control-Allow-Origin', expected);
      res.vary('Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(204).end();
      }
    }
    if (req.method === 'OPTIONS') return res.status(404).end();
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'glasschat-auth' }));
  const api = express.Router();

  async function createSession(user, req, res) {
    const token = (await randomBytes(32)).toString('base64url');
    const csrf = (await randomBytes(32)).toString('base64url');
    const expiry = new Date(Date.now() + SESSION_TTL_MS);
    await pool.query('INSERT INTO auth_sessions(token_hash, csrf_hash, user_id, expires_at, user_agent) VALUES($1,$2,$3,$4,$5)', [sha256(token), sha256(csrf), user.id, expiry, String(req.get('user-agent') || '').slice(0, 512)]);
    setCookie(res, token, Math.floor(SESSION_TTL_MS / 1000));
    return csrf;
  }
  async function readSession(req) {
    const token = cookieValue(req, SESSION_COOKIE);
    if (!token || token.length > 128) return null;
    const result = await pool.query('SELECT s.token_hash, s.csrf_hash, s.user_id, s.expires_at, u.id, u.username, u.email, u.email_verified_at, u.profile, u.created_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > now()', [sha256(token)]);
    if (!result.rows[0]) return null;
    return { row: result.rows[0], tokenHash: sha256(token) };
  }
  async function requireSession(req, res, next) {
    try { req.auth = await readSession(req); if (!req.auth) return res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' }); next(); }
    catch (err) { logger.error('auth session lookup failed', err); res.status(503).json({ error: 'AUTH_SERVICE_UNAVAILABLE' }); }
  }
  function requireCsrf(req, res, next) {
    const supplied = req.get('x-csrf-token');
    if (!supplied || !equalHex(sha256(supplied).toString('hex'), Buffer.from(req.auth.row.csrf_hash).toString('hex'))) return res.status(403).json({ error: 'CSRF_CHECK_FAILED' });
    next();
  }
  async function issueEmailToken(table, userId, expires, send) {
    const raw = (await randomBytes(32)).toString('base64url');
    await pool.query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
    await pool.query(`INSERT INTO ${table}(token_hash,user_id,expires_at) VALUES($1,$2,now()+$3::interval)`, [sha256(raw), userId, expires]);
    await send(raw);
  }

  api.post('/register', jsonOnly, appOriginCheck, emailLimiter, async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!usernameValid(username)) return res.status(400).json({ error: 'INVALID_USERNAME', message: 'Use 3–24 lowercase letters, numbers, or underscores.' });
    if (!emailValid(email)) return res.status(400).json({ error: 'INVALID_EMAIL' });
    if (Array.from(password).length < 12 || Array.from(password).length > 128 || Buffer.byteLength(password, 'utf8') > 512) return res.status(400).json({ error: 'INVALID_PASSWORD', message: 'Password must be 12–128 characters.' });
    try {
      const hash = await argon2.hash(password, ARGON_OPTIONS);
      const raw = (await randomBytes(32)).toString('base64url');
      const result = await pool.query(`WITH created AS (INSERT INTO users(username,email,password_hash) VALUES($1,$2,$3) RETURNING id), enrolled AS (INSERT INTO community_memberships(community_id,user_id) SELECT c.id,created.id FROM communities c CROSS JOIN created WHERE c.slug='commons') INSERT INTO email_verification_tokens(token_hash,user_id,expires_at) SELECT $4,id,now()+$5::interval FROM created RETURNING user_id`, [username, email, hash, sha256(raw), TOKEN_TTL.verify]);
      const userId = result.rows[0].user_id;
      try { await mailer.sendVerification({ to: email, username, token: raw }); }
      catch (err) { logger.error('verification email delivery failed'); return res.status(503).json({ error: 'EMAIL_DELIVERY_UNAVAILABLE' }); }
      return res.status(202).json({ message: 'If the account can be created, a verification email will be sent.' });
    } catch (err) {
      if (err.code === '23505') {
        if (err.constraint === 'users_username_lower_unique') return res.status(409).json({ error: 'USERNAME_UNAVAILABLE' });
        return res.status(202).json({ message: 'If the account can be created, a verification email will be sent.' });
      }
      logger.error('registration failed', err); return res.status(503).json({ error: 'AUTH_SERVICE_UNAVAILABLE' });
    }
  });

  api.post('/login', jsonOnly, appOriginCheck, loginLimiter, async (req, res) => {
    const identity = String(req.body?.identity || '').trim().toLowerCase().slice(0, 254);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!identity || !password || password.length > 512) return res.status(400).json({ error: 'INVALID_CREDENTIALS' });
    try {
      const result = await pool.query('SELECT id,username,email,password_hash,email_verified_at,profile,created_at FROM users WHERE lower(email)=$1 OR lower(username)=$1 LIMIT 1', [identity]);
      const user = result.rows[0];
      const valid = await argon2.verify(user?.password_hash || await dummyHash, password).catch(() => false);
      if (!user || !valid || !user.email_verified_at) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      const csrfToken = await createSession(user, req, res);
      return res.json({ user: publicUser(user), csrfToken });
    } catch (err) { logger.error('login failed', err); return res.status(503).json({ error: 'AUTH_SERVICE_UNAVAILABLE' }); }
  });

  api.post('/verify-email', jsonOnly, appOriginCheck, emailLimiter, async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT t.user_id FROM email_verification_tokens t WHERE t.token_hash=$1 AND t.expires_at>now() FOR UPDATE', [sha256(token)]);
      if (!found.rows[0]) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN' }); }
      const userId = found.rows[0].user_id;
      await client.query('UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=$1', [userId]);
      await client.query('DELETE FROM email_verification_tokens WHERE user_id=$1', [userId]);
      await client.query('COMMIT');
      const result = await pool.query('SELECT id,username,email,email_verified_at,profile,created_at FROM users WHERE id=$1', [userId]);
      const csrfToken = await createSession(result.rows[0], req, res);
      return res.json({ user: publicUser(result.rows[0]), csrfToken });
    } catch (err) { await client.query('ROLLBACK').catch(() => {}); logger.error('email verification failed', err); return res.status(503).json({ error: 'AUTH_SERVICE_UNAVAILABLE' }); }
    finally { client.release(); }
  });

  api.post('/verification/resend', jsonOnly, appOriginCheck, emailLimiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    try {
      if (emailValid(email)) {
        const user = (await pool.query('SELECT id,username,email FROM users WHERE lower(email)=$1 AND email_verified_at IS NULL', [email])).rows[0];
        if (user) await issueEmailToken('email_verification_tokens', user.id, TOKEN_TTL.verify, token => mailer.sendVerification({ to: user.email, username: user.username, token }));
      }
    } catch (err) { logger.error('verification resend failed'); }
    return res.status(202).json({ message: 'If verification is needed, an email will be sent.' });
  });

  api.post('/password/forgot', jsonOnly, appOriginCheck, emailLimiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    try {
      if (emailValid(email)) {
        const user = (await pool.query('SELECT id,username,email FROM users WHERE lower(email)=$1 AND email_verified_at IS NOT NULL', [email])).rows[0];
        if (user) await issueEmailToken('password_reset_tokens', user.id, TOKEN_TTL.reset, token => mailer.sendPasswordReset({ to: user.email, username: user.username, token }));
      }
    } catch (err) { logger.error('password reset request processing failed'); }
    return res.status(202).json({ message: 'If an account exists, password reset instructions will be sent.' });
  });

  api.post('/password/reset', jsonOnly, appOriginCheck, emailLimiter, async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(token) || Array.from(password).length < 12 || Array.from(password).length > 128 || Buffer.byteLength(password, 'utf8') > 512) return res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN_OR_PASSWORD' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const match = await client.query('SELECT user_id FROM password_reset_tokens WHERE token_hash=$1 AND expires_at>now() FOR UPDATE', [sha256(token)]);
      if (!match.rows[0]) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN_OR_PASSWORD' }); }
      const userId = match.rows[0].user_id;
      const newHash = await argon2.hash(password, ARGON_OPTIONS);
      await client.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2', [newHash, userId]);
      await client.query('DELETE FROM auth_sessions WHERE user_id=$1', [userId]);
      await client.query('DELETE FROM password_reset_tokens WHERE user_id=$1', [userId]);
      await client.query('COMMIT');
      const realtime = req.app.locals.realtime;
      if (realtime) { realtime.in(`user:${userId}`).emit('session:expired'); realtime.in(`user:${userId}`).disconnectSockets(true); }
      clearCookie(res); return res.json({ message: 'Password reset. Please sign in again.' });
    } catch (err) { await client.query('ROLLBACK').catch(() => {}); logger.error('password reset failed', err); return res.status(503).json({ error: 'AUTH_SERVICE_UNAVAILABLE' }); }
    finally { client.release(); }
  });

  api.get('/me', authLimiter, requireSession, async (req, res) => res.json({ user: publicUser(req.auth.row) }));
  api.get('/communities', authLimiter, requireSession, async (req, res) => {
    try {
      const result = await pool.query(`SELECT c.id,c.slug,c.name,ch.id AS channel_id,ch.name AS channel_name,ch.topic AS channel_topic FROM communities c JOIN community_memberships m ON m.community_id=c.id LEFT JOIN channels ch ON ch.community_id=c.id WHERE m.user_id=$1 ORDER BY c.name,ch.name`, [req.auth.row.user_id]);
      const communities = new Map();
      for (const row of result.rows) {
        if (!communities.has(row.id)) communities.set(row.id, { id: row.id, slug: row.slug, name: row.name, channels: [] });
        if (row.channel_id) communities.get(row.id).channels.push({ id: row.channel_id, name: row.channel_name, topic: row.channel_topic });
      }
      res.json({ communities: [...communities.values()] });
    } catch (err) { logger.error('community list failed', err); res.status(503).json({ error: 'COMMUNITY_SERVICE_UNAVAILABLE' }); }
  });
  api.get('/channels/:channelId/messages', authLimiter, requireSession, async (req, res) => {
    try {
      const channel = await pool.query(`SELECT ch.id FROM channels ch JOIN community_memberships m ON m.community_id=ch.community_id WHERE ch.id=$1 AND m.user_id=$2`, [req.params.channelId, req.auth.row.user_id]);
      if (!channel.rows[0]) return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
      const messages = await pool.query(`SELECT msg.id,u.username AS "user",msg.text,msg.created_at AS time FROM messages msg JOIN users u ON u.id=msg.author_id WHERE msg.channel_id=$1 ORDER BY msg.created_at DESC,msg.id DESC LIMIT 100`, [req.params.channelId]);
      res.json({ messages: messages.rows.reverse() });
    } catch (err) { if (err.code === '22P02') return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' }); logger.error('message history failed', err); res.status(503).json({ error: 'COMMUNITY_SERVICE_UNAVAILABLE' }); }
  });
  api.get('/csrf', authLimiter, requireSession, async (req, res) => {
    try {
      const token = (await randomBytes(32)).toString('base64url');
      await pool.query('UPDATE auth_sessions SET csrf_hash=$1,last_seen_at=now() WHERE token_hash=$2', [sha256(token), req.auth.tokenHash]);
      res.json({ csrfToken: token });
    } catch (err) { logger.error('CSRF token rotation failed', err); res.status(503).json({ error: 'AUTH_SERVICE_UNAVAILABLE' }); }
  });
  api.post('/logout', jsonOnly, appOriginCheck, authLimiter, requireSession, requireCsrf, async (req, res) => {
    try {
      await pool.query('DELETE FROM auth_sessions WHERE token_hash=$1', [req.auth.tokenHash]);
      const realtime = req.app.locals.realtime, room = `session:${req.auth.tokenHash.toString('hex')}`;
      if (realtime) { realtime.in(room).emit('session:expired'); realtime.in(room).disconnectSockets(true); }
      clearCookie(res); res.status(204).end();
    }
    catch (err) { logger.error('logout failed', err); res.status(503).json({ error: 'AUTH_SERVICE_UNAVAILABLE' }); }
  });

  app.use('/api/auth', api);
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'REQUEST_TOO_LARGE' });
    logger.error('unhandled API error', err); return res.status(500).json({ error: 'INTERNAL_ERROR' });
  });
  return app;
}

module.exports = { createAuthApp, ARGON_OPTIONS, SESSION_TTL_MS };
