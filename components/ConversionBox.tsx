'use client';

import { useMemo } from 'react';
import {
  CONVERSION_VARIANTS,
  resolveConversionVariant,
  type ConversionVariant,
} from '@/lib/conversion-box';

const VISITOR_ID_KEY = 'rs_visitor_id';

type Props = {
  pageTemplate?: string | null;
};

function getVisitorId() {
  if (typeof window === 'undefined') return undefined;

  const existing = window.localStorage.getItem(VISITOR_ID_KEY);
  if (existing) return existing;

  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  window.localStorage.setItem(VISITOR_ID_KEY, id);
  return id;
}

function trackConversionClick(
  variant: ConversionVariant,
  cta: string,
  pageTemplate?: string | null,
) {
  const payload = {
    variant,
    cta,
    slug: window.location.pathname,
    pageTemplate: pageTemplate ?? null,
  };

  const endpoint = '/api/conversion-events';
  const body = JSON.stringify(payload);

  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    navigator.sendBeacon(endpoint, blob);
    return;
  }

  void fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  });
}

export default function ConversionBox({ pageTemplate }: Props) {
  const variant = useMemo(() => {
    const seed = getVisitorId();
    return resolveConversionVariant(process.env.NEXT_PUBLIC_CONVERSION_BOX_VARIANT, seed);
  }, []);

  const config = CONVERSION_VARIANTS[variant];

  return (
    <aside data-variant={variant} data-page-template={pageTemplate ?? undefined}>
      <h2>{config.heading}</h2>
      <ul>
        {config.ctas.map((cta) => (
          <li key={cta.id}>
            <a
              href={cta.href}
              onClick={() => trackConversionClick(variant, cta.id, pageTemplate)}
              target={cta.external ? '_blank' : undefined}
              rel={cta.external ? 'noopener noreferrer' : undefined}
            >
              {cta.label}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
