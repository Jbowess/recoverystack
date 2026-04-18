import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { NEWSLETTER_URL } from '@/lib/brand';

export const revalidate = 1800;

const SITE = process.env.SITE_URL ?? 'https://recoverystack.io';

const BEAT_META: Record<string, { label: string; description: string }> = {
  wearables: {
    label: 'Wearables',
    description: 'News on fitness wearables, smart rings, and biosensor technology — product launches, firmware updates, and accuracy studies.',
  },
  sleep_tech: {
    label: 'Sleep Tech',
    description: 'The latest in sleep tracking hardware, sleep improvement devices, and connected sleep platforms.',
  },
  sleep_science: {
    label: 'Sleep Science',
    description: 'Peer-reviewed research, clinical findings, and expert analysis on sleep physiology and recovery.',
  },
  recovery_protocols: {
    label: 'Recovery Protocols',
    description: 'Evidence-based updates on recovery methods, tools, and protocol design for athletes and active individuals.',
  },
  nutrition: {
    label: 'Nutrition & Supplementation',
    description: 'Research and news on nutrition, supplementation, and performance nutrition for recovery.',
  },
  regulatory: {
    label: 'Regulatory',
    description: 'FDA clearances, CE markings, clinical certifications, and regulatory developments in health technology.',
  },
  performance: {
    label: 'Performance',
    description: 'Training science, periodization research, and performance technology news for competitive athletes.',
  },
  general_recovery: {
    label: 'Recovery',
    description: 'General recovery news — tools, trends, and research relevant to athlete recovery and human performance.',
  },
};

const FORMAT_LABELS: Record<string, string> = {
  breaking: 'Breaking',
  research: 'Research',
  roundup: 'Roundup',
  expert_reaction: 'Expert',
  data_brief: 'Data',
};

type NewsPage = {
  slug: string;
  title: string;
  meta_description: string | null;
  published_at: string | null;
  news_format: string | null;
};

export async function generateStaticParams() {
  return Object.keys(BEAT_META).map((beat) => ({ beat }));
}

export async function generateMetadata({ params }: { params: Promise<{ beat: string }> }): Promise<Metadata> {
  const { beat } = await params;
  const meta = BEAT_META[beat];
  if (!meta) return { title: 'Not found' };

  return {
    title: `${meta.label} News | RecoveryStack`,
    description: meta.description,
    alternates: { canonical: `${SITE}/news/beat/${beat}` },
    openGraph: {
      type: 'website',
      url: `${SITE}/news/beat/${beat}`,
      title: `${meta.label} News | RecoveryStack`,
      description: meta.description,
      siteName: 'RecoveryStack',
    },
  };
}

