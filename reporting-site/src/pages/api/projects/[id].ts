// /api/projects/:id — update (PATCH) and delete (DELETE).
// Writes are gated by src/middleware.ts. SSR only.
import type { APIRoute } from 'astro';
import { getProject, updateProject, deleteProject } from '../../../lib/projects-db';
import { ensureModules, type ProjectInput } from '../../../lib/projectTypes';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET: APIRoute = async ({ params }) => {
  try {
    const p = await getProject(params.id!);
    return p ? json(p) : json({ error: 'Not found.' }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
};

// Build a partial patch from only the fields present in the body.
function coercePatch(body: any): Partial<ProjectInput> {
  const patch: Partial<ProjectInput> = {};
  const str = (k: keyof ProjectInput) => {
    if (typeof body?.[k] === 'string') (patch as any)[k] = body[k].trim();
  };
  str('name'); str('color'); str('owner'); str('website');
  str('targetCustomers'); str('preciseTargeting'); str('rtb'); str('emailTarget');
  if (body?.channels) {
    patch.channels = {
      seo: String(body.channels.seo ?? '').trim(),
      sem: String(body.channels.sem ?? '').trim(),
      email: String(body.channels.email ?? '').trim(),
    };
  }
  if (body?.modules) patch.modules = ensureModules(body.modules);
  return patch;
}

export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    const patch = coercePatch(await request.json());
    if (patch.name !== undefined && !patch.name) return json({ error: 'Name cannot be empty.' }, 400);
    if (patch.website !== undefined && !patch.website) return json({ error: 'Website cannot be empty.' }, 400);
    const updated = await updateProject(params.id!, patch);
    return updated ? json(updated) : json({ error: 'Not found.' }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  try {
    await deleteProject(params.id!);
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
};
