'use client';

import { useState } from 'react';

type Props = {
  title: string;
};

export default function ShareBar({ title }: Props) {
  const [copied, setCopied] = useState(false);

  function getUrl() {
    return typeof window !== 'undefined' ? window.location.href : '';
  }

  function shareTwitter() {
    const url = encodeURIComponent(getUrl());
    const text = encodeURIComponent(title);
    window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`, '_blank', 'noopener');
  }

  function shareLinkedIn() {
    const url = encodeURIComponent(getUrl());
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`, '_blank', 'noopener');
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(getUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement('input');
      input.value = getUrl();
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const btnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(255,255,255,0.08)',
    color: '#cbd5e1',
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'background 0.15s',
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        marginTop: 20,
      }}
      aria-label="Share this article"
    >
      <button type="button" style={btnStyle} onClick={shareTwitter} aria-label="Share on X / Twitter">
        𝕏 Share
      </button>
      <button type="button" style={btnStyle} onClick={shareLinkedIn} aria-label="Share on LinkedIn">
        in Share
      </button>
      <button type="button" style={btnStyle} onClick={copyLink} aria-label="Copy link">
        {copied ? '✓ Copied!' : '🔗 Copy link'}
      </button>
    </div>
  );
}
