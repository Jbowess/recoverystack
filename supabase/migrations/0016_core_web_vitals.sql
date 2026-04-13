-- Core Web Vitals daily snapshot from Chrome UX Report (CrUX) API
-- Tracks LCP, CLS, INP at p75 to monitor Google ranking signal trends.
create table if not exists core_web_vitals (
  id           uuid primary key default gen_random_uuid(),
  recorded_at  date not null unique,
  lcp_p75      numeric(8,2),     -- milliseconds
  cls_p75      numeric(8,4),     -- unitless score
  inp_p75      numeric(8,2),     -- milliseconds
  lcp_rating   text,             -- 'good' | 'needs_improvement' | 'poor'
  cls_rating   text,
  inp_rating   text,
  raw          jsonb,            -- full API response for debugging
  created_at   timestamptz not null default now()
);

create index if not exists core_web_vitals_recorded_at_idx on core_web_vitals (recorded_at desc);
