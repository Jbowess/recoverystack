import Link from 'next/link';
import { getMigrationReadinessReport } from '@/lib/migration-readiness';
import { supabaseAdmin } from '@/lib/supabase-admin';

function parseMessage(params: Record<string, string | string[] | undefined>) {
  const ok = typeof params.ok === 'string' ? params.ok : '';
  const error = typeof params.error === 'string' ? params.error : '';
  const detail = typeof params.detail === 'string' ? params.detail : '';

  const okMessages: Record<string, string> = {
    trend_approved: 'Trend approved and review draft created.',
    draft_published: 'Page published successfully.',
    pipeline_started: 'Daily pipeline started in the background.',
    refresh_approved: 'Refresh item approved for regeneration.',
    refresh_rejectd: 'Refresh item rejected.',
    refresh_deferd: 'Refresh item deferred.',
    page_regenerated: 'Page regenerated and revalidated.',
    component_library_reseeded: 'Component library reseed completed safely (idempotent upsert).',
    keyword_queue_seeded: 'Top trends were queued into keyword_queue.',
  };

  const errorMessages: Record<string, string> = {
    invalid_action: 'Invalid action.',
    not_draft: 'Only review-ready pages can be published.',
    trend_not_found: 'Trend not found.',
    refresh_item_not_found: 'Refresh queue item not found.',
    page_not_found: 'Page not found.',
    publish_validation_failed: 'Publish blocked by validation guards.',
    pipeline_start_failed: 'Could not start daily pipeline.',
    page_regenerate_failed: 'Could not regenerate selected page.',
    component_library_reseed_failed: 'Could not reseed component library.',
    keyword_queue_seed_failed: 'Could not queue top trends.',
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

function countBy(rows: any[], key: string) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = String(row?.[key] ?? 'unknown').trim() || 'unknown';
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function numericSummary(rows: any[]) {
  if (!rows.length) return { rowCount: 0, numericFields: {} as Record<string, { min: number; max: number; avg: number }> };

  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row ?? {})) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        const list = buckets.get(key) ?? [];
        list.push(value);
        buckets.set(key, list);
      }
    }
  }

  const numericFields: Record<string, { min: number; max: number; avg: number }> = {};
  for (const [key, list] of buckets.entries()) {
    if (!list.length) continue;
    const min = Math.min(...list);
    const max = Math.max(...list);
    const avg = list.reduce((sum, n) => sum + n, 0) / list.length;
    numericFields[key] = { min, max, avg: Number(avg.toFixed(3)) };
  }

  return {
    rowCount: rows.length,
    numericFields,
  };
}

function topWeightedByCluster(rows: any[]) {
  const grouped = new Map<string, Array<{ name: string; weight: number }>>();

  for (const row of rows) {
    const cluster = String(row?.cluster ?? 'unknown').trim() || 'unknown';
    const name = String(row?.name ?? '').trim();
    const weight = Number(row?.weight ?? 0);
    if (!name || !Number.isFinite(weight)) continue;

    const current = grouped.get(cluster) ?? [];
    current.push({ name, weight });
    grouped.set(cluster, current);
  }

  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cluster, items]) => [cluster, items.sort((a, b) => b.weight - a.weight).slice(0, 3)]),
  );
}

async function safeSelect(table: string, columns: string, limit = 1000) {
  const response = await supabaseAdmin.from(table).select(columns).limit(limit);
  if (response.error) {
    return { data: [], error: response.error.message };
  }
  return { data: response.data ?? [], error: null as string | null };
}