export default async function BeatPage({ params }: { params: Promise<{ beat: string }> }) {
  const { beat } = await params;
  const meta = BEAT_META[beat];
  if (!meta) notFound();

  const { data } = await supabaseAdmin
    .from('pages')
    .select('slug, title, meta_description, published_at, news_format')
    .eq('status', 'published')
    .eq('template', 'news')
    .eq('beat', beat)
    .order('published_at', { ascending: false })
    .limit(36);

  const pages = (data ?? []) as NewsPage[];

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'News', item: `${SITE}/news` },
      { '@type': 'ListItem', position: 3, name: meta.label, item: `${SITE}/news/beat/${beat}` },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      <div className="rs-shell">
        <header className="rs-navbar" role="banner">
          <div className="rs-container rs-navbar-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <a href="/" className="rs-logo" aria-label="RecoveryStack home"><img src="/logo.png" alt="RecoveryStack" height={32} style={{ display: 'block', height: '32px', width: 'auto' }} /></a>
            <nav aria-label="Primary" className="rs-nav-links">
              <a href="/news">News</a>
              <a href="/guides">Guides</a>
              <a href="/alternatives">Alternatives</a>
              <a href="/protocols">Protocols</a>
            </nav>
          </div>
        </header>

        <main className="rs-main-section" id="main-content">
          <div className="rs-container" style={{ maxWidth: '1100px', margin: '0 auto', padding: '2rem 1rem' }}>

            {/* Breadcrumb */}
            <nav aria-label="Breadcrumb" style={{ marginBottom: '1.5rem', fontSize: '0.85rem', color: 'var(--rs-muted, #94a3b8)' }}>
              <a href="/news" style={{ color: 'var(--rs-muted, #94a3b8)' }}>News</a>
              <span style={{ margin: '0 0.5rem' }}>›</span>
              <span>{meta.label}</span>
            </nav>

            <div style={{ marginBottom: '2rem' }}>
              <p style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--rs-accent, #3b82f6)', marginBottom: '0.5rem' }}>
                {meta.label}
              </p>
              <h1 style={{ fontSize: 'clamp(1.5rem, 3.5vw, 2.25rem)', fontWeight: 700, marginBottom: '0.75rem' }}>
                {meta.label} News
              </h1>
              <p style={{ color: 'var(--rs-muted, #94a3b8)', maxWidth: '640px', lineHeight: 1.6 }}>
                {meta.description}
              </p>
            </div>

            {/* Other beats nav */}
            <nav aria-label="Other topics" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '2rem' }}>
              <a href="/news" style={{ padding: '0.3rem 0.75rem', borderRadius: '999px', fontSize: '0.8rem', background: 'var(--rs-surface-2, #1e293b)', color: 'var(--rs-muted, #94a3b8)', textDecoration: 'none' }}>
                All News
              </a>
              {Object.entries(BEAT_META)
                .filter(([b]) => b !== beat)
                .map(([b, m]) => (
                  <a key={b} href={`/news/beat/${b}`} style={{ padding: '0.3rem 0.75rem', borderRadius: '999px', fontSize: '0.8rem', background: 'var(--rs-surface-2, #1e293b)', color: 'var(--rs-muted, #94a3b8)', textDecoration: 'none' }}>
                    {m.label}
                  </a>
                ))}
            </nav>

            {pages.length > 0 ? (
              <section aria-label={`${meta.label} news articles`}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.25rem' }}>
                  {pages.map((page) => {
                    const date = page.published_at ? new Date(page.published_at) : null;
                    const formatLabel = page.news_format ? FORMAT_LABELS[page.news_format] : null;
                    return (
                      <article key={page.slug} className="rs-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1.25rem' }}>
                        {formatLabel && (
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--rs-accent, #3b82f6)' }}>
                            {formatLabel}
                          </span>
                        )}
                        <a href={`/news/${page.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <h2 style={{ fontSize: '1rem', fontWeight: 600, lineHeight: 1.4, margin: 0 }}>{page.title}</h2>
                        </a>
                        {page.meta_description && (
                          <p style={{ fontSize: '0.85rem', color: 'var(--rs-muted, #94a3b8)', lineHeight: 1.5, margin: 0 }}>
                            {page.meta_description.slice(0, 120)}{page.meta_description.length > 120 ? '…' : ''}
                          </p>
                        )}
                        {date && (
                          <time dateTime={date.toISOString()} style={{ fontSize: '0.75rem', color: 'var(--rs-muted, #94a3b8)', marginTop: 'auto', paddingTop: '0.5rem' }}>
                            {date.toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' })}
                          </time>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : (
              <div className="rs-card" style={{ padding: '2rem', textAlign: 'center' }}>
                <p style={{ color: 'var(--rs-muted, #94a3b8)' }}>No {meta.label.toLowerCase()} news published yet.</p>
                <a href="/news" style={{ marginTop: '1rem', display: 'inline-block', color: 'var(--rs-accent, #3b82f6)' }}>← All news</a>
              </div>
            )}

            <aside style={{ marginTop: '3rem', padding: '1.5rem', background: 'var(--rs-surface-2, #1e293b)', borderRadius: '12px' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.4rem' }}>Daily {meta.label} brief</h2>
              <p style={{ color: 'var(--rs-muted, #94a3b8)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                Get {meta.label.toLowerCase()} news distilled into a daily brief. $1/mo, cancel anytime.
              </p>
              <a href={NEWSLETTER_URL} target="_blank" rel="noopener noreferrer" className="rs-btn rs-btn-primary">
                Subscribe to RecoveryStack News
              </a>
            </aside>

          </div>
        </main>

        <footer className="rs-footer">
          <div className="rs-container">
            <nav aria-label="Footer">
              <a href="/news">News</a>
              <a href="/guides">Guides</a>
              <a href="/protocols">Protocols</a>
              <a href="/api/news-rss" type="application/rss+xml">RSS</a>
            </nav>
          </div>
        </footer>
      </div>
    </>
  );
}
