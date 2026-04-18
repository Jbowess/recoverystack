import type { Metadata } from 'next';
import BrandSeoPreview from '@/components/BrandSeoPreview';

const BRAND = 'Oura Ring';

export const metadata: Metadata = {
  title: `${BRAND} Preview`,
  description: `Preview of a premium RecoveryStack branded SEO landing page for ${BRAND}.`,
};

export default function OuraRingPreviewPage() {
  return (
    <BrandSeoPreview
      brand={BRAND}
      category="Brand SEO Preview"
      heroTitle="Recovery intelligence for"
      heroBody={`This sample page shows how a generated ${BRAND} SEO landing page can live inside the RecoveryStack family: white clinical-tech background, cyan signal accents, editorial hierarchy, glass surfaces, and conversion-focused structure.`}
      proofItems={[
        {
          title: 'High-trust buyer framing',
          text: `The ${BRAND} query is treated like a premium product decision, not a low-trust content click.`,
        },
        {
          title: 'Shared design language',
          text: 'The page keeps the same RecoveryStack typography, border, spacing, and glow system used across the acquisition layer.',
        },
        {
          title: 'Down-funnel orientation',
          text: 'The layout is built to transition branded search traffic into newsletter and product engagement.',
        },
      ]}
      benefits={[
        {
          title: `${BRAND} trust section`,
          text: `A reader landing on a ${BRAND} page gets premium trust cues immediately instead of default content-site styling.`,
          bullets: ['Crisp glass cards', 'Controlled accent glow', 'Editorial hero hierarchy'],
        },
        {
          title: 'Commercial-intent structure',
          text: 'The page is arranged for comparison, objections, and conversion rather than broad informational browsing.',
          bullets: ['Proof before CTA', 'Comparison logic', 'Buyer FAQ coverage'],
        },
        {
          title: 'Reusable for more brands',
          text: 'The same page system can generate additional brand surfaces without changing the overall RecoveryStack identity.',
          bullets: ['Single design system', 'Repeatable section model', 'Consistent mobile spacing'],
        },
      ]}
      comparisonRows={[
        {
          label: 'Aesthetic',
          brand: 'Premium clinical-tech interface with white space, hairline borders, and cyan highlights.',
          generic: 'Flat content blocks with default Tailwind SaaS styling.',
        },
        {
          label: 'Brand trust',
          brand: `Makes ${BRAND} feel like part of a serious product evaluation environment.`,
          generic: 'Looks like an isolated article page with weak brand carryover.',
        },
        {
          label: 'Conversion path',
          brand: 'Guides the reader toward RecoveryStack News and the core product path.',
          generic: 'Drops isolated CTAs without enough framing.',
        },
        {
          label: 'Programmatic reuse',
          brand: 'Scales to more branded pages while keeping one visual identity.',
          generic: 'Requires one-off redesign decisions per page.',
        },
      ]}
      faqs={[
        {
          q: `Is this meant to rank for ${BRAND} queries or just look good?`,
          a: `Both. The page structure supports high-intent ${BRAND} SEO terms while keeping the visual system premium enough to preserve brand trust.`,
        },
        {
          q: 'Can this be reused for another brand after review?',
          a: 'Yes. The section pattern is intentionally reusable, so once the design direction is approved it can be repeated programmatically.',
        },
        {
          q: 'Would this replace the homepage?',
          a: 'No. This preview is a standalone localhost route so you can evaluate the generated page in isolation first.',
        },
      ]}
    />
  );
}
