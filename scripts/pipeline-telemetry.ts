import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

type RunStatus = 'running' | 'succeeded' | 'failed';
type StepStatus = RunStatus;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null;

const MAX_ARTIFACT_CHARS = 50_000;

function truncateArtifactLog(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= MAX_ARTIFACT_CHARS) return value;
  return `${value.slice(0, MAX_ARTIFACT_CHARS)}\n\n[truncated ${value.length - MAX_ARTIFACT_CHARS} chars]`;
}

function logTelemetryWarning(context: string, error: unknown) {
  console.warn(`[telemetry] ${context} failed`, error);
}

export async function startPipelineRun(pipelineName: string, totalSteps: number): Promise<string | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('pipeline_runs')
    .insert({
      pipeline_name: pipelineName,
      status: 'running',
      started_at: new Date().toISOString(),
      metadata: { totalSteps },
    })
    .select('id')
    .single();

  if (error) {
    logTelemetryWarning('startPipelineRun', error);
    return null;
  }

  return data?.id ?? null;
}

export async function finishPipelineRun(
  runId: string | null,
  status: Exclude<RunStatus, 'running'>,
  startedAtMs: number,
  errorMessage?: string,
) {
  if (!supabase || !runId) return;

  const { error } = await supabase
    .from('pipeline_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAtMs,
      error_message: errorMessage ?? null,
    })
    .eq('id', runId);

  if (error) logTelemetryWarning('finishPipelineRun', error);
}

export async function startPipelineStep(
  runId: string | null,
  stepKey: string,
  stepName: string,
  index: number,
  total: number,
  command: string,
): Promise<string | null> {
  if (!supabase || !runId) return null;

  const { data, error } = await supabase
    .from('pipeline_steps')
    .insert({
      run_id: runId,
      step_key: stepKey,
      step_name: stepName,
      step_index: index,
      total_steps: total,
      command,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    logTelemetryWarning('startPipelineStep', error);
    return null;
  }

  return data?.id ?? null;
}

export async function finishPipelineStep(
  stepId: string | null,
  status: Exclude<StepStatus, 'running'>,
  startedAtMs: number,
  artifactLog: string | null,
  exitCode?: number,
  errorMessage?: string,
) {
  if (!supabase || !stepId) return;

  const { error } = await supabase
    .from('pipeline_steps')
    .update({
      status,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAtMs,
      artifact_log: truncateArtifactLog(artifactLog),
      exit_code: typeof exitCode === 'number' ? exitCode : null,
      error_message: errorMessage ?? null,
    })
    .eq('id', stepId);

  if (error) logTelemetryWarning('finishPipelineStep', error);
}
