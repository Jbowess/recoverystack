-- Competitor price snapshots scraped by scripts/price-scraper.ts
-- Read by lib/info-gain-feeds.ts to populate price_performance sections
create table if not exists price_snapshots (
  id           uuid primary key default gen_random_uuid(),
  retailer     text not null,
  product_name text not null,
  price        numeric(10,2),
  currency     text not null default 'AUD',
  in_stock     boolean,
  url          text not null unique,
  captured_at  timestamptz not null default now()
);

create index if not exists price_snapshots_captured_at_idx on price_snapshots (captured_at desc);
create index if not exists price_snapshots_retailer_idx    on price_snapshots (retailer);
