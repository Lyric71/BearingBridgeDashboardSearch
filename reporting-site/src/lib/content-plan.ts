// Server-side "Content Plan" generator. For ONE keyword it:
//   1. pulls the live Google SERP (top organic results) + search volume via
//      DataForSEO — the same paid API the /seo/refresh flow uses,
//   2. asks Claude (claude-opus-4-8) to write a competitive content brief from
//      those signals, streaming the brief token-by-token,
//   3. persists the finished brief + the SERP signals to Supabase
//      (content_plans, single source of truth).
//
// Runs inside the Astro/Vercel SSR function — no Python, no child process, no
// local files. Called by src/pages/seo/content-plan.ts, which streams every
// yielded event to the browser as Server-Sent Events. Mirrors the shape of
// src/lib/cwf-serp.ts's refreshCluster generator.
import Anthropic from '@anthropic-ai/sdk';
import { marked } from 'marked';
import { db } from './db';

// ── DataForSEO ────────────────────────────────────────────────────────────────
// Map the keyword's language to a DataForSEO (location_code, language_code).
// Defaults to global English, matching the rest of the SEO dashboard.
const LOCALE: Record<string, { location: number; language: string }> = {
  EN: { location: 2840, language: 'en' }, // United States / global English
  FR: { location: 2250, language: 'fr' }, // France
};
const localeFor = (lang: string) => LOCALE[lang?.toUpperCase()] ?? LOCALE.EN;

interface OrganicItem { type?: string; url?: string; title?: string; rank_absolute?: number; }
export interface Competitor { rank: number; domain: string; title: string; url: string; }

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
  try {
    return url.split('/')[2].toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Top organic competitors for the keyword (deduped by domain, best rank kept).
async function getCompetitors(keyword: string, lang: string, topN = 10): Promise<Competitor[]> {
  const { location, language } = localeFor(lang);
  const data = await dfsPost('/v3/serp/google/organic/live/regular', [{
    keyword, location_code: location, language_code: language, device: 'desktop', depth: 20,
  }]);
  const task = data?.tasks?.[0];
  if (task?.status_code !== 20000) return [];
  const items: OrganicItem[] = (task?.result?.[0]?.items ?? []) as OrganicItem[];
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

export interface Volume { volume: number; cpc: number; competition: number; }

async function getVolume(keyword: string, lang: string): Promise<Volume | null> {
  const { location, language } = localeFor(lang);
  const data = await dfsPost('/v3/keywords_data/google_ads/search_volume/live', [{
    keywords: [keyword], location_code: location, language_code: language,
  }]);
  const task = data?.tasks?.[0];
  if (task?.status_code !== 20000) return null;
  const it = task?.result?.[0];
  if (!it) return null;
  return {
    volume: it.search_volume ?? 0,
    cpc: Math.round((it.cpc ?? 0) * 100) / 100,
    competition: it.competition_index ?? 0,
  };
}

// ── Claude prompt ────────────────────────────────────────────────────────────
function buildPrompt(input: {
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

  return `Write a competitive SEO content brief for a **new page** targeting the keyword "${keyword}".

Context
- Language of the target content: ${language}
- Search intent (as tagged by us): ${intent || 'unknown — infer it from the SERP'}
- ${vol}
${projectName ? `- Publishing site / brand: ${projectName}` : ''}
${targetUrl ? `- Target URL for the page: ${targetUrl}` : ''}

Top-ranking pages for this keyword (Google organic):
${comps}

Produce the brief in GitHub-flavored Markdown with these sections, in order:

1. **# Content Plan — <keyword>** (H1 title)
2. **Target intent & angle** — one paragraph: the dominant intent behind the query and the unique angle this page should take to win.
3. **Recommended title tag & H1** — 2–3 title-tag options (≤60 chars each) and one H1.
4. **Meta description** — one option, ≤155 chars.
5. **Outline** — the full H2/H3 structure. For each H2 give a suggested word count and a one-line note on what it must cover. Base the structure on what the top competitors cover, then add sections that close their gaps.
6. **Entities & keywords to cover** — a bullet list of subtopics, entities, and semantically related terms the page must include.
7. **Suggested internal links & CTAs** — what to link to and where to place the primary CTA (be specific to the intent).
8. **Competitive gap** — 2–4 bullets: what the current top results are missing that this page can own.
9. **Target length & format** — total word count and format guidance (list-heavy, comparison table, step-by-step, etc.).

Be specific and actionable — this brief goes straight to a writer. Do not include preamble or closing remarks; output only the brief.`;
}

// ── Events (mirror the refresh SSE protocol) ──────────────────────────────────
export type PlanEvent =
  | { event: 'phase'; msg: string }
  | { event: 'signals'; volume: Volume | null; competitors: Competitor[] }
  | { event: 'token'; text: string }
  | { event: 'done'; keyword: string; language: string; plan_md: string; html: string; indicators: object }
  | { event: 'error'; msg: string };

export interface PlanInput {
  keyword: string;
  language?: string;
  intent?: string;
  targetUrl?: string;
  projectId?: string;
  projectName?: string;
}

// Core generator: build a content plan for ONE keyword, yielding progress
// events. The caller streams each event to the browser as SSE.
export async function* generateContentPlan(input: PlanInput): AsyncGenerator<PlanEvent> {
  const keyword = input.keyword.trim();
  const language = (input.language || 'EN').toUpperCase();
  if (!keyword) { yield { event: 'error', msg: 'Keyword is required.' }; return; }

  const apiKey = import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) { yield { event: 'error', msg: 'Missing ANTHROPIC_API_KEY env var.' }; return; }

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
  yield { event: 'signals', volume, competitors };

  yield { event: 'phase', msg: 'Writing the content brief with Claude…' };
  const client = new Anthropic({ apiKey });
  const prompt = buildPrompt({
    keyword, language, intent: input.intent ?? '', targetUrl: input.targetUrl ?? '',
    volume, competitors, projectName: input.projectName ?? '',
  });

  let plan_md = '';
  try {
    const stream = client.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: 'You are a senior SEO content strategist. You write precise, competitive content briefs that a writer can execute without further guidance.',
      messages: [{ role: 'user', content: prompt }],
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
    volume: volume?.volume ?? null,
    cpc: volume?.cpc ?? null,
    competition: volume?.competition ?? null,
    intent: input.intent ?? null,
    competitors,
  };
  const { error } = await db.from('content_plans').upsert({
    project_id: input.projectId || null,
    keyword,
    language,
    target_url: input.targetUrl || null,
    plan_md,
    indicators,
  }, { onConflict: 'keyword,language' });
  if (error) { yield { event: 'error', msg: `Saved brief but DB write failed: ${error.message}` }; return; }

  yield {
    event: 'done',
    keyword, language, plan_md,
    html: marked(plan_md) as string,
    indicators,
  };
}
