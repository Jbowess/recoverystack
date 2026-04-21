import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: slug.replace(/-/g, ' '),
    description: 'RecoveryStack entity profile.',
  };
}

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const entityResult = await supabaseAdmin
    .from('topic_entities')
    .select('id,slug,canonical_name,entity_type,authority_score,metadata')
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle();

  if (entityResult.error) throw entityResult.error;
  if (!entityResult.data) notFound();

  const entity = entityResult.data as any;

  const [aliasResult, relatedPageResult, storylineResult] = await Promise.all([
    supabaseAdmin
      .from('topic_entity_aliases')
      .select('alias')
      .eq('entity_id', entity.id)
      .order('confidence_score', { ascending: false })
      .limit(12),
    supabaseAdmin
      .from('page_entities')
      .select('page_slug,salience_score,is_primary,pages!inner(title,template,meta_description)')
      .eq('entity_key', slug)
      .order('salience_score', { ascending: false })
      .limit(10),
    supabaseAdmin
      .from('storylines')
      .select('slug,title,status,latest_event_at')
      .eq('canonical_entity_id', entity.id)
      .order('latest_event_at', { ascending: false })
      .limit(8),
  ]);

  return (
    <main className="rs-shell">
      <section className="rs-hero">
        <div className="rs-container">
          <a className="rs-breadcrumb" href="/entities">← All entities</a>
          <span className="rs-tag">Entity Profile</span>
          <h1>{entity.canonical_name}</h1>
          <p className="rs-excerpt">
            {typeof entity.metadata?.description === 'string' ? entity.metadata.description : 'RecoveryStack entity profile.'}
          </p>
          <p className="rs-meta">{entity.entity_type} · authority {entity.authority_score}</p>
        </div>
      </section>

      <section className="rs-main-section">
        <div className="rs-container rs-grid">
          <article className="rs-card">
            <h2>Key facts</h2>
            <ul>
              {(Array.isArray(entity.metadata?.key_facts) ? entity.metadata.key_facts : []).map((fact: string, index: number) => (
                <li key={`fact-${index}`}>{fact}</li>
              ))}
            </ul>
            {typeof entity.metadata?.site_url === 'string' ? (
              <p><a href={entity.metadata.site_url}>Canonical URL</a></p>
            ) : null}
          </article>

          <article className="rs-card">
            <h2>Aliases</h2>
            <ul>
              {(aliasResult.data ?? []).map((alias: any, index: number) => (
                <li key={`alias-${index}`}>{alias.alias}</li>
              ))}
            </ul>
          </article>

          <article className="rs-card">
            <h2>Related pages</h2>
            <ul>
              {(relatedPageResult.data ?? []).map((item: any) => (
                <li key={`${item.page_slug}-${item.salience_score}`}>
                  <a href={`/${item.pages.template}/${item.page_slug}`}>{item.pages.title}</a>
                  <div>{item.pages.meta_description}</div>
                </li>
              ))}
            </ul>
          </article>

          <article className="rs-card">
            <h2>Recent storylines</h2>
            <ul>
              {(storylineResult.data ?? []).map((storyline: any) => (
                <li key={storyline.slug}>
                  <strong>{storyline.title}</strong>
                  <div>{storyline.status} · {storyline.latest_event_at ? new Date(storyline.latest_event_at).toLocaleDateString('en-AU') : 'n/a'}</div>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>
    </main>
  );
}