async function getDashboardData() {
  const [
    { data: newTrends },
    { data: reviewQueue },
    { data: published },
    { data: counts },
    { data: deploys },
    { data: pipelineRuns },
    { data: successfulPipelineRuns },
    { data: refreshQueue },
    { count: trendCount },
    { count: reviewCount },
    { count: publishedCount },
    { count: refreshQueueCount },
    migrationReadiness,
    componentLibraryRows,
    performanceFingerprintRows,
    keywordQueueRows,
    clusterMetricsRows,
    newsroomFeedRows,
    newsroomEventRows,
    newsroomEntityRows,
    newsroomStorylineRows,
  ] = await Promise.all([
    supabaseAdmin.from('trends').select('*').eq('status', 'new').order('created_at', { ascending: false }).limit(100),
    supabaseAdmin.from('pages').select('id,slug,title,template,status,updated_at').in('status', ['draft', 'approved']).order('updated_at', { ascending: false }).limit(100),
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
    supabaseAdmin.from('pages').select('id', { count: 'exact', head: true }).in('status', ['draft', 'approved']),
    supabaseAdmin.from('pages').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    supabaseAdmin.from('content_refresh_queue').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
    getMigrationReadinessReport(),
    safeSelect('component_library', 'cluster,name,weight,active'),
    safeSelect('performance_fingerprints', 'template,top_performer_count,avg_word_count,avg_faq_count,best_ctr_word_range,computed_at'),
    safeSelect('keyword_queue', 'status,source'),
    safeSelect('cluster_metrics', '*', 300),
    safeSelect('news_source_feeds', 'beat,active'),
    safeSelect('news_source_events', 'status,event_type,beat'),
    safeSelect('topic_entities', 'entity_type,beat,authority_score'),
    safeSelect('storylines', 'status,beat,freshness_score,authority_score'),
  ]);

  const byTemplate = (counts ?? []).reduce((acc: Record<string, number>, row: any) => {
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

  const componentByCluster = countBy(componentLibraryRows.data, 'cluster');
  const componentTopWeights = topWeightedByCluster(componentLibraryRows.data);
  const keywordByStatus = countBy(keywordQueueRows.data, 'status');
  const keywordBySource = countBy(keywordQueueRows.data, 'source');
  const clusterMetricsSummary = numericSummary(clusterMetricsRows.data);
  const newsroomFeedsByBeat = countBy(newsroomFeedRows.data, 'beat');
  const newsroomEventsByStatus = countBy(newsroomEventRows.data, 'status');
  const newsroomEventsByType = countBy(newsroomEventRows.data, 'event_type');
  const newsroomEntitiesByType = countBy(newsroomEntityRows.data, 'entity_type');
  const newsroomStorylinesByStatus = countBy(newsroomStorylineRows.data, 'status');

  return {
    newTrends: newTrends ?? [],
    drafts: reviewQueue ?? [],
    published: published ?? [],
    byTemplate,
    lastDeploy: deploys?.[0] ?? null,
    lastSuccessfulBuild: successfulPipelineRuns?.[0] ?? null,
    latestPipelineRun,
    latestPipelineSteps: latestPipelineSteps ?? [],
    refreshQueue: refreshQueue ?? [],
    migrationReadiness,
    totals: {
      trends: trendCount ?? 0,
      drafts: reviewCount ?? 0,
      published: publishedCount ?? 0,
      refreshQueue: refreshQueueCount ?? 0,
    },
    componentLibrary: {
      byCluster: componentByCluster,
      topWeights: componentTopWeights,
      total: componentLibraryRows.data.length,
      error: componentLibraryRows.error,
    },
    feedbackLoop: {
      fingerprints: performanceFingerprintRows.data,
      error: performanceFingerprintRows.error,
    },
    keywordQueue: {
      byStatus: keywordByStatus,
      bySource: keywordBySource,
      total: keywordQueueRows.data.length,
      error: keywordQueueRows.error,
    },
    clusterMetrics: {
      summary: clusterMetricsSummary,
      error: clusterMetricsRows.error,
    },
    newsroom: {
      feedsByBeat: newsroomFeedsByBeat,
      eventsByStatus: newsroomEventsByStatus,
      eventsByType: newsroomEventsByType,
      entitiesByType: newsroomEntitiesByType,
      storylinesByStatus: newsroomStorylinesByStatus,
      feedTotal: newsroomFeedRows.data.length,
      eventTotal: newsroomEventRows.data.length,
      entityTotal: newsroomEntityRows.data.length,
      storylineTotal: newsroomStorylineRows.data.length,
      error: newsroomFeedRows.error || newsroomEventRows.error || newsroomEntityRows.error || newsroomStorylineRows.error,
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
      <p>Manual gates enforced: generation writes to review state, publishing runs through guarded admin actions only.</p>

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

      <section style={{ marginTop: 20, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
        <h2 style={{ marginTop: 0 }}>Migration readiness</h2>
        {data.migrationReadiness.ready ? (
          <p style={{ color: '#166534' }}>All required tables are present ({data.migrationReadiness.requiredTableCount} checked).</p>
        ) : (
          <>
            <p style={{ color: '#b91c1c' }}>
              Missing {data.migrationReadiness.missingTableCount} required table(s). Run the SQL snippets below in Supabase SQL Editor, then refresh this page.
            </p>
            <p style={{ marginTop: 0 }}>
              API status endpoint:{' '}
              <code style={{ background: '#f3f4f6', padding: '1px 4px' }}>/api/admin/migration-readiness</code>
            </p>
            <ul>
              {data.migrationReadiness.missingMigrations.map((migration: any) => (
                <li key={migration.migration} style={{ marginBottom: 14 }}>
                  <p style={{ margin: '0 0 6px' }}>
                    <strong>{migration.migration}</strong> ({migration.filePath})
                    <br />
                    Missing tables: {migration.missingTables.join(', ')}
                  </p>
                  <pre
                    style={{
                      background: '#111827',
                      color: '#f9fafb',
                      padding: 12,
                      borderRadius: 6,
                      overflowX: 'auto',
                      whiteSpace: 'pre-wrap',
                      maxHeight: 280,
                    }}
                  >
                    {migration.sqlSnippet}
                  </pre>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section style={{ marginTop: 20 }}>
        <h2>Status counts</h2>
        <ul>
          <li>Trends pending approval: {data.totals.trends}</li>
          <li>Pages in review queue: {data.totals.drafts}</li>
          <li>Published pages: {data.totals.published}</li>
          <li>Refresh queue (queued): {data.totals.refreshQueue}</li>
        </ul>
      </section>

      <section style={{ marginTop: 24, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
        <h2 style={{ marginTop: 0 }}>Component & keyword cluster controls</h2>
        <p style={{ marginTop: 0, color: '#4b5563' }}>Operational controls for component library reseeding and keyword queue filling.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <form method="post" action="/api/admin/cluster-systems">
            <input type="hidden" name="action" value="reseed_component_library" />
            <button type="submit">Reseed component_library</button>
          </form>
          <form method="post" action="/api/admin/cluster-systems">
            <input type="hidden" name="action" value="enqueue_top_trends" />
            <input type="hidden" name="limit" value="25" />
            <button type="submit">Enqueue top trends → keyword_queue</button>
          </form>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>New system visibility</h2>

        <h3 style={{ marginBottom: 6 }}>component_library counts by cluster</h3>
        {data.componentLibrary.error ? (
          <p style={{ color: '#92400e' }}>{data.componentLibrary.error}</p>
        ) : (
          <>
            <p style={{ color: '#4b5563' }}>Total rows: {data.componentLibrary.total}</p>
            <ul>
              {Object.entries(data.componentLibrary.byCluster)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([cluster, count]) => (
                  <li key={cluster}>
                    {cluster}: {count}
                  </li>
                ))}
            </ul>
            <p style={{ color: '#4b5563', marginBottom: 6 }}>Highest-weight components per cluster</p>
            <ul>
              {Object.entries(data.componentLibrary.topWeights).map(([cluster, items]: [string, any]) => (
                <li key={`weights-${cluster}`}>
                  {cluster}: {items.map((item: { name: string; weight: number }) => `${item.name} (${item.weight})`).join(', ')}
                </li>
              ))}
            </ul>
          </>
        )}

        <h3 style={{ marginBottom: 6 }}>adaptive feedback loop</h3>
        {data.feedbackLoop.error ? (
          <p style={{ color: '#92400e' }}>{data.feedbackLoop.error}</p>
        ) : data.feedbackLoop.fingerprints.length ? (
          <ul>
            {data.feedbackLoop.fingerprints.map((row: any) => (
              <li key={row.template}>
                {row.template}: top performers {row.top_performer_count ?? 0}, avg words {row.avg_word_count ?? 'n/a'}, avg FAQs {row.avg_faq_count ?? 'n/a'}, best CTR range {row.best_ctr_word_range ?? 'n/a'}, computed {formatDateTime(row.computed_at)}
              </li>
            ))}
          </ul>
        ) : (
          <p>No adaptive feedback fingerprints written yet.</p>
        )}

        <h3 style={{ marginBottom: 6 }}>keyword_queue counts</h3>
        {data.keywordQueue.error ? (
          <p style={{ color: '#92400e' }}>{data.keywordQueue.error}</p>
        ) : (
          <>
            <p style={{ color: '#4b5563' }}>Total rows: {data.keywordQueue.total}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <strong>By status</strong>
                <ul>
                  {Object.entries(data.keywordQueue.byStatus)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([status, count]) => (
                      <li key={status}>
                        {status}: {count}
                      </li>
                    ))}
                </ul>
              </div>
              <div>
                <strong>By source</strong>
                <ul>
                  {Object.entries(data.keywordQueue.bySource)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([source, count]) => (
                      <li key={source}>
                        {source}: {count}
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </>
        )}

        <h3 style={{ marginBottom: 6 }}>cluster_metrics summary</h3>
        {data.clusterMetrics.error ? (
          <p style={{ color: '#92400e' }}>{data.clusterMetrics.error}</p>
        ) : (
          <>
            <p style={{ color: '#4b5563' }}>Rows sampled: {data.clusterMetrics.summary.rowCount}</p>
            {Object.keys(data.clusterMetrics.summary.numericFields).length ? (
              <ul>
                {Object.entries(data.clusterMetrics.summary.numericFields)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([field, stats]) => (
                    <li key={field}>
                      {field}: min {stats.min} · avg {stats.avg} · max {stats.max}
                    </li>
                  ))}
              </ul>
            ) : (
              <p>No numeric fields found in sampled cluster_metrics rows.</p>
            )}
          </>
        )}

        <h3 style={{ marginBottom: 6 }}>newsroom system visibility</h3>
        {data.newsroom.error ? (
          <p style={{ color: '#92400e' }}>{data.newsroom.error}</p>
        ) : (
          <>
            <p style={{ color: '#4b5563' }}>
              Feeds: {data.newsroom.feedTotal} · Source events: {data.newsroom.eventTotal} · Entities: {data.newsroom.entityTotal} · Storylines: {data.newsroom.storylineTotal}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <strong>Feeds by beat</strong>
                <ul>
                  {Object.entries(data.newsroom.feedsByBeat).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={label}>{label}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Events by status</strong>
                <ul>
                  {Object.entries(data.newsroom.eventsByStatus).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={label}>{label}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Events by type</strong>
                <ul>
                  {Object.entries(data.newsroom.eventsByType).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={label}>{label}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Entities / storylines</strong>
                <ul>
                  {Object.entries(data.newsroom.entitiesByType).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`entity-${label}`}>entity {label}: {count}</li>
                  ))}
                  {Object.entries(data.newsroom.storylinesByStatus).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`story-${label}`}>storyline {label}: {count}</li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
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
                  {template}: {String(count)}
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
        <h2>Review queue</h2>
        <ul>
          {data.drafts.map((d: any) => (
            <li key={d.id}>
              <strong>{d.title}</strong> <span style={{ color: '#4b5563' }}>({d.status})</span>
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
