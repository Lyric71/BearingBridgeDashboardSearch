// Server-side port of seo/scripts/cwf_serp_ranking.py — the ChinaWebFoundry
// per-cluster "Refresh" that re-runs the live Google SERP ranking, rebuilds the
// cluster report + global overview, and persists them to Supabase (single source
// of truth). Runs inside the Astro/Vercel SSR function — no Python, no child
// process, no local files. Called by src/pages/seo/refresh.ts.
//
// Keyword LISTS come from the Supabase `keywords` table (project + cluster +
// language=EN). Cluster labels, ordering, and the keyword→on-site-content map
// are domain knowledge not in the DB, so they stay as static metadata here.
import { db } from './db';
import { marked } from 'marked';

const US = 'chinawebfoundry.com';
const BASE = 'https://www.chinawebfoundry.com';
const LOCATION_CODE = 2840; // United States / global English
const LANGUAGE_CODE = 'en';
const PROJECT_ID = 'chinawebfoundry';

// Generic / non-competitor domains we don't treat as "competitors".
const SKIP_DOMAINS = [
  'google.com', 'google.co', 'youtube.com', 'linkedin.com', 'facebook.com',
  'instagram.com', 'twitter.com', 'x.com', 'wikipedia.org', 'reddit.com',
  'quora.com', 'amazon.com', 'yelp.com', 'medium.com', 'github.com',
  'wordpress.org', 'wordpress.com', 'cloudflare.com', 'alibabacloud.com',
  'cloud.tencent.com', 'statista.com', 'gov.cn', 'trade.gov',
];

// The refresh button and serp_reports use ids like '05-baidu-china-seo'. The
// `keywords` table groups by human labels like 'Baidu & China SEO'. Bridge the
// two here. `label` is the heading used in the rendered report; `order` fixes
// the overview's cluster ordering; `dbCluster` is the keywords-table cluster.
export interface ClusterMeta { cid: string; label: string; dbCluster: string; }
export const CLUSTER_META: ClusterMeta[] = [
  { cid: '01-core-web-agency',      label: 'Core Service — Web Agency & China Websites', dbCluster: 'Core Service' },
  { cid: '02-wordpress-woocommerce', label: 'WordPress / WooCommerce in China',           dbCluster: 'WordPress / WooCommerce' },
  { cid: '03-hosting-icp-infra',    label: 'Hosting · ICP · Infrastructure',              dbCluster: 'Hosting & ICP' },
  { cid: '04-performance-firewall', label: 'Performance · Access · Great Firewall',       dbCluster: 'Performance & Firewall' },
  { cid: '05-baidu-china-seo',      label: 'Baidu & China SEO',                           dbCluster: 'Baidu & China SEO' },
  { cid: '06-ai-search-geo',        label: 'AI Search / GEO China',                       dbCluster: 'AI Search / GEO' },
  { cid: '07-localization-ux',      label: 'Localization · UX · Design Best Practices',   dbCluster: 'Localization & UX' },
  { cid: '08-compliance-legal',     label: 'Compliance · Legal',                          dbCluster: 'Compliance & Legal' },
  { cid: '09-digital-marketing',    label: 'Digital Marketing · Social · Campaigns',      dbCluster: 'Digital Marketing & Social' },
];
const CLUSTER_ORDER = CLUSTER_META.map(c => c.cid);
const META_BY_CID = new Map(CLUSTER_META.map(c => [c.cid, c]));

