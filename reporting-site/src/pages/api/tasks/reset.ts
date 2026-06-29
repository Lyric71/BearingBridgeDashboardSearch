// /api/tasks/reset — reset all tasks back to the original GTM plan.
import type { APIRoute } from 'astro';
import { resetTasks } from '../../../lib/tasks-db';

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    return new Response(JSON.stringify(await resetTasks()), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
