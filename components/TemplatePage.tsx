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
import { getEditorialMetadata } from '@/lib/editorial';
import { supabaseAdmin } from '@/lib/supabase-admin';
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
      nodes.push(<a key={match.index} href={match[2]}>{match[1]}</a>);
    } else if (match[3]) {
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
        return [row.title, row.journal, row.pubdate].filter(Boolean).join(' - ');
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
        <strong
          style={{
            display: 'block',
            marginBottom: '0.4rem',
            fontSize: '0.8rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--rs-accent, #00c2a8)',
          }}
        >
          Definition
        </strong>
        <p style={{ margin: 0 }}>{text}</p>
      </div>
    );
  }

  if (section.id === 'scientific-alpha-feed') {
    const feeds = page?.body_json?.info_gain_feeds as InfoGainFeeds | undefined;
    const items = feeds?.scientific_alpha?.items ?? [];
    if (items.length > 0) {
      return (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {items.map((item, idx) => (
            <li
              key={`pub-${idx}`}
              style={{
                marginBottom: '0.75rem',
                paddingBottom: '0.75rem',
                borderBottom: '1px solid var(--rs-surface-2, #1e293b)',
              }}
            >
              <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 500 }}>
                {item.title}
              </a>
              {(item.journal || item.pubdate) ? (
                <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--rs-muted, #94a3b8)', marginTop: '0.2rem' }}>
                  {[item.journal, item.pubdate].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      );
    }
  }

  if (section.id === 'social-sentiment-feed') {
    const feeds = page?.body_json?.info_gain_feeds as InfoGainFeeds | undefined;
    const complaints = feeds?.social_sentiment?.complaints ?? [];
    if (complaints.length > 0) {
      return (
        <div>
          {complaints.map((item, idx) => (
            <div
              key={`reddit-${idx}`}
              style={{ marginBottom: '0.75rem', padding: '0.75rem', background: 'var(--rs-surface-2, #1e293b)', borderRadius: '0.5rem' }}
            >
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

function renderMethodology(page: PageRecord) {
  const methodology = page.body_json?.review_methodology;
  if (!methodology) return null;

  return (
    <section aria-labelledby="methodology-heading">
      <h2 id="methodology-heading">How we evaluated this topic</h2>
      {methodology.summary ? <p>{methodology.summary}</p> : null}
      {methodology.tested?.length ? (
        <>
          <h3>What we checked</h3>
          <ul>
            {methodology.tested.map((item, index) => <li key={`tested-${index}`}>{item}</li>)}
          </ul>
        </>
      ) : null}
      {methodology.scoring?.length ? (
        <>
          <h3>How we scored it</h3>
          <ul>
            {methodology.scoring.map((item, index) => <li key={`scoring-${index}`}>{item}</li>)}
          </ul>
        </>
      ) : null}
      {methodology.use_cases?.length ? (
        <>
          <h3>Best-fit use cases</h3>
          <ul>
            {methodology.use_cases.map((item, index) => <li key={`use-case-${index}`}>{item}</li>)}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function renderReferences(page: PageRecord) {
  const references = page.body_json?.references ?? [];
  if (!references.length) return null;

  return (
    <section aria-labelledby="references-heading">
      <h2 id="references-heading">Sources and references</h2>
      <ol>
        {references.map((reference, index) => (
          <li key={`${reference.url}-${index}`}>
            <a href={reference.url} target="_blank" rel="noopener noreferrer">
              {reference.title}
            </a>
            {reference.source || reference.year ? (
              <span style={{ color: 'var(--rs-muted, #94a3b8)' }}>
                {' '}({[reference.source, reference.year].filter(Boolean).join(' · ')})
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function buildTocItems(page: PageRecord): Array<{ id: string; text: string }> {
  const sections = page.body_json?.sections ?? [];
  const items = sections.map((s) => ({ id: `section-${s.id}`, text: s.heading }));
  if ((page.body_json?.key_takeaways ?? []).length > 0) {
    items.unshift({ id: 'key-takeaways-heading', text: 'Key takeaways' });
  }
  if (page.body_json?.review_methodology) {
    items.push({ id: 'methodology-heading', text: 'How we evaluated this topic' });
  }
  items.push({ id: 'visual-insights-heading', text: 'Visual insights' });
  if ((page.body_json?.verdict ?? []).length > 0) {
    items.push({ id: 'verdict-heading', text: 'RecoveryStack Verdict' });
  }
  if ((page.body_json?.references ?? []).length > 0) {
    items.push({ id: 'references-heading', text: 'Sources and references' });
  }
  return items;
}

async function loadSupportingVisuals(pageId: string) {
  const { data } = await supabaseAdmin
    .from('page_visual_assets')
    .select('id,image_url,alt_text,asset_kind')
    .eq('page_id', pageId)
    .eq('status', 'ready')
    .neq('asset_kind', 'hero')
    .order('sort_order', { ascending: true })
    .limit(4);

  return (data ?? []) as Array<{ id: string; image_url: string | null; alt_text: string | null; asset_kind: string }>;
}

export default async function TemplatePage({ page, pillarLink, siblingLinks, schemaJsonLd }: Props) {
  const verdict = page.body_json?.verdict ?? [];
  const takeaways = page.body_json?.key_takeaways ?? [];
  const publishedDate = formatDate(page.published_at ?? page.updated_at);
  const reviewedDate = formatDate(typeof page.metadata?.reviewed_at === 'string' ? page.metadata.reviewed_at : page.updated_at);
  const readTime = estimateReadTime(page);
  const backTo = `/${page.template}`;
  const tocItems = buildTocItems(page);
  const editorial = getEditorialMetadata(page);
  const referenceCount = page.body_json?.references?.length ?? 0;
  const supportingVisuals = await loadSupportingVisuals(page.id);

  return (
    <div className="rs-shell">
      <ReadingProgressBar />

      <header className="rs-navbar" role="banner">
        <div className="rs-container rs-navbar-inner">
          <a href="/" className="rs-logo" aria-label="RecoveryStack home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="RecoveryStack" height={32} style={{ display: 'block', height: '32px', width: 'auto' }} />
          </a>
          <nav aria-label="Primary" className="rs-nav-links">
            <a href="/news">News</a>
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
              alt={typeof page.metadata?.hero_image_alt === 'string' ? page.metadata.hero_image_alt : page.h1}
              width={1200}
              height={630}
              fetchPriority="high"
              style={{ width: '100%', height: 'auto', borderRadius: '0.75rem', marginBottom: '1.5rem', objectFit: 'cover' }}
            />
          ) : null}
          <div className="rs-hero-grid">
            <div className="rs-hero-copy">
              <span className="rs-tag">{page.template}</span>
              <h1>{page.h1}</h1>
              <p className="rs-meta">{publishedDate} · {readTime}</p>
              <p className="rs-excerpt">{page.intro ?? page.meta_description}</p>

              <div className="rs-card" style={{ marginTop: '1rem', padding: '1rem 1.1rem' }}>
                <p style={{ margin: 0, fontWeight: 600 }}>
                  Written by <a href={`/authors/${editorial.author.slug}`}>{editorial.author.name}</a>
                  {editorial.reviewer ? (
                    <>
                      {' '}· Reviewed by <a href={`/authors/${editorial.reviewer.slug}`}>{editorial.reviewer.name}</a>
                    </>
                  ) : null}
                </p>
                <p style={{ margin: '0.4rem 0 0', color: 'var(--rs-muted, #94a3b8)' }}>
                  {editorial.author.title}
                  {editorial.reviewer ? ` · ${editorial.reviewer.title}` : ''}
                </p>
                <p style={{ margin: '0.5rem 0 0', color: 'var(--rs-muted, #94a3b8)' }}>
                  Updated {publishedDate} · Reviewed {reviewedDate} · {referenceCount} source{referenceCount === 1 ? '' : 's'}
                </p>
              </div>

              <div className="rs-trust-bar">
                {editorial.trustSignals.map((item, index) => (
                  <React.Fragment key={item}>
                    {index > 0 ? <span className="rs-trust-divider" aria-hidden="true">·</span> : null}
                    <span className="rs-trust-item">{item}</span>
                  </React.Fragment>
                ))}
              </div>

              <ShareBar title={page.title} />
            </div>
          </div>
        </div>
      </section>

      <main className="rs-main-section">
        <div className="rs-container rs-article-layout">
          <aside className="rs-toc-sidebar">
            <TableOfContents items={tocItems} />
          </aside>

          <div className="rs-article-column">
            <article className="rs-article rs-prose" aria-label="Article content">
              {takeaways.length > 0 ? (
                <section aria-labelledby="key-takeaways-heading">
                  <h2 id="key-takeaways-heading">Key takeaways</h2>
                  <ul>
                    {takeaways.map((item, index) => <li key={`takeaway-${index}`}>{item}</li>)}
                  </ul>
                </section>
              ) : null}

              {renderSections(page)}
              {renderMethodology(page)}

              {supportingVisuals.length > 0 ? (
                <section aria-labelledby="visual-insights-heading">
                  <h2 id="visual-insights-heading">Visual insights</h2>
                  <div className="rs-grid">
                    {supportingVisuals.map((visual) => (
                      <figure className="rs-card" key={visual.id}>
                        {visual.image_url ? (
                          <img
                            src={visual.image_url}
                            alt={visual.alt_text ?? `${page.title} visual`}
                            width={1200}
                            height={675}
                            loading="lazy"
                            style={{ width: '100%', height: 'auto', borderRadius: '0.5rem' }}
                          />
                        ) : null}
                        <figcaption style={{ marginTop: '0.75rem', color: 'var(--rs-muted, #94a3b8)' }}>
                          {visual.alt_text ?? visual.asset_kind}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </section>
              ) : null}

              {page.body_json?.comparison_table?.headers && page.body_json.comparison_table.rows ? (
                <section aria-labelledby="comparison-table-heading">
                  <h2 id="comparison-table-heading">Side-by-side comparison</h2>
                  <ComparisonTable
                    headers={page.body_json.comparison_table.headers}
                    rows={page.body_json.comparison_table.rows}
                  />
                </section>
              ) : null}

              {verdict.length > 0 ? (
                <section aria-labelledby="verdict-heading">
                  <h2 id="verdict-heading"><span className="rs-gradient-text">RecoveryStack Verdict</span></h2>
                  {verdict.slice(0, 3).map((paragraph, index) => (
                    <p key={index}>{parseInlineLinks(paragraph)}</p>
                  ))}
                </section>
              ) : null}

              {renderReferences(page)}
            </article>

            <section className="rs-article rs-card" aria-labelledby="compatibility-heading">
              <h2 id="compatibility-heading">Compatibility checker</h2>
              <CompatibilityCheckerWidget pageSlug={page.slug} pageTemplate={page.template} />
            </section>

            <section className="rs-article rs-card" aria-labelledby="conversion-heading">
              <h2 id="conversion-heading">Next step</h2>
              <ConversionBox
                pageTemplate={page.template}
                primaryKeyword={page.primary_keyword}
                productUrl={typeof page.metadata?.product_destination_url === 'string' ? page.metadata.product_destination_url : null}
                newsletterUrl={typeof page.metadata?.newsletter_url === 'string' ? page.metadata.newsletter_url : null}
                mainSiteUrl={MAIN_SITE_URL}
              />
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
                  {siblingLinks.map((link) => {
                    const template = link.template ?? page.template;
                    const label = template.charAt(0).toUpperCase() + template.slice(1);
                    return (
                      <article className="rs-card" key={link.slug}>
                        <h3>{label}</h3>
                        <PillarLink href={`/${template}/${link.slug}`} anchorText={link.anchor} />
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
          </div>
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
