'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { NEWSLETTER_URL } from '@/lib/brand';

type Props = {
  pageTemplate?: string;
};

const HEADLINES: Record<string, { heading: string; subtext: string }> = {
  guides: {
    heading: 'Keep the research coming in your inbox',
    subtext: 'RecoveryStack News turns long-form guides into a sharper weekly brief.',
  },
  alternatives: {
    heading: 'Still comparing devices?',
    subtext: 'Get the weekly health-tech buying brief before you make the call.',
  },
  protocols: {
    heading: 'Take the next step on the main site',
    subtext: 'RecoveryStack News packages protocols, wearables, and product picks into one feed.',
  },
  metrics: {
    heading: 'Make the numbers useful',
    subtext: 'Get the signal behind recovery metrics in the newsletter, not just raw charts.',
  },
  costs: {
    heading: 'Get the buyer context before you spend',
    subtext: 'RecoveryStack News tracks the market so you can judge value, not hype.',
  },
  compatibility: {
    heading: 'See what belongs in your stack',
    subtext: 'Use the newsletter to stay current on devices, integrations, and what is worth buying.',
  },
  trends: {
    heading: 'Stay ahead of recovery tech',
    subtext: 'Get the weekly trend breakdown on RecoveryStack News.',
  },
  pillars: {
    heading: 'Follow the full RecoveryStack view',
    subtext: 'Get the ongoing recovery-tech thesis on the main newsletter.',
  },
};

const DEFAULT = {
  heading: 'Continue on RecoveryStack News',
  subtext: 'The newsletter is where RecoveryStack turns research into an ongoing product and buying edge.',
};
const DISMISSED_KEY = 'rs_exit_dismissed';

function buildHref(pageTemplate?: string) {
  const url = new URL(NEWSLETTER_URL);
  url.searchParams.set('utm_source', 'exit_intent');
  url.searchParams.set('utm_medium', 'organic-site');
  url.searchParams.set('utm_campaign', 'recoverystack-seo');
  if (pageTemplate) url.searchParams.set('utm_content', pageTemplate);
  return url.toString();
}

export default function ExitIntentModal({ pageTemplate }: Props) {
  const [open, setOpen] = useState(false);
  const href = useMemo(() => buildHref(pageTemplate), [pageTemplate]);

  const dismiss = useCallback(() => {
    setOpen(false);
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1');
    } catch {}
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISSED_KEY)) return;
    } catch {}

    let timer: ReturnType<typeof setTimeout> | undefined;

    const onMouseLeave = (event: MouseEvent) => {
      if (event.clientY <= 0) {
        timer = setTimeout(() => setOpen(true), 200);
      }
    };

    const mobileTimer = setTimeout(() => {
      if (window.innerWidth < 768) setOpen(true);
    }, 45_000);

    window.addEventListener('mouseout', onMouseLeave);
    return () => {
      window.removeEventListener('mouseout', onMouseLeave);
      if (timer) clearTimeout(timer);
      clearTimeout(mobileTimer);
    };
  }, []);

  if (!open) return null;

  const copy = HEADLINES[pageTemplate ?? ''] ?? DEFAULT;

  return (
    <div className="rs-modal-overlay" role="dialog" aria-modal="true" aria-label="RecoveryStack newsletter prompt">
      <div className="rs-modal">
        <button className="rs-modal-close" onClick={dismiss} aria-label="Close">
          &times;
        </button>
        <div className="rs-modal-body">
          <h3 className="rs-modal-heading">{copy.heading}</h3>
          <p className="rs-modal-subtext">{copy.subtext}</p>
          <a className="rs-btn-primary rs-btn-link" href={href} target="_blank" rel="noopener noreferrer">
            Open RecoveryStack News
          </a>
          <p className="rs-modal-disclaimer">
            Subscribe on the main site. The newsletter is the primary path into the Volo Ring funnel.
          </p>
        </div>
      </div>
    </div>
  );
}
