-- ----------------------------------------------------------------------------
-- blog_articles — the individual articles proposed by a 'blog' content plan.
-- A blog plan (content_plans row, kind='blog') proposes N articles; each becomes
-- one row here so it can be accepted/deleted and its publication tracked.
--
-- Lifecycle: status 'proposed' → 'accepted' (or the row is deleted). Once
-- accepted, `published` + `published_url` track whether it went live and where.
-- ----------------------------------------------------------------------------
create table if not exists public.blog_articles (
  id                uuid primary key default gen_random_uuid(),
  content_plan_id   uuid references public.content_plans(id) on delete cascade,
  project_id        text references public.projects(id) on delete set null,
  cluster           text,
  language          text not null default 'EN',
  sort_order        integer not null default 0,
  title             text not null,
  primary_keyword   text,
  secondary_keywords text,                 -- comma-joined
  intent            text,
  funnel_stage      text,
  est_words         integer,
  role              text,                  -- 'Pillar' | 'Supporting'
  slug              text,
  outline_md        text,
  status            text not null default 'proposed',  -- 'proposed' | 'accepted'
  published         boolean not null default false,
  published_url     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists blog_articles_plan_idx on public.blog_articles (content_plan_id, sort_order);
create index if not exists blog_articles_project_idx on public.blog_articles (project_id);

create trigger blog_articles_set_updated_at before update on public.blog_articles
  for each row execute function public.set_updated_at();

alter table public.blog_articles enable row level security;
create policy blog_articles_authenticated_all on public.blog_articles
  for all to authenticated using (true) with check (true);
