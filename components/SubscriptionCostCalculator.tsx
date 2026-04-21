'use client';

import { useState } from 'react';

async function logToolUsage(metadata: Record<string, unknown>) {
  try {
    await fetch('/api/tools/usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolSlug: 'subscription-cost-calculator',
        eventType: 'calculated',
        metadata,
      }),
    });
  } catch {
    // Non-blocking.
  }
}

export default function SubscriptionCostCalculator() {
  const [hardwarePrice, setHardwarePrice] = useState(399);
  const [monthlySubscription, setMonthlySubscription] = useState(0);
  const [years, setYears] = useState(2);
  const [result, setResult] = useState<{
    yearOne: number;
    multiYear: number;
    monthlyEquivalent: number;
  } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const yearOne = hardwarePrice + monthlySubscription * 12;
    const multiYear = hardwarePrice + monthlySubscription * 12 * years;
    const monthlyEquivalent = Number((multiYear / Math.max(years * 12, 1)).toFixed(2));

    setResult({
      yearOne,
      multiYear,
      monthlyEquivalent,
    });

    await logToolUsage({
      hardware_price_usd: hardwarePrice,
      monthly_subscription_usd: monthlySubscription,
      years,
      year_one_cost_usd: yearOne,
      multi_year_cost_usd: multiYear,
    });
  }

  return (
    <section className="rs-card rs-tool-card">
      <h2>Subscription Cost Calculator</h2>
      <p className="rs-newsletter-copy">
        Model year-one and multi-year wearable cost instead of evaluating hardware price in isolation.
      </p>
      <form onSubmit={handleSubmit} className="rs-tool-form">
        <label>
          Hardware price (USD)
          <input
            className="rs-select"
            type="number"
            min={0}
            step={1}
            value={hardwarePrice}
            onChange={(event) => setHardwarePrice(Number(event.target.value))}
          />
        </label>
        <label>
          Monthly subscription (USD)
          <input
            className="rs-select"
            type="number"
            min={0}
            step={1}
            value={monthlySubscription}
            onChange={(event) => setMonthlySubscription(Number(event.target.value))}
          />
        </label>
        <label>
          Compare over years
          <select className="rs-select" value={years} onChange={(event) => setYears(Number(event.target.value))}>
            <option value={1}>1 year</option>
            <option value={2}>2 years</option>
            <option value={3}>3 years</option>
          </select>
        </label>
        <button type="submit" className="rs-btn-primary">Calculate total cost</button>
      </form>
      {result ? (
        <div className="rs-tool-result">
          <strong>Year-one cost: ${result.yearOne.toFixed(0)}</strong>
          <p>Total over {years} year{years === 1 ? '' : 's'}: ${result.multiYear.toFixed(0)}</p>
          <p>Monthly equivalent: ${result.monthlyEquivalent.toFixed(2)}</p>
        </div>
      ) : null}
    </section>
  );
}
