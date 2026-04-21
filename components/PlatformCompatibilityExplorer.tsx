'use client';

import { useState } from 'react';

type ProductOption = {
  slug: string;
  brand: string | null;
  model: string | null;
  compatible_platforms: string[] | null;
  subscription_required: boolean | null;
  battery_days: number | null;
  price_usd: number | null;
};

type Props = {
  products: ProductOption[];
};

async function logToolUsage(metadata: Record<string, unknown>) {
  try {
    await fetch('/api/tools/usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolSlug: 'platform-compatibility-explorer',
        eventType: 'filtered',
        metadata,
      }),
    });
  } catch {
    // Non-blocking.
  }
}

function supportsPlatform(platforms: string[] | null, target: string) {
  if (target === 'any') return true;
  const normalized = (platforms ?? []).map((value) => value.toLowerCase());
  if (target === 'ios') return normalized.some((value) => value.includes('ios') || value.includes('iphone') || value.includes('apple'));
  if (target === 'android') return normalized.some((value) => value.includes('android'));
  return true;
}

export default function PlatformCompatibilityExplorer({ products }: Props) {
  const [platform, setPlatform] = useState<'any' | 'ios' | 'android'>('any');
  const [avoidSubscription, setAvoidSubscription] = useState(false);
  const [minBatteryDays, setMinBatteryDays] = useState(4);
  const [results, setResults] = useState<ProductOption[]>(products);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filtered = products.filter((product) => {
      if (!supportsPlatform(product.compatible_platforms, platform)) return false;
      if (avoidSubscription && product.subscription_required) return false;
      if ((product.battery_days ?? 0) < minBatteryDays) return false;
      return true;
    });

    setResults(filtered);
    await logToolUsage({
      platform,
      avoid_subscription: avoidSubscription,
      min_battery_days: minBatteryDays,
      result_count: filtered.length,
    });
  }

  return (
    <section className="rs-card rs-tool-card">
      <h2>Platform Compatibility Explorer</h2>
      <p className="rs-newsletter-copy">
        Narrow the smart ring field by phone platform, battery expectations, and subscription tolerance.
      </p>
      <form onSubmit={handleSubmit} className="rs-tool-form">
        <label>
          Phone platform
          <select className="rs-select" value={platform} onChange={(event) => setPlatform(event.target.value as 'any' | 'ios' | 'android')}>
            <option value="any">Any</option>
            <option value="ios">iPhone / iOS</option>
            <option value="android">Android</option>
          </select>
        </label>
        <label className="rs-tool-checkbox">
          <input
            type="checkbox"
            checked={avoidSubscription}
            onChange={(event) => setAvoidSubscription(event.target.checked)}
          />
          Avoid products with a required monthly subscription.
        </label>
        <label>
          Minimum battery life
          <select className="rs-select" value={minBatteryDays} onChange={(event) => setMinBatteryDays(Number(event.target.value))}>
            <option value={3}>3+ days</option>
            <option value={4}>4+ days</option>
            <option value={5}>5+ days</option>
            <option value={7}>7+ days</option>
          </select>
        </label>
        <button type="submit" className="rs-btn-primary">Filter products</button>
      </form>

      <div className="rs-tool-result">
        <strong>{results.length} matching product{results.length === 1 ? '' : 's'}</strong>
        <ul>
          {results.slice(0, 8).map((product) => (
            <li key={product.slug}>
              {[product.brand, product.model].filter(Boolean).join(' ') || product.slug}
              {typeof product.price_usd === 'number' ? ` · $${product.price_usd}` : ''}
              {typeof product.battery_days === 'number' ? ` · ${product.battery_days} day battery` : ''}
              {product.subscription_required ? ' · subscription' : ' · no required subscription'}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
