import type { Metadata } from 'next';
import SmartRingFitTool from '@/components/SmartRingFitTool';

export const metadata: Metadata = {
  title: 'Smart Ring Fit Tool',
  description: 'Interactive buyer-segmentation tool for smart ring visitors.',
};

export default function SmartRingFitPage() {
  return (
    <main className="rs-shell">
      <section className="rs-hero">
        <div className="rs-container">
          <a href="/" className="rs-breadcrumb">RecoveryStack</a>
          <div className="rs-hero-grid">
            <div className="rs-hero-copy">
              <span className="rs-tag">Interactive Tool</span>
              <h1>Segment smart ring buyers before you pitch them.</h1>
              <p className="rs-excerpt">
                This is part of the growth engine, not a generic widget. It turns broad wearable traffic into segment-specific product and lead-magnet paths.
              </p>
            </div>
          </div>
          <div className="rs-main-section">
            <SmartRingFitTool />
          </div>
        </div>
      </section>
    </main>
  );
}
