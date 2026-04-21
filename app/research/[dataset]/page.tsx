import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ dataset: string }>;
}): Promise<Metadata> {
  const { dataset } = await params;
  return {
    title: `${dataset.replace(/-/g, ' ')} dataset`,
    description: 'RecoveryStack first-party research snapshot.',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatValue(value: unknown) {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined || value === '') return 'n/a';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default async function ResearchDatasetPage({
  params,
}: {
  params: Promise<{ dataset: string }>;
}) {
  const { dataset } = await params;
  const { data, error } = await supabaseAdmin
    .from('comparison_dataset_snapshots')
    .select('dataset_key,title,snapshot_date,row_count,data,metadata')
    .eq('dataset_key', dataset)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) notFound();

  const rows: Record<string, unknown>[] = Array.isArray(data.data) ? data.data.filter(isRecord) : [];
  const columns: string[] = Array.from(
    new Set(rows.flatMap((row: Record<string, unknown>) => Object.keys(row))),
  ).slice(0, 8);

  return (
    <main className="rs-shell">
      <section className="rs-hero">
        <div className="rs-container">
          <a className="rs-breadcrumb" href="/research">← All research</a>
          <span className="rs-tag">Dataset</span>
          <h1>{data.title}</h1>
          <p className="rs-excerpt">
            {typeof data.metadata?.description === 'string' ? data.metadata.description : 'RecoveryStack research snapshot.'}
          </p>
          <p className="rs-meta">
            Snapshot {new Date(data.snapshot_date).toLocaleDateString('en-AU')} · {data.row_count} rows
          </p>
        </div>
      </section>

      <section className="rs-main-section">
        <div className="rs-container">
          {rows.length > 0 && columns.length > 0 ? (
            <div className="rs-card" style={{ overflowX: 'auto' }}>
              <table className="rs-comparison-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {columns.map((column: string) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 16).map((row: Record<string, unknown>, index: number) => (
                    <tr key={`row-${index}`}>
                      {columns.map((column: string) => (
                        <td key={`${index}-${column}`}>{formatValue(row[column])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rs-card">
              <p>This dataset does not contain tabular rows yet.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
