import { MAIN_SITE_URL, NEWSLETTER_URL, PRODUCT_DESTINATION_URL, PRODUCT_NAME } from '@/lib/brand';
import type { TemplateType } from '@/lib/types';

export type ConversionVariant = 'a' | 'b';

export type ConversionCta = {
  id: string;
  href: string;
  label: string;
  external?: boolean;
};

export type ConversionVariantConfig = {
  heading: string;
  body: string;
  ctas: ConversionCta[];
};

type ConversionContext = {
  pageTemplate?: string | null;
  primaryKeyword?: string | null;
  productUrl?: string | null;
  newsletterUrl?: string | null;
  mainSiteUrl?: string | null;
};

export const CONVERSION_VARIANTS: Record<ConversionVariant, ConversionVariantConfig> = {
  a: {
    heading: 'Start with the RecoveryStack newsletter',
    body: 'Use the newsletter as the research layer, then move into the product page when you are ready to compare or buy.',
    ctas: [
      { id: 'newsletter', href: NEWSLETTER_URL, label: 'Read RecoveryStack News', external: true },
      { id: 'main_site', href: MAIN_SITE_URL, label: 'Visit RecoveryStack.io', external: true },
      { id: 'product', href: PRODUCT_DESTINATION_URL, label: `Explore the ${PRODUCT_NAME}`, external: true },
    ],
  },
  b: {
    heading: 'Turn recovery research into a weekly edge',
    body: 'Keep the buying context current in the newsletter, then use the product page when you want to evaluate the ring directly.',
    ctas: [
      { id: 'newsletter', href: NEWSLETTER_URL, label: 'Join the health-tech newsletter', external: true },
      { id: 'product', href: PRODUCT_DESTINATION_URL, label: `See how ${PRODUCT_NAME} fits the stack`, external: true },
      { id: 'main_site', href: MAIN_SITE_URL, label: 'Go to the main RecoveryStack site', external: true },
    ],
  },
};

const TEMPLATE_HEADINGS: Partial<Record<TemplateType, { heading: string; body: string; productLabel: string }>> = {
  alternatives: {
    heading: `Compare alternatives, then evaluate the ${PRODUCT_NAME}`,
    body: 'This page is for shortlist building. Use the product page next if you want the first-party feature set, sizing, and buying details.',
    productLabel: `Compare your shortlist with ${PRODUCT_NAME}`,
  },
  reviews: {
    heading: `Validate the review, then inspect the ${PRODUCT_NAME}`,
    body: 'If the review got you closer to a decision, the product page should be the next stop for official specs, fit, and launch details.',
    productLabel: `Inspect the ${PRODUCT_NAME}`,
  },
  costs: {
    heading: 'Turn price research into a buying decision',
    body: 'Use the newsletter for ongoing market context, then move to the product page when you want the current offer and product specifics.',
    productLabel: `See ${PRODUCT_NAME} pricing context`,
  },
  compatibility: {
    heading: 'Check compatibility, then confirm product fit',
    body: 'Once your stack looks compatible, use the product page to validate device support, sizing, and the exact buyer path.',
    productLabel: `Check ${PRODUCT_NAME} fit`,
  },
  metrics: {
    heading: 'Understand the metrics, then see how they show up in the ring',
    body: 'This page explains the signal. The product page is where you confirm how that signal appears in the actual wearable and app.',
    productLabel: `See metrics in ${PRODUCT_NAME}`,
  },
  pillars: {
    heading: 'Use the hub, then move into the product path',
    body: 'This hub is meant to orient the market. The next step is either the newsletter for ongoing context or the product page for direct buying intent.',
    productLabel: `Start with ${PRODUCT_NAME}`,
  },
};

export function resolveConversionVariant(value: string | undefined, seed?: string): ConversionVariant {
  const normalized = value?.trim().toLowerCase();

  if (normalized === 'a' || normalized === 'b') return normalized;

  if (seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % 2 === 0 ? 'a' : 'b';
  }

  return Math.random() < 0.5 ? 'a' : 'b';
}

export function buildConversionVariantConfig(
  variant: ConversionVariant,
  context: ConversionContext,
): ConversionVariantConfig {
  const base = CONVERSION_VARIANTS[variant];
  const template = (context.pageTemplate ?? null) as TemplateType | null;
  const overlay = template ? TEMPLATE_HEADINGS[template] : undefined;
  const productUrl = context.productUrl?.trim() || PRODUCT_DESTINATION_URL;
  const newsletterUrl = context.newsletterUrl?.trim() || NEWSLETTER_URL;
  const mainSiteUrl = context.mainSiteUrl?.trim() || MAIN_SITE_URL;

  const ctas = base.ctas.map((cta) => {
    if (cta.id === 'product') {
      return {
        ...cta,
        href: productUrl,
        label: overlay?.productLabel ?? cta.label,
      };
    }

    if (cta.id === 'newsletter') {
      return {
        ...cta,
        href: newsletterUrl,
      };
    }

    if (cta.id === 'main_site') {
      return {
        ...cta,
        href: mainSiteUrl,
      };
    }

    return cta;
  });

  return {
    heading: overlay?.heading ?? base.heading,
    body: overlay?.body ?? base.body,
    ctas,
  };
}
