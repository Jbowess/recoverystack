import { spawnSync } from 'node:child_process';
import {
  finishPipelineRun,
  finishPipelineStep,
  startPipelineRun,
  startPipelineStep,
} from './pipeline-telemetry';
import { sendPipelineAlert } from '@/lib/pipeline-alerts';

type Step = {
  id: string;
  name: string;
  script: string;
};

// Steps organized into phases. Steps within the same phase run in parallel.
type Phase = {
  label: string;
  steps: Step[];
};

const phases: Phase[] = [
  {
    label: 'Cost & Health Check',
    steps: [
      { id: 'api-cost-monitor', name: 'API cost monitor', script: 'scripts/api-cost-monitor.ts' },
      { id: 'queue-state-repair', name: 'Queue state repair', script: 'scripts/queue-state-repair.ts' },
    ],
  },
  {
    label: 'Discovery',
    steps: [
      { id: 'gsc-sync', name: 'GSC metrics sync', script: 'scripts/gsc-sync.ts' },
      { id: 'trend-scraper', name: 'Trend scraper', script: 'scripts/trend-scraper.ts' },
      { id: 'watchlist-sync', name: 'Watchlist sync', script: 'scripts/watchlist-sync.ts' },
      { id: 'brand-monitor', name: 'Watchlist monitor', script: 'scripts/brand-monitor.ts' },
      { id: 'news-intake', name: 'News intake', script: 'scripts/news-intake.ts' },
      { id: 'entity-sync', name: 'Entity sync', script: 'scripts/entity-sync.ts' },
      { id: 'storyline-builder', name: 'Storyline builder', script: 'scripts/storyline-builder.ts' },
      { id: 'gap-analyzer', name: 'Gap analyzer', script: 'scripts/gap-analyzer.ts' },
      { id: 'cannibalization-check', name: 'Cannibalization check', script: 'scripts/cannibalization-check.ts' },
      { id: 'competitor-spy', name: 'Competitor intelligence', script: 'scripts/competitor-spy.ts' },
      // Information gathering — run in parallel with other discovery steps
      { id: 'rank-tracker', name: 'Rank tracker', script: 'scripts/rank-tracker.ts' },
      { id: 'serp-feature-detector', name: 'SERP feature detector', script: 'scripts/serp-feature-detector.ts' },
      { id: 'keyword-data-sync', name: 'Keyword volume sync', script: 'scripts/keyword-data-sync.ts' },
      { id: 'competitor-content-extractor', name: 'Competitor content extractor', script: 'scripts/competitor-content-extractor.ts' },
      { id: 'competitor-alert', name: 'Competitor alert', script: 'scripts/competitor-alert.ts' },
      { id: 'gsc-opportunity-miner', name: 'GSC opportunity miner', script: 'scripts/gsc-opportunity-miner.ts' },
      { id: 'community-sentiment-miner', name: 'Community sentiment miner', script: 'scripts/community-sentiment-miner.ts' },
      { id: 'clinical-trials-monitor', name: 'Clinical trials monitor', script: 'scripts/clinical-trials-monitor.ts' },
      { id: 'app-review-miner', name: 'App review miner', script: 'scripts/app-review-miner.ts' },
      { id: 'conversion-sync', name: 'Conversion sync', script: 'scripts/conversion-sync.ts' },
      { id: 'proprietary-data-rollup', name: 'Proprietary data rollup', script: 'scripts/proprietary-data-rollup.ts' },
    ],
  },
  {
    label: 'News Wave',
    steps: [
      { id: 'news-wave', name: 'News velocity pipeline', script: 'scripts/news-wave.ts' },
    ],
  },
  {
    label: 'Keyword Expansion',
    steps: [
      { id: 'smart-ring-roadmap-sync', name: 'Smart ring roadmap sync', script: 'scripts/smart-ring-roadmap-sync.ts' },
      { id: 'smart-ring-demand-seed', name: 'Smart ring demand seed', script: 'scripts/smart-ring-demand-seed.ts' },
      { id: 'keyword-expander', name: 'Keyword expander', script: 'scripts/keyword-expander.ts' },
      { id: 'paa-factory', name: 'PAA page factory', script: 'scripts/paa-page-factory.ts' },
      { id: 'competitor-brand-page-generator', name: 'Competitor brand page generator', script: 'scripts/competitor-brand-page-generator.ts' },
      { id: 'use-case-page-splitter', name: 'Use-case page splitter', script: 'scripts/use-case-page-splitter.ts' },
      { id: 'buying-guide-generator', name: 'Buying guide generator', script: 'scripts/buying-guide-generator.ts' },
    ],
  },
  {
    label: 'Brief Generation',
    steps: [
      { id: 'brief-generator', name: 'Brief generator', script: 'scripts/brief-generator.ts' },
      { id: 'query-coverage-planner', name: 'Query coverage planner', script: 'scripts/query-coverage-planner.ts' },
    ],
  },
  {
    label: 'Generation',
    steps: [
      { id: 'content-generator', name: 'Content generator', script: 'scripts/content-generator.ts' },
      { id: 'visual-asset-generator', name: 'Supporting visual generator', script: 'scripts/visual-asset-generator.ts' },
      { id: 'claim-verifier', name: 'Claim verifier', script: 'scripts/claim-verifier.ts' },
      { id: 'video-seo-generator', name: 'Video SEO generator', script: 'scripts/video-seo-generator.ts' },
    ],
  },
  {
    label: 'Linking & Quality',
    steps: [
      { id: 'linker', name: 'Linker', script: 'scripts/linker.ts' },
      { id: 'quality-gate', name: 'Quality gate', script: 'scripts/quality-gate.ts' },
      { id: 'content-diff', name: 'Content diff checker', script: 'scripts/content-diff.ts' },
    ],
  },
  {
    label: 'Deploy',
    steps: [
      { id: 'deploy', name: 'Deploy trigger', script: 'scripts/deploy.ts' },
    ],
  },
  {
    label: 'Distribution',
    steps: [
      { id: 'distribution-asset-generator', name: 'Distribution asset generator', script: 'scripts/distribution-asset-generator.ts' },
      { id: 'social-publish-queue', name: 'Social publish queue', script: 'scripts/social-publish-queue.ts' },
      { id: 'media-pack-generator', name: 'Media pack generator', script: 'scripts/media-pack-generator.ts' },
      { id: 'outreach-queue-builder', name: 'Outreach queue builder', script: 'scripts/outreach-queue-builder.ts' },
      { id: 'partner-crm-sync', name: 'Partner CRM sync', script: 'scripts/partner-crm-sync.ts' },
      { id: 'creator-crm-sync', name: 'Creator CRM sync', script: 'scripts/creator-crm-sync.ts' },
      { id: 'email-digest-builder', name: 'Email digest builder', script: 'scripts/email-digest-builder.ts' },
      { id: 'demand-loop-builder', name: 'Demand loop builder', script: 'scripts/demand-loop-builder.ts' },
    ],
  },
  {
    label: 'Performance Optimization',
    steps: [
      { id: 'ctr-optimizer', name: 'CTR optimizer', script: 'scripts/ctr-optimizer.ts' },
      { id: 'discover-optimizer', name: 'Discover optimizer', script: 'scripts/discover-optimizer.ts' },
      { id: 'news-freshness', name: 'News freshness monitor', script: 'scripts/news-freshness.ts' },
      { id: 'story-followup', name: 'Story follow-up scheduler', script: 'scripts/story-followup.ts' },
      { id: 'persona-distributor', name: 'Persona distribution builder', script: 'scripts/persona-distributor.ts' },
      { id: 'staleness-scorer', name: 'Content staleness scorer', script: 'scripts/staleness-scorer.ts' },
      { id: 'snippet-optimizer', name: 'Featured snippet optimizer', script: 'scripts/snippet-optimizer.ts' },
      { id: 'geo-optimizer', name: 'GEO optimizer', script: 'scripts/geo-optimizer.ts' },
      { id: 'cwv-auto-fix', name: 'CWV auto-fix', script: 'scripts/cwv-auto-fix.ts' },
      { id: 'ab-test-manager', name: 'A/B test manager', script: 'scripts/ab-test-manager.ts' },
      { id: 'distribution-performance-rollup', name: 'Distribution performance rollup', script: 'scripts/distribution-performance-rollup.ts' },
      { id: 'social-metrics-sync', name: 'Social metrics sync', script: 'scripts/social-metrics-sync.ts' },
      { id: 'journey-attribution-rollup', name: 'Journey attribution rollup', script: 'scripts/journey-attribution-rollup.ts' },
      { id: 'ranking-opportunity-audit', name: 'Ranking opportunity audit', script: 'scripts/ranking-opportunity-audit.ts' },
    ],
  },
  {
    label: 'Rollup',
    steps: [
      { id: 'cluster-metrics-rollup', name: 'Cluster metrics rollup', script: 'scripts/cluster-metrics-rollup.ts' },
      { id: 'page-quality-scorer', name: 'Page quality scorer', script: 'scripts/page-quality-scorer.ts' },
      { id: 'adaptive-feedback-loop', name: 'Adaptive feedback loop', script: 'scripts/adaptive-feedback-loop.ts' },
      { id: 'topical-map', name: 'Topical authority map', script: 'scripts/topical-map.ts' },
      { id: 'orphan-link-audit', name: 'Orphan link audit', script: 'scripts/orphan-link-audit.ts' },
      { id: 'backlink-sync', name: 'Backlink sync', script: 'scripts/backlink-sync.ts' },
      { id: 'title-experiment-promoter', name: 'Title experiment promoter', script: 'scripts/title-experiment-promoter.ts' },
      { id: 'authority-rollup', name: 'Entity authority rollup', script: 'scripts/authority-rollup.ts' },
      { id: 'comparison-datasets', name: 'Comparison datasets', script: 'scripts/comparison-dataset-builder.ts' },
      { id: 'source-quality-scorer', name: 'Source quality scorer', script: 'scripts/source-quality-scorer.ts' },
      { id: 'serp-winner-analyzer', name: 'SERP winner analyzer', script: 'scripts/serp-winner-analyzer.ts' },
      { id: 'editorial-review-queue', name: 'Editorial review queue', script: 'scripts/editorial-review-queue.ts' },
      { id: 'news-roundup', name: 'Weekly roundup builder', script: 'scripts/news-roundup.ts' },
      // Performance intelligence rollups
      { id: 'performance-fingerprint', name: 'Performance fingerprint', script: 'scripts/performance-fingerprint.ts' },
      { id: 'cluster-completeness-checker', name: 'Cluster completeness checker', script: 'scripts/cluster-completeness-checker.ts' },
      { id: 'brand-product-sync', name: 'Brand product sync', script: 'scripts/brand-product-sync.ts' },
      { id: 'product-spec-sync', name: 'Product spec sync', script: 'scripts/product-spec-sync.ts' },
      { id: 'product-truth-sync', name: 'Product truth sync', script: 'scripts/product-truth-sync.ts' },
      { id: 'volo-product-intelligence-sync', name: 'Volo product intelligence sync', script: 'scripts/volo-product-intelligence-sync.ts' },
      { id: 'audience-segment-sync', name: 'Audience segment sync', script: 'scripts/audience-segment-sync.ts' },
      { id: 'brand-voice-governor', name: 'Brand voice governor', script: 'scripts/brand-voice-governor.ts' },
      { id: 'automation-governor', name: 'Automation governor', script: 'scripts/automation-governor.ts' },
      { id: 'editorial-trust-upgrade', name: 'Editorial trust upgrade', script: 'scripts/editorial-trust-upgrade.ts' },
      { id: 'editorial-governance-rollup', name: 'Editorial governance rollup', script: 'scripts/editorial-governance-rollup.ts' },
      // Quality, discovery, and internationalisation rollups
      { id: 'schema-validator', name: 'Schema validator', script: 'scripts/schema-validator.ts' },
      { id: 'link-prospect-miner', name: 'Link prospect miner', script: 'scripts/link-prospect-miner.ts' },
      { id: 'locale-generator', name: 'Locale generator', script: 'scripts/locale-generator.ts' },
    ],
  },
];

