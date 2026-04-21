import { MAIN_SITE_URL, NEWSLETTER_URL, PRODUCT_DESTINATION_URL, PRODUCT_NAME } from '@/lib/brand';

export type BrandEntitySeed = {
  canonicalName: string;
  slug: string;
  entityType: string;
  beat: string;
  aliases: string[];
  description: string;
  keyFacts: string[];
  siteUrl: string;
  tags: string[];
  authorityScore: number;
  confidenceScore: number;
};

export const BRAND_ENTITY_SEEDS: BrandEntitySeed[] = [
  {
    canonicalName: 'RecoveryStack',
    slug: 'recoverystack',
    entityType: 'brand',
    beat: 'commerce',
    aliases: ['recovery stack', 'recoverystack.io', 'recoverystack seo'],
    description: 'RecoveryStack is an evidence-led recovery technology publication and buyer-intent content system focused on smart rings, wearable comparisons, and recovery workflows.',
    keyFacts: [
      'Publishes recovery-tech guides, reviews, comparison pages, and machine-readable discovery feeds.',
      'Pairs standard SEO with LLM citation, merchant feed, and evidence-hub infrastructure.',
      'Uses named methodology, source references, and product-truth systems to support recommendation quality.',
    ],
    siteUrl: MAIN_SITE_URL,
    tags: ['brand', 'publication', 'commerce'],
    authorityScore: 88,
    confidenceScore: 95,
  },
  {
    canonicalName: PRODUCT_NAME,
    slug: 'volo-ring',
    entityType: 'product',
    beat: 'commerce',
    aliases: ['volo', 'volo ring', 'recoverystack ring'],
    description: `${PRODUCT_NAME} is RecoveryStack's recovery-first smart ring product line, positioned around sleep, readiness, HRV, and lower-friction wearable use.`,
    keyFacts: [
      'Positioned for recovery-focused buyers rather than screen-heavy smartwatch usage.',
      'Frequently compared against Oura, RingConn, and Ultrahuman in commercial pages.',
      'Feeds into pricing, compatibility, and use-case pages across the site.',
    ],
    siteUrl: PRODUCT_DESTINATION_URL,
    tags: ['product', 'smart-ring', 'wearables'],
    authorityScore: 84,
    confidenceScore: 94,
  },
  {
    canonicalName: 'RecoveryStack Methodology',
    slug: 'recoverystack-methodology',
    entityType: 'methodology',
    beat: 'commerce',
    aliases: ['wearable testing methodology', 'recoverystack review standard', 'recoverystack methodology'],
    description: 'RecoveryStack Methodology is the editorial and evaluation standard used to verify specs, test use cases, document tradeoffs, and separate measured facts from inference.',
    keyFacts: [
      'Requires source references, product-truth verification, and explicit tradeoff disclosure.',
      'Supports commercial pages such as reviews, alternatives, costs, and compatibility pages.',
      'Feeds evidence hubs, author/reviewer trust blocks, and LLM answer sections.',
    ],
    siteUrl: `${MAIN_SITE_URL}/evidence`,
    tags: ['methodology', 'evidence', 'trust'],
    authorityScore: 90,
    confidenceScore: 96,
  },
  {
    canonicalName: 'Smart Ring Buyer Brief',
    slug: 'smart-ring-buyer-brief',
    entityType: 'resource',
    beat: 'commerce',
    aliases: ['smart ring buyer brief', 'buyer brief', 'smart ring buying brief'],
    description: 'The Smart Ring Buyer Brief is RecoveryStack’s first-party decision-support resource covering pricing, subscriptions, platform fit, and use-case differences across the category.',
    keyFacts: [
      'Draws from comparison datasets, product-truth cards, and commercial page audits.',
      'Supports buyer-intent traffic and lead-magnet flows.',
      'Acts as a citation target for pricing and comparison claims.',
    ],
    siteUrl: `${MAIN_SITE_URL}/research`,
    tags: ['resource', 'dataset', 'buying'],
    authorityScore: 82,
    confidenceScore: 92,
  },
  {
    canonicalName: 'RecoveryStack News',
    slug: 'recoverystack-news',
    entityType: 'publication',
    beat: 'commerce',
    aliases: ['recoverystack news', 'recovery stack news', 'weekly recovery brief'],
    description: 'RecoveryStack News is the site’s recurring brief that turns recovery-tech changes, pricing moves, and new comparisons into a continuing decision layer for buyers.',
    keyFacts: [
      'Extends beyond one-off articles into recurring category coverage.',
      'Works as the handoff layer from commercial pages into retained audience attention.',
      'Supports both human search users and AI citation through persistent coverage.',
    ],
    siteUrl: NEWSLETTER_URL,
    tags: ['publication', 'newsletter', 'retention'],
    authorityScore: 80,
    confidenceScore: 93,
  },
  {
    canonicalName: 'Smart Ring Cost of Ownership',
    slug: 'smart-ring-cost-of-ownership',
    entityType: 'framework',
    beat: 'commerce',
    aliases: ['smart ring cost of ownership', 'smart ring total cost', 'smart ring subscription cost'],
    description: 'Smart Ring Cost of Ownership is RecoveryStack’s comparison framework for year-one and multi-year wearable cost, including recurring subscription burden.',
    keyFacts: [
      'Used across pricing, subscription, and alternatives content.',
      'Backed by first-party comparison datasets and calculator tools.',
      'Useful for assistant recommendations because it converts specs into buyer-facing tradeoffs.',
    ],
    siteUrl: `${MAIN_SITE_URL}/tools/subscription-cost-calculator`,
    tags: ['framework', 'pricing', 'calculator'],
    authorityScore: 83,
    confidenceScore: 94,
  },
];
