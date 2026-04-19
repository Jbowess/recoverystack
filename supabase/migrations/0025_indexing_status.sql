-- Track Google indexing status per published page.
-- Populated by scripts/indexing-status-checker.ts via Google URL Inspection API.
-- Separate table for efficient querying — metadata jsonb is too slow for analytics.

create table if not exists page_index_status (
  id                   uuid primary key default gen_random_uuid(),
  page_slug            text not null unique,
  page_url             text not null,
  index_status         text not null default 'UNKNOWN'
                         check (index_status in ('INDEXED','NOT_INDEXED','CRAWLED_NOT_INDEXED','DISCOVERED_NOT_INDEXED','EXCLUDED','UNKNOWN')),
  coverage_state       text,
  robots_txt_state     text,
  indexing_state       text,
  last_crawl_time      timestamptz,
  verdict              text,
  checked_at           timestamptz not null default now(),
  created_at           timestamptz not null default now()
);

create index if not exists page_index_status_status_idx  on page_index_status (index_status);
create index if not exists page_index_status_checked_idx on page_index_status (checked_at desc);

-- Convenience view: indexed vs not-indexed counts
create or replace view index_coverage_summary as
select
  index_status,
  count(*)                                             as page_count,
  round(count(*) * 100.0 / sum(count(*)) over (), 1)  as pct
from page_index_status
group by index_status
order by page_count desc;
