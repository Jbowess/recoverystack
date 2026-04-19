import { spawnSync } from 'node:child_process';

type Step = {
  name: string;
  command: string[];
};

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const SKIP_GROWTH = process.argv.includes('--skip-growth');
const SKIP_DATA = process.argv.includes('--skip-data');
const SKIP_ATTRIBUTION = process.argv.includes('--skip-attribution');
const SKIP_OPTIMIZATION = process.argv.includes('--skip-optimization');
const SKIP_REPURPOSING = process.argv.includes('--skip-repurposing');

function timestamp(): string {
  return new Date().toISOString();
}

function withDryRun(command: string[]): string[] {
  return DRY_RUN ? [...command, '--dry-run'] : command;
}

const steps: Step[] = [
  ...(SKIP_GROWTH
    ? []
    : [
        {
          name: 'Smart ring growth stack',
          command: withDryRun(['npx', 'tsx', 'scripts/smart-ring-growth-playbook.ts', '--skip-post-publish']),
        },
      ]),
  ...(SKIP_DATA
    ? []
    : [
        { name: 'Product spec sync', command: withDryRun(['npx', 'tsx', 'scripts/product-spec-sync.ts']) },
        { name: 'Product truth sync', command: withDryRun(['npx', 'tsx', 'scripts/product-truth-sync.ts']) },
        { name: 'Price scraper', command: withDryRun(['npx', 'tsx', 'scripts/price-scraper.ts']) },
        { name: 'App review miner', command: withDryRun(['npx', 'tsx', 'scripts/app-review-miner.ts']) },
        { name: 'Community sentiment miner', command: withDryRun(['npx', 'tsx', 'scripts/community-sentiment-miner.ts']) },
        { name: 'Smart ring comparison datasets', command: withDryRun(['npx', 'tsx', 'scripts/comparison-dataset-builder.ts', '--smart-ring-only']) },
      ]),
  ...(SKIP_ATTRIBUTION
    ? []
    : [
        { name: 'Conversion sync', command: withDryRun(['npx', 'tsx', 'scripts/conversion-sync.ts']) },
        { name: 'Journey attribution rollup', command: withDryRun(['npx', 'tsx', 'scripts/journey-attribution-rollup.ts']) },
      ]),
  ...(SKIP_REPURPOSING
    ? []
    : [
        { name: 'Brand framework seeder', command: withDryRun(['npx', 'tsx', 'scripts/brand-framework-seeder.ts']) },
        { name: 'Distribution asset generator', command: withDryRun(['npx', 'tsx', 'scripts/distribution-asset-generator.ts']) },
        { name: 'Series generator', command: withDryRun(['npx', 'tsx', 'scripts/series-generator.ts']) },
        { name: 'Lead magnet generator', command: withDryRun(['npx', 'tsx', 'scripts/lead-magnet-generator.ts']) },
        { name: 'Community prompt generator', command: withDryRun(['npx', 'tsx', 'scripts/community-prompt-generator.ts']) },
        { name: 'Video package generator', command: withDryRun(['npx', 'tsx', 'scripts/video-package-generator.ts']) },
        { name: 'Creator brief generator', command: withDryRun(['npx', 'tsx', 'scripts/creator-brief-generator.ts']) },
        { name: 'Press data brief generator', command: withDryRun(['npx', 'tsx', 'scripts/press-data-brief-generator.ts']) },
        { name: 'Persona distributor', command: withDryRun(['npx', 'tsx', 'scripts/persona-distributor.ts']) },
        { name: 'Media pack generator', command: withDryRun(['npx', 'tsx', 'scripts/media-pack-generator.ts']) },
        { name: 'Social publish queue', command: withDryRun(['npx', 'tsx', 'scripts/social-publish-queue.ts']) },
        { name: 'Distribution performance rollup', command: withDryRun(['npx', 'tsx', 'scripts/distribution-performance-rollup.ts']) },
        { name: 'Repurposing priority scorer', command: withDryRun(['npx', 'tsx', 'scripts/repurposing-priority-scorer.ts']) },
        { name: 'Brand reach rollup', command: withDryRun(['npx', 'tsx', 'scripts/brand-reach-rollup.ts']) },
        { name: 'Tool idea miner', command: withDryRun(['npx', 'tsx', 'scripts/tool-idea-miner.ts']) },
        { name: 'Repurposing feedback loop', command: withDryRun(['npx', 'tsx', 'scripts/repurposing-feedback-loop.ts']) },
      ]),
  ...(SKIP_OPTIMIZATION
    ? []
    : [
        { name: 'Query coverage planner', command: withDryRun(['npx', 'tsx', 'scripts/query-coverage-planner.ts', '--smart-ring-only']) },
        { name: 'Orphan link audit', command: withDryRun(['npx', 'tsx', 'scripts/orphan-link-audit.ts', '--smart-ring-only']) },
        { name: 'Link rebuild', command: withDryRun(['npx', 'tsx', 'scripts/linker.ts']) },
        { name: 'CTR optimizer', command: withDryRun(['npx', 'tsx', 'scripts/ctr-optimizer.ts', '--smart-ring-only']) },
        { name: 'Snippet optimizer', command: withDryRun(['npx', 'tsx', 'scripts/snippet-optimizer.ts', '--smart-ring-only']) },
        { name: 'GEO optimizer', command: withDryRun(['npx', 'tsx', 'scripts/geo-optimizer.ts']) },
      ]),
];

function runStep(step: Step, index: number, total: number) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`${timestamp()} | [${index}/${total}] ${step.name}`);
  console.log(`${timestamp()} | CMD ${step.command.join(' ')}`);
  console.log(`${'='.repeat(72)}\n`);

  const result = spawnSync(step.command[0], step.command.slice(1), {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    throw new Error(`${step.name} failed with exit code ${result.status ?? 1}`);
  }
}

function main() {
  console.log(`${timestamp()} | Smart ring system focus started`);
  console.log(`${timestamp()} | Dry run: ${DRY_RUN ? 'yes' : 'no'}`);

  steps.forEach((step, index) => runStep(step, index + 1, steps.length));

  console.log(`\n${'-'.repeat(72)}`);
  console.log(`${timestamp()} | Smart ring system focus completed`);
  console.log(`${'-'.repeat(72)}\n`);
}

main();
