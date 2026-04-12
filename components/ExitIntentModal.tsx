'use client';

import { useEffect, useState, useCallback } from 'react';

type Props = {
  pageTemplate?: string;
};

const HEADLINES: Record<string, { heading: string; subtext: string }> = {
  guides: { heading: 'Before you go — grab the free comparison cheat sheet', subtext: 'Side-by-side specs so you can decide without 20 browser tabs.' },
  alternatives: { heading: 'Still deciding? Get the free switching guide', subtext: 'Step-by-step migration plan with zero data loss.' },
  protocols: { heading: 'Don\'t train without a plan', subtext: 'Download the free recovery protocol PDF — used by 2,000+ athletes.' },
  metrics: { heading: 'Make sense of your numbers', subtext: 'Free metric decoder cheat sheet — know what to track and when to worry.' },
  costs: { heading: 'The real cost breakdown, in your inbox', subtext: 'Free 1-year TCO calculator spreadsheet — no surprises.' },
  compatibility: { heading: 'Check before you buy', subtext: 'Free compatibility matrix PDF — every device, every app, one page.' },
  trends: { heading: 'Stay ahead of the curve', subtext: 'Weekly trend briefing — first to know what\'s actually worth watching.' },
  pillars: { heading: 'Get the full recovery playbook', subtext: 'Our best resources in one free PDF — from beginner to advanced.' },
};

const DEFAULT = { heading: 'Get the Ultimate Recovery Protocol PDF', subtext: 'Free download. Practical plan, no hype.' };
const DISMISSED_KEY = 'rs_exit_dismissed';

export default function ExitIntentModal({ pageTemplate }: Props) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const dismiss = useCallback(() => {
    setOpen(false);
    try { sessionStorage.setItem(DISMISSED_KEY, '1'); } catch {}
  }, []);

  useEffect(() => {
    // Don't show again if already dismissed this session
    try { if (sessionStorage.getItem(DISMISSED_KEY)) return; } catch {}

    let timer: ReturnType<typeof setTimeout>;

    const onMouseLeave = (event: MouseEvent) => {
      if (event.clientY <= 0) {
        // Small delay to prevent accidental triggers
        timer = setTimeout(() => setOpen(true), 200);
      }
    };

    // Also trigger on mobile after 45s of engagement
    const mobileTimer = setTimeout(() => {
      if (window.innerWidth < 768) setOpen(true);
    }, 45_000);

    window.addEventListener('mouseout', onMouseLeave);
    return () => {
      window.removeEventListener('mouseout', onMouseLeave);
      clearTimeout(timer);
      clearTimeout(mobileTimer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) return;

    try {
      const res = await fetch('/api/newsletter-subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source: 'exit_intent', pageTemplate }),
      });
      if (!res.ok) throw new Error('Failed');
      setSubmitted(true);
      setTimeout(dismiss, 2500);
    } catch {
      setError('Something went wrong. Try again.');
    }
  };

  if (!open) return null;

  const copy = HEADLINES[pageTemplate ?? ''] ?? DEFAULT;

  return (
    <div className="rs-modal-overlay" role="dialog" aria-modal="true" aria-label="Exit offer">
      <div className="rs-modal">
        <button className="rs-modal-close" onClick={dismiss} aria-label="Close">&times;</button>
        {submitted ? (
          <div className="rs-modal-body">
            <p className="rs-modal-heading">You&apos;re in! Check your inbox.</p>
          </div>
        ) : (
          <div className="rs-modal-body">
            <h3 className="rs-modal-heading">{copy.heading}</h3>
            <p className="rs-modal-subtext">{copy.subtext}</p>
            <form onSubmit={handleSubmit} className="rs-form-row" style={{ marginTop: 16 }}>
              <input
                className="rs-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
              <button type="submit" className="rs-btn-primary">Send it free</button>
            </form>
            {error && <p style={{ color: '#f87171', fontSize: 13, marginTop: 8 }}>{error}</p>}
            <p className="rs-modal-disclaimer">No spam. Unsubscribe anytime.</p>
          </div>
        )}
      </div>
    </div>
  );
}
