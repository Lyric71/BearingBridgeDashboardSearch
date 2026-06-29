// /api/projects — list (GET) and create (POST).
// Writes are gated by src/middleware.ts (bearer token). SSR only.
import type { APIRoute } from 'astro';
import { listProjects, createProject } from '../../../lib/projects-db';
import { ensureModules, type ProjectInput } from '../../../lib/projectTypes';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET: APIRoute = async () => {
  try {
    return json(await listProjects());
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
};

// Normalize an untrusted payload into a ProjectInput (strings + booleans only).
function coerceInput(body: any): ProjectInput {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    name: s(body?.name).trim(),
    color: s(body?.color),
    owner: s(body?.owner).trim(),
    website: s(body?.website).trim(),
    targetCustomers: s(body?.targetCustomers).trim(),
    preciseTargeting: s(body?.preciseTargeting).trim(),
    rtb: s(body?.rtb).trim(),
    emailTarget: s(body?.emailTarget).trim(),
    channels: {
      seo: s(body?.channels?.seo).trim(),
      sem: s(body?.channels?.sem).trim(),
      email: s(body?.channels?.email).trim(),
    },
    modules: ensureModules(body?.modules),
  };
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const input = coerceInput(await request.json());
    if (!input.name) return json({ error: 'Name is required.' }, 400);
    if (!input.website) return json({ error: 'A website is required.' }, 400);
    return json(await createProject(input), 201);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
};
