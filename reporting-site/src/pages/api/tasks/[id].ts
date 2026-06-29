// /api/tasks/:id — update (PATCH: title and/or status) and delete (DELETE).
import type { APIRoute } from 'astro';
import { updateTask, deleteTask } from '../../../lib/tasks-db';

export const prerender = false;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    const b = await request.json();
    const patch: { title?: string; status?: string } = {};
    if (typeof b?.title === 'string') patch.title = b.title.trim();
    if (typeof b?.status === 'string') patch.status = b.status.trim();
    const updated = await updateTask(params.id!, patch);
    return updated ? json(updated) : json({ error: 'Not found or nothing to update.' }, 404);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
};

export const DELETE: APIRoute = async ({ params }) => {
  try { await deleteTask(params.id!); return json({ ok: true }); }
  catch (e) { return json({ error: (e as Error).message }, 500); }
};
