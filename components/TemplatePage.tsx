import React from 'react';
import CompatibilityCheckerWidget from '@/components/CompatibilityCheckerWidget';
import ComparisonTable from '@/components/ComparisonTable';
import ConversionBox from '@/components/ConversionBox';
import ExitIntentModal from '@/components/ExitIntentModal';
import NewsletterForm from '@/components/NewsletterForm';
import PillarLink from '@/components/PillarLink';
import ReadingProgressBar from '@/components/ReadingProgressBar';
import ShareBar from '@/components/ShareBar';
import TableOfContents from '@/components/TableOfContents';
import { MAIN_SITE_URL, NEWSLETTER_URL, PRODUCT_NAME } from '@/lib/brand';
import type { InfoGainFeeds, InternalLink, PageBodySection, PageRecord } from '@/lib/types';

type Props = {
  page: PageRecord;
  pillarLink: InternalLink | null;
  siblingLinks: InternalLink[];
  schemaJsonLd: unknown[];
};

function formatDate(dateStr: string | null) {
  if (!dateStr) return 'Updated recently';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return 'Updated recently';
  return new Intl.DateTimeFormat('en-AU', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function estimateReadTime(page: PageRecord) {
  const textParts: string[] = [page.h1, page.intro ?? ''];
  const sections = page.body_json?.sections ?? [];

  for (const section of sections) {
    textParts.push(section.heading);
    textParts.push(JSON.stringify(section.content));
  }

  const words = textParts.join(' ').trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(3, Math.ceil(words / 220));
  return `${minutes} min read`;
}

const INLINE_LINK_RE = /\[([^\]]+)\]\((\/[^)]+)\)|(\/(?:guides|alternatives|protocols|metrics|costs|compatibility|trends|pillars|reviews|checklists)\/[a-z0-9-]+)/g;

function parseInlineLinks(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_LINK_RE.lastIndex = 0;

  while ((match = INLINE_LINK_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1] && match[2]) {
      // Markdown link: [anchor](/path)
      nodes.push(<a key={match.index} href={match[2]}>{match[1]}</a>);
    } else if (match[3]) {
      // Bare path: /guides/slug
      nodes.push(<a key={match.index} href={match[3]}>{match[3]}</a>);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length === 1 && typeof nodes[0] === 'string' ? nodes[0] : <>{nodes}</>;
}

function toSentenceArray(content: unknown): string[] {
  if (Array.isArray(content)) {
    return content.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).filter(Boolean);
  }

  if (typeof content === 'string') {
    return [content];
  }

  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>;

    if (Array.isArray(obj.paragraphs)) {
      return obj.paragraphs.map((item) => String(item));
    }

    if (Array.isArray(obj.items)) {
      return obj.items.map((item) => String(item));
    }

    if (Array.isArray(obj.studies)) {
      return obj.studies.map((item) => {
        const row = item as { title?: string; journal?: string | null; pubdate?: string | null };
        return [row.title, row.journal, row.pubdate].filter(Boolean).join(' — ');
      });
    }

    if (Array.isArray(obj.complaints)) {
      return obj.complaints.map((item) => {
        const row = item as { title?: string; subreddit?: string; score?: number | null; comments?: number | null };
        return `${row.title ?? 'Complaint'} (${row.subreddit ?? 'reddit'} · score ${row.score ?? 'n/a'} · comments ${row.comments ?? 'n/a'})`;
      });
    }

    return [JSON.stringify(content, null, 2)];
  }

  return [];
}

