// /api/keywords/reset?project=<id> — reset a project's keywords to the seed.
import type { APIRoute } from 'astro';
import { resetKeywords } from '../../../lib/keywords-db';

export const prerender = false;

export const POST: APIRoute = async ({ url }) => {
  const project = url.searchParams.get('project') ?? '';
  if (!project) {
    return new Response(JSON.stringify({ error: 'project is required.' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    return new Response(JSON.stringify(await resetKeywords(project)), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
