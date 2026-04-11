create table if not exists deploy_events (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'ok',
  detail text,
  created_at timestamptz not null default now()
);

create table if not exists conversion_events (
  id uuid primary key default gen_random_uuid(),
  slug text,
  page_template text,
  variant text not null,
  cta text not null,
  created_at timestamptz not null default now()
);
