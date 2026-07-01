// Production "Generate" endpoint for /seo/content-plan. Builds an AI content
// brief for ONE keyword server-side (live SERP via DataForSEO + Claude),
// persists it to Supabase, and streams progress to the browser as Server-Sent
// Events. Runs in the Astro/Vercel SSR function — works in `astro dev` AND in
// production. Mirrors the exposure of src/pages/seo/refresh.ts (unauthenticated
// at the server layer, reached via EventSource which can't carry a Bearer
// token); tighten with cookie auth if the dashboard goes public.
import type { APIRoute } from 'astro';
import { generateContentPlan, type PlanEvent } from '../../lib/content-plan';

export const prerender = false;

// The SERP fetch + Claude generation can run tens of seconds — the serverless
// timeout headroom is set via the Vercel adapter's `maxDuration` in
// astro.config.mjs.

export const GET: APIRoute = ({ url }) => {
  const kind = url.searchParams.get('kind') === 'blog' ? 'blog' : 'landing';
  const keyword = (url.searchParams.get('keyword') ?? '').trim();
  const cluster = (url.searchParams.get('cluster') ?? '').trim();
  const language = url.searchParams.get('language') ?? 'EN';
  const intent = url.searchParams.get('intent') ?? '';
  const targetUrl = url.searchParams.get('targetUrl') ?? '';
  const projectId = url.searchParams.get('projectId') ?? '';
  const projectName = url.searchParams.get('projectName') ?? '';
  const articleCountRaw = url.searchParams.get('articleCount') ?? '';
  const articleCount = articleCountRaw ? Math.min(20, Math.max(1, parseInt(articleCountRaw, 10) || 0)) : undefined;

  if (kind === 'blog') {
    if (!cluster) return new Response('Cluster is required for a blog plan.', { status: 400 });
    if (!projectId) return new Response('A project is required for a blog plan.', { status: 400 });
  } else if (!keyword) {
    return new Response('Keyword is required.', { status: 400 });
  }
  if (keyword.length > 200 || cluster.length > 200) {
    return new Response('Input is too long.', { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sse = (obj: PlanEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const ev of generateContentPlan({
          kind, keyword, cluster, language, intent, targetUrl, projectId, projectName, articleCount,
        })) sse(ev);
      } catch (err) {
        sse({ event: 'error', msg: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
};
