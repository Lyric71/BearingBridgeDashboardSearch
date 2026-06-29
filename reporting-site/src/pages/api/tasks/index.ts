// /api/tasks — create (POST). Listing is via SSR hydration; GET returns grouped.
import type { APIRoute } from 'astro';
import { listTasksGrouped, createTask } from '../../../lib/tasks-db';

export const prerender = false;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async () => {
  try { return json(await listTasksGrouped()); }
  catch (e) { return json({ error: (e as Error).message }, 500); }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const b = await request.json();
    const projectId = String(b?.projectId ?? '').trim();
    const title = String(b?.title ?? '').trim();
    const status = String(b?.status ?? '').trim();
    if (!projectId || !title || !status) return json({ error: 'projectId, title and status are required.' }, 400);
    const id = typeof b?.id === 'string' ? b.id : undefined;
    return json(await createTask({ id, projectId, title, status }), 201);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
};