function renderSectionContent(section: PageBodySection, page?: PageRecord) {
  const content = section.content as Record<string, unknown> | unknown;

  // Definition box — styled for featured snippet extraction (position 0)
  if (section.kind === 'definition_box') {
    const text = typeof content === 'string' ? content : toSentenceArray(content).join(' ');
    return (
      <div
        style={{
          borderLeft: '4px solid var(--rs-accent, #00c2a8)',
          paddingLeft: '1rem',
          paddingTop: '0.75rem',
          paddingBottom: '0.75rem',
          background: 'var(--rs-surface-2, #1e293b)',
          borderRadius: '0 0.5rem 0.5rem 0',
          marginBottom: '1.5rem',
        }}
        role="note"
        aria-label={`Definition: ${section.heading}`}
      >
        <strong style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--rs-accent, #00c2a8)' }}>
          Definition
        </strong>
        <p style={{ margin: 0 }}>{text}</p>
      </div>
    );
  }

  // Scientific alpha feed — render PubMed citations as real HTML links
  if (section.id === 'scientific-alpha-feed') {
    const feeds = page?.body_json?.info_gain_feeds as InfoGainFeeds | undefined;
    const items = feeds?.scientific_alpha?.items ?? [];
    if (items.length > 0) {
      return (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {items.map((item, idx) => (
            <li key={`pub-${idx}`} style={{ marginBottom: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--rs-surface-2, #1e293b)' }}>
              <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 500 }}>
                {item.title}
              </a>
              {(item.journal || item.pubdate) && (
                <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--rs-muted, #94a3b8)', marginTop: '0.2rem' }}>
                  {[item.journal, item.pubdate].filter(Boolean).join(' · ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      );
    }
  }

  // Social sentiment feed — render Reddit complaints as cards with links
  if (section.id === 'social-sentiment-feed') {
    const feeds = page?.body_json?.info_gain_feeds as InfoGainFeeds | undefined;
    const complaints = feeds?.social_sentiment?.complaints ?? [];
    if (complaints.length > 0) {
      return (
        <div>
          {complaints.map((item, idx) => (
            <div key={`reddit-${idx}`} style={{ marginBottom: '0.75rem', padding: '0.75rem', background: 'var(--rs-surface-2, #1e293b)', borderRadius: '0.5rem' }}>
              <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 500 }}>
                {item.title}
              </a>
              <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--rs-muted, #94a3b8)', marginTop: '0.2rem' }}>
                r/{item.subreddit} · {item.score ?? 0} points · {item.comments ?? 0} comments
              </span>
            </div>
          ))}
        </div>
      );
    }
  }

  if (section.kind === 'faq') {
    const faqs = Array.isArray((content as Record<string, unknown>)?.items)
      ? ((content as Record<string, unknown>).items as Array<{ q?: string; a?: string }>)
      : [];

    if (faqs.length > 0) {
      return (
        <div>
          {faqs.map((faq, idx) => (
            <article key={`${section.id}-faq-${idx}`}>
              <h3>{faq.q ?? `Question ${idx + 1}`}</h3>
              <p>{parseInlineLinks(faq.a ?? '')}</p>
            </article>
          ))}
        </div>
      );
    }
  }

  if (section.kind === 'steps' || section.kind === 'list') {
    const items = toSentenceArray(content);
    if (items.length) {
      return (
        <ol>
          {items.map((item, idx) => (
            <li key={`${section.id}-item-${idx}`}>{item}</li>
          ))}
        </ol>
      );
    }
  }

  if (section.kind === 'table') {
    const table = content as { headers?: string[]; rows?: string[][] };
    if (Array.isArray(table?.headers) && Array.isArray(table?.rows)) {
      return <ComparisonTable headers={table.headers} rows={table.rows} />;
    }
  }

  return toSentenceArray(content).map((paragraph, idx) => <p key={`${section.id}-p-${idx}`}>{parseInlineLinks(paragraph)}</p>);
}

function renderSections(page: PageRecord) {
  const sections = page.body_json?.sections ?? [];
  return sections.map((section) => (
    <section key={section.id} aria-labelledby={`section-${section.id}`}>
      <h2 id={`section-${section.id}`}>{section.heading}</h2>
      {renderSectionContent(section, page)}
    </section>
  ));
}

function buildTocItems(page: PageRecord): Array<{ id: string; text: string }> {
  const sections = page.body_json?.sections ?? [];
  const items = sections.map((s) => ({ id: `section-${s.id}`, text: s.heading }));
  if ((page.body_json?.verdict ?? []).length > 0) {
    items.push({ id: 'verdict-heading', text: 'RecoveryStack Verdict' });
  }
  return items;
}

export default function TemplatePage({ page, pillarLink, siblingLinks, schemaJsonLd }: Props) {
  const verdict = page.body_json?.verdict ?? [];
  const publishedDate = formatDate(page.published_at ?? page.updated_at);
  const readTime = estimateReadTime(page);
  const backTo = `/${page.template}`;
  const tocItems = buildTocItems(page);

  return (
    <div className="rs-shell">
      <ReadingProgressBar />

      <header className="rs-navbar" role="banner">
        <div className="rs-container rs-navbar-inner">
          <a href="/" className="rs-logo">RECOVERYSTACK</a>
          <nav aria-label="Primary" className="rs-nav-links">
            <a href="/guides">Guides</a>
            <a href="/alternatives">Alternatives</a>
            <a href="/protocols">Protocols</a>
            <a href="/metrics">Metrics</a>
            <a href="/costs">Costs</a>
            <a href="/trends">Trends</a>
            <a href="/reviews">Reviews</a>
            <a href="/checklists">Checklists</a>
          </nav>
        </div>
      </header>

      <section className="rs-hero">
        <div className="rs-container">
          <a className="rs-breadcrumb" href={backTo}>← All {page.template}</a>
          {page.metadata?.hero_image ? (
            <img
              src={page.metadata.hero_image as string}
              alt={page.h1}
              width={1200}
              height={630}
              loading="lazy"
              style={{ width: '100%', height: 'auto', borderRadius: '0.75rem', marginBottom: '1.5rem', objectFit: 'cover' }}
            />
          ) : null}
          <div className="rs-hero-grid">
            <div className="rs-hero-copy">
              <span className="rs-tag">{page.template}</span>
              <h1>{page.h1}</h1>
              <p className="rs-meta">{publishedDate} · {readTime}</p>
              <p className="rs-excerpt">{page.intro ?? page.meta_description}</p>

              {/* Social proof / trust signals */}
              <div className="rs-trust-bar">
                <span className="rs-trust-item">Reviewed by RecoveryStack Editorial Team</span>
                <span className="rs-trust-divider" aria-hidden="true">·</span>
                <span className="rs-trust-item">Evidence-based</span>
                <span className="rs-trust-divider" aria-hidden="true">·</span>
                <span className="rs-trust-item">Last updated {publishedDate}</span>
              </div>

              <ShareBar title={page.title} />
            </div>
          </div>
        </div>
      </section>

      <main className="rs-main-section">
        <div className="rs-container rs-article-layout">
          {/* Sticky sidebar TOC on desktop */}
          <aside className="rs-toc-sidebar">
            <TableOfContents items={tocItems} />
          </aside>

          <div className="rs-article-column">
            <article className="rs-article rs-prose" aria-label="Article content">
              {renderSections(page)}

            {page.body_json?.comparison_table?.headers && page.body_json.comparison_table.rows ? (
              <section aria-labelledby="comparison-table-heading">
                <h2 id="comparison-table-heading">Side-by-Side Comparison</h2>
                <ComparisonTable
                  headers={page.body_json.comparison_table.headers}
                  rows={page.body_json.comparison_table.rows}
                />
              </section>
            ) : null}

            {verdict.length > 0 ? (
              <section aria-labelledby="verdict-heading">
                <h2 id="verdict-heading"><span className="rs-gradient-text">RecoveryStack Verdict</span></h2>
                {verdict.slice(0, 3).map((p, i) => (
                  <p key={i}>{parseInlineLinks(p)}</p>
                ))}
              </section>
            ) : null}
          </article>

          <section className="rs-article rs-card" aria-labelledby="compatibility-heading">
            <h2 id="compatibility-heading">Compatibility checker</h2>
            <CompatibilityCheckerWidget pageSlug={page.slug} pageTemplate={page.template} />
          </section>

          <section className="rs-article rs-card" aria-labelledby="conversion-heading">
            <h2 id="conversion-heading">Next step</h2>
            <ConversionBox pageTemplate={page.template} />
          </section>

          <section className="rs-related" aria-labelledby="related-heading">
            <div className="rs-article" style={{ maxWidth: '100%' }}>
              <h2 id="related-heading">Related articles</h2>
              <div className="rs-grid">
                {pillarLink ? (
                  <article className="rs-card">
                    <h3>Pillar guide</h3>
                    <PillarLink href={`/${pillarLink.template ?? 'pillars'}/${pillarLink.slug}`} anchorText={pillarLink.anchor} />
                  </article>
                ) : null}
                {siblingLinks.map((l) => {
                  const tmpl = l.template ?? page.template;
                  const label = tmpl.charAt(0).toUpperCase() + tmpl.slice(1);
                  return (
                    <article className="rs-card" key={l.slug}>
                      <h3>{label}</h3>
                      <PillarLink href={`/${tmpl}/${l.slug}`} anchorText={l.anchor} />
                    </article>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="rs-article rs-card rs-newsletter" aria-labelledby="newsletter-heading">
            <h2 id="newsletter-heading">Continue on RecoveryStack News</h2>
            <p className="rs-excerpt">
              This article is the entry point. RecoveryStack News is where readers keep up with
              recovery tech, wearable buying context, and the path toward the {PRODUCT_NAME}.
            </p>
            <NewsletterForm pageTemplate={page.template} source="article" />
          </section>

          </div>{/* close rs-article-column */}
        </div>
      </main>

      <footer className="rs-footer">
        <div className="rs-container">
          <div className="rs-footer-grid">
            <div>
              <h3>Product</h3>
              <ul>
                <li><a href="/guides">Guides</a></li>
                <li><a href="/compatibility">Compatibility</a></li>
                <li><a href="/metrics">Metrics</a></li>
              </ul>
            </div>
            <div>
              <h3>Company</h3>
              <ul>
                <li><a href={MAIN_SITE_URL} target="_blank" rel="noopener noreferrer">Main site</a></li>
                <li><a href={NEWSLETTER_URL} target="_blank" rel="noopener noreferrer">RecoveryStack News</a></li>
                <li><a href={MAIN_SITE_URL} target="_blank" rel="noopener noreferrer">About RecoveryStack</a></li>
              </ul>
            </div>
            <div>
              <h3>Support</h3>
              <ul>
                <li><a href={NEWSLETTER_URL} target="_blank" rel="noopener noreferrer">Newsletter signup</a></li>
                <li><a href="/protocols">Protocols</a></li>
                <li><a href={MAIN_SITE_URL} target="_blank" rel="noopener noreferrer">{PRODUCT_NAME}</a></li>
              </ul>
            </div>
            <div>
              <h3>Legal</h3>
              <ul>
                <li><a href={MAIN_SITE_URL} target="_blank" rel="noopener noreferrer">Privacy</a></li>
                <li><a href={MAIN_SITE_URL} target="_blank" rel="noopener noreferrer">Terms</a></li>
                <li><a href={MAIN_SITE_URL} target="_blank" rel="noopener noreferrer">Cookies</a></li>
              </ul>
            </div>
          </div>
          <p className="rs-tagline">Organic recovery-tech content that feeds RecoveryStack News and the Volo Ring funnel.</p>
        </div>
      </footer>

      {schemaJsonLd.map((item, idx) => (
        <script key={idx} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(item) }} />
      ))}

      <ExitIntentModal pageTemplate={page.template} />
    </div>
  );
}
