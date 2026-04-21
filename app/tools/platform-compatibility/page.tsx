import type { Metadata } from 'next';
import PlatformCompatibilityExplorer from '@/components/PlatformCompatibilityExplorer';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Platform Compatibility Explorer',
  description: 'Filter smart rings by platform support, subscription preference, and battery expectations.',
};

export default async function PlatformCompatibilityPage() {
  const { data, error } = await supabaseAdmin
    .from('product_specs')
    .select('slug,brand,model,compatible_platforms,subscription_required,battery_days,price_usd')
    .eq('status', 'active')
    .limit(24);

  if (error) throw error;

  return (
    <main className="rs-shell">
      <section className="rs-hero">
        <div className="rs-container">
          <a href="/tools" className="rs-breadcrumb">RecoveryStack Tools</a>
          <span className="rs-tag">Interactive Tool</span>
          <h1>Filter the category by platform and battery reality.</h1>
          <p className="rs-excerpt">
            Compatibility pages are stronger when buyers can test their own constraints directly instead of reading generic copy.
          </p>
        </div>
      </section>
      <section className="rs-main-section">
        <div className="rs-container">
          <PlatformCompatibilityExplorer products={(data ?? []) as any[]} />
        </div>
      </section>
    </main>
  );
}
