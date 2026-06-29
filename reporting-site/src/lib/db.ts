// Server-side Supabase access. This is the single source of truth for the app.
//
// Uses the SECRET key, so it must only ever be imported from server code
// (.astro frontmatter, API routes, middleware) — never from a client `<script>`.
// The secret key bypasses RLS; the browser never talks to Supabase directly, it
// goes through our /api/* routes.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.SUPABASE_URL;
const secret = import.meta.env.SUPABASE_SECRET_KEY;

if (!url || !secret) {
  throw new Error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY env vars.');
}

export const db = createClient(url, secret, {
  auth: { persistSession: false }, // serverless: nothing to persist between requests
});