// Keyword → best on-site content (chinawebfoundry.com). null = content gap.
const G = '/resources/china-web-guide';
const S = '/services';
type Content = readonly [string, string] | null;
const CONTENT: Record<string, Content> = {
  // 01 core
  'web agency china':            ['/web-agency-china', 'Web Agency China (service hub)'],
  'china web design':            ['/web-agency-china', 'Web Agency China'],
  'chinese website design':      ['/web-agency-china', 'Web Agency China'],
  'chinese website development': ['/web-agency-china', 'Web Agency China'],
  'website in china':            ['/', 'Homepage'],
  'china website':               ['/', 'Homepage'],
  'china market entry website':  [`${S}/strategy-audit`, 'Strategy & Audit'],
  'cross border website china':  ['/web-agency-china', 'Web Agency China'],
  'bilingual website china':     ['/web-agency-china', 'Web Agency China'],
  // 02 wordpress
  'wordpress china':              ['/wordpress', 'WordPress in China'],
  'wordpress in china':           ['/wordpress', 'WordPress in China'],
  'make wordpress work in china': ['/wordpress', 'WordPress in China'],
  'woocommerce china':            ['/wordpress', 'WordPress in China'],
  // 03 hosting / icp
  'china web hosting':      [`${S}/china-hosting`, 'China Hosting'],
  'host website in china':  [`${G}/china-website-hosting-guide`, 'Guide: China Website Hosting'],
  'best china hosting':     [`${S}/china-hosting`, 'China Hosting'],
  'alibaba cloud hosting':  [`${G}/china-website-hosting-guide`, 'Guide: China Website Hosting'],
  'tencent cloud hosting':  [`${G}/china-website-hosting-guide`, 'Guide: China Website Hosting'],
  'china cdn':              [`${S}/china-hosting`, 'China Hosting'],
  '.cn domain registration': null,
  'icp license':            [`${G}/icp-licence-filing-foreign-companies`, 'Guide: ICP Licence & Filing'],
  'icp filing':             [`${G}/icp-licence-filing-foreign-companies`, 'Guide: ICP Licence & Filing'],
  'do i need an icp license': [`${G}/icp-licence-filing-foreign-companies`, 'Guide: ICP Licence & Filing'],
  'icp license cost':       [`${G}/icp-licence-filing-foreign-companies`, 'Guide: ICP Licence & Filing'],
  // 04 performance / firewall
  'why is my website slow in china': [`${G}/great-firewall-what-it-blocks`, 'Guide: Great Firewall'],
  'website not working in china':    ['/china-site-scanner', 'China Site Scanner (tool)'],
  'is my website blocked in china':  ['/china-site-scanner', 'China Site Scanner (tool)'],
  'speed up website in china':       [`${S}/technical-integration`, 'Technical Integration'],
  'great firewall website':          [`${G}/great-firewall-what-it-blocks`, 'Guide: Great Firewall'],
  'does google work in china':       [`${G}/great-firewall-what-it-blocks`, 'Guide: Great Firewall'],
  'is google blocked in china':      [`${G}/great-firewall-what-it-blocks`, 'Guide: Great Firewall'],
  'wechat browser compatibility':    ['/wechat', 'WeChat'],
  // 05 baidu / china seo
  'baidu seo':            [`${S}/baidu-seo`, 'Baidu SEO'],
  'baidu seo agency':     [`${S}/baidu-seo`, 'Baidu SEO'],
  'china seo':            [`${S}/baidu-seo`, 'Baidu SEO'],
  'how to rank on baidu': [`${G}/baidu-seo-ranking-in-china`, 'Guide: Baidu SEO Ranking'],
  'baidu tongji':         [`${G}/baidu-keyword-research-tools`, 'Guide: Baidu Keyword Tools'],
  'baidu index':          [`${G}/baidu-keyword-research-tools`, 'Guide: Baidu Keyword Tools'],
  'baidu webmaster tools': [`${G}/baidu-keyword-research-tools`, 'Guide: Baidu Keyword Tools'],
  'sogou seo':            [`${G}/china-search-landscape-beyond-baidu`, 'Guide: Search Landscape Beyond Baidu'],
  'baidu ads':            null,
  // 06 ai search / geo
  'geo china':                            [`${S}/geo`, 'GEO (Generative Engine Optimization)'],
  'generative engine optimization china': [`${S}/geo`, 'GEO'],
  'ai search optimization china':         [`${S}/geo`, 'GEO'],
  'baidu ai seo':                         [`${S}/geo`, 'GEO'],
  'deepseek seo':                         [`${S}/geo`, 'GEO'],
  'chinese ai search engines':            [`${G}/china-search-landscape-beyond-baidu`, 'Guide: Search Landscape Beyond Baidu'],
  'how to rank on chinese ai':            [`${S}/geo`, 'GEO'],
  // 07 localization / ux
  'china website localization':  [`${G}/china-website-localisation`, 'Guide: China Website Localisation'],
  'chinese website translation': [`${S}/chinese-content`, 'Chinese Content'],
  'mobile first design china':   [`${G}/mobile-first-design-china`, 'Guide: Mobile-First Design China'],
  'mobile only china':           [`${G}/mobile-first-design-china`, 'Guide: Mobile-First Design China'],
  'chinese web design best practices': [`${S}/ux-ui-design`, 'UX/UI Design'],
  'chinese ux design':           [`${S}/ux-ui-design`, 'UX/UI Design'],
  'wechat mini program development': ['/wechat', 'WeChat'],
  'hreflang china':              [`${G}/china-website-localisation`, 'Guide: China Website Localisation'],
  // 08 compliance / legal
  'china pipl':                                [`${G}/china-data-privacy-pipl-dsl`, 'Guide: China Data Privacy (PIPL/DSL)'],
  'china personal information protection law': [`${G}/china-data-privacy-pipl-dsl`, 'Guide: China Data Privacy (PIPL/DSL)'],
  'china data privacy law':                    [`${G}/china-data-privacy-pipl-dsl`, 'Guide: China Data Privacy (PIPL/DSL)'],
  'china cybersecurity law':                   [`${G}/china-data-privacy-pipl-dsl`, 'Guide: China Data Privacy (PIPL/DSL)'],
  'china data security law':                   [`${G}/china-data-privacy-pipl-dsl`, 'Guide: China Data Privacy (PIPL/DSL)'],
  'pipl website compliance':                   [`${G}/china-data-privacy-pipl-dsl`, 'Guide: China Data Privacy (PIPL/DSL)'],
  'china advertising law compliance':          null,
  // 09 digital marketing
  'digital marketing china': [`${G}/china-content-marketing-strategy`, 'Guide: China Content Marketing'],
  'china content marketing': [`${G}/china-content-marketing-strategy`, 'Guide: China Content Marketing'],
  'zhongcao marketing':      null,
  'xiaohongshu marketing':   null,
  'douyin marketing':        null,
  'kol marketing china':     null,
  'singles day china':       null,
  '618 shopping festival':   null,
};

