const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

async function migrate(pool, migrationsDir = path.join(__dirname, 'migrations')) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [0x474c415353]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
    const files = fs.readdirSync(migrationsDir).filter(x => /^\d+_[a-z0-9_-]+\.sql$/.test(x)).sort();
    for (const name of files) {
      if (applied.has(name)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
        await client.query('COMMIT');
        console.log(`Applied migration ${name}`);
      } catch (err) { await client.query('ROLLBACK'); throw err; }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [0x474c415353]).catch(() => {});
    client.release();
  }
}

function makePool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined;
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: Number(process.env.PG_POOL_MAX || 10), idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
}

if (require.main === module) {
  const pool = makePool();
  migrate(pool).then(() => pool.end()).catch(async err => { console.error('Migration failed:', err.message); await pool.end(); process.exitCode = 1; });
}
module.exports = { migrate, makePool };
