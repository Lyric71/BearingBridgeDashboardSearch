# Supabase — single source of truth

This is the database that fixes "we lose data when we go online": projects, GTM
tasks, keywords, SERP reports and Google Ads snapshots all live here and are read
**and written at runtime** by the Astro SSR app and the Python scripts. No more
build-time files or per-browser `localStorage` as the source of truth.

## Schema (step 1 — done)

`migrations/0001_init.sql`

| Table | Replaces | Shape |
|---|---|---|
| `projects` | `gtm.json` projects + localStorage `bbg_gtm_projects_v1` | normalized; `channels`/`modules` as JSONB to match current shape |
| `board_columns` | `gtm.json` `columns` | static (`todo`/`doing`/`done`), seeded in `seed.sql` |
| `tasks` | `gtm.json` tasks + localStorage `bbg_gtm_tasks_v1` | normalized, FK → projects, ordered per column |
| `keywords` | `keywords.json` | normalized, FK → projects; `legacy_id` keeps the `cwf-001` codes |
| `serp_reports` | `data/projects/<id>/competitors/*.md` | rendered Markdown in `content_md` + parsed `indicators` |
| `serp_history` | `competitors/_history.json` | one row per refresh, before/after as JSONB |
| `ads_snapshots` | `google_ads_performance.json` | nested report kept as JSONB per (project, date) |

**Why mixed normalized + JSONB:** structured data the UI edits row-by-row is
normalized; documents (SERP Markdown) and wholesale-regenerated reports (Ads
performance) stay as-is so we don't fight their shape. See header comments in
`0001_init.sql`.

**Security:** RLS is on. Logged-in (`authenticated`) users get full access; the
SSR server uses the service-role key (bypasses RLS); logged-out `anon` gets
nothing — so the existing login page gates everything.

## How to apply

**Option A — Supabase CLI (recommended, keeps migrations versioned):**
```bash
# one-time: install CLI, then link to your project
supabase link --project-ref <your-project-ref>
supabase db push          # applies migrations/*.sql
psql "$DATABASE_URL" -f supabase/seed.sql   # or run seed.sql in the SQL editor
```

**Option B — Dashboard SQL editor:** paste `migrations/0001_init.sql` then
`seed.sql` into the SQL editor and run.

## Next steps (not done yet)
2. Create the Supabase project, set `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY` in Vercel + local `.env`.
3. One-shot importer: seed `projects`/`tasks`/`keywords`/`serp_reports`/
   `ads_snapshots` from the current files so nothing is lost.
4. Add `@astrojs/vercel` SSR adapter + `src/lib/db.ts` (Supabase client).
5. Migrate the UI module by module: swap each localStorage store for `fetch`
   over new `/api/*` routes.
6. Point the Python `seo/`+`sem/` scripts at the DB via `supabase-py`.
