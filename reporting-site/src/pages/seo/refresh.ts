// Production "Refresh" endpoint for /seo/competitors. Re-runs the live Google
// SERP ranking for ONE cluster server-side (DataForSEO, batched), rebuilds the
// cluster report + global overview, persists everything to Supabase, and streams
// keyword-by-keyword progress to the browser as Server-Sent Events.
//
// Runs in the Astro/Vercel SSR function — works in `astro dev` AND in production
// (no Python, no child process, no local files). Replaces the old dev-only
// src/server/refresh.ts that spawned cwf_serp_ranking.py.
//
// Deliberately NOT under /api/: the browser reaches it via EventSource, which
// can't send the Bearer token the /api/* middleware requires. It mirrors the
// exposure of the rest of the /seo SSR pages (unauthenticated at the server
// layer); tighten later with cookie-based auth if the dashboard goes public.
import type { APIRoute } from 'astro';
import { refreshCluster, type RefreshEvent } from '../../lib/cwf-serp';

export const prerender = false;

// NOTE: the serverless timeout is raised via the Vercel adapter's `maxDuration`
// option in astro.config.mjs (batched DataForSEO calls can run tens of seconds).

// Cluster ids look like "05-baidu-china-seo" — constrain the input.
const CLUSTER_RE = /^[0-9]{2}-[a-z0-9-]+$/;

export const GET: APIRoute = ({ url }) => {
  const project = url.searchParams.get('project') ?? '';
  const cluster = url.searchParams.get('cluster') ?? '';

  if (project !== 'chinawebfoundry') {
    return new Response('Refresh is only available for ChinaWebFoundry.', { status: 400 });
  }
  if (!CLUSTER_RE.test(cluster)) {
    return new Response('Invalid cluster id.', { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sse = (obj: RefreshEvent | Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const ev of refreshCluster(cluster)) sse(ev);
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
