// /api/keywords — create (POST). Listing is via SSR hydration on the page.
import type { APIRoute } from 'astro';
import { listKeywordsGrouped, createKeyword } from '../../../lib/keywords-db';

export const prerender = false;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async () => {
  try { return json(await listKeywordsGrouped()); }
  catch (e) { return json({ error: (e as Error).message }, 500); }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const b = await request.json();
    const projectId = String(b?.projectId ?? '').trim();
    const keyword = String(b?.keyword ?? '').trim();
    if (!projectId || !keyword) return json({ error: 'projectId and keyword are required.' }, 400);
    const input = {
      keyword,
      language: String(b?.language ?? 'EN'),
      intent: String(b?.intent ?? ''),
      cluster: String(b?.cluster ?? '').trim(),
      priority: String(b?.priority ?? ''),
    };
    const id = typeof b?.id === 'string' ? b.id : undefined;
    return json(await createKeyword(projectId, input, id), 201);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
};
