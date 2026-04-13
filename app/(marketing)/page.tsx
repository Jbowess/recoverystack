import type { Metadata } from 'next';
import ConversionBox from '@/components/ConversionBox';
import NewsletterForm from '@/components/NewsletterForm';
import { MAIN_SITE_URL, NEWSLETTER_URL, PRODUCT_NAME } from '@/lib/brand';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const revalidate = 3600;

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

export const metadata: Metadata = {
  title: 'RecoveryStack SEO Engine | RecoveryStack',
  description:
    'Evidence-based recovery protocols, wearable comparisons, and performance guides that move organic users into RecoveryStack News.',
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    title: 'RecoveryStack SEO Engine | RecoveryStack',
    description: 'RecoveryStack content designed to turn organic traffic into RecoveryStack News subscribers.',
    images: [{ url: `${SITE_URL}/opengraph-image`, width: 1200, height: 630 }],
  },
};

const WEBSITE_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'RecoveryStack.io',
  url: SITE_URL,
  description: 'Organic acquisition system for RecoveryStack News and the Volo Ring funnel',
};

const TEMPLATE_LABELS: Record<string, string> = {
  guides: 'Guide',
  alternatives: 'Alternative',
  protocols: 'Protocol',
  metrics: 'Metric',
  costs: 'Cost',
  compatibility: 'Compatibility',
  trends: 'Trend',
  pillars: 'Overview',
};

const CATEGORIES = [
  { label: 'Recovery Guides', href: '/guides', emoji: 'RS' },
  { label: 'Protocols', href: '/protocols', emoji: 'PR' },
  { label: 'Metrics', href: '/metrics', emoji: 'MT' },
  { label: 'Alternatives', href: '/alternatives', emoji: 'AL' },
  { label: 'Compatibility', href: '/compatibility', emoji: 'CP' },
  { label: 'Trends', href: '/trends', emoji: 'TR' },
];

const FAQS = [
  {
    q: 'What is RecoveryStack?',
    a: 'RecoveryStack is a recovery intelligence brand that publishes evidence-based guides, protocols, and wearable analysis to move readers into RecoveryStack News.',
  },
  {
    q: 'What should I do after reading an article here?',
    a: 'The primary next step is RecoveryStack News on the main site, where the brand turns research, buying context, and recovery tech analysis into an ongoing newsletter experience.',
  },
  {
    q: 'Are the guides based on real research?',
    a: 'Yes. Content is built around primary sources, named authorities, clinical standards, and clear editorial framing where applicable.',
  },
  {
    q: `Where does the ${PRODUCT_NAME} fit?`,
    a: `RecoveryStack News and the main RecoveryStack site are the bridge into the ${PRODUCT_NAME} funnel. This SEO layer is designed to attract qualified readers first, then move them deeper into the brand.`,
  },
];

