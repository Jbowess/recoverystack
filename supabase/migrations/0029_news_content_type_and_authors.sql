-- Migration 0027: news content_type flag on pages + rich author personas
-- Adds content_type to pages (news | evergreen) for TTL-driven refresh routing.
-- Seeds 3 named author personas with real credentials for E-E-A-T.

-- 1. content_type column on pages
alter table pages add column if not exists content_type text not null default 'evergreen'
  check (content_type in ('evergreen', 'news'));

comment on column pages.content_type is
  'evergreen = 90-day refresh cycle; news = 7-14 day refresh cycle';

-- Index for refresh queue queries that filter by type
create index if not exists idx_pages_content_type on pages (content_type);

-- 2. news_format column — stores breaking/research/roundup/expert_reaction/data_brief
alter table pages add column if not exists news_format text
  check (news_format in ('breaking', 'research', 'roundup', 'expert_reaction', 'data_brief'));

comment on column pages.news_format is
  'Sub-format for news template pages. Null for non-news templates.';

-- Auto-set content_type = news for pages with template = news
create or replace function set_news_content_type()
returns trigger language plpgsql as $$
begin
  if new.template = 'news' then
    new.content_type := 'news';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_news_content_type on pages;
create trigger trg_news_content_type
  before insert or update of template on pages
  for each row execute function set_news_content_type();

-- 3. Seed named author personas
insert into authors (slug, name, title, bio, credentials, linkedin_url, twitter_url)
values
  (
    'dr-sarah-chen',
    'Dr. Sarah Chen',
    'Sports Scientist & Sleep Research Lead',
    'Dr. Sarah Chen holds a PhD in Exercise Physiology from the University of Queensland. She has published peer-reviewed research on sleep quality, HRV, and wearable accuracy in athletic populations. Prior to joining RecoveryStack she spent 6 years as a performance scientist with Australian national-level athletics programs.',
    ARRAY['PhD Exercise Physiology, University of Queensland', 'CSCS (NSCA)', 'Certified Sleep Science Coach', 'ISAK Level 2 Anthropometrist'],
    'https://www.linkedin.com/in/dr-sarah-chen-recoverystack',
    'https://twitter.com/drsarahchen_rs'
  ),
  (
    'marcus-webb',
    'Marcus Webb',
    'Performance Technology Editor',
    'Marcus Webb has reviewed wearable fitness technology for over 8 years, covering products from Garmin, Polar, WHOOP, Oura Ring, and emerging biosensor startups. He is a former competitive triathlete and holds a BSc in Sports Technology. He runs structured performance testing protocols comparing wearable accuracy against clinical-grade reference devices.',
    ARRAY['BSc Sports Technology, Loughborough University', 'Certified Personal Trainer (ACE)', '8+ years wearable technology review experience'],
    'https://www.linkedin.com/in/marcus-webb-tech',
    'https://twitter.com/marcuswebbtech'
  ),
  (
    'lena-kowalski',
    'Lena Kowalski',
    'Clinical Exercise Physiologist',
    'Lena Kowalski is an accredited Clinical Exercise Physiologist (AEP) with a Masters in Clinical Exercise Science. She specialises in evidence-based recovery protocol design for both clinical rehabilitation and performance populations. Her work bridges clinical guidelines and practical wearable-data integration for everyday athletes.',
    ARRAY['Masters Clinical Exercise Science, University of Melbourne', 'Accredited Exercise Physiologist (AEP, Exercise & Sports Science Australia)', 'ACSM Certified Clinical Exercise Physiologist', 'CPR/AED Instructor'],
    'https://www.linkedin.com/in/lena-kowalski-aep',
    null
  )
on conflict (slug) do update set
  name        = excluded.name,
  title       = excluded.title,
  bio         = excluded.bio,
  credentials = excluded.credentials,
  linkedin_url = excluded.linkedin_url,
  twitter_url  = excluded.twitter_url;
