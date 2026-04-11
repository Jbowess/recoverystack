export type ConversionVariant = 'a' | 'b';

export type ConversionCta = {
  id: string;
  href: string;
  label: string;
};

export type ConversionVariantConfig = {
  heading: string;
  ctas: ConversionCta[];
};

export const CONVERSION_VARIANTS: Record<ConversionVariant, ConversionVariantConfig> = {
  a: {
    heading: 'Build your recovery stack',
    ctas: [
      { id: 'ring', href: '/ring', label: 'RecoveryStack Smart Ring' },
      { id: 'newsletter', href: '/newsletter', label: '$1/mo Premium Health Tech Newsletter' },
      { id: 'protocol', href: '/free-protocol', label: 'Free Ultimate Recovery Protocol PDF' },
    ],
  },
  b: {
    heading: 'Start with your highest-impact upgrade',
    ctas: [
      { id: 'protocol', href: '/free-protocol', label: 'Get the Free Ultimate Recovery Protocol PDF' },
      { id: 'newsletter', href: '/newsletter', label: 'Join the $1/mo Premium Health Tech Newsletter' },
      { id: 'ring', href: '/ring', label: 'Explore the RecoveryStack Smart Ring' },
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
