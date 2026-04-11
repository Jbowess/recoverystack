import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase-admin';

function parseMessage(params: Record<string, string | string[] | undefined>) {
  const ok = typeof params.ok === 'string' ? params.ok : '';
  const error = typeof params.error === 'string' ? params.error : '';
  const detail = typeof params.detail === 'string' ? params.detail : '';

  const okMessages: Record<string, string> = {
    trend_approved: 'Trend approved and draft created.',
    draft_published: 'Draft published successfully.',
    pipeline_started: 'Daily pipeline started in the background.',
  };

  const errorMessages: Record<string, string> = {
    invalid_action: 'Invalid action.',
    not_draft: 'Only drafts can be published.',
    trend_not_found: 'Trend not found.',
    publish_validation_failed: 'Publish blocked by validation guards.',
    pipeline_start_failed: 'Could not start daily pipeline.',
  };

  return {
    ok: okMessages[ok] ?? '',
    error: errorMessages[error] ?? '',
    details: detail
      ? detail
          .split(';')
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  };
}

async function getDashboardData() {
  const [
    { data: newTrends },
    { data: drafts },
    { data: published },
    { data: counts },
    { data: deploys },
    { data: pipelineRuns },
    { count: trendCount },
    { count: draftCount },
    { count: publishedCount },
    { count: refreshQueueCount },
  ] = await Promise.all([
    supabaseAdmin.from('trends').select('*').eq('status', 'new').order('created_at', { ascending: false }).limit(100),
    supabaseAdmin.from('pages').select('id,slug,title,template,updated_at').eq('status', 'draft').order('updated_at', { ascending: false }).limit(100),
    supabaseAdmin.from('pages').select('id,slug,title,template,published_at').eq('status', 'published').order('published_at', { ascending: false }).limit(100),
    supabaseAdmin.from('pages').select('template').neq('template', ''),
    supabaseAdmin.from('deploy_events').select('created_at,status').order('created_at', { ascending: false }).limit(1),
    supabaseAdmin.from('pipeline_runs').select('id,pipeline_name,status,started_at,finished_at,duration_ms,error_message').order('started_at', { ascending: false }).limit(1),
    supabaseAdmin.from('trends').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    supabaseAdmin.from('pages').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
    supabaseAdmin.from('pages').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    supabaseAdmin.from('content_refresh_queue').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
  ]);

  const byTemplate = (counts ?? []).reduce<Record<string, number>>((acc, row: any) => {
    acc[row.template] = (acc[row.template] ?? 0) + 1;
    return acc;
  }, {});

  const latestPipelineRun = pipelineRuns?.[0] ?? null;
  const { data: latestPipelineSteps } = latestPipelineRun
    ? await supabaseAdmin
        .from('pipeline_steps')
        .select('id,step_name,step_key,status,duration_ms,exit_code,error_message')
        .eq('run_id', latestPipelineRun.id)
        .order('step_index', { ascending: true })
    : { data: [] as any[] };

  return {
    newTrends: newTrends ?? [],
    drafts: drafts ?? [],
    published: published ?? [],
    byTemplate,
    lastDeploy: deploys?.[0] ?? null,
    latestPipelineRun,
    latestPipelineSteps: latestPipelineSteps ?? [],
    totals: {
      trends: trendCount ?? 0,
      drafts: draftCount ?? 0,
      published: publishedCount ?? 0,
      refreshQueue: refreshQueueCount ?? 0,
    },
  };
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [data, params] = await Promise.all([getDashboardData(), searchParams]);
  const message = parseMessage(params);

  return (
    <main>
      <h1>RecoveryStack Admin</h1>
      <p>Manual gates enforced: trend approval then draft publish.</p>

      {message.ok ? <p style={{ color: 'green' }}>{message.ok}</p> : null}
      {message.error ? (
        <div style={{ color: 'crimson' }}>
          <p>{message.error}</p>
          {message.details.length ? (
            <ul>
              {message.details.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <section>
        <h2>Status counts</h2>
        <ul>
          <li>Trends pending approval: {data.totals.trends}</li>
          <li>Drafts ready for review: {data.totals.drafts}</li>
          <li>Published pages: {data.totals.published}</li>
          <li>Refresh queue (queued): {data.totals.refreshQueue}</li>
        </ul>
      </section>

      <section>
        <h2>Pipeline</h2>
        <form method="post" action="/api/admin/pipeline">
          <input type="hidden" name="action" value="run_pipeline" />
          <button type="submit">Run Pipeline</button>
        </form>

        <div style={{ marginTop: 12 }}>
          <h3>Last pipeline run</h3>
          {data.latestPipelineRun ? (
            <>
              <p>
                <strong>{data.latestPipelineRun.pipeline_name}</strong> · status:{' '}
                <strong>{data.latestPipelineRun.status}</strong>
              </p>
              <p>
                started: {data.latestPipelineRun.started_at ?? 'n/a'} · finished:{' '}
                {data.latestPipelineRun.finished_at ?? 'in progress'} · duration(ms):{' '}
                {data.latestPipelineRun.duration_ms ?? 'n/a'}
              </p>
              {data.latestPipelineRun.error_message ? (
                <p style={{ color: 'crimson' }}>error: {data.latestPipelineRun.error_message}</p>
              ) : null}
              {data.latestPipelineSteps.length ? (
                <ul>
                  {data.latestPipelineSteps.map((step: any) => (
                    <li key={step.id}>
                      {step.step_name} — {step.status}
                      {typeof step.duration_ms === 'number' ? ` (${step.duration_ms}ms)` : ''}
                      {typeof step.exit_code === 'number' ? ` [exit ${step.exit_code}]` : ''}
                      {step.error_message ? ` — ${step.error_message}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p>No pipeline telemetry yet.</p>
          )}
        </div>
      </section>

      <section>
        <h2>Basic analytics</h2>
        <pre>{JSON.stringify({ pageCountByTemplate: data.byTemplate, lastDeploy: data.lastDeploy }, null, 2)}</pre>
      </section>

      <section>
        <h2>Trend queue (status=new)</h2>
        <ul>
          {data.newTrends.map((trend: any) => (
            <li key={trend.id}>
              <strong>{trend.term}</strong> ({trend.source ?? 'unknown'})
              <form method="post" action={`/api/admin/trends/${trend.id}`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="approve" />
                <button type="submit">Approve</button>
              </form>
              <form method="post" action={`/api/admin/trends/${trend.id}`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="reject" />
                <button type="submit">Reject</button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Draft queue</h2>
        <ul>
          {data.drafts.map((d: any) => (
            <li key={d.id}>
              <Link href={`/${d.template}/${d.slug}`}>{d.title}</Link>
              <form method="post" action={`/api/admin/drafts/${d.id}`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="publish" />
                <button type="submit">Publish</button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Published (latest)</h2>
        <ul>
          {data.published.slice(0, 30).map((p: any) => (
            <li key={p.id}>
              <Link href={`/${p.template}/${p.slug}`}>{p.title}</Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
