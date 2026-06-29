// Apply the SQL files in supabase/ to the database in DATABASE_URL.
// Run: node scripts/db-apply.mjs
// Surfaces the real Postgres error if any statement fails (unlike the
// dashboard, which rolls the whole script back as one transaction).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const env = {};
for (const line of readFileSync(join(here, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
if (!env.DATABASE_URL) {
  console.error('✗ Missing DATABASE_URL in .env');
  process.exit(1);
}

// Apply specific SQL files passed as args (relative to repo root), or the full
// initial setup by default.
const argFiles = process.argv.slice(2);
const files = argFiles.length
  ? argFiles.map(f => join(repoRoot, f))
  : [
      join(repoRoot, 'supabase', 'migrations', '0001_init.sql'),
      join(repoRoot, 'supabase', 'seed.sql'),
    ];

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log('→ connected\n');
  for (const f of files) {
    const sql = readFileSync(f, 'utf8');
    process.stdout.write(`applying ${f.replace(repoRoot, '.')} ... `);
    await client.query(sql); // simple-query protocol: runs the whole file
    console.log('ok');
  }
  // Ask PostgREST to refresh its schema cache so the REST API sees new tables.
  await client.query(`notify pgrst, 'reload schema';`);
  console.log('\n✅ Applied. PostgREST schema reload requested.');
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  if (err.position) console.error(`   at SQL position ${err.position}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