// ── DataForSEO ────────────────────────────────────────────────────────────────
interface OrganicItem { type?: string; url?: string; rank_absolute?: number; }
interface Volume { volume: number; cpc: number; competition: number; }

function dfsAuth(): string {
  const login = import.meta.env.DATAFORSEO_LOGIN;
  const password = import.meta.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error('Missing DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD env vars.');
  }
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
}

async function dfsPost(endpoint: string, payload: unknown): Promise<any> {
  const res = await fetch(`https://api.dataforseo.com${endpoint}`, {
    method: 'POST',
    headers: { Authorization: dfsAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`DataForSEO ${endpoint} HTTP ${res.status}`);
  return res.json();
}

// Batch: one live/regular request carrying up to 100 tasks (one per keyword).
// Returns a map keyword → organic items (empty list if that task errored).
async function getSerpBatch(keywords: string[]): Promise<Map<string, OrganicItem[]>> {
  const out = new Map<string, OrganicItem[]>();
  for (const kw of keywords) out.set(kw, []); // default empty
  if (keywords.length === 0) return out;

  const payload = keywords.map(keyword => ({
    keyword, location_code: LOCATION_CODE, language_code: LANGUAGE_CODE,
    device: 'desktop', depth: 100,
  }));
  const data = await dfsPost('/v3/serp/google/organic/live/regular', payload);
  for (const task of data.tasks ?? []) {
    const kw: string = task?.data?.keyword ?? task?.result?.[0]?.keyword ?? '';
    if (!out.has(kw)) continue;
    if (task?.status_code !== 20000) continue; // leave as empty list
    const items: OrganicItem[] = (task?.result?.[0]?.items ?? []) as OrganicItem[];
    out.set(kw, items.filter(i => i?.type === 'organic'));
  }
  return out;
}

async function getVolumes(keywords: string[]): Promise<Map<string, Volume>> {
  const vols = new Map<string, Volume>();
  if (keywords.length === 0) return vols;
  const data = await dfsPost('/v3/keywords_data/google_ads/search_volume/live', [{
    keywords, location_code: LOCATION_CODE, language_code: LANGUAGE_CODE,
  }]);
  const task = data?.tasks?.[0];
  if (task?.status_code !== 20000) return vols;
  for (const it of task?.result ?? []) {
    const kw = (it?.keyword ?? '').toLowerCase();
    vols.set(kw, {
      volume: it?.search_volume ?? 0,
      cpc: Math.round((it?.cpc ?? 0) * 100) / 100,
      competition: it?.competition_index ?? 0,
    });
  }
  return vols;
}

// ── Helpers (ported 1:1 from the Python) ───────────────────────────────────────
function extractDomain(url: string): string {
  try {
    return url.split('/')[2].toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}
const isSkip = (domain: string) => SKIP_DOMAINS.some(s => domain.includes(s));

function fmt(r: number | null): string {
  if (r === null) return '—';
  if (r <= 3) return `**${r}**`;
  if (r <= 10) return String(r);
  return `*${r}*`;
}
const visIndex = (rank: number | null) => (rank === null ? 0 : Math.max(0, 101 - rank));

function discoverTopCompetitors(organicLists: OrganicItem[][], topN = 10) {
  const appear = new Map<string, number>();
  const rankSum = new Map<string, number>();
  for (const items of organicLists) {
    const seen = new Set<string>();
    for (const it of items) {
      const d = extractDomain(it.url ?? '');
      const r = it.rank_absolute ?? 999;
      if (!d || d === US || isSkip(d) || seen.has(d)) continue;
      appear.set(d, (appear.get(d) ?? 0) + 1);
      rankSum.set(d, (rankSum.get(d) ?? 0) + r);
      seen.add(d);
    }
  }
  const scored = [...appear.entries()].map(([d, c]) => {
    const avg = rankSum.get(d)! / c;
    return { d, score: c * 100 - avg };
  });
  scored.sort((a, b) => b.score - a.score);
  return { top10: scored.slice(0, topN).map(s => s.d), appear, rankSum };
}

function ranksFor(items: OrganicItem[], tracked: string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const t of tracked) out[t] = null;
  for (const it of items) {
    const url = it.url ?? '';
    const r = it.rank_absolute ?? null;
    const d = extractDomain(url);
    for (const t of tracked) {
      if ((t === d || url.includes('//' + t) || url.includes('.' + t)) && out[t] === null) {
        out[t] = r;
      }
    }
  }
  return out;
}

// ── Types ──────────────────────────────────────────────────────────────────────
export interface ClusterSummary {
  cid: string; label: string; n: number; ranked: number; covered: number;
  our_index: number; our_index_sum: number; rel: number;
  best_comp: string | null; best_idx: number;
}
export interface GlobalIndicators { ranked: number; covered: number; total: number; index: number; }
export interface Snapshot { cluster: ClusterSummary | null; global: GlobalIndicators; }
export interface DoneEntry { ts: string; cluster: string; label: string; before: Snapshot; after: Snapshot; }
export interface KeywordHistory {
  keyword: string;
  before_rank: number | null; after_rank: number | null;
  before_ts: string | null; after_ts: string | null;
}

// ── Report builders (ported from build_cluster / build_overview) ───────────────
function round1(x: number): number { return Math.round(x * 10) / 10; }

function buildCluster(
  cid: string, label: string, keywords: string[],
  organic: Map<string, OrganicItem[]>, volumes: Map<string, Volume>,
): { markdown: string; summary: ClusterSummary } {
  const lists = keywords.map(k => organic.get(k) ?? []);
  const { top10, appear, rankSum } = discoverTopCompetitors(lists);
  const tracked = [US, ...top10];

  const compIndexSum = new Map<string, number>();
  for (const d of tracked) compIndexSum.set(d, 0);

  interface Row { kw: string; rk: Record<string, number | null>; topDomain: string; content: Content; }
  const rows: Row[] = [];
  for (const kw of keywords) {
    const items = organic.get(kw) ?? [];
    const rk = ranksFor(items, tracked);
    const topDomain = items.length ? extractDomain(items[0].url ?? '') : '—';
    const content = CONTENT[kw.toLowerCase()] ?? null;
    rows.push({ kw, rk, topDomain, content });
    for (const d of tracked) compIndexSum.set(d, compIndexSum.get(d)! + visIndex(rk[d]));
  }

  const n = keywords.length;
  const today = new Date().toISOString().slice(0, 10);
  const cols = ['Volume', 'CPC', 'Comp.', '#1 Domain', US, ...top10, 'Our Content', 'Index/100'];
  const header = '| Keyword | ' + cols.join(' | ') + ' |';
  const sep = '|---|' + Array(cols.length).fill('---').join('|') + '|';

  const lines: string[] = [
    `# SERP Report — ${label}`,
    `Date: ${today} | google.com | Global (EN) | Depth: 100 | Tracking: ${US}`,
    '',
    '**Bold** = top 3 · plain = top 10 · *italic* = 11–100 · — = not ranked · Index/100 = our visibility (rank 1 = 100, unranked = 0)',
    '',
    header, sep,
  ];
  for (const { kw, rk, topDomain, content } of rows) {
    const v = volumes.get(kw.toLowerCase());
    const row: string[] = [
      v?.volume ? v.volume.toLocaleString('en-US') : '—',
      v?.cpc ? `$${v.cpc.toFixed(2)}` : '—',
      String(v?.competition ?? '—'),
      topDomain || '—',
    ];
    for (const d of tracked) row.push(fmt(rk[d]));
    row.push(content ? `[${content[1]}](${BASE}${content[0]})` : '— *(gap)*');
    row.push(String(visIndex(rk[US])));
    lines.push('| ' + kw + ' | ' + row.join(' | ') + ' |');
  }

  const ourIndexSumRaw = compIndexSum.get(US)!;
  const ourIdx = round1(ourIndexSumRaw / n);
  let best: { d: string | null; idx: number } = { d: null, idx: 0 };
  for (const d of top10) {
    const idx = compIndexSum.get(d)! / n;
    if (idx > best.idx) best = { d, idx };
  }
  const rel = best.idx ? round1((ourIdx / best.idx) * 100) : 100.0;
  const rankedN = rows.filter(r => r.rk[US] !== null).length;
  const coveredN = rows.filter(r => r.content).length;

  lines.push(
    '',
    '## Top 10 Competitors (auto-discovered)',
    '',
    '| Rank | Domain | Appearances | Avg Position | Visibility Index/100 |',
    '|---|---|---|---|---|',
  );
  const compTable = top10.map(d => ({
    d, c: appear.get(d)!, avg: round1(rankSum.get(d)! / appear.get(d)!), idx: round1(compIndexSum.get(d)! / n),
  }));
  compTable.forEach((c, i) => lines.push(`| ${i + 1} | ${c.d} | ${c.c}/${n} | ${c.avg} | ${c.idx} |`));

  lines.push(
    '',
    '## Ranking Index — ChinaWebFoundry vs Competitors',
    '',
    `- **Keywords ranked (top 100):** ${rankedN}/${n}`,
    `- **Keywords with on-site content:** ${coveredN}/${n}`,
    `- **ChinaWebFoundry visibility index:** **${round1(ourIndexSumRaw / n)}/100**`,
    `- **Strongest competitor:** ${best.d ?? '—'} (${round1(best.idx)}/100)`,
    `- **Competitive index (us ÷ strongest competitor):** **${rel}/100**`,
    '',
    '| Entity | Visibility Index/100 |',
    '|---|---|',
    `| **${US} (us)** | **${round1(ourIndexSumRaw / n)}** |`,
  );
  for (const c of compTable) lines.push(`| ${c.d} | ${c.idx} |`);

  const summary: ClusterSummary = {
    cid, label, n, ranked: rankedN, covered: coveredN,
    our_index: round1(ourIndexSumRaw / n), our_index_sum: Math.round(ourIndexSumRaw * 1e4) / 1e4,
    rel, best_comp: best.d, best_idx: round1(best.idx),
  };
  return { markdown: lines.join('\n'), summary };
}

function buildOverview(summaries: ClusterSummary[]): { markdown: string; indicators: GlobalIndicators } {
  const today = new Date().toISOString().slice(0, 10);
  const total = summaries.reduce((s, x) => s + x.n, 0);
  const ranked = summaries.reduce((s, x) => s + x.ranked, 0);
  const covered = summaries.reduce((s, x) => s + x.covered, 0);
  const ourSum = summaries.reduce((s, x) => s + (x.our_index_sum ?? x.our_index * x.n), 0);
  const ourAvg = total ? round1(ourSum / total) : 0;

  const lines: string[] = [
    '# SERP Report — 00 Overview (All Clusters)',
    `Date: ${today} | google.com | Global (EN) | Depth: 100 | Tracking: ${US}`,
    '',
    `Across **${total}** English buyer-intent keywords (Google organic, global EN).`,
    '',
    '## Headline',
    '',
    `- **Keywords ranked in top 100:** ${ranked}/${total}`,
    `- **Keywords with dedicated on-site content:** ${covered}/${total}`,
    `- **Overall ChinaWebFoundry visibility index:** **${ourAvg}/100**`,
    '',
    '## By Cluster',
    '',
    '| Cluster | Keywords | We rank | Content | Our Index/100 | Top competitor | Their Index | Us vs them /100 |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    lines.push(
      `| ${s.label} | ${s.n} | ${s.ranked}/${s.n} | ${s.covered}/${s.n} | ` +
      `${s.our_index} | ${s.best_comp ?? '—'} | ${s.best_idx} | ${s.rel} |`,
    );
  }
  lines.push(
    '',
    '## Top 10 Competitors (auto-discovered)',
    '',
    'Per-cluster competitor tables are in each cluster report. The strongest competitor',
    'per cluster is listed above; open a cluster below for its full top-10 and per-keyword ranks.',
  );
  return { markdown: lines.join('\n'), indicators: { ranked, covered, total, index: ourAvg } };
}

// ── Summary state (rebuild the overview from every cluster, DB-backed) ─────────
// Prefer the summary stored in serp_reports.indicators (written by a prior TS
// refresh); else reconstruct from the report body (rows imported from the old
// Python/file flow). Mirrors parse_cluster_md + read_summaries.
function parseClusterSummary(cid: string, raw: string): ClusterSummary | null {
  raw = raw.replace(/\r\n?/g, '\n');
  const meta = META_BY_CID.get(cid);
  const num = (re: RegExp): number | null => {
    const m = raw.match(re);
    return m ? Number(m[1]) : null;
  };
  const ranked = num(/Keywords ranked \(top 100\):\*\*\s*(\d+)\//);
  const n = num(/Keywords ranked \(top 100\):\*\*\s*\d+\/(\d+)/);
  const covered = num(/Keywords with on-site content:\*\*\s*(\d+)\//);
  let index = num(/ChinaWebFoundry visibility index:\*\*\s*\*\*([\d.]+)\/100/);
  if (n === null) return null;
  const bm = raw.match(/Strongest competitor:\*\*\s*(.+?)\s*\(([\d.]+)\/100\)/);
  const rel = num(/Competitive index.*?\*\*\s*\*\*([\d.]+)\/100/);
  index = index ?? 0;
  return {
    cid, label: meta?.label ?? cid, n,
    ranked: ranked ?? 0, covered: covered ?? 0,
    our_index: index, our_index_sum: Math.round(index * n * 1e4) / 1e4,
    rel: rel ?? 0,
    best_comp: bm && bm[1] !== '—' ? bm[1] : null,
    best_idx: bm ? Number(bm[2]) : 0,
  };
}

function isFullSummary(o: unknown): o is ClusterSummary {
  return !!o && typeof o === 'object' && 'our_index_sum' in (o as object) && 'n' in (o as object);
}

// cid → summary for every cluster that has a report, keyed & ordered by CLUSTER_ORDER.
async function readSummaries(overrideCid?: string, override?: ClusterSummary): Promise<Map<string, ClusterSummary>> {
  const { data, error } = await db
    .from('serp_reports')
    .select('cluster,content_md,indicators')
    .eq('project_id', PROJECT_ID);
  if (error) throw new Error(error.message);

  const out = new Map<string, ClusterSummary>();
  for (const r of data as { cluster: string; content_md: string; indicators: unknown }[]) {
    if (r.cluster === '00-overview' || !META_BY_CID.has(r.cluster)) continue;
    const s = isFullSummary(r.indicators)
      ? r.indicators as ClusterSummary
      : parseClusterSummary(r.cluster, r.content_md ?? '');
    if (s) out.set(r.cluster, s);
  }
  if (overrideCid && override) out.set(overrideCid, override);
  return out;
}

function orderedSummaries(byCid: Map<string, ClusterSummary>): ClusterSummary[] {
  return CLUSTER_ORDER.filter(c => byCid.has(c)).map(c => byCid.get(c)!);
}

function globalIndicators(byCid: Map<string, ClusterSummary>): GlobalIndicators {
  const summaries = orderedSummaries(byCid);
  const total = summaries.reduce((s, x) => s + x.n, 0);
  const ourSum = summaries.reduce((s, x) => s + (x.our_index_sum ?? x.our_index * x.n), 0);
  return {
    ranked: summaries.reduce((s, x) => s + x.ranked, 0),
    covered: summaries.reduce((s, x) => s + x.covered, 0),
    total,
    index: total ? round1(ourSum / total) : 0,
  };
}

// ── DB writes ──────────────────────────────────────────────────────────────────
async function upsertReport(row: {
  cluster: string; title: string; report_date: string; content_md: string; indicators: object;
}): Promise<void> {
  const { error } = await db.from('serp_reports')
    .upsert({ project_id: PROJECT_ID, ...row }, { onConflict: 'project_id,cluster' });
  if (error) throw new Error(error.message);
}

// ── Progress events (mirror the Python emit() protocol) ────────────────────────
export type RefreshEvent =
  | { event: 'start'; cluster: string; label: string; n: number; keywords: string[]; before: Snapshot }
  | { event: 'keyword'; i: number; n: number; kw: string; rank: number | null; ok: boolean }
  | { event: 'phase'; msg: string }
  | {
      event: 'done'; ts: string; cluster: string; label: string;
      before: Snapshot; after: Snapshot;
      // Rendered HTML so the page can swap the cluster's tables in place —
      // reflecting keywords added on /seo/keywords since the last refresh,
      // without a full reload.
      rankHtml: string; scoreHtml: string;
      // Per-keyword before → after ranks, so the page can re-render the
      // per-keyword Refresh History live.
      keywordHistory: KeywordHistory[];
    }
  | { event: 'error'; msg: string };

// Split a cluster report the same way /seo/competitors does and render each
// half to HTML (rank table + auto-discovered competitors table).
function renderReportSections(markdown: string): { rankHtml: string; scoreHtml: string } {
  const raw = markdown.replace(/\r\n?/g, '\n');
  const sep = raw.indexOf('## Top 10 Competitors');
  const rankSection = sep > -1 ? raw.slice(0, sep) : raw;
  const scoreSection = sep > -1 ? raw.slice(sep) : '';
  return { rankHtml: marked(rankSection) as string, scoreHtml: marked(scoreSection) as string };
}

async function readClusterKeywords(dbCluster: string): Promise<string[]> {
  const { data, error } = await db
    .from('keywords')
    .select('keyword')
    .eq('project_id', PROJECT_ID)
    .eq('cluster', dbCluster)
    .eq('language', 'EN')
    .order('keyword');
  if (error) throw new Error(error.message);
  return (data as { keyword: string }[]).map(r => r.keyword);
}

// Core generator: refresh ONE cluster, yielding progress events. The caller
// streams each event to the browser as SSE. All DB writes happen inline.
export async function* refreshCluster(cid: string): AsyncGenerator<RefreshEvent> {
  const meta = META_BY_CID.get(cid);
  if (!meta) { yield { event: 'error', msg: `unknown cluster: ${cid}` }; return; }

  const keywords = await readClusterKeywords(meta.dbCluster);
  if (keywords.length === 0) {
    yield { event: 'error', msg: `No EN keywords found for cluster "${meta.label}".` };
    return;
  }

  const beforeByCid = await readSummaries();
  const before: Snapshot = { cluster: beforeByCid.get(cid) ?? null, global: globalIndicators(beforeByCid) };
  yield { event: 'start', cluster: cid, label: meta.label, n: keywords.length, keywords, before };

  // Batch: one DataForSEO request for all keywords in the cluster.
  const organic = await getSerpBatch(keywords);

  // Stream per-keyword results so the checklist fills in keyword-by-keyword.
  let i = 0;
  const usRanks = new Map<string, number | null>(); // keyword → our rank this run
  for (const kw of keywords) {
    i++;
    const items = organic.get(kw) ?? [];
    const rank = items.find(it => extractDomain(it.url ?? '').includes(US))?.rank_absolute ?? null;
    usRanks.set(kw, rank);
    yield { event: 'keyword', i, n: keywords.length, kw, rank, ok: items.length > 0 };
  }

  yield { event: 'phase', msg: 'Fetching search volumes…' };
  const volumes = await getVolumes(keywords);

  yield { event: 'phase', msg: 'Building report…' };
  const { markdown, summary } = buildCluster(cid, meta.label, keywords, organic, volumes);
  const today = new Date().toISOString().slice(0, 10);
  await upsertReport({
    cluster: cid, title: meta.label, report_date: today,
    content_md: markdown, indicators: summary,
  });

  // Rebuild the global overview from every cluster (this one now updated).
  const afterByCid = await readSummaries(cid, summary);
  const { markdown: ovMd, indicators: ovInd } = buildOverview(orderedSummaries(afterByCid));
  await upsertReport({
    cluster: '00-overview', title: '00 Overview (All Clusters)', report_date: today,
    content_md: ovMd, indicators: ovInd,
  });

  const after: Snapshot = { cluster: summary, global: ovInd };
  const entry: DoneEntry = { ts: today, cluster: cid, label: meta.label, before, after };

  // Per-keyword refresh history: one row per keyword (the latest refresh). The
  // "before" rank is the previous refresh's rank; the "after" is this run's.
  // Read the previous rows first, then replace the cluster's rows entirely so
  // exactly the current keyword set is kept (removed keywords drop out).
  const { data: prevRows, error: prevErr } = await db.from('serp_keyword_history')
    .select('keyword,after_rank,after_ts').eq('project_id', PROJECT_ID).eq('cluster', cid);
  if (prevErr) throw new Error(prevErr.message);
  const prev = new Map((prevRows as { keyword: string; after_rank: number | null; after_ts: string | null }[])
    .map(r => [r.keyword, r]));

  const keywordHistory: KeywordHistory[] = keywords.map(kw => {
    const p = prev.get(kw);
    return {
      keyword: kw,
      before_rank: p?.after_rank ?? null,
      after_rank: usRanks.get(kw) ?? null,
      before_ts: p?.after_ts ?? null,
      after_ts: today,
    };
  });

  const { error: delErr } = await db.from('serp_keyword_history')
    .delete().eq('project_id', PROJECT_ID).eq('cluster', cid);
  if (delErr) throw new Error(delErr.message);
  const { error: khErr } = await db.from('serp_keyword_history')
    .insert(keywordHistory.map(k => ({ project_id: PROJECT_ID, cluster: cid, ...k })));
  if (khErr) throw new Error(khErr.message);

  const { rankHtml, scoreHtml } = renderReportSections(markdown);
  yield { event: 'done', ...entry, rankHtml, scoreHtml, keywordHistory };
}
