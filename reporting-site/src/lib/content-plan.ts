// Server-side "Content Plan" generator. Two kinds of brief:
//   • 'landing' — a landing-page brief for ONE keyword (streamed Markdown).
//   • 'blog'    — a blog content plan for a whole keyword CLUSTER. Claude returns
//                 STRUCTURED JSON (a narrative + N article objects); each article
//                 becomes a blog_articles row that can be accepted/deleted and
//                 tracked to publication. New runs on a cluster with existing
//                 articles APPEND distinct new articles — they never replace or
//                 duplicate the existing (especially published) ones.
// Both pull live Google SERP + search-volume signals via DataForSEO, then ask
// Claude (claude-opus-4-8) to write the brief and persist to Supabase.
//
// Runs inside the Astro/Vercel SSR function. Called by
// src/pages/seo/content-plan-generate.ts, which streams every yielded event to
// the browser as Server-Sent Events.
import Anthropic from '@anthropic-ai/sdk';
import { marked } from 'marked';
import { db } from './db';
import {
  listArticlesForCluster, createBlogArticles,
  type BlogArticle, type BlogArticleInput,
} from './blog-articles-db';

// ── DataForSEO ────────────────────────────────────────────────────────────────
const LOCALE: Record<string, { location: number; language: string }> = {
  EN: { location: 2840, language: 'en' }, // United States / global English
  FR: { location: 2250, language: 'fr' }, // France
};
const localeFor = (lang: string) => LOCALE[lang?.toUpperCase()] ?? LOCALE.EN;

interface OrganicItem { type?: string; url?: string; title?: string; rank_absolute?: number; }
export interface Competitor { rank: number; domain: string; title: string; url: string; }
export interface Volume { volume: number; cpc: number; competition: number; }

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

