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
    label: 'Discovery',
    steps: [
      { id: 'trend-scraper', name: 'Trend scraper', script: 'scripts/trend-scraper.ts' },
      { id: 'gap-analyzer', name: 'Gap analyzer', script: 'scripts/gap-analyzer.ts' },
      { id: 'cannibalization-check', name: 'Cannibalization check', script: 'scripts/cannibalization-check.ts' },
    ],
  },
  {
    label: 'Generation',
    steps: [
      { id: 'content-generator', name: 'Content generator', script: 'scripts/content-generator.ts' },
    ],
  },
  {
    label: 'Linking & Quality',
    steps: [
      { id: 'linker', name: 'Linker', script: 'scripts/linker.ts' },
      { id: 'quality-gate', name: 'Quality gate', script: 'scripts/quality-gate.ts' },
    ],
  },
  {
    label: 'Deploy',
    steps: [
      { id: 'deploy', name: 'Deploy trigger', script: 'scripts/deploy.ts' },
    ],
  },
  {
    label: 'Rollup',
    steps: [
      { id: 'cluster-metrics-rollup', name: 'Cluster metrics rollup', script: 'scripts/cluster-metrics-rollup.ts' },
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
