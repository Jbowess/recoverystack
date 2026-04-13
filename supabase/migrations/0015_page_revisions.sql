-- Page revision history: preserves body_json + intro before every content update
-- Enables rollback via admin without losing previously generated content.
create table if not exists page_revisions (
  id          uuid primary key default gen_random_uuid(),
  page_id     uuid not null,
  page_slug   text not null,
  intro       text,
  body_json   jsonb,
  reason      text,             -- e.g. 'content_refresh', 'admin_regenerate', 'batch_generate'
  revised_at  timestamptz not null default now()
);

create index if not exists page_revisions_page_id_idx   on page_revisions (page_id);
create index if not exists page_revisions_revised_at_idx on page_revisions (revised_at desc);

-- Keep last 10 revisions per page to avoid unbounded growth
-- (enforce via application logic — the generator trims on insert)
