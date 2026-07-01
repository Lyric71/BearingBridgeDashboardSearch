-- ----------------------------------------------------------------------------
-- content_plans: add a `kind` so the table holds two brief types —
--   'landing' : a landing-page brief for ONE keyword (the original flow),
--   'blog'    : a blog content plan for a whole keyword CLUSTER.
-- For 'blog' rows, `keyword` holds the cluster label and `cluster` names it;
-- `target_url` holds the blog base URL the articles live under.
-- ----------------------------------------------------------------------------
alter table public.content_plans
  add column if not exists kind    text not null default 'landing',  -- 'landing' | 'blog'
  add column if not exists cluster text;                             -- set for kind='blog'

-- Uniqueness now spans `kind` so a keyword can have a landing brief and a
-- cluster can have a blog brief without colliding.
alter table public.content_plans drop constraint if exists content_plans_keyword_language_key;
alter table public.content_plans
  add constraint content_plans_kind_keyword_language_key unique (kind, keyword, language);