const allSteps = phases.flatMap((p) => p.steps);

function timestamp(): string {
  return new Date().toISOString();
}

async function runStep(step: Step, index: number, total: number, runId: string | null) {
  const label = `[${index}/${total}] ${step.name}`;
  const start = Date.now();
  const command = `npx tsx ${step.script}`;
  const stepId = await startPipelineStep(runId, step.id, step.name, index, total, command);

  console.log(`\n${'='.repeat(72)}`);
  console.log(`${timestamp()} | START ${label}`);
  console.log(`${timestamp()} | CMD   ${command}`);
  console.log(`${'='.repeat(72)}\n`);

  const result = spawnSync('npx', ['tsx', step.script], {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  const artifactLog = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const elapsedSeconds = ((Date.now() - start) / 1000).toFixed(1);

  if (result.status !== 0) {
    const exitCode = result.status ?? 1;
    await finishPipelineStep(stepId, 'failed', start, artifactLog, exitCode, `Exit code ${exitCode}`);

    console.error(`\n${'!'.repeat(72)}`);
    console.error(`${timestamp()} | FAIL  ${label} (${elapsedSeconds}s)`);
    console.error(`${timestamp()} | EXIT  ${result.status ?? 'unknown'}`);
    console.error(`${'!'.repeat(72)}\n`);
    return { ok: false as const, exitCode };
  }

  await finishPipelineStep(stepId, 'succeeded', start, artifactLog, result.status ?? 0);

  console.log(`\n${'-'.repeat(72)}`);
  console.log(`${timestamp()} | DONE  ${label} (${elapsedSeconds}s)`);
  console.log(`${'-'.repeat(72)}\n`);
  return { ok: true as const };
}

async function main() {
  const runStartedAt = Date.now();
  console.log(`${timestamp()} | Daily orchestration started`);

  const total = allSteps.length;
  const runId = await startPipelineRun('daily-orchestrator', total);
  let stepCounter = 0;

  try {
    for (const phase of phases) {
      console.log(`\n${'#'.repeat(72)}`);
      console.log(`${timestamp()} | PHASE: ${phase.label} (${phase.steps.length} step(s) in parallel)`);
      console.log(`${'#'.repeat(72)}\n`);

      if (phase.steps.length === 1) {
        // Single step — run sequentially as before
        stepCounter += 1;
        const step = phase.steps[0];
        const result = await runStep(step, stepCounter, total, runId);

        if (!result.ok) {
          const errorMsg = `${step.name} failed with exit code ${result.exitCode}`;
          await finishPipelineRun(runId, 'failed', runStartedAt, errorMsg);
          await sendPipelineAlert({
            pipeline: 'daily-orchestrator',
            step: step.name,
            status: 'failed',
            message: errorMsg,
            durationMs: Date.now() - runStartedAt,
          });
          process.exit(result.exitCode);
        }
      } else {
        // Multiple steps — run in parallel
        const parallelResults = await Promise.all(
          phase.steps.map((step) => {
            stepCounter += 1;
            return runStep(step, stepCounter, total, runId).then((result) => ({ step, result }));
          }),
        );

        for (const { step, result } of parallelResults) {
          if (!result.ok) {
            const errorMsg = `${step.name} failed with exit code ${result.exitCode}`;
            await finishPipelineRun(runId, 'failed', runStartedAt, errorMsg);
            await sendPipelineAlert({
              pipeline: 'daily-orchestrator',
              step: step.name,
              status: 'failed',
              message: errorMsg,
              durationMs: Date.now() - runStartedAt,
            });
            process.exit(result.exitCode);
          }
        }
      }
    }

    await finishPipelineRun(runId, 'succeeded', runStartedAt);
    console.log(`${timestamp()} | Daily orchestration completed successfully`);
    console.log('SEO generation ready');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await finishPipelineRun(runId, 'failed', runStartedAt, errorMsg);
    await sendPipelineAlert({
      pipeline: 'daily-orchestrator',
      status: 'failed',
      message: errorMsg,
      durationMs: Date.now() - runStartedAt,
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
