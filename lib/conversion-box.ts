import { MAIN_SITE_URL, NEWSLETTER_URL, PRODUCT_DESTINATION_URL, PRODUCT_NAME } from '@/lib/brand';

export type ConversionVariant = 'a' | 'b';

export type ConversionCta = {
  id: string;
  href: string;
  label: string;
  external?: boolean;
};

export type ConversionVariantConfig = {
  heading: string;
  ctas: ConversionCta[];
};

export const CONVERSION_VARIANTS: Record<ConversionVariant, ConversionVariantConfig> = {
  a: {
    heading: 'Start with the RecoveryStack newsletter',
    ctas: [
      { id: 'newsletter', href: NEWSLETTER_URL, label: 'Read RecoveryStack News', external: true },
      { id: 'main_site', href: MAIN_SITE_URL, label: 'Visit RecoveryStack.io', external: true },
      { id: 'product', href: PRODUCT_DESTINATION_URL, label: `Explore the ${PRODUCT_NAME}`, external: true },
    ],
  },
  b: {
    heading: 'Turn recovery research into a weekly edge',
    ctas: [
      { id: 'newsletter', href: NEWSLETTER_URL, label: 'Join the health-tech newsletter', external: true },
      { id: 'product', href: PRODUCT_DESTINATION_URL, label: `See how ${PRODUCT_NAME} fits the stack`, external: true },
      { id: 'main_site', href: MAIN_SITE_URL, label: 'Go to the main RecoveryStack site', external: true },
    ],
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
