'use client';

import { useEffect } from 'react';
import { detectDiscoverySource } from '@/lib/llm-discovery';

const SESSION_KEY = 'rs_discovery_session_id';
const TRACKED_PREFIX = 'rs_discovery_tracked:';

type Props = {
  slug: string;
  pageTemplate: string;
};

function getSessionId() {
  if (typeof window === 'undefined') return '';
  const existing = window.sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;

  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  window.sessionStorage.setItem(SESSION_KEY, id);
  return id;
}

export default function DiscoveryAttributionTracker({ slug, pageTemplate }: Props) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const referrer = document.referrer || '';
    const source = detectDiscoverySource({
      utmSource: params.get('utm_source'),
      referrer,
    });

    if (source === 'unknown' || source === 'direct') return;

    const dedupeKey = `${TRACKED_PREFIX}${window.location.pathname}${window.location.search}`;
    if (window.sessionStorage.getItem(dedupeKey)) return;
    window.sessionStorage.setItem(dedupeKey, '1');

    const payload = {
      source,
      slug,
      pageTemplate,
      landingUrl: window.location.href,
      referrerUrl: referrer || null,
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
      utmCampaign: params.get('utm_campaign'),
      sessionId: getSessionId(),
    };

    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/discovery-events', new Blob([body], { type: 'application/json' }));
      return;
    }

    void fetch('/api/discovery-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    });
  }, [pageTemplate, slug]);

  return null;
}
