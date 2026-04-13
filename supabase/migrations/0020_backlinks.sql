-- Backlink monitoring — tracks inbound links from external domains
-- Populated by scripts/backlink-sync.ts via Ahrefs or Moz API
create table if not exists backlinks (
  id               uuid primary key default gen_random_uuid(),
  referring_domain text not null,
  referring_url    text not null unique,
  target_url       text not null,
  anchor_text      text,
  domain_rating    int,
  first_seen       date not null default current_date,
  last_seen        date not null default current_date,
  is_new           boolean not null default true,
  source           text not null default 'ahrefs'
);

create index if not exists backlinks_referring_domain_idx on backlinks (referring_domain);
create index if not exists backlinks_first_seen_idx       on backlinks (first_seen desc);
create index if not exists backlinks_domain_rating_idx    on backlinks (domain_rating desc nulls last);
create index if not exists backlinks_target_url_idx       on backlinks (target_url);
