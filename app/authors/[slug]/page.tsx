import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export const revalidate = 3600;

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

interface Author {
  id: string;
  slug: string;
  name: string;
  title: string;
  bio: string | null;
  credentials: string[] | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  avatar_url: string | null;
}

export async function generateStaticParams() {
  const { data } = await supabase.from('authors').select('slug');
  return (data ?? []).map((a: { slug: string }) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await supabase
    .from('authors')
    .select('name, title, bio')
    .eq('slug', slug)
    .single();
  const author = (data ?? null) as Pick<Author, 'name' | 'title' | 'bio'> | null;

  if (!author) return { title: 'Author not found' };

  return {
    title: `${author.name} — ${author.title} | RecoveryStack`,
    description: author.bio?.slice(0, 160) ?? `${author.name} is a ${author.title} at RecoveryStack.`,
  };
}

export default async function AuthorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const { data } = await supabase
    .from('authors')
    .select('*')
    .eq('slug', slug)
    .single();
  const author = (data ?? null) as Author | null;

  if (!author) notFound();

  // Fetch articles by this author (pages mentioning this author slug)
  const { data: articles } = await supabase
    .from('pages')
    .select('slug, template, title, published_at')
    .eq('status', 'published')
    .contains('metadata', { author_slug: slug })
    .order('published_at', { ascending: false })
    .limit(12);

  const authorUrl = `${SITE_URL}/authors/${slug}`;

  const personJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: author.name,
    jobTitle: author.title,
    url: authorUrl,
    description: author.bio ?? undefined,
      ...(author.credentials?.length ? { hasCredential: author.credentials.map((c: string) => ({ '@type': 'EducationalOccupationalCredential', credentialCategory: c })) } : {}),
    sameAs: [author.linkedin_url, author.twitter_url].filter(Boolean),
    worksFor: {
      '@type': 'Organization',
      name: 'RecoveryStack',
      url: SITE_URL,
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }} />

      <div className="rs-shell">
        <header className="rs-navbar" role="banner">
          <div className="rs-container rs-navbar-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <a href="/" className="rs-logo" aria-label="RecoveryStack home"><img src="/logo.png" alt="RecoveryStack" height={32} style={{ display: 'block', height: '32px', width: 'auto' }} /></a>
            <nav aria-label="Primary" className="rs-nav-links">
              <a href="/guides">Guides</a>
              <a href="/alternatives">Alternatives</a>
              <a href="/protocols">Protocols</a>
            </nav>
          </div>
        </header>

        <main className="rs-main-section">
          <div className="rs-container" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1rem' }}>
            <a href="/about/team" className="rs-breadcrumb">← All Authors</a>

            <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start', marginTop: '2rem', marginBottom: '2rem' }}>
              {author.avatar_url ? (
                <img
                  src={author.avatar_url}
                  alt={author.name}
                  width={120}
                  height={120}
                  style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                />
              ) : (
                <div
                  aria-hidden="true"
                  style={{
                    width: 120,
                    height: 120,
                    borderRadius: '50%',
                    background: 'var(--rs-surface-2, #1e293b)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '2.5rem',
                    flexShrink: 0,
                  }}
                >
                  {author.name.charAt(0)}
                </div>
              )}

              <div>
                <h1 style={{ marginBottom: '0.25rem' }}>{author.name}</h1>
                <p style={{ color: 'var(--rs-muted, #94a3b8)', marginBottom: '0.75rem' }}>{author.title}</p>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  {author.linkedin_url && (
                    <a href={author.linkedin_url} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
                      LinkedIn
                    </a>
                  )}
                  {author.twitter_url && (
                    <a href={author.twitter_url} target="_blank" rel="noopener noreferrer" aria-label="Twitter/X">
                      Twitter/X
                    </a>
                  )}
                </div>
              </div>
            </div>

            {author.bio && (
              <section aria-labelledby="bio-heading">
                <h2 id="bio-heading">About</h2>
                <p>{author.bio}</p>
              </section>
            )}

            {author.credentials && author.credentials.length > 0 && (
              <section aria-labelledby="credentials-heading" style={{ marginTop: '1.5rem' }}>
                <h2 id="credentials-heading">Credentials</h2>
                <ul>
                  {author.credentials.map((cred: string, i: number) => (
                    <li key={i}>{cred}</li>
                  ))}
                </ul>
              </section>
            )}

            {articles && articles.length > 0 && (
              <section aria-labelledby="articles-heading" style={{ marginTop: '2rem' }}>
                <h2 id="articles-heading">Articles</h2>
                <div className="rs-grid">
                  {articles.map((article: { slug: string; template: string; title: string; published_at: string | null }) => (
                    <article className="rs-card" key={article.slug}>
                      <a href={`/${article.template}/${article.slug}`}>
                        <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>{article.title}</h3>
                      </a>
                      {article.published_at && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--rs-muted, #94a3b8)' }}>
                          {new Date(article.published_at).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        </main>

        <footer className="rs-footer">
          <div className="rs-container">
            <p className="rs-tagline">Organic recovery-tech content that feeds RecoveryStack News and the Volo Ring funnel.</p>
          </div>
        </footer>
      </div>
    </>
  );
}
