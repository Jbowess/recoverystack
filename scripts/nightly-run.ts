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
  command: string;
  args: string[];
};

const steps: Step[] = [
  { id: 'daily-run', command: 'npm', args: ['run', 'daily:run'] },
  { id: 'gsc-sync', command: 'npm', args: ['run', 'gsc:sync'] },
  { id: 'content-refresh', command: 'npm', args: ['run', 'content:refresh'] },
  { id: 'content-refresh-processor', command: 'npm', args: ['run', 'content:refresh:process'] },
  { id: 'cwv-monitor', command: 'npm', args: ['run', 'cwv:monitor'] },
  { id: 'ctr-optimizer', command: 'npm', args: ['run', 'ctr:optimize'] },
  { id: 'backlink-sync', command: 'npm', args: ['run', 'backlink:sync'] },
  { id: 'price-scraper', command: 'npm', args: ['run', 'price:scrape'] },
];

function logEvent(level: 'info' | 'error', event: string, data: Record<string, unknown> = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }

  console.log(line);
}

async function runStep(step: Step, index: number, total: number, runId: string | null) {
  const startedAt = Date.now();
  const command = [step.command, ...step.args].join(' ');

  logEvent('info', 'step.start', {
    step: step.id,
    index,
    total,
    command,
  });

  const stepId = await startPipelineStep(runId, step.id, step.id, index, total, command);

  const result = spawnSync(step.command, step.args, {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  const artifactLog = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const durationMs = Date.now() - startedAt;

  if (result.status !== 0) {
    const exitCode = result.status ?? 1;
    await finishPipelineStep(stepId, 'failed', startedAt, artifactLog, exitCode, `Exit code ${exitCode}`);

    logEvent('error', 'step.failed', {
      step: step.id,
      index,
      total,
      durationMs,
      exitCode,
    });

    return { ok: false as const, exitCode };
  }

  await finishPipelineStep(stepId, 'succeeded', startedAt, artifactLog, result.status ?? 0);

  logEvent('info', 'step.succeeded', {
    step: step.id,
    index,
    total,
    durationMs,
  });

  return { ok: true as const };
}

async function main() {
  const startedAt = Date.now();
  const runId = await startPipelineRun('nightly-run', steps.length);

  logEvent('info', 'nightly.start', { totalSteps: steps.length, runId });

  try {
    for (let idx = 0; idx < steps.length; idx += 1) {
      const step = steps[idx];
      const result = await runStep(step, idx + 1, steps.length, runId);

      if (!result.ok) {
        const errorMsg = `${step.id} failed with exit code ${result.exitCode}`;
        await finishPipelineRun(runId, 'failed', startedAt, errorMsg);
        await sendPipelineAlert({
          pipeline: 'nightly-run',
          step: step.id,
          status: 'failed',
          message: errorMsg,
          durationMs: Date.now() - startedAt,
        });
        process.exit(result.exitCode);
      }
    }

    await finishPipelineRun(runId, 'succeeded', startedAt);
    logEvent('info', 'nightly.succeeded', {
      durationMs: Date.now() - startedAt,
      totalSteps: steps.length,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await finishPipelineRun(runId, 'failed', startedAt, errorMsg);
    await sendPipelineAlert({
      pipeline: 'nightly-run',
      status: 'failed',
      message: errorMsg,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
