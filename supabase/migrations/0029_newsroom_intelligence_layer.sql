alter table if exists news_source_events
  add column if not exists significance_score integer not null default 50,
  add column if not exists clustering_key text;

create index if not exists idx_news_source_events_significance
  on news_source_events (significance_score desc, published_at desc);

create index if not exists idx_news_source_events_clustering_key
  on news_source_events (clustering_key);

alter table if exists storylines
  add column if not exists clustering_key text;

create index if not exists idx_storylines_clustering_key
  on storylines (clustering_key, latest_event_at desc);
