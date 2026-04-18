import type { Metadata } from 'next';
import { MAIN_SITE_URL, NEWSLETTER_URL, PRODUCT_NAME } from '@/lib/brand';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const revalidate = 3600;

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

export const metadata: Metadata = {
  title: 'RecoveryStack SEO Engine | RecoveryStack',
  description:
    'Premium clinical-tech SEO landing page for RecoveryStack content, built to convert high-intent recovery readers into RecoveryStack News subscribers.',
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    title: 'RecoveryStack SEO Engine | RecoveryStack',
    description:
      'A premium biotech-style search landing page for evidence-led recovery content, newsletter conversion, and product demand capture.',
    images: [{ url: `${SITE_URL}/opengraph-image`, width: 1200, height: 630 }],
  },
};

const WEBSITE_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'RecoveryStack.io',
  url: SITE_URL,
  description: 'Premium recovery intelligence system for RecoveryStack News and the Volo Ring funnel',
};

const TRUST_METRICS = [
  { value: '8', label: 'SEO content systems' },
  { value: '24/7', label: 'Clinical-tech publishing surface' },
  { value: '1', label: 'Clear conversion path to news' },
];

const PROOF_POINTS = [
  {
    title: 'Evidence-first editorial stance',
    text: 'Pages are framed around recovery science, wearable interpretation, buyer clarity, and clinical-style presentation rather than thin affiliate formatting.',
  },
  {
    title: 'High-intent commercial coverage',
    text: 'Guides, reviews, alternatives, compatibility, and cost pages are structured to absorb demand from readers already close to a product decision.',
  },
  {
    title: 'Shared design system for scale',
    text: 'Each branded SEO page can be generated from the same premium white, cyan, and charcoal language without drifting into template fatigue.',
  },
];

const BENEFITS = [
  {
    title: 'Search pages that feel like product',
    text: 'RecoveryStack presents acquisition content with the same sharp hierarchy, trust cues, and precision as a clinical-tech product interface.',
    bullets: ['Uppercase editorial display typography', 'Glass-surface proof modules', 'Controlled cyan emphasis instead of loud gradients'],
  },
  {
    title: 'A clearer route into the funnel',
    text: `The page architecture keeps organic visitors moving from category education to RecoveryStack News, then deeper into the ${PRODUCT_NAME} decision path.`,
    bullets: ['Intent-aware CTA placement', 'Brand proof before hard conversion asks', 'Strong newsletter and main-site handoff'],
  },
  {
    title: 'Built for repeatable brand generation',
    text: 'The section model supports programmatic rollout for individual brands without replacing the underlying RecoveryStack visual identity.',
    bullets: ['Reusable hero and proof framework', 'Consistent FAQ and comparison patterns', 'Shared card, border, and spacing system'],
  },
];

const COMPARISON_ROWS = [
  {
    label: 'Visual trust',
    brand: 'Clinical-tech interface with glass panels, restrained glow, and editorial spacing.',
    generic: 'Generic SaaS sections, loud gradients, or plain affiliate blocks.',
  },
  {
    label: 'Conversion strategy',
    brand: 'Guides the reader from credibility to the newsletter and product ecosystem.',
    generic: 'Pushes a CTA before enough proof is established.',
  },
  {
    label: 'Programmatic scale',
    brand: 'Supports repeated brand pages while preserving one design language.',
    generic: 'Creates a new mini-brand system for every page.',
  },
  {
    label: 'SEO presentation',
    brand: 'Optimized copy in a premium shell that still feels product-led.',
    generic: 'Content-farm formatting that dilutes brand trust.',
  },
];

const TOPIC_CLUSTERS = [
  { label: 'Recovery Guides', href: '/guides' },
  { label: 'Protocols', href: '/protocols' },
  { label: 'Metrics', href: '/metrics' },
  { label: 'Alternatives', href: '/alternatives' },
  { label: 'Compatibility', href: '/compatibility' },
  { label: 'Trends', href: '/trends' },
];

const FAQS = [
  {
    q: 'What makes this SEO page different from a standard affiliate landing page?',
    a: 'It uses a premium RecoveryStack product language first: sharp hierarchy, precise typography, clinical-tech proof surfaces, and a controlled conversion path into RecoveryStack News.',
  },
  {
    q: 'Can this structure be reused for multiple brands?',
    a: 'Yes. The section system is designed for repeated branded rollouts while keeping one consistent white, cyan, and charcoal design system across every page.',
  },
  {
    q: 'How does the page support conversion?',
    a: `The layout moves from editorial trust and product-category framing into specific proof, comparison logic, FAQs, and finally a direct handoff to RecoveryStack News and the ${PRODUCT_NAME} ecosystem.`,
  },
  {
    q: 'Is the page still SEO-aware?',
    a: 'Yes. The copy is built around high-intent recovery queries and schema support, but the presentation stays premium and product-led instead of looking like low-trust SEO inventory.',
  },
];

