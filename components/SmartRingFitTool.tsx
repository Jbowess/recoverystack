'use client';

import { useState } from 'react';

type Priority = 'sleep' | 'cost' | 'accuracy' | 'training';

type Result = {
  segment: string;
  recommendation: string;
  nextStep: { slug: string; title: string; primary_cta: string; destination_url: string | null };
};

export default function SmartRingFitTool() {
  const [priority, setPriority] = useState<Priority>('sleep');
  const [hatesSubscription, setHatesSubscription] = useState(false);
  const [prefersNoScreen, setPrefersNoScreen] = useState(true);
  const [result, setResult] = useState<Result | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const res = await fetch('/api/tools/buyer-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority, hatesSubscription, prefersNoScreen }),
    });
    if (!res.ok) return;
    const json = await res.json();
    setResult(json.result);
  }

  return (
    <section className="rs-card rs-tool-card">
      <h2>Smart Ring Fit Tool</h2>
      <p className="rs-newsletter-copy">
        This quick tool routes buyers into the right segment, lead magnet, and product angle instead of treating all wearable visitors the same.
      </p>
      <form onSubmit={handleSubmit} className="rs-tool-form">
        <label>
          Top priority
          <select className="rs-select" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="sleep">Sleep and recovery</option>
            <option value="cost">Cost and subscriptions</option>
            <option value="accuracy">Accuracy and validation</option>
            <option value="training">Training readiness</option>
          </select>
        </label>
        <label className="rs-tool-checkbox">
          <input type="checkbox" checked={hatesSubscription} onChange={(e) => setHatesSubscription(e.target.checked)} />
          I want to avoid a monthly subscription if possible.
        </label>
        <label className="rs-tool-checkbox">
          <input type="checkbox" checked={prefersNoScreen} onChange={(e) => setPrefersNoScreen(e.target.checked)} />
          I prefer a no-screen wearable.
        </label>
        <button type="submit" className="rs-btn-primary">Get Recommendation</button>
      </form>
      {result ? (
        <div className="rs-tool-result">
          <strong>{result.segment}</strong>
          <p>{result.recommendation}</p>
          <a className="rs-btn-secondary rs-btn-link" href={result.nextStep.destination_url ?? '/news'}>
            {result.nextStep.primary_cta}
          </a>
        </div>
      ) : null}
    </section>
  );
}
