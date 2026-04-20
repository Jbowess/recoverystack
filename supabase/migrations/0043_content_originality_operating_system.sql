alter table pages add column if not exists originality_score integer;
alter table pages add column if not exists originality_status text;
alter table pages add column if not exists originality_profile jsonb not null default '{}'::jsonb;

create index if not exists idx_pages_originality_score
  on pages (originality_score desc)
  where originality_score is not null;

create index if not exists idx_pages_originality_status
  on pages (originality_status, status)
  where originality_status is not null;

create table if not exists page_originality_scores (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null,
  page_slug text not null,
  template text,
  total_score integer not null check (total_score >= 0 and total_score <= 100),
  status text not null check (status in ('pass', 'review', 'fail')),
  summary text,
  profile jsonb not null default '{}'::jsonb,
  breakdown jsonb not null default '{}'::jsonb,
  matched_pages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_page_originality_scores_page
  on page_originality_scores (page_id, created_at desc);

create index if not exists idx_page_originality_scores_status
  on page_originality_scores (status, total_score asc, created_at desc);

create table if not exists content_block_fingerprints (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null,
  page_slug text not null,
  template text,
  block_type text not null,
  block_key text not null,
  fingerprint text not null,
  simhash text not null,
  preview text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_content_block_fingerprints_page
  on content_block_fingerprints (page_id, block_type);

create index if not exists idx_content_block_fingerprints_slug
  on content_block_fingerprints (page_slug, block_type);

create index if not exists idx_content_block_fingerprints_fingerprint
  on content_block_fingerprints (fingerprint, block_type);