async function getFeaturedPages() {
  try {
    const { data } = await supabaseAdmin
      .from('pages')
      .select('slug,template,title,meta_description,published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(6);

    return (data ?? []) as Array<{
      slug: string;
      template: string;
      title: string;
      meta_description: string | null;
      published_at: string | null;
    }>;
  } catch {
    return [] as Array<{
      slug: string;
      template: string;
      title: string;
      meta_description: string | null;
      published_at: string | null;
    }>;
  }
}

function SectionHeading({
  label,
  title,
  body,
  compact,
}: {
  label: string;
  title: string;
  body: string;
  compact?: boolean;
}) {
  return (
    <div style={{ maxWidth: 760, marginBottom: 28 }}>
      <p className="section-label">{label}</p>
      <h2 className={`headline-display${compact ? ' is-compact' : ''}`}>{title}</h2>
      <p className="seo-body-copy" style={{ marginTop: 18 }}>{body}</p>
    </div>
  );
}

export default async function HomePage() {
  const featured = await getFeaturedPages();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_SCHEMA) }}
      />

      <main className="seo-shell seo-page">
        <header className="seo-nav" role="banner">
          <div className="seo-container seo-nav-inner">
            <a href="/" className="seo-nav-brand">RecoveryStack</a>
            <nav aria-label="Primary" className="seo-nav-links">
              <a href="#proof">Proof</a>
              <a href="#benefits">Benefits</a>
              <a href="#comparison">Why RecoveryStack</a>
              <a href="#faq">FAQ</a>
            </nav>
            <a
              className="btn-primary"
              href={NEWSLETTER_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Read RecoveryStack News
            </a>
          </div>
        </header>

        <section className="seo-hero">
          <div className="seo-container">
            <div className="seo-hero-grid">
              <div className="seo-hero-copy">
                <p className="section-label">Premium Recovery Intelligence</p>
                <h1 className="headline-display">
                  Branded search pages
                  <br />
                  <span className="text-gradient">built like clinical tech</span>
                </h1>
                <p className="seo-body-copy" style={{ marginTop: 22 }}>
                  RecoveryStack turns high-intent recovery search traffic into a sharp, high-trust
                  brand surface. The result is an SEO landing page that feels closer to a premium
                  performance lab product than a generic content funnel.
                </p>

                <div className="seo-actions">
                  <a
                    className="btn-primary"
                    href={NEWSLETTER_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Enter RecoveryStack News
                  </a>
                  <a
                    className="btn-outline"
                    href={MAIN_SITE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Visit Main Site
                  </a>
                </div>

                <div className="seo-inline-metrics">
                  {TRUST_METRICS.map((item) => (
                    <div key={item.label} className="seo-inline-metric">
                      <strong>{item.value}</strong>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <aside className="glass-card seo-kicker-card sensor-glow">
                <h2>RecoveryStack SEO Engine</h2>
                <p style={{ marginTop: 14 }}>
                  A high-converting brand landing surface for evidence-led recovery content,
                  newsletter acquisition, and product demand capture.
                </p>
                <div className="seo-chip-row">
                  <span className="seo-chip">White / Cyan / Charcoal</span>
                  <span className="seo-chip">Glass Morphism Panels</span>
                  <span className="seo-chip">Uppercase Display System</span>
                </div>
                <div className="seo-proof-strip">
                  {PROOF_POINTS.map((item) => (
                    <div key={item.title} className="seo-proof-cell hairline-frame">
                      <strong>{item.title}</strong>
                      <span>{item.text}</span>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          </div>
        </section>

        <section id="proof" className="seo-section seo-section-tight">
          <div className="seo-container">
            <SectionHeading
              label="Trust / Proof"
              title="Structured for credibility before conversion"
              body="Every block is designed to build confidence in the brand first. Thin borders, editorial whitespace, controlled cyan highlights, and restrained dark contrast panels make the page feel precise rather than promotional."
              compact
            />

            <div className="seo-grid-3">
              {PROOF_POINTS.map((item) => (
                <article key={item.title} className="glass-card seo-card sensor-glow">
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="benefits" className="seo-section">
          <div className="seo-container">
            <SectionHeading
              label="Brand-Specific Benefits"
              title="Why this page system fits the RecoveryStack family"
              body="The page model is built to support branded SEO demand capture without dropping into low-trust article aesthetics. It keeps a unified visual identity while giving each entry point enough product and buyer context to convert."
              compact
            />

            <div className="seo-grid-3">
              {BENEFITS.map((item) => (
                <article key={item.title} className="glass-card seo-list-card sensor-glow">
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                  <ul>
                    {item.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="seo-section seo-dark-section">
          <div className="seo-container">
            <SectionHeading
              label="Topic Coverage"
              title="Clean entry points across the recovery stack"
              body="The same system supports guides, protocols, metrics, alternatives, compatibility, and trend pages. Each cluster stays visually aligned, which matters when organic visitors move deeper into the site."
              compact
            />

            <div className="seo-grid-3">
              {TOPIC_CLUSTERS.map((cluster) => (
                <a
                  key={cluster.href}
                  href={cluster.href}
                  className="glass-card-dark seo-card sensor-glow"
                  style={{ textDecoration: 'none' }}
                >
                  <h3>{cluster.label}</h3>
                  <p className="seo-meta-text">
                    Open the branded topic hub for {cluster.label.toLowerCase()} content and keep the
                    reader inside one coherent RecoveryStack system.
                  </p>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section id="comparison" className="seo-section">
          <div className="seo-container">
            <SectionHeading
              label="Why Choose RecoveryStack"
              title="A sharper alternative to generic SEO landing pages"
              body="The difference is not just the copy. RecoveryStack uses a premium biotech-style visual hierarchy that keeps high-intent readers in a product-grade environment from first click to final CTA."
              compact
            />

            <div className="seo-comparison">
              <div className="glass-card sensor-glow" style={{ borderRadius: 24, padding: 28 }}>
                <table className="seo-comparison-table" aria-label="RecoveryStack comparison table">
                  <thead>
                    <tr>
                      <th>Signal</th>
                      <th>RecoveryStack</th>
                      <th>Generic SEO Page</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARISON_ROWS.map((row) => (
                      <tr key={row.label}>
                        <td><strong>{row.label}</strong></td>
                        <td>{row.brand}</td>
                        <td>{row.generic}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <aside className="glass-card-dark seo-card sensor-glow" style={{ borderRadius: 24, padding: 28 }}>
                <h3 className="seo-panel-title">Conversion Logic</h3>
                <p className="seo-meta-text" style={{ marginTop: 16 }}>
                  The page earns the CTA through trust, not noise. Organic visitors get context,
                  brand credibility, buyer framing, and only then a direct handoff to RecoveryStack
                  News and the broader product ecosystem.
                </p>
                <div className="seo-dual-actions">
                  <a
                    className="btn-primary"
                    href={NEWSLETTER_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Start with News
                  </a>
                  <a
                    className="btn-outline"
                    href={MAIN_SITE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Explore RecoveryStack
                  </a>
                </div>
              </aside>
            </div>
          </div>
        </section>

        {featured.length > 0 && (
          <section className="seo-section">
            <div className="seo-container">
              <SectionHeading
                label="Latest Entry Points"
                title="Current pages already feeding the acquisition layer"
                body="Published pages can be surfaced inside the same premium shell, giving users immediate proof that the design system scales beyond a single hero block."
                compact
              />

              <div className="seo-grid-3">
                {featured.map((page) => (
                  <a
                    key={page.slug}
                    href={`/${page.template}/${page.slug}`}
                    className="glass-card seo-article-card sensor-glow"
                  >
                    <span className="seo-eyebrow">{page.template}</span>
                    <h3>{page.title}</h3>
                    <p>
                      {(page.meta_description ?? '').slice(0, 145)}
                      {(page.meta_description ?? '').length > 145 ? '...' : ''}
                    </p>
                  </a>
                ))}
              </div>
            </div>
          </section>
        )}

        <section id="faq" className="seo-section">
          <div className="seo-container">
            <SectionHeading
              label="FAQ"
              title="Common questions about the RecoveryStack SEO page"
              body="The FAQ keeps commercial-intent objections and implementation concerns inside the same premium surface instead of pushing them into low-context support copy."
              compact
            />

            <div className="seo-faq-list">
              {FAQS.map((faq) => (
                <details key={faq.q} className="glass-card seo-faq-item sensor-glow">
                  <summary>{faq.q}</summary>
                  <p className="seo-faq-answer">{faq.a}</p>
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
          </div>
        </section>

        <section className="seo-section">
          <div className="seo-container">
            <div className="glass-card-dark seo-cta-band sensor-glow">
              <p className="section-label">Final CTA</p>
              <h2 className="headline-display is-compact">
                Turn search intent into
                <br />
                RecoveryStack demand
              </h2>
              <p className="seo-body-copy" style={{ marginTop: 18 }}>
                Use RecoveryStack News as the primary conversion layer, then carry qualified readers
                into the main site and the {PRODUCT_NAME} product path.
              </p>
              <div className="seo-dual-actions">
                <a
                  className="btn-primary"
                  href={NEWSLETTER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Read RecoveryStack News
                </a>
                <a
                  className="btn-outline"
                  href={MAIN_SITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Visit RecoveryStack.io
                </a>
              </div>
            </div>
          </div>
        </section>

        <div className="seo-container seo-footer-note">
          RecoveryStack premium recovery intelligence surface. Designed for organic acquisition,
          newsletter conversion, and branded product demand capture.
        </div>
      </main>
    </>
  );
}
