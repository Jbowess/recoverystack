'use client';

import { useState } from 'react';

type Props = {
  pageTemplate?: string;
};

export default function NewsletterForm({ pageTemplate }: Props) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || status === 'loading') return;

    setStatus('loading');
    try {
      const res = await fetch('/api/newsletter-subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source: 'newsletter_form', pageTemplate }),
      });
      if (!res.ok) throw new Error('Failed');
      setStatus('success');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'success') {
    return (
      <div className="rs-newsletter-success">
        <p style={{ fontSize: '1.125rem', fontWeight: 600 }}>You&apos;re subscribed!</p>
        <p style={{ color: 'var(--rs-text-secondary)', fontSize: 14 }}>Check your inbox for the first issue.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="newsletter-email" className="rs-meta">Email address</label>
      <div className="rs-form-row">
        <input
          id="newsletter-email"
          className="rs-input"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={status === 'loading'}
        />
        <button type="submit" className="rs-btn-primary" disabled={status === 'loading'}>
          {status === 'loading' ? 'Subscribing…' : 'Subscribe'}
        </button>
      </div>
      {status === 'error' && (
        <p style={{ color: '#f87171', fontSize: 13, marginTop: 8 }}>Something went wrong. Please try again.</p>
      )}
    </form>
  );
}
