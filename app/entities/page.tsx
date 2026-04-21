import type { Metadata } from 'next';
import { BRAND_ENTITY_SEEDS } from '@/lib/brand-entities';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Entity Hub',
  description: 'First-class RecoveryStack entities for the brand, product, methodology, and decision frameworks.',
};

export default async function EntityIndexPage() {
  const { data, error } = await supabaseAdmin
    .from('topic_entities')
    .select('slug,canonical_name,entity_type,authority_score,metadata')
    .eq('active', true)
    .in('slug', BRAND_ENTITY_SEEDS.map((seed) => seed.slug))
    .order('authority_score', { ascending: false });

  if (error) throw error;

  return (
    <main className="rs-shell">
      <section className="rs-hero">
        <div className="rs-container">
          <span className="rs-tag">Entity Hub</span>
          <h1>Entity pages that make the brand graph explicit.</h1>
          <p className="rs-excerpt">
            These pages give assistants and readers a single place to understand RecoveryStack, its product surfaces, and the methodology behind the site.
          </p>
        </div>
      </section>

      <section className="rs-main-section">
        <div className="rs-container seo-grid-3">
          {(data ?? []).map((entity: any) => (
            <article className="rs-card" key={entity.slug}>
              <h2 style={{ marginTop: 0 }}>
                <a href={`/entities/${entity.slug}`}>{entity.canonical_name}</a>
              </h2>
              <p>{typeof entity.metadata?.description === 'string' ? entity.metadata.description : 'RecoveryStack entity profile.'}</p>
              <p style={{ color: 'var(--rs-muted, #94a3b8)' }}>
                {entity.entity_type} · authority {entity.authority_score}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
