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
    refresh_approved: 'Refresh item approved and page moved to draft.',
    refresh_rejectd: 'Refresh item rejected.',
    refresh_deferd: 'Refresh item deferred.',
    page_regenerated: 'Page regenerated and revalidated.',
  };

  const errorMessages: Record<string, string> = {
    invalid_action: 'Invalid action.',
    not_draft: 'Only drafts can be published.',
    trend_not_found: 'Trend not found.',
    refresh_item_not_found: 'Refresh queue item not found.',
    page_not_found: 'Page not found.',
    publish_validation_failed: 'Publish blocked by validation guards.',
    pipeline_start_failed: 'Could not start daily pipeline.',
    page_regenerate_failed: 'Could not regenerate selected page.',
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

function formatDateTime(value?: string | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function getStatusColor(status?: string | null) {
  if (!status) return '#6b7280';
  const normalized = status.toLowerCase();
  if (normalized === 'ok' || normalized === 'succeeded') return '#166534';
  if (normalized === 'error' || normalized === 'failed') return '#b91c1c';
  if (normalized === 'running') return '#92400e';
  return '#374151';
}

async function getDashboardData() {
  const [
    { data: newTrends },
    { data: drafts },
    { data: published },
    { data: counts },
    { data: deploys },
    { data: pipelineRuns },
    { data: successfulPipelineRuns },
    { data: refreshQueue },
    { count: trendCount },
    { count: draftCount },
    { count: publishedCount },
    { count: refreshQueueCount },
  ] = await Promise.all([
    supabaseAdmin.from('trends').select('*').eq('status', 'new').order('created_at', { ascending: false }).limit(100),
    supabaseAdmin.from('pages').select('id,slug,title,template,updated_at').eq('status', 'draft').order('updated_at', { ascending: false }).limit(100),
    supabaseAdmin.from('pages').select('id,slug,title,template,published_at').eq('status', 'published').order('published_at', { ascending: false }).limit(100),
    supabaseAdmin.from('pages').select('template').neq('template', ''),
    supabaseAdmin.from('deploy_events').select('created_at,status,detail').order('created_at', { ascending: false }).limit(1),
    supabaseAdmin.from('pipeline_runs').select('id,pipeline_name,status,started_at,finished_at,duration_ms,error_message').order('started_at', { ascending: false }).limit(1),
    supabaseAdmin
      .from('pipeline_runs')
      .select('finished_at,status,pipeline_name')
      .eq('status', 'succeeded')
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(1),
    supabaseAdmin
      .from('content_refresh_queue')
      .select('id,page_id,slug,reason,status,queued_at,processed_at,stale_days,low_traffic')
      .eq('status', 'queued')
      .order('queued_at', { ascending: false })
      .limit(100),
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
    lastSuccessfulBuild: successfulPipelineRuns?.[0] ?? null,
    latestPipelineRun,
    latestPipelineSteps: latestPipelineSteps ?? [],
    refreshQueue: refreshQueue ?? [],
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
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '20px 16px 56px' }}>
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

      <section style={{ marginTop: 20 }}>
        <h2>Status counts</h2>
        <ul>
          <li>Trends pending approval: {data.totals.trends}</li>
          <li>Drafts ready for review: {data.totals.drafts}</li>
          <li>Published pages: {data.totals.published}</li>
          <li>Refresh queue (queued): {data.totals.refreshQueue}</li>
        </ul>
      </section>

      <section id="deploy" style={{ marginTop: 24, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
        <h2 style={{ marginTop: 0 }}>Deploy status</h2>
        <p style={{ marginBottom: 8 }}>Telemetry from Vercel deploy hook + pipeline build history.</p>

        <div style={{ marginBottom: 10 }}>
          <strong>Latest deploy hook event:</strong>{' '}
          {data.lastDeploy ? (
            <>
              <span style={{ color: getStatusColor(data.lastDeploy.status), fontWeight: 600 }}>{data.lastDeploy.status}</span>
              {' · '}
              <span>{formatDateTime(data.lastDeploy.created_at)}</span>
              {data.lastDeploy.detail ? <div style={{ color: '#4b5563', marginTop: 4 }}>{data.lastDeploy.detail}</div> : null}
            </>
          ) : (
            <span>No deploy hook events yet.</span>
          )}
        </div>

        <div>
          <strong>Last successful build:</strong>{' '}
          {data.lastSuccessfulBuild ? (
            <>
              <span>{formatDateTime(data.lastSuccessfulBuild.finished_at)}</span>
              <span style={{ color: '#4b5563' }}> · {data.lastSuccessfulBuild.pipeline_name}</span>
            </>
          ) : (
            <span>No successful pipeline run found yet.</span>
          )}
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
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
                <strong style={{ color: getStatusColor(data.latestPipelineRun.status) }}>{data.latestPipelineRun.status}</strong>
              </p>
              <p>
                started: {formatDateTime(data.latestPipelineRun.started_at)} · finished: {formatDateTime(data.latestPipelineRun.finished_at)} · duration(ms):{' '}
                {data.latestPipelineRun.duration_ms ?? 'n/a'}
              </p>
              {data.latestPipelineRun.error_message ? (
                <p style={{ color: 'crimson' }}>error: {data.latestPipelineRun.error_message}</p>
              ) : null}
              {data.latestPipelineSteps.length ? (
                <ul>
                  {data.latestPipelineSteps.map((step: any) => (
                    <li key={step.id}>
                      {step.step_name} — <span style={{ color: getStatusColor(step.status) }}>{step.status}</span>
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

      <section style={{ marginTop: 24 }}>
        <h2>Basic analytics</h2>
        {Object.keys(data.byTemplate).length ? (
          <ul>
            {Object.entries(data.byTemplate)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([template, count]) => (
                <li key={template}>
                  {template}: {count}
                </li>
              ))}
          </ul>
        ) : (
          <p>No template stats yet.</p>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
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

      <section style={{ marginTop: 24 }}>
        <h2>Refresh queue (status=queued)</h2>
        <ul>
          {data.refreshQueue.map((item: any) => (
            <li key={item.id}>
              <strong>{item.slug}</strong> — {item.reason}
              {typeof item.stale_days === 'number' ? ` (${item.stale_days}d stale)` : ''}
              {item.low_traffic ? ' · low traffic' : ''}
              <form method="post" action={`/api/admin/refresh-queue/${item.id}`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="approve" />
                <button type="submit">Approve refresh</button>
              </form>
              <form method="post" action={`/api/admin/refresh-queue/${item.id}`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="reject" />
                <button type="submit">Reject</button>
              </form>
              <form method="post" action={`/api/admin/refresh-queue/${item.id}`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="defer" />
                <button type="submit">Defer</button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Draft queue</h2>
        <ul>
          {data.drafts.map((d: any) => (
            <li key={d.id}>
              <Link href={`/${d.template}/${d.slug}` as any}>{d.title}</Link>
              <form method="post" action={`/api/admin/drafts/${d.id}`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="publish" />
                <button type="submit">Publish</button>
              </form>
              <form method="post" action={`/api/admin/pages/${d.id}/regenerate`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="regenerate" />
                <button type="submit">Regenerate</button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Published (latest)</h2>
        <ul>
          {data.published.slice(0, 30).map((p: any) => (
            <li key={p.id}>
              <Link href={`/${p.template}/${p.slug}` as any}>{p.title}</Link>
              <form method="post" action={`/api/admin/pages/${p.id}/regenerate`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="regenerate" />
                <button type="submit">Regenerate</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
