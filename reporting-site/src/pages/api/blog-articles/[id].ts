// /api/blog-articles/:id — update (PATCH: accept / publish status / URL) and
// delete (DELETE). Gated by the shared-login middleware like the other /api/*.
import type { APIRoute } from 'astro';
import { updateBlogArticle, deleteBlogArticle, type BlogArticlePatch } from '../../../lib/blog-articles-db';

export const prerender = false;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    const b = await request.json();
    const patch: BlogArticlePatch = {};
    if (b?.status === 'proposed' || b?.status === 'accepted') patch.status = b.status;
    if (typeof b?.published === 'boolean') patch.published = b.published;
    if (typeof b?.published_url === 'string') patch.published_url = b.published_url.trim();
    const updated = await updateBlogArticle(params.id!, patch);
    return updated ? json(updated) : json({ error: 'Not found or nothing to update.' }, 404);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
};

export const DELETE: APIRoute = async ({ params }) => {
  try { await deleteBlogArticle(params.id!); return json({ ok: true }); }
  catch (e) { return json({ error: (e as Error).message }, 500); }
};
