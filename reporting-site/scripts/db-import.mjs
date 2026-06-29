// One-shot, idempotent importer: loads the current file-based data into Supabase.
// Run: node scripts/db-import.mjs
//
//   reporting-site/src/data/gtm.json        -> projects (+ tasks, first run only)
//   reporting-site/src/data/keywords.json   -> keywords         (upsert)
//   data/projects/<id>/competitors/*.md     -> serp_reports     (upsert)
//   seo/reports/*.md                        -> serp_reports (beyondbordergroup)
//   data/google_ads_performance.json        -> ads_snapshots    (upsert)
//
// Safe to re-run: everything upserts on a natural key. Tasks are only seeded
// when a project has none, so re-running never duplicates or wipes edits.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..');
const repoRoot = join(siteRoot, '..');

const env = {};
for (const line of readFileSync(join(siteRoot, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const yes = s => /^yes/i.test(String(s ?? ''));
const die = (label, error) => {
  if (error) { console.error(`✗ ${label}: ${error.message}`); process.exit(1); }
};

// ---- 1. projects + tasks (from gtm.json) ----------------------------------
const gtm = readJson(join(siteRoot, 'src', 'data', 'gtm.json'));

const projectRows = gtm.projects.map((p, i) => ({
  id: p.id,
  name: p.name,
  color: p.color,
  owner: p.owner ?? '',
  website: p.website ?? '',
  target_customers: p.targetCustomers ?? '',
  precise_targeting: p.preciseTargeting ?? '',
  rtb: p.rtb ?? '',
  email_target: p.emailTarget ?? '',
  channels: {
    seo: p.channels?.seo ?? '',
    sem: p.channels?.sem ?? '',
    email: p.channels?.email ?? '',
  },
  // Same rule the app used to seed modules from channels.
  modules: { kanban: true, seo: yes(p.channels?.seo), googleAds: yes(p.channels?.sem) },
  sort_order: i,
}));
die('projects', (await db.from('projects').upsert(projectRows, { onConflict: 'id' })).error);
console.log(`✓ projects: ${projectRows.length} upserted`);

let tasksInserted = 0, tasksSkipped = 0;
for (const p of gtm.projects) {
  const { count, error: cErr } = await db
    .from('tasks').select('*', { count: 'exact', head: true }).eq('project_id', p.id);
  die(`tasks count ${p.id}`, cErr);
  if (count > 0) { tasksSkipped += 1; continue; }   // already has tasks → don't touch
  const rows = (p.tasks ?? []).map((t, i) => ({
    project_id: p.id, title: t.title, status: t.status, sort_order: i,
  }));
  if (rows.length) {
    die(`tasks ${p.id}`, (await db.from('tasks').insert(rows)).error);
    tasksInserted += rows.length;
  }
}
console.log(`✓ tasks: ${tasksInserted} inserted, ${tasksSkipped} projects skipped (already had tasks)`);

// ---- 2. keywords (from keywords.json) -------------------------------------
const kw = readJson(join(siteRoot, 'src', 'data', 'keywords.json'));
const kwRows = [];
for (const [projectId, list] of Object.entries(kw.projects ?? {})) {
  for (const k of list) {
    kwRows.push({
      project_id: projectId,
      legacy_id: k.id ?? null,
      keyword: k.keyword,
      language: k.language ?? 'EN',
      intent: k.intent ?? null,
      cluster: k.cluster ?? null,
      priority: k.priority ?? null,
    });
  }
}
if (kwRows.length) {
  die('keywords', (await db.from('keywords')
    .upsert(kwRows, { onConflict: 'project_id,keyword,language' })).error);
}
console.log(`✓ keywords: ${kwRows.length} upserted`);

// ---- 3. serp_reports (competitor markdown) --------------------------------
// Parse "## Headline" bullets into { ranked, covered, total, index } (overview only).
function parseIndicators(rawIn) {
  const raw = rawIn.replace(/\r\n?/g, '\n'); // normalize CRLF so $ anchors correctly
  const start = raw.indexOf('## Headline');
  if (start < 0) return null;
  const section = raw.slice(start).split(/\n##\s/)[0];
  const out = {};
  for (const line of section.split('\n')) {
    const m = line.match(/^-\s*\*\*(.+?):\*\*\s*(.+)$/);
    if (!m) continue;
    const label = m[1].toLowerCase();
    const val = m[2].replace(/\*\*/g, '').trim();
    const frac = val.match(/(\d+)\s*\/\s*(\d+)/);
    if (label.includes('ranked') && frac) { out.ranked = +frac[1]; out.total = +frac[2]; }
    else if (label.includes('content') && frac) { out.covered = +frac[1]; }
    else if (label.includes('index')) { const n = val.match(/([\d.]+)/); if (n) out.index = +n[1]; }
  }
  return Object.keys(out).length ? out : null;
}
function reportMeta(rawIn, file) {
  const lines = rawIn.replace(/\r\n?/g, '\n').split('\n');
  const titleLine = lines.find(l => l.startsWith('# '));
  const title = titleLine
    ? titleLine.replace(/^#\s*SERP Report\s*[—-]\s*/, '').replace(/^#\s*/, '').trim()
    : file;
  const dateLine = lines.find(l => l.startsWith('Date:'));
  const dm = dateLine?.match(/(\d{4}-\d{2}-\d{2})/);
  return { title, report_date: dm ? dm[1] : null };
}
function collectReports(dir, projectId) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => {
      const raw = readFileSync(join(dir, f), 'utf8');
      const { title, report_date } = reportMeta(raw, f);
      return {
        project_id: projectId,
        cluster: f.replace(/\.md$/, ''),
        title, report_date,
        content_md: raw,
        indicators: parseIndicators(raw),
      };
    });
}

const reportRows = [];
// Per-project competitor reports.
for (const p of gtm.projects) {
  reportRows.push(...collectReports(join(repoRoot, 'data', 'projects', p.id, 'competitors'), p.id));
}
// Legacy fallback the app used for beyondbordergroup.
reportRows.push(...collectReports(join(repoRoot, 'seo', 'reports'), 'beyondbordergroup'));

if (reportRows.length) {
  die('serp_reports', (await db.from('serp_reports')
    .upsert(reportRows, { onConflict: 'project_id,cluster' })).error);
}
console.log(`✓ serp_reports: ${reportRows.length} upserted`);

// ---- 4. ads_snapshots (google_ads_performance.json) -----------------------
const adsPath = join(repoRoot, 'data', 'google_ads_performance.json');
if (existsSync(adsPath)) {
  const ads = readJson(adsPath);
  const row = {
    project_id: 'beyondbordergroup',   // account-level data, owned by BBG
    snapshot_date: ads.date,
    account: ads.account ?? null,
    currency: ads.currency ?? null,
    data: ads.timeframes ?? {},
  };
  die('ads_snapshots', (await db.from('ads_snapshots')
    .upsert(row, { onConflict: 'project_id,snapshot_date' })).error);
  console.log(`✓ ads_snapshots: 1 upserted (${ads.date}, ${Object.keys(ads.timeframes ?? {}).length} timeframes)`);
} else {
  console.log('• ads_snapshots: no google_ads_performance.json, skipped');
}

console.log('\n✅ Import complete.');