async function getFeaturedPages() {
  try {
    const { data } = await supabaseAdmin
      .from('pages')
      .select('slug,template,title,meta_description,published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(9);
    return data ?? [];
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const featured = await getFeaturedPages();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_SCHEMA) }}
      />

      <main style={{ fontFamily: 'system-ui, sans-serif', color: '#111827' }}>
        <section
          style={{
            background: '#0f172a',
            color: '#f8fafc',
            padding: '72px 16px 64px',
            textAlign: 'center',
          }}
        >
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <p
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#94a3b8',
                marginBottom: 16,
              }}
            >
              RecoveryStack organic acquisition layer
            </p>
            <h1
              style={{
                fontSize: 'clamp(28px, 5vw, 48px)',
                fontWeight: 800,
                lineHeight: 1.15,
                margin: '0 0 20px',
              }}
            >
              Turn search traffic into
              <br />
              RecoveryStack News subscribers
            </h1>
            <p
              style={{
                fontSize: 18,
                color: '#94a3b8',
                maxWidth: 620,
                margin: '0 auto 32px',
                lineHeight: 1.6,
              }}
            >
              Evidence-based recovery protocols, wearable comparisons, and health-tech research
              built to move high-intent readers into the RecoveryStack newsletter.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <a
                href={NEWSLETTER_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '12px 28px',
                  background: '#16a34a',
                  color: '#fff',
                  borderRadius: 8,
                  textDecoration: 'none',
                  fontWeight: 700,
                  fontSize: 15,
                }}
              >
                Read RecoveryStack News
              </a>
              <a
                href={MAIN_SITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '12px 28px',
                  background: 'rgba(255,255,255,0.1)',
                  color: '#f8fafc',
                  borderRadius: 8,
                  textDecoration: 'none',
                  fontWeight: 600,
                  fontSize: 15,
                  border: '1px solid rgba(255,255,255,0.15)',
                }}
              >
                Visit the main site
              </a>
            </div>
          </div>
        </section>

        <div
          style={{
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            padding: '16px',
            textAlign: 'center',
          }}
        >
          <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>
            Primary research-backed content · Built to feed RecoveryStack News · Organic acquisition
            for the Volo Ring funnel
          </p>
        </div>

        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>
          <section style={{ padding: '56px 0 40px' }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Browse by topic cluster</h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 12,
              }}
            >
              {CATEGORIES.map((cat) => (
                <a
                  key={cat.href}
                  href={cat.href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '14px 16px',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    textDecoration: 'none',
                    color: '#374151',
                    fontWeight: 600,
                    fontSize: 14,
                    background: '#fff',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 800 }}>{cat.emoji}</span>
                  {cat.label}
                </a>
              ))}
            </div>
          </section>

          {featured.length > 0 && (
            <section style={{ paddingBottom: 56 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Latest SEO entry points</h2>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                  gap: 16,
                }}
              >
                {featured.map((page) => (
                  <a
                    key={page.slug}
                    href={`/${page.template}/${page.slug}`}
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <article
                      style={{
                        border: '1px solid #e2e8f0',
                        borderRadius: 10,
                        padding: '18px 20px',
                        height: '100%',
                        background: '#fff',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.07em',
                          color: '#16a34a',
                          marginBottom: 10,
                        }}
                      >
                        {TEMPLATE_LABELS[page.template] ?? page.template}
                      </span>
                      <h3
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: '#0f172a',
                          margin: '0 0 8px',
                          lineHeight: 1.4,
                        }}
                      >
                        {page.title}
                      </h3>
                      {page.meta_description && (
                        <p
                          style={{
                            color: '#64748b',
                            fontSize: 13,
                            margin: 0,
                            lineHeight: 1.5,
                          }}
                        >
                          {page.meta_description.slice(0, 110)}
                          {page.meta_description.length > 110 ? '...' : ''}
                        </p>
                      )}
                    </article>
                  </a>
                ))}
              </div>
            </section>
          )}

          <section style={{ paddingBottom: 56 }}>
            <ConversionBox pageTemplate="homepage" />
          </section>

          <section style={{ paddingBottom: 56 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Frequently asked questions</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {FAQS.map((faq) => (
                <details
                  key={faq.q}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: '14px 18px',
                    background: '#fff',
                  }}
                >
                  <summary
                    style={{
                      fontWeight: 600,
                      fontSize: 15,
                      cursor: 'pointer',
                      color: '#0f172a',
                    }}
                  >
                    {faq.q}
                  </summary>
                  <p style={{ color: '#475569', marginTop: 10, fontSize: 14, lineHeight: 1.6 }}>
                    {faq.a}
                  </p>
                </details>
              ))}
            </div>
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{
                __html: JSON.stringify({
                  '@context': 'https://schema.org',
                  '@type': 'FAQPage',
                  mainEntity: FAQS.map((faq) => ({
                    '@type': 'Question',
                    name: faq.q,
                    acceptedAnswer: { '@type': 'Answer', text: faq.a },
                  })),
                }),
              }}
            />
          </section>

          <section id="newsletter" style={{ paddingBottom: 72 }}>
            <div
              style={{
                background: '#0f172a',
                borderRadius: 12,
                padding: '40px 32px',
                textAlign: 'center',
                color: '#f8fafc',
              }}
            >
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>
                RecoveryStack News is the main conversion goal
              </h2>
              <p style={{ color: '#94a3b8', margin: '0 0 24px', fontSize: 15 }}>
                Move readers from search into the newsletter, then into the main site and the
                {' '}
                {PRODUCT_NAME}
                {' '}
                funnel.
              </p>
              <NewsletterForm source="homepage" />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
