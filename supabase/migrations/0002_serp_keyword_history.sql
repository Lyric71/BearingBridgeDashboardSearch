-- ----------------------------------------------------------------------------
-- serp_keyword_history — per-keyword refresh history (replaces the per-cluster
-- serp_history for the competitors page). Exactly ONE row per keyword is kept:
-- the latest refresh, holding the previous refresh's rank (before) and this
-- refresh's rank (after) so the UI can show "keyword: before → after".
-- Written by the /seo/refresh endpoint (src/lib/cwf-serp.ts).
-- ----------------------------------------------------------------------------
create table if not exists public.serp_keyword_history (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references public.projects(id) on delete cascade,
  cluster     text not null,               -- cid, e.g. '02-wordpress-woocommerce'
  keyword     text not null,
  before_rank int,                          -- our rank at the previous refresh (null = not ranked / none)
  after_rank  int,                          -- our rank at this refresh (null = not ranked)
  before_ts   date,                         -- date of the previous refresh
  after_ts    date,                         -- date of this refresh
  updated_at  timestamptz not null default now(),
  unique (project_id, cluster, keyword)
);
create index if not exists serp_keyword_history_project_cluster_idx
  on public.serp_keyword_history (project_id, cluster);

create trigger serp_keyword_history_set_updated_at before update on public.serp_keyword_history
  for each row execute function public.set_updated_at();

alter table public.serp_keyword_history enable row level security;
create policy serp_keyword_history_authenticated_all on public.serp_keyword_history
  for all to authenticated using (true) with check (true);
