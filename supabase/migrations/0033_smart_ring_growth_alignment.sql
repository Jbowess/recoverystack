-- Smart ring growth alignment
-- Brings older installs closer to the assumptions used by the current SEO system.

alter table pages
  drop constraint if exists pages_template_check;

alter table pages
  add constraint pages_template_check
  check (template in (
    'guides',
    'alternatives',
    'protocols',
    'metrics',
    'costs',
    'compatibility',
    'trends',
    'pillars',
    'reviews',
    'checklists',
    'news'
  ));

alter table pages
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists content_type text not null default 'evergreen',
  add column if not exists news_format text,
  add column if not exists beat text,
  add column if not exists freshness_tier text,
  add column if not exists story_status text,
  add column if not exists source_event_id uuid,
  add column if not exists storyline_id uuid,
  add column if not exists last_verified_at timestamptz;

alter table keyword_queue
  add column if not exists normalized_keyword text,
  add column if not exists real_search_volume integer,
  add column if not exists keyword_difficulty integer;

update keyword_queue
set normalized_keyword = lower(trim(primary_keyword))
where normalized_keyword is null;

create index if not exists idx_pages_content_type_status
  on pages (content_type, status, updated_at desc);

create index if not exists keyword_queue_normalized_keyword_idx
  on keyword_queue (normalized_keyword);

alter table keyword_queue
  drop constraint if exists keyword_queue_template_id_check;

alter table keyword_queue
  add constraint keyword_queue_template_id_check
  check (
    template_id in (
      'comparison',
      'guide',
      'protocol',
      'guides',
      'alternatives',
      'protocols',
      'metrics',
      'costs',
      'compatibility',
      'trends',
      'pillars',
      'reviews',
      'checklists',
      'news'
    )
  );

alter table keyword_queue
  drop constraint if exists keyword_queue_source_check;

alter table keyword_queue
  add constraint keyword_queue_source_check
  check (
    source in (
      'evergreen',
      'trend',
      'paa',
      'related_search',
      'modifier_expansion',
      'topical_gap',
      'gsc_orphan'
    )
  );
