alter table pages
  add column if not exists last_generated_at timestamptz,
  add column if not exists needs_revalidation boolean not null default false,
  add column if not exists last_deployed_at timestamptz;

alter table pages
  drop constraint if exists pages_status_check;

alter table pages
  add constraint pages_status_check
  check (status in ('draft', 'approved', 'published', 'archived'));

create index if not exists idx_pages_needs_revalidation
  on pages (status, needs_revalidation, updated_at desc);
