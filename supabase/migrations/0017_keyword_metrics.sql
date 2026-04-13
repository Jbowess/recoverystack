-- Real keyword metrics columns on keyword_queue
-- Populated by gap-analyzer via DataForSEO Keywords API
alter table keyword_queue
  add column if not exists real_search_volume integer,
  add column if not exists keyword_difficulty integer,
  add column if not exists cpc numeric(8,4);

create index if not exists keyword_queue_search_volume_idx on keyword_queue (real_search_volume desc nulls last);