function extractDomain(url: string): string {
  try { return url.split('/')[2].toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

function competitorsFromItems(items: OrganicItem[], topN: number): Competitor[] {
  const out: Competitor[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (it?.type !== 'organic' || !it.url) continue;
    const domain = extractDomain(it.url);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push({ rank: it.rank_absolute ?? out.length + 1, domain, title: it.title ?? '', url: it.url });
    if (out.length >= topN) break;
  }
  return out;
}

async function getCompetitors(keyword: string, lang: string, topN = 10): Promise<Competitor[]> {
  const { location, language } = localeFor(lang);
  const data = await dfsPost('/v3/serp/google/organic/live/regular', [{
    keyword, location_code: location, language_code: language, device: 'desktop', depth: 20,
  }]);
  const task = data?.tasks?.[0];
  if (task?.status_code !== 20000) return [];
  return competitorsFromItems((task?.result?.[0]?.items ?? []) as OrganicItem[], topN);
}

async function getCompetitorsBatch(keywords: string[], lang: string, topN = 3): Promise<Map<string, Competitor[]>> {
  const out = new Map<string, Competitor[]>();
  for (const k of keywords) out.set(k, []);
  if (keywords.length === 0) return out;
  const { location, language } = localeFor(lang);
  const payload = keywords.map(keyword => ({
    keyword, location_code: location, language_code: language, device: 'desktop', depth: 20,
  }));
  const data = await dfsPost('/v3/serp/google/organic/live/regular', payload);
  for (const task of data?.tasks ?? []) {
    const kw: string = task?.data?.keyword ?? task?.result?.[0]?.keyword ?? '';
    if (!out.has(kw) || task?.status_code !== 20000) continue;
    out.set(kw, competitorsFromItems((task?.result?.[0]?.items ?? []) as OrganicItem[], topN));
  }
  return out;
}

async function getVolume(keyword: string, lang: string): Promise<Volume | null> {
  const map = await getVolumes([keyword], lang);
  return map.get(keyword.toLowerCase()) ?? null;
}

async function getVolumes(keywords: string[], lang: string): Promise<Map<string, Volume>> {
  const vols = new Map<string, Volume>();
  if (keywords.length === 0) return vols;
  const { location, language } = localeFor(lang);
  const data = await dfsPost('/v3/keywords_data/google_ads/search_volume/live', [{
    keywords, location_code: location, language_code: language,
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

async function readClusterKeywords(projectId: string, cluster: string, language: string): Promise<string[]> {
  const { data, error } = await db
    .from('keywords').select('keyword')
    .eq('project_id', projectId).eq('cluster', cluster).eq('language', language)
    .order('keyword');
  if (error) throw new Error(error.message);
  return (data as { keyword: string }[]).map(r => r.keyword);
}

// ── Landing-page prompt (streamed Markdown) ──────────────────────────────────
function buildLandingPrompt(input: {
  keyword: string; language: string; intent: string; targetUrl: string;
  volume: Volume | null; competitors: Competitor[]; projectName: string;
}): string {
  const { keyword, language, intent, targetUrl, volume, competitors, projectName } = input;
  const vol = volume
    ? `Search volume: ${volume.volume.toLocaleString('en-US')}/mo · CPC: $${volume.cpc.toFixed(2)} · Competition index: ${volume.competition}/100`
    : 'Search volume: unavailable';
  const comps = competitors.length
    ? competitors.map(c => `${c.rank}. ${c.domain} — "${c.title}"\n   ${c.url}`).join('\n')
    : 'No competitor data available.';

  return `Write a competitive SEO content brief for a **new landing page** targeting the keyword "${keyword}".

Context
- Language of the target content: ${language}
- Search intent (as tagged by us): ${intent || 'unknown — infer it from the SERP'}
- ${vol}
${projectName ? `- Publishing site / brand: ${projectName}` : ''}
${targetUrl ? `- Target URL for the page: ${targetUrl}` : ''}

Top-ranking pages for this keyword (Google organic):
${comps}

Produce the brief in GitHub-flavored Markdown with these sections, in order:

1. **# Landing Page Plan — <keyword>** (H1 title)
2. **Target intent & angle** — one paragraph.
3. **Recommended title tag & H1** — 2–3 title-tag options (≤60 chars each) and one H1.
4. **Meta description** — one option, ≤155 chars.
5. **Outline** — the full H2/H3 structure with a suggested word count per H2, based on what competitors cover plus gap-closing sections.
6. **Entities & keywords to cover** — bullet list.
7. **Suggested internal links & CTAs** — specific to the intent.
8. **Competitive gap** — 2–4 bullets.
9. **Target length & format**.

Be specific and actionable — this goes straight to a writer. Output only the brief, no preamble.`;
}

// ── Blog cluster prompt (structured JSON) ────────────────────────────────────
function buildBlogPrompt(input: {
  cluster: string; language: string; blogBaseUrl: string; projectName: string;
  count: number; rows: { keyword: string; volume: Volume | null; competitors: Competitor[] }[];
  existing: BlogArticle[];
}): string {
  const { cluster, language, blogBaseUrl, projectName, count, rows, existing } = input;
  const kwLines = rows.map(r => {
    const v = r.volume ? `${r.volume.volume.toLocaleString('en-US')}/mo, CPC $${r.volume.cpc.toFixed(2)}` : 'volume n/a';
    const top = r.competitors.length ? r.competitors.map(c => c.domain).join(', ') : 'no SERP data';
    return `- "${r.keyword}" — ${v}. Top-ranking: ${top}`;
  }).join('\n');

  const existingBlock = existing.length
    ? `\nArticles that ALREADY EXIST for this cluster — you MUST NOT duplicate or substantially overlap these (especially the PUBLISHED ones). Propose genuinely different angles/topics that cover remaining gaps:\n` +
      existing.map(a => `- "${a.title}" [${a.status}${a.published ? ', PUBLISHED' : ''}] — primary keyword: ${a.primary_keyword ?? '?'}`).join('\n') + '\n'
    : '';

  return `Design ${count} NEW blog article${count === 1 ? '' : 's'} for the keyword cluster "${cluster}" — part of a hub-and-spoke blog that ranks for this cluster's keywords.

Context
- Language of the articles: ${language}
${projectName ? `- Publishing site / brand: ${projectName}` : ''}
- Blog base URL the articles live under: ${blogBaseUrl || '(not specified — use relative /blog/<slug> URLs for the slug field)'}

Keywords in this cluster (with live search volume and the domains ranking for them):
${kwLines || '(no keywords found for this cluster)'}
${existingBlock}
Return a JSON object with:
- overview: a one-paragraph Markdown overview of the cluster and the angle these new articles take.
- articles: EXACTLY ${count} article object${count === 1 ? '' : 's'}, each with: title; primary_keyword (choose from or closely related to the cluster keywords); secondary_keywords (array); intent; funnel_stage; est_words (integer); role ("Pillar" or "Supporting"); slug (a URL slug${blogBaseUrl ? ` to append to ${blogBaseUrl}` : ''}); outline_md (a concise Markdown H2/H3 outline, 3–6 headings, noting what each section covers).
- internal_linking: Markdown describing how these articles link to each other and to relevant service/landing pages.
- publishing_order: Markdown suggesting the order to publish and why.
- competitive_gap: Markdown, 2–4 bullets on what the ranking domains miss that this content can own.

Every proposed article must be distinct from the existing ones listed above. Be specific and actionable — this goes straight to an editor.`;
}

const BLOG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    overview: { type: 'string' },
    internal_linking: { type: 'string' },
    publishing_order: { type: 'string' },
    competitive_gap: { type: 'string' },
    articles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          primary_keyword: { type: 'string' },
          secondary_keywords: { type: 'array', items: { type: 'string' } },
          intent: { type: 'string' },
          funnel_stage: { type: 'string' },
          est_words: { type: 'integer' },
          role: { type: 'string', enum: ['Pillar', 'Supporting'] },
          slug: { type: 'string' },
          outline_md: { type: 'string' },
        },
        required: ['title', 'primary_keyword', 'secondary_keywords', 'intent', 'funnel_stage', 'est_words', 'role', 'slug', 'outline_md'],
      },
    },
  },
  required: ['overview', 'internal_linking', 'publishing_order', 'competitive_gap', 'articles'],
} as const;

interface BlogArticleJson {
  title: string; primary_keyword: string; secondary_keywords: string[];
  intent: string; funnel_stage: string; est_words: number; role: string;
  slug: string; outline_md: string;
}
interface BlogPlanJson {
  overview: string; internal_linking: string; publishing_order: string;
  competitive_gap: string; articles: BlogArticleJson[];
}

function blogNarrative(cluster: string, j: BlogPlanJson): string {
  return [
    `# Blog Content Plan — ${cluster}`, '',
    j.overview, '',
    '## Internal linking', '', j.internal_linking, '',
    '## Publishing order', '', j.publishing_order, '',
    '## Competitive gap', '', j.competitive_gap,
  ].join('\n');
}

// ── Events (mirror the refresh SSE protocol) ──────────────────────────────────
export type PlanKind = 'landing' | 'blog';
export type PlanEvent =
  | { event: 'phase'; msg: string }
  | { event: 'signals'; summary: string }
  | { event: 'token'; text: string }
  | { event: 'done'; kind: PlanKind; label: string; language: string; plan_md: string; html: string; indicators: object; planId?: string; articles?: BlogArticle[] }
  | { event: 'error'; msg: string };

export interface PlanInput {
  kind: PlanKind;
  keyword?: string;    // landing
  cluster?: string;    // blog
  language?: string;
  intent?: string;     // landing only
  targetUrl?: string;  // landing: target page URL · blog: blog base URL
  projectId?: string;
  projectName?: string;
  articleCount?: number; // blog: how many NEW articles to draft (default 1)
}

export async function* generateContentPlan(input: PlanInput): AsyncGenerator<PlanEvent> {
  const language = (input.language || 'EN').toUpperCase();
  const kind: PlanKind = input.kind === 'blog' ? 'blog' : 'landing';

  const apiKey = import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) { yield { event: 'error', msg: 'Missing ANTHROPIC_API_KEY env var.' }; return; }
  const client = new Anthropic({ apiKey });

  // ── Blog: structured, additive article proposals ──────────────────────────
  if (kind === 'blog') {
    const cluster = (input.cluster ?? '').trim();
    if (!cluster) { yield { event: 'error', msg: 'Cluster is required for a blog plan.' }; return; }
    if (!input.projectId) { yield { event: 'error', msg: 'A project is required for a blog plan.' }; return; }
    const count = Math.min(20, Math.max(1, input.articleCount ?? 1));

    let plan: BlogPlanJson;
    let existing: BlogArticle[] = [];
    let totalVol = 0;
    let keywordCount = 0;
    try {
      yield { event: 'phase', msg: `Loading keywords & existing articles for "${cluster}"…` };
      const [keywords, existingArticles] = await Promise.all([
        readClusterKeywords(input.projectId, cluster, language),
        listArticlesForCluster(input.projectId, cluster, language),
      ]);
      existing = existingArticles;
      keywordCount = keywords.length;
      if (keywords.length === 0) {
        yield { event: 'error', msg: `No ${language} keywords found in cluster "${cluster}".` };
        return;
      }

      yield { event: 'phase', msg: `Fetching live SERP & volume for ${keywords.length} keywords…` };
      const [serp, vols] = await Promise.all([
        getCompetitorsBatch(keywords, language),
        getVolumes(keywords, language),
      ]);
      const rows = keywords.map(k => ({
        keyword: k, volume: vols.get(k.toLowerCase()) ?? null, competitors: serp.get(k) ?? [],
      }));
      totalVol = rows.reduce((s, r) => s + (r.volume?.volume ?? 0), 0);
      yield {
        event: 'signals',
        summary: `${keywords.length} keywords · ${totalVol.toLocaleString('en-US')}/mo · ${existing.length} existing article${existing.length === 1 ? '' : 's'}`,
      };

      yield { event: 'phase', msg: `Drafting ${count} new article${count === 1 ? '' : 's'} with Claude…` };
      const prompt = buildBlogPrompt({
        cluster, language, blogBaseUrl: input.targetUrl ?? '', projectName: input.projectName ?? '',
        count, rows, existing,
      });
      const resp = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high', format: { type: 'json_schema', schema: BLOG_SCHEMA } },
        system: 'You are a senior SEO content strategist. You design blog content plans as structured data an editor can execute.',
        messages: [{ role: 'user', content: prompt }],
      });
      const text = resp.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('');
      plan = JSON.parse(text) as BlogPlanJson;
    } catch (err) {
      yield { event: 'error', msg: err instanceof Error ? err.message : String(err) };
      return;
    }

    yield { event: 'phase', msg: 'Saving…' };
    let created: BlogArticle[] = [];
    let planId = '';
    try {
      const plan_md = blogNarrative(cluster, plan);
      const indicators = { cluster, keywordCount, totalVolume: totalVol };
      const { data: planRow, error: upErr } = await db.from('content_plans').upsert({
        project_id: input.projectId || null,
        kind: 'blog', cluster, keyword: cluster, language,
        target_url: input.targetUrl || null, plan_md, indicators,
      }, { onConflict: 'kind,keyword,language' }).select('id').single();
      if (upErr) throw new Error(upErr.message);
      planId = (planRow as { id: string }).id;

      const startOrder = existing.reduce((mx, a) => Math.max(mx, a.sort_order), -1) + 1;
      const rows: BlogArticleInput[] = plan.articles.map((a, i) => ({
        content_plan_id: planId,
        project_id: input.projectId || null,
        cluster, language,
        sort_order: startOrder + i,
        title: a.title,
        primary_keyword: a.primary_keyword ?? null,
        secondary_keywords: Array.isArray(a.secondary_keywords) ? a.secondary_keywords.join(', ') : null,
        intent: a.intent ?? null,
        funnel_stage: a.funnel_stage ?? null,
        est_words: Number.isFinite(a.est_words) ? Math.round(a.est_words) : null,
        role: a.role ?? null,
        slug: a.slug ?? null,
        outline_md: a.outline_md ?? null,
      }));
      created = await createBlogArticles(rows);
    } catch (err) {
      yield { event: 'error', msg: `Draft ready but DB write failed: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }

    yield {
      event: 'done',
      kind: 'blog', label: cluster, language,
      plan_md: blogNarrative(cluster, plan),
      html: marked(blogNarrative(cluster, plan)) as string,
      indicators: { cluster, totalVolume: totalVol, newCount: created.length, existingCount: existing.length },
      planId, articles: created,
    };
    return;
  }

  // ── Landing: streamed Markdown brief ──────────────────────────────────────
  const keyword = (input.keyword ?? '').trim();
  if (!keyword) { yield { event: 'error', msg: 'Keyword is required.' }; return; }

  yield { event: 'phase', msg: 'Fetching live SERP & search volume…' };
  let competitors: Competitor[] = [];
  let volume: Volume | null = null;
  try {
    [competitors, volume] = await Promise.all([
      getCompetitors(keyword, language),
      getVolume(keyword, language),
    ]);
  } catch (err) {
    yield { event: 'error', msg: err instanceof Error ? err.message : String(err) };
    return;
  }
  yield {
    event: 'signals',
    summary: [
      volume ? `${volume.volume.toLocaleString('en-US')}/mo` : 'volume n/a',
      volume ? `CPC $${volume.cpc.toFixed(2)}` : null,
      `${competitors.length} competitors`,
    ].filter(Boolean).join(' · '),
  };

  yield { event: 'phase', msg: 'Writing the landing-page brief with Claude…' };
  let plan_md = '';
  try {
    const stream = client.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: 'You are a senior SEO content strategist. You write precise, competitive content briefs a writer can execute without further guidance.',
      messages: [{ role: 'user', content: buildLandingPrompt({
        keyword, language, intent: input.intent ?? '', targetUrl: input.targetUrl ?? '',
        volume, competitors, projectName: input.projectName ?? '',
      }) }],
    });
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        plan_md += ev.delta.text;
        yield { event: 'token', text: ev.delta.text };
      }
    }
  } catch (err) {
    yield { event: 'error', msg: err instanceof Error ? err.message : String(err) };
    return;
  }
  if (!plan_md.trim()) { yield { event: 'error', msg: 'Claude returned an empty brief.' }; return; }

  yield { event: 'phase', msg: 'Saving…' };
  const indicators = {
    volume: volume?.volume ?? null, cpc: volume?.cpc ?? null,
    competition: volume?.competition ?? null, intent: input.intent ?? null, competitors,
  };
  const { error } = await db.from('content_plans').upsert({
    project_id: input.projectId || null,
    kind: 'landing', cluster: null, keyword, language,
    target_url: input.targetUrl || null, plan_md, indicators,
  }, { onConflict: 'kind,keyword,language' });
  if (error) { yield { event: 'error', msg: `Saved brief but DB write failed: ${error.message}` }; return; }

  yield {
    event: 'done',
    kind: 'landing', label: keyword, language, plan_md,
    html: marked(plan_md) as string, indicators,
  };
}
