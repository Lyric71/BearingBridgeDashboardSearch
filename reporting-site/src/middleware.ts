// Gate all /api/* routes behind the shared login. The browser sends the same
// SHA-256(login:password) hash it computes on the login page as a bearer token;
// we recompute it from the env vars and compare.
//
// NOTE (interim): this mirrors the existing shared-password model. A later step
// replaces it with proper Supabase Auth + per-user sessions.
import { createHash } from 'node:crypto';
import { defineMiddleware } from 'astro:middleware';

function expectedToken(): string {
  const login = import.meta.env.SITE_LOGIN;
  const password = import.meta.env.SITE_PASSWORD;
  if (!login || !password) throw new Error('Missing SITE_LOGIN / SITE_PASSWORD env vars.');
  return createHash('sha256').update(`${login}:${password}`).digest('hex');
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (pathname.startsWith('/api/')) {
    const auth = context.request.headers.get('authorization') ?? '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (token !== expectedToken()) {
      return new Response(JSON.stringify({ error: 'Unauthorized.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  return next();
});
