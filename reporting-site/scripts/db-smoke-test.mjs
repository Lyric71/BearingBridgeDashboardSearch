// Connection + schema smoke test. Run: node scripts/db-smoke-test.mjs
// Reads .env, connects with the secret key (bypasses RLS), and confirms every
// table from migrations/0001_init.sql exists and that board_columns is seeded.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (no dependency): KEY=VALUE lines, ignores # comments.
const env = {};
for (const line of readFileSync(join(here, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}

const url = env.SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error('✗ Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const TABLES = [
  'projects', 'board_columns', 'tasks', 'keywords',
  'serp_reports', 'serp_history', 'ads_snapshots',
];

let ok = true;
console.log(`→ ${url}\n`);

for (const t of TABLES) {
  const { count, error } = await db.from(t).select('*', { count: 'exact', head: true });
  if (error) {
    ok = false;
    console.log(`✗ ${t.padEnd(14)} ${error.message}`);
  } else {
    console.log(`✓ ${t.padEnd(14)} exists (${count} rows)`);
  }
}

// board_columns should have been seeded with 3 rows.
const { data: cols, error: colErr } = await db
  .from('board_columns').select('id,label').order('sort_order');
if (colErr) {
  ok = false;
  console.log(`\n✗ board_columns read error: ${colErr.message}`);
} else {
  const ids = (cols ?? []).map(c => c.id).join(', ');
  const seeded = (cols ?? []).length === 3;
  console.log(`\n${seeded ? '✓' : '✗'} board_columns seeded (${(cols ?? []).length}/3): [${ids}]`);
  if (!seeded) {
    ok = false;
    console.log('  → run supabase/seed.sql in the SQL editor to seed the kanban columns.');
  }
}

console.log(ok ? '\n✅ All good — connection + schema verified.' : '\n❌ Problems found (see above).');
process.exit(ok ? 0 : 1);
