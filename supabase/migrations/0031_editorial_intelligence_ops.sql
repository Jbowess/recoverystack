create table if not exists source_watchlists (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references topic_entities(id) on delete set null,
  slug text not null unique,
  label text not null,
  watch_type text not null default 'brand',
  beat text not null default 'general_recovery',
  source_url text,
  query text,
  cadence text not null default 'daily',
  priority integer not null default 60,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  last_hit_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_source_watchlists_active on source_watchlists (active, priority desc);
create index if not exists idx_source_watchlists_entity on source_watchlists (entity_id, active);

create table if not exists source_watchlist_hits (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references source_watchlists(id) on delete cascade,
  event_id uuid references news_source_events(id) on delete set null,
  hit_key text not null unique,
  matched_term text,
  confidence_score integer not null default 70,
  metadata jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_source_watchlist_hits_watchlist on source_watchlist_hits (watchlist_id, detected_at desc);
create index if not exists idx_source_watchlist_hits_event on source_watchlist_hits (event_id);

create table if not exists page_claims (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  page_slug text not null,
  claim_hash text not null,
  claim_text text not null,
  claim_type text not null default 'factual',
  status text not null default 'pending',
  confidence_score integer not null default 50,
  source_event_id uuid references news_source_events(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_id, claim_hash)
);

create index if not exists idx_page_claims_page on page_claims (page_id, status, confidence_score desc);
create index if not exists idx_page_claims_status on page_claims (status, updated_at desc);

create table if not exists claim_evidence_links (
  id uuid primary key default gen_random_uuid(),
  page_claim_id uuid not null references page_claims(id) on delete cascade,
  event_id uuid references news_source_events(id) on delete set null,
  source_reference_id uuid references page_source_references(id) on delete set null,
  evidence_url text,
  evidence_kind text not null default 'source_reference',
  support_level text not null default 'partial',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_claim_evidence_links_claim on claim_evidence_links (page_claim_id, support_level);

create table if not exists story_followup_jobs (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  storyline_id uuid references storylines(id) on delete cascade,
  page_slug text not null,
  checkpoint_hours integer not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (page_id, checkpoint_hours)
);

create index if not exists idx_story_followup_jobs_due on story_followup_jobs (status, scheduled_for asc);

create table if not exists comparison_dataset_snapshots (
  id uuid primary key default gen_random_uuid(),
  dataset_key text not null,
  title text not null,
  beat text not null default 'general_recovery',
  snapshot_date date not null default current_date,
  row_count integer not null default 0,
  data jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (dataset_key, snapshot_date)
);

create index if not exists idx_comparison_dataset_snapshots_key on comparison_dataset_snapshots (dataset_key, snapshot_date desc);

create table if not exists source_quality_scores (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  source_kind text not null default 'domain',
  beat text not null default 'general_recovery',
  score integer not null default 50,
  event_count integer not null default 0,
  citation_count integer not null default 0,
  page_count integer not null default 0,
  coverage_count integer not null default 0,
  success_rate numeric(6,4) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  last_computed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_source_quality_scores_score on source_quality_scores (score desc, last_computed_at desc);

create table if not exists serp_winner_patterns (
  id uuid primary key default gen_random_uuid(),
  template text not null,
  query_intent text not null default 'informational',
  beat text not null default 'general_recovery',
  computed_at timestamptz not null default now(),
  metrics jsonb not null default '{}'::jsonb,
  patterns jsonb not null default '{}'::jsonb,
  unique (template, query_intent, beat)
);

create index if not exists idx_serp_winner_patterns_template on serp_winner_patterns (template, beat, computed_at desc);

create table if not exists persona_distribution_queue (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  page_slug text not null,
  channel text not null default 'newsletter',
  persona text not null,
  status text not null default 'draft',
  payload jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (page_id, channel, persona)
);

create index if not exists idx_persona_distribution_queue_status on persona_distribution_queue (status, generated_at desc);

create table if not exists editorial_review_queue (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  page_slug text not null,
  review_type text not null default 'editorial',
  priority integer not null default 50,
  status text not null default 'open',
  reviewer_slug text,
  rationale text,
  payload jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (page_id, review_type, status)
);

create index if not exists idx_editorial_review_queue_open on editorial_review_queue (status, priority desc, opened_at desc);
