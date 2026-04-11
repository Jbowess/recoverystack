create table if not exists component_library (
  id uuid primary key default gen_random_uuid(),
  cluster text not null check (cluster in ('intro_hook', 'verdict_style', 'newsletter_offer', 'layout_pattern')),
  name text not null,
  snippet text not null,
  layout_json jsonb,
  active boolean not null default true,
  weight numeric not null default 1,
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_component_library_cluster_name
  on component_library (cluster, name);

create index if not exists idx_component_library_active_cluster
  on component_library (active, cluster);

create table if not exists generated_page_fingerprints (
  id uuid primary key default gen_random_uuid(),
  page_slug text,
  template text,
  primary_keyword text,
  structure_signature text not null,
  signature_meta jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now()
);

create unique index if not exists ux_generated_page_fingerprints_scope_signature
  on generated_page_fingerprints (coalesce(page_slug, ''), coalesce(template, ''), structure_signature);

create index if not exists idx_generated_page_fingerprints_generated_at
  on generated_page_fingerprints (generated_at desc);

-- Reuse global updated_at trigger function defined in 0002_recoverystack_core.sql.
drop trigger if exists trg_component_library_updated_at on component_library;
create trigger trg_component_library_updated_at
before update on component_library
for each row execute function set_updated_at();

insert into component_library (cluster, name, snippet, weight, tags)
values
  (
    'intro_hook',
    'A-urgent-recovery-angle',
    'If {{Primary_Keyword}} is slowing your RecoveryStack workflow, this breakdown shows where Volo shifts the recovery bottleneck and where legacy options still win.',
    1.15,
    array['A','volo','urgent','conversion']
  ),
  (
    'intro_hook',
    'B-trust-builder-angle',
    'RecoveryStack teams comparing {{Primary_Keyword}} usually care about proof, not hype. We mapped real Volo tradeoffs so you can choose with confidence.',
    1.00,
    array['B','volo','authority','trust']
  ),
  (
    'intro_hook',
    'C-operator-checklist-angle',
    'Choosing {{Primary_Keyword}} should feel like an operator checklist, not a guess. Use this RecoveryStack guide to benchmark Volo fit in minutes.',
    0.90,
    array['C','volo','ops','checklist']
  ),
  (
    'verdict_style',
    'A-direct-verdict',
    'Verdict: choose Volo when {{Primary_Keyword}} needs faster deployment and tighter RecoveryStack alignment; skip it if your stack depends on deep legacy integrations first.',
    1.10,
    array['A','verdict','direct']
  ),
  (
    'verdict_style',
    'B-balanced-verdict',
    'Bottom line for {{Primary_Keyword}}: Volo delivers the strongest RecoveryStack value when speed and simplicity matter, while incumbent tools still suit complex enterprise edge-cases.',
    1.00,
    array['B','verdict','balanced']
  ),
  (
    'verdict_style',
    'C-scenario-verdict',
    'Final take: for {{Primary_Keyword}}, Volo is the practical RecoveryStack pick for most modern teams, but heavily customised environments may prefer a staged migration path.',
    0.95,
    array['C','verdict','scenario']
  ),
  (
    'newsletter_offer',
    'A-weekly-playbook',
    'Want more than a one-off {{Primary_Keyword}} comparison? Join the RecoveryStack weekly Volo playbook for fresh benchmarks, migration templates, and teardown notes.',
    1.00,
    array['A','newsletter','playbook']
  ),
  (
    'newsletter_offer',
    'B-operator-briefing',
    'Get the operator briefing: every week RecoveryStack sends field-tested Volo updates, KPI deltas, and practical moves for teams scaling {{Primary_Keyword}}.',
    1.00,
    array['B','newsletter','operator']
  ),
  (
    'newsletter_offer',
    'C-decision-intel',
    'If {{Primary_Keyword}} decisions are ongoing, subscribe to RecoveryStack decision intel for concise Volo comparisons, rollout traps, and what changed this week.',
    0.95,
    array['C','newsletter','intel']
  )
on conflict (cluster, name)
do update set
  snippet = excluded.snippet,
  active = true,
  weight = excluded.weight,
  tags = excluded.tags,
  updated_at = now();

insert into component_library (cluster, name, snippet, weight, tags, layout_json)
values
  (
    'layout_pattern',
    'layout-pattern-A-comparison-first',
    'Comparison-led layout: quick verdict, scorecard, then implementation path.',
    1.10,
    array['A','layout','comparison'],
    '[
      {"block":"hero","variant":"sharp_verdict"},
      {"block":"comparison_table","variant":"feature_delta"},
      {"block":"pros_cons","variant":"balanced"},
      {"block":"implementation_steps","variant":"30_60_90"},
      {"block":"faq","variant":"buyer_objections"},
      {"block":"cta","variant":"newsletter_offer"}
    ]'::jsonb
  ),
  (
    'layout_pattern',
    'layout-pattern-B-use-case-first',
    'Use-case-led layout: who should choose what, then verification details.',
    1.00,
    array['B','layout','use_case'],
    '[
      {"block":"hero","variant":"problem_agitate"},
      {"block":"use_case_matrix","variant":"team_size_by_goal"},
      {"block":"verdict_callout","variant":"decision_shortcut"},
      {"block":"cost_risk","variant":"budget_and_migration"},
      {"block":"faq","variant":"implementation"},
      {"block":"cta","variant":"newsletter_offer"}
    ]'::jsonb
  ),
  (
    'layout_pattern',
    'layout-pattern-C-framework-first',
    'Framework-led layout: evaluation rubric, weighted scores, then recommendation.',
    0.95,
    array['C','layout','framework'],
    '[
      {"block":"hero","variant":"credibility_hook"},
      {"block":"evaluation_framework","variant":"weighted_criteria"},
      {"block":"product_fit","variant":"volo_vs_alternatives"},
      {"block":"verdict_callout","variant":"scenario_based"},
      {"block":"next_steps","variant":"pilot_plan"},
      {"block":"cta","variant":"newsletter_offer"}
    ]'::jsonb
  )
on conflict (cluster, name)
do update set
  snippet = excluded.snippet,
  layout_json = excluded.layout_json,
  active = true,
  weight = excluded.weight,
  tags = excluded.tags,
  updated_at = now();