-- ----------------------------------------------------------------------------
-- content_plans — one AI-generated content brief per (keyword, language).
-- Produced by the /seo/content-plan endpoint (src/lib/content-plan.ts): it
-- pulls the live Google SERP + search volume for the keyword via DataForSEO,
-- then asks Claude to write a competitive content brief. The page renders
-- plan_md; indicators mirrors the SERP signals the brief was built from.
--
-- project_id is optional: a plan can be tied to a project (so it shows on that
-- project's panel) or stand alone. Exactly ONE plan is kept per (keyword,
-- language) — regenerating upserts in place.
-- ----------------------------------------------------------------------------
create table if not exists public.content_plans (
  id          uuid primary key default gen_random_uuid(),
  project_id  text references public.projects(id) on delete set null,
  keyword     text not null,
  language    text not null default 'EN',        -- 'EN' | 'FR' | ...
  target_url  text,                              -- optional page the brief targets
  plan_md     text not null,                     -- the Markdown content brief
  -- SERP signals the brief was built from:
  -- { "volume": 320, "cpc": 4.1, "competition": 55, "intent": "Commercial",
  --   "competitors": [{ "rank": 1, "domain": "...", "title": "..." }, ...] }
  indicators  jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (keyword, language)
);
create index if not exists content_plans_project_idx on public.content_plans (project_id);
create index if not exists content_plans_created_idx on public.content_plans (created_at desc);

create trigger content_plans_set_updated_at before update on public.content_plans
  for each row execute function public.set_updated_at();

alter table public.content_plans enable row level security;
create policy content_plans_authenticated_all on public.content_plans
  for all to authenticated using (true) with check (true);
