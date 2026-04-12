-- Serverless-safe cron locks (replaces filesystem locks)
create table if not exists cron_locks (
  lock_name text primary key,
  lock_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Content uniqueness fingerprints for deduplication
create table if not exists content_fingerprints (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null,
  slug text not null,
  template text not null,
  simhash text not null,
  keyword_signature text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_content_fingerprints_simhash on content_fingerprints (simhash);
create index if not exists idx_content_fingerprints_slug on content_fingerprints (slug);
