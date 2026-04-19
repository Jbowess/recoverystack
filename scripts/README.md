# Scripts Index

This directory is the repo's operational command surface. It is intentionally flat so every job is easy to invoke from `package.json`, cron, and orchestration scripts.

## Orchestration
- `daily-orchestrator.ts`: primary phased pipeline runner.
- `nightly-run.ts`: cron-friendly nightly execution.
- `pipeline.ts`: older pipeline entrypoint.
- `smart-ring-growth-playbook.ts`: smart-ring SEO growth workflow.
- `smart-ring-system-focus.ts`: smart-ring operating loop across growth, data, repurposing, and optimization.

## Discovery And Intelligence
- `trend-scraper.ts`, `news-intake.ts`, `news-wave.ts`, `news-roundup.ts`, `news-freshness.ts`
- `entity-sync.ts`, `storyline-builder.ts`, `story-followup.ts`
- `gap-analyzer.ts`, `keyword-expander.ts`, `query-coverage-planner.ts`, `paa-page-factory.ts`
- `competitor-spy.ts`, `competitor-content-extractor.ts`, `competitor-alert.ts`, `competitor-keywords-seed.ts`
- `community-sentiment-miner.ts`, `app-review-miner.ts`, `clinical-trials-monitor.ts`
- `gsc-sync.ts`, `gsc-opportunity-miner.ts`, `keyword-data-sync.ts`, `rank-tracker.ts`

## Content And Page Generation
- `brief-generator.ts`, `content-generator.ts`, `batch-generate.ts`
- `buying-guide-generator.ts`, `use-case-page-splitter.ts`, `competitor-brand-page-generator.ts`
- `locale-generator.ts`, `video-seo-generator.ts`, `visual-asset-generator.ts`
- `content-refresh.ts`, `content-refresh-processor.ts`, `content-diff.ts`

## Product Truth And Data
- `product-spec-sync.ts`, `product-truth-sync.ts`, `price-scraper.ts`
- `comparison-dataset-builder.ts`, `proprietary-data-rollup.ts`
- `brand-product-sync.ts`, `volo-product-intelligence-sync.ts`
- `conversion-sync.ts`, `journey-attribution-rollup.ts`

## SEO Optimization And Quality
- `linker.ts`, `orphan-link-audit.ts`, `cannibalization-check.ts`
- `quality-gate.ts`, `page-quality-scorer.ts`, `editorial-trust-upgrade.ts`, `claim-verifier.ts`
- `ctr-optimizer.ts`, `snippet-optimizer.ts`, `discover-optimizer.ts`, `geo-optimizer.ts`
- `schema-validator.ts`, `schema-backfill.ts`
- `authority-rollup.ts`, `cluster-metrics-rollup.ts`, `cluster-completeness-checker.ts`
- `serp-feature-detector.ts`, `serp-winner-analyzer.ts`, `ranking-opportunity-audit.ts`

## Distribution And Repurposing
- `distribution-asset-generator.ts`, `distribution-performance-rollup.ts`, `repurposing-feedback-loop.ts`
- `repurposing-priority-scorer.ts`, `persona-distributor.ts`, `social-publish-queue.ts`, `social-publish-dispatcher.ts`
- `email-digest-builder.ts`, `media-pack-generator.ts`, `lead-magnet-generator.ts`
- `series-generator.ts`, `creator-brief-generator.ts`, `press-data-brief-generator.ts`
- `community-prompt-generator.ts`, `video-package-generator.ts`, `brand-framework-seeder.ts`
- `brand-reach-rollup.ts`, `tool-idea-miner.ts`

## Outreach, CRM, And Operations
- `outreach-queue-builder.ts`, `link-prospect-miner.ts`
- `creator-crm-sync.ts`, `partner-crm-sync.ts`, `audience-segment-sync.ts`
- `brand-monitor.ts`, `brand-voice-governor.ts`, `automation-governor.ts`
- `api-cost-monitor.ts`, `pipeline-telemetry.ts`, `queue-state-repair.ts`
- `smoke-seed.ts`, `smoke-test.ts`, `deploy.ts`

## Working Rule
- Put reusable logic in `lib/`.
- Keep scripts focused on CLI argument parsing, orchestration, and persistence.
- Add new scripts here to the relevant section when you add a new `package.json` command.
