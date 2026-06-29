// /api/keywords/:id — update (PATCH) and delete (DELETE).
import type { APIRoute } from 'astro';
import { updateKeyword, deleteKeyword } from '../../../lib/keywords-db';

export const prerender = false;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    const b = await request.json();
    const patch: Record<string, string> = {};
    for (const k of ['keyword', 'language', 'intent', 'cluster', 'priority']) {
      if (typeof b?.[k] === 'string') patch[k] = k === 'cluster' || k === 'keyword' ? b[k].trim() : b[k];
    }
    const updated = await updateKeyword(params.id!, patch);
    return updated ? json(updated) : json({ error: 'Not found or nothing to update.' }, 404);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
};

export const DELETE: APIRoute = async ({ params }) => {
  try { await deleteKeyword(params.id!); return json({ ok: true }); }
  catch (e) { return json({ error: (e as Error).message }, 500); }
};
