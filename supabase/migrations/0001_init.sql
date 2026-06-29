-- ============================================================================
-- 0001_init.sql — initial schema for the reporting dashboard
--
-- Single source of truth for everything the app reads/writes online. Replaces:
--   • reporting-site/src/data/gtm.json        -> projects, board_columns, tasks
--   • reporting-site/src/data/keywords.json   -> keywords
--   • data/projects/<id>/competitors/*.md     -> serp_reports
--   • data/projects/<id>/competitors/_history.json -> serp_history
--   • data/google_ads_performance.json        -> ads_snapshots
--   • browser localStorage (projects/tasks)   -> projects, tasks
--
-- Design notes:
--   • Structured data (projects/tasks/keywords) is fully normalized so the UI
--     can create/edit/delete individual rows.
--   • Document data (SERP reports) keeps its rendered Markdown in a column —
--     the competitors page renders Markdown directly today, so we don't shred
--     it into rows. Parsed KPIs are mirrored into `indicators` for cards.
--   • Google Ads performance is a deep nested report regenerated wholesale by
--     the Python script, so it's stored as a JSONB snapshot per (project,date),
--     not normalized. Query with Postgres JSON operators if needed later.
--   • Text ids (e.g. 'chinawebfoundry') are preserved as primary keys so
--     existing references and the importer stay stable.
-- ============================================================================

-- gen_random_uuid() ships with Supabase (pgcrypto in the extensions schema).

-- Keep updated_at fresh on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- projects — top-level entity for the whole dashboard
-- ----------------------------------------------------------------------------
create table public.projects (
  id                text primary key,                 -- slug, e.g. 'chinawebfoundry'
  name              text not null,
  color             text not null default 'var(--bbg-blue)',
  owner             text not null default '',
  website           text not null default '',         -- mandatory in the UI; '' allowed at DB level for seeded rows
  target_customers  text not null default '',
  precise_targeting text not null default '',
  rtb               text not null default '',
  email_target      text not null default '',
  -- { "seo": "...", "sem": "...", "email": "..." } — free-text channel notes
  channels          jsonb not null default '{"seo":"","sem":"","email":""}'::jsonb,
  -- { "kanban": true, "seo": true, "googleAds": true }
  modules           jsonb not null default '{"kanban":true,"seo":true,"googleAds":true}'::jsonb,
  sort_order        integer not null default 0,       -- preserves display order
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- board_columns — GTM kanban columns (shared across projects)
-- ----------------------------------------------------------------------------
create table public.board_columns (
  id         text primary key,        -- 'todo' | 'doing' | 'done'
  label      text not null,
  sort_order integer not null default 0
);

-- ----------------------------------------------------------------------------
-- tasks — GTM kanban cards, scoped to a project
-- ----------------------------------------------------------------------------
create table public.tasks (
  id         uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  title      text not null,
  status     text not null references public.board_columns(id),  -- column id
  sort_order integer not null default 0,                         -- position within column
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_project_status_idx on public.tasks (project_id, status, sort_order);
create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- keywords — SEO/SEM keyword research, scoped to a project
-- ----------------------------------------------------------------------------
create table public.keywords (
  id         uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  legacy_id  text,                          -- original 'cwf-001' id, for import idempotency
  keyword    text not null,
  language   text not null default 'EN',    -- 'EN' | 'FR' | ...
  intent     text,                          -- Commercial | Informational | Navigational | ...
  cluster    text,                          -- topic cluster label
  priority   text,                          -- High | Medium-High | Medium | Low-Medium | ...
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, keyword, language)
);
create index keywords_project_idx on public.keywords (project_id);
create index keywords_cluster_idx on public.keywords (project_id, cluster);
create trigger keywords_set_updated_at before update on public.keywords
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- serp_reports — one rendered SERP/competitor report per (project, cluster)
-- Written by seo/scripts/cwf_serp_ranking.py. The page renders content_md.
-- ----------------------------------------------------------------------------
create table public.serp_reports (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references public.projects(id) on delete cascade,
  cluster     text not null,                -- '01-core-web-agency', '00-overview', ...
  title       text,
  report_date date,
  content_md  text not null,                -- the Markdown report body
  -- parsed KPIs surfaced as cards: { "ranked": 17, "covered": 12, "total": 71, "index": 23 }
  indicators  jsonb,
  updated_at  timestamptz not null default now(),
  unique (project_id, cluster)
);
create trigger serp_reports_set_updated_at before update on public.serp_reports
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- serp_history — refresh history (was competitors/_history.json)
-- ----------------------------------------------------------------------------
create table public.serp_history (
  id         uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  cluster    text not null,
  label      text,
  ts         timestamptz not null default now(),
  before     jsonb,        -- { cluster: ..., global: { ranked, covered, total, index } }
  after      jsonb
);
create index serp_history_project_cluster_idx on public.serp_history (project_id, cluster, ts desc);

-- ----------------------------------------------------------------------------
-- ads_snapshots — Google Ads performance report (was google_ads_performance.json)
-- Deep nested timeframes->campaigns->ad_groups->keywords kept as JSONB; the
-- Python exporter regenerates the whole blob, the UI renders it as a tree.
-- ----------------------------------------------------------------------------
create table public.ads_snapshots (
  id            uuid primary key default gen_random_uuid(),
  project_id    text not null references public.projects(id) on delete cascade,
  snapshot_date date not null,        -- the "date" field at the top of the export
  account       text,                 -- '557-577-6523'
  currency      text,                 -- 'HKD'
  data          jsonb not null,       -- the "timeframes" object (1d / 7d / 30d / ...)
  created_at    timestamptz not null default now(),
  unique (project_id, snapshot_date)
);
create index ads_snapshots_project_date_idx on public.ads_snapshots (project_id, snapshot_date desc);

-- ============================================================================
-- Row-Level Security
--   Internal dashboard: any authenticated (logged-in) user has full access.
--   The SSR server uses the service-role key, which bypasses RLS entirely.
--   anon (logged-out) gets nothing -> writes/reads require login.
-- ============================================================================
alter table public.projects      enable row level security;
alter table public.board_columns enable row level security;
alter table public.tasks         enable row level security;
alter table public.keywords      enable row level security;
alter table public.serp_reports  enable row level security;
alter table public.serp_history  enable row level security;
alter table public.ads_snapshots enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'projects','board_columns','tasks','keywords',
    'serp_reports','serp_history','ads_snapshots'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true);',
      t || '_authenticated_all', t
    );
  end loop;
end $$;
