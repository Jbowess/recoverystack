'use client';

import { NEWSLETTER_URL } from '@/lib/brand';

type Props = {
  pageTemplate?: string;
  source?: 'homepage' | 'article' | 'not_found';
};

function withTrackingParams(pageTemplate?: string, source?: string) {
  const url = new URL(NEWSLETTER_URL);

  if (source) url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', 'organic-site');
  url.searchParams.set('utm_campaign', 'recoverystack-seo');
  if (pageTemplate) url.searchParams.set('utm_content', pageTemplate);

  return url.toString();
}

export default function NewsletterForm({ pageTemplate, source = 'article' }: Props) {
  const href = withTrackingParams(pageTemplate, source);

  return (
    <div>
      <p className="rs-newsletter-copy">
        RecoveryStack News covers recovery tech, protocols, wearables, and buying signals that matter.
      </p>
      <div className="rs-form-row">
        <a className="rs-btn-primary rs-btn-link" href={href} target="_blank" rel="noopener noreferrer">
          Go to RecoveryStack News
        </a>
      </div>
      <p className="rs-newsletter-note">
        Subscribe on the main site, then use the newsletter to evaluate recovery tools and the Volo Ring.
      </p>
    </div>
  );
}
