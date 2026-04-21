import type { Metadata } from 'next';
import SubscriptionCostCalculator from '@/components/SubscriptionCostCalculator';

export const metadata: Metadata = {
  title: 'Subscription Cost Calculator',
  description: 'Estimate year-one and multi-year smart ring cost including recurring subscriptions.',
};

export default function SubscriptionCostCalculatorPage() {
  return (
    <main className="rs-shell">
      <section className="rs-hero">
        <div className="rs-container">
          <a href="/tools" className="rs-breadcrumb">RecoveryStack Tools</a>
          <span className="rs-tag">Interactive Tool</span>
          <h1>Estimate total wearable cost, not just sticker price.</h1>
          <p className="rs-excerpt">
            Subscription burden is one of the easiest ways to misread product value. This tool makes that tradeoff explicit.
          </p>
        </div>
      </section>
      <section className="rs-main-section">
        <div className="rs-container">
          <SubscriptionCostCalculator />
        </div>
      </section>
    </main>
  );
}
