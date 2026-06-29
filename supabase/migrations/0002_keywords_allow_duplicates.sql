-- The keyword table's surrogate uuid PK already guarantees row identity, and the
-- UI supports duplicating a keyword (same text/language) to tweak the copy. So
-- drop the (project_id, keyword, language) uniqueness, and move import
-- idempotency onto legacy_id (the original 'cwf-001' codes). Postgres treats
-- NULLs as distinct, so user-created keywords (legacy_id NULL) are unconstrained.
alter table public.keywords drop constraint if exists keywords_project_id_keyword_language_key;
create unique index if not exists keywords_project_legacy_idx
  on public.keywords (project_id, legacy_id) where legacy_id is not null;
