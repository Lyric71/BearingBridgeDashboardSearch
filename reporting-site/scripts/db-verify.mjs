// Quick post-import verification: row counts + a few spot checks.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const l of readFileSync(join(here, '..', '.env'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2];
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

for (const t of ['projects', 'tasks', 'keywords', 'serp_reports', 'serp_history', 'ads_snapshots']) {
  const { count } = await db.from(t).select('*', { count: 'exact', head: true });
  console.log(t.padEnd(14), count);
}
const { data: p } = await db.from('projects').select('modules').eq('id', 'chinawebfoundry').single();
console.log('\nspot: chinawebfoundry modules =', JSON.stringify(p.modules));
const { count: cwfKw } = await db.from('keywords').select('*', { count: 'exact', head: true }).eq('project_id', 'chinawebfoundry');
console.log('spot: chinawebfoundry keywords =', cwfKw);
const { data: ov } = await db.from('serp_reports').select('indicators')
  .eq('project_id', 'chinawebfoundry').eq('cluster', '00-overview').single();
console.log('spot: overview indicators =', JSON.stringify(ov.indicators));
