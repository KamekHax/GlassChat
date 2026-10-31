const http = require('node:http');
const { createAuthApp } = require('./app');
const { makePool } = require('./migrate');
const { createMailer } = require('./mailer');
const { attachRealtime } = require('./realtime');

async function main() {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.APP_ORIGIN || new URL(process.env.APP_ORIGIN).protocol !== 'https:' || new URL(process.env.APP_ORIGIN).origin !== process.env.APP_ORIGIN) throw new Error('Production requires APP_ORIGIN to be an HTTPS origin (no path or trailing slash)');
    if (process.env.TRUST_PROXY !== '1') throw new Error('Production requires TRUST_PROXY=1 behind exactly one trusted HTTPS reverse proxy');
    if (process.env.AUTH_HOST !== '0.0.0.0') throw new Error('Production requires AUTH_HOST=0.0.0.0 for the hosted service listener');
  }
  const pool = makePool();
  await pool.query('SELECT 1');
  const mailer = createMailer();
  const app = createAuthApp({ pool, mailer });
  const server = http.createServer(app);
  const io = attachRealtime(server, { pool });
  app.locals.realtime = io;
  const expirySweep = setInterval(async () => {
    try {
      const expired = await pool.query("DELETE FROM auth_sessions WHERE expires_at < now() RETURNING encode(token_hash,'hex') AS token_hash");
      for (const row of expired.rows) { const room = `session:${row.token_hash}`; io.in(room).emit('session:expired'); io.in(room).disconnectSockets(true); }
    } catch { console.error('Expired session cleanup failed'); }
  }, 60 * 1000).unref();
  const tokenCleanup = setInterval(() => {
    pool.query('DELETE FROM email_verification_tokens WHERE expires_at < now()').then(() => pool.query('DELETE FROM password_reset_tokens WHERE expires_at < now()')).catch(() => console.error('Expired token cleanup failed'));
  }, 6 * 60 * 60 * 1000).unref();
  const port = Number(process.env.PORT || process.env.AUTH_PORT || 3211);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT/AUTH_PORT must be an integer from 1 to 65535');
  const host = process.env.AUTH_HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`GlassChat auth API listening on ${host}:${port}`));
  const stop = signal => { console.log(`Received ${signal}; closing auth API`); clearInterval(expirySweep); clearInterval(tokenCleanup); io.close(() => server.close(async () => { await pool.end(); process.exit(0); })); setTimeout(() => process.exit(1), 10000).unref(); };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}
main().catch(err => { console.error('GlassChat auth startup failed:', err.message); process.exit(1); });
