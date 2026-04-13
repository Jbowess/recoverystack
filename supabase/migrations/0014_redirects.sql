-- Redirect management: prevents 404s when slugs are renamed or pages are removed
create table if not exists redirects (
  id           uuid primary key default gen_random_uuid(),
  from_path    text not null unique,   -- e.g. /guides/old-slug
  to_path      text not null,          -- e.g. /guides/new-slug
  status_code  integer not null default 301 check (status_code in (301, 302, 308)),
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists redirects_from_path_idx on redirects (from_path);
