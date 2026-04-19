import { spawnSync } from 'node:child_process';

type Step = {
  name: string;
  script: string;
  args?: string[];
};

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const SKIP_GENERATION = process.argv.includes('--skip-generation');
const SKIP_POST_PUBLISH = process.argv.includes('--skip-post-publish');

const smartRingCompetitors = [
  'ouraring.com',
  'ultrahuman.com',
  'ringconn.com',
  'samsung.com',
];

const steps: Step[] = [
  { name: 'Smart ring demand seed', script: 'scripts/smart-ring-demand-seed.ts' },
  { name: 'Use-case page splitter', script: 'scripts/use-case-page-splitter.ts', args: ['--category=smart ring'] },
  { name: 'Buying guide generator', script: 'scripts/buying-guide-generator.ts', args: ['--category=smart ring'] },
  ...smartRingCompetitors.map((competitor) => ({
    name: `Competitor brand pages (${competitor})`,
    script: 'scripts/competitor-brand-page-generator.ts',
    args: [`--competitor=${competitor}`],
  })),
  { name: 'Cannibalization check', script: 'scripts/cannibalization-check.ts' },
  ...(SKIP_GENERATION
    ? []
    : [
        { name: 'Brief generator', script: 'scripts/brief-generator.ts' },
        { name: 'Content generator', script: 'scripts/content-generator.ts' },
        { name: 'Quality gate', script: 'scripts/quality-gate.ts' },
      ]),
  ...(SKIP_POST_PUBLISH
    ? []
    : [
        { name: 'Link rebuild', script: 'scripts/linker.ts' },
        { name: 'Schema validator', script: 'scripts/schema-validator.ts' },
        { name: 'GEO optimizer', script: 'scripts/geo-optimizer.ts' },
      ]),
];

function timestamp(): string {
  return new Date().toISOString();
}

function runStep(step: Step, index: number, total: number) {
  const command = ['npx', 'tsx', step.script, ...(step.args ?? []), ...(DRY_RUN ? ['--dry-run'] : [])];

  console.log(`\n${'='.repeat(72)}`);
  console.log(`${timestamp()} | [${index}/${total}] ${step.name}`);
  console.log(`${timestamp()} | CMD ${command.join(' ')}`);
  console.log(`${'='.repeat(72)}\n`);

  const result = spawnSync(command[0], command.slice(1), {
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
  console.log(`${timestamp()} | Smart ring growth playbook started`);
  console.log(`${timestamp()} | Dry run: ${DRY_RUN ? 'yes' : 'no'}`);
  console.log(`${timestamp()} | Skip generation: ${SKIP_GENERATION ? 'yes' : 'no'}`);
  console.log(`${timestamp()} | Skip post-publish: ${SKIP_POST_PUBLISH ? 'yes' : 'no'}`);

  steps.forEach((step, index) => runStep(step, index + 1, steps.length));

  console.log(`\n${'-'.repeat(72)}`);
  console.log(`${timestamp()} | Smart ring growth playbook completed`);
  console.log(`${'-'.repeat(72)}\n`);
}

main();
