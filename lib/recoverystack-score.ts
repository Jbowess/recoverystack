import type { PageRecord } from '@/lib/types';

export type RecoveryStackScoreDimension = {
  id: string;
  label: string;
  score: number;
  rationale: string;
};

export type RecoveryStackScorecard = {
  overall: number;
  label: string;
  summary: string;
  dimensions: RecoveryStackScoreDimension[];
  verdict: {
    bestFor: string;
    avoidIf: string;
    bottomLine: string;
  };
};

const DIMENSION_CONFIG: Array<{
  id: string;
  label: string;
  fallback: number;
  weight: number;
  rationale: string;
}> = [
  {
    id: 'signal',
    label: 'Signal Quality',
    fallback: 68,
    weight: 0.24,
    rationale: 'How clearly this page explains which metrics, signals, or product claims are worth caring about.',
  },
  {
    id: 'wearability',
    label: 'Comfort and Adherence',
    fallback: 63,
    weight: 0.14,
    rationale: 'How well the page covers overnight comfort, sizing, daily wear, and whether the product is realistic to live with.',
  },
  {
    id: 'cost',
    label: 'Cost Clarity',
    fallback: 60,
    weight: 0.18,
    rationale: 'How clearly the page exposes total cost of ownership, subscriptions, and real-world value tradeoffs.',
  },
  {
    id: 'ecosystem',
    label: 'Ecosystem Fit',
    fallback: 64,
    weight: 0.16,
    rationale: 'How well the page sets expectations around apps, compatibility, integrations, and buyer friction.',
  },
  {
    id: 'buyer_fit',
    label: 'Buyer Fit',
    fallback: 70,
    weight: 0.14,
    rationale: 'How directly the page helps the reader decide whether a product or category fits their use case.',
  },
  {
    id: 'trust',
    label: 'Trust and Evidence',
    fallback: 72,
    weight: 0.14,
    rationale: 'How much methodological clarity, sourcing, review hygiene, and evidence discipline the page shows.',
  },
];

type VerdictKey = keyof RecoveryStackScorecard['verdict'];

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readScore(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? clampScore(value) : null;
}

function extractKeywordSignals(page: PageRecord) {
  const haystack = [
    page.title,
    page.h1,
    page.intro ?? '',
    page.primary_keyword ?? '',
    ...(page.secondary_keywords ?? []),
    ...(page.body_json?.key_takeaways ?? []),
    ...(page.body_json?.verdict ?? []),
  ]
    .join(' ')
    .toLowerCase();

  return {
    hasAccuracyCue: /(accuracy|validation|signal|hrv|sleep tracking|readiness|spo2|temperature)/.test(haystack),
    hasComfortCue: /(comfort|fit|sizing|size|overnight|wear|ring size|no-screen)/.test(haystack),
    hasCostCue: /(cost|price|pricing|subscription|monthly|ownership|budget|value)/.test(haystack),
    hasEcosystemCue: /(iphone|android|app|compatib|integration|sync|platform)/.test(haystack),
    hasAthleteCue: /(runner|training|athlete|strength|recovery|sleep)/.test(haystack),
  };
}

function parseStructuredDimensions(value: unknown): RecoveryStackScoreDimension[] | null {
  if (!Array.isArray(value)) return null;

  const rows = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const label = readString(record.label);
      const score = readScore(record.score);
      const rationale = readString(record.rationale) ?? readString(record.reason) ?? '';
      if (!label || score === null) return null;
      return {
        id: readString(record.id) ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        label,
        score,
        rationale: rationale || 'RecoveryStack dimension.',
      };
    })
    .filter((row): row is RecoveryStackScoreDimension => Boolean(row));

  return rows.length ? rows : null;
}

function deriveDimensions(page: PageRecord): RecoveryStackScoreDimension[] {
  const explicit = parseStructuredDimensions(page.metadata?.recoverystack_score_dimensions);
  if (explicit) return explicit;

  const referencesCount = page.body_json?.references?.length ?? 0;
  const hasMethodology = Boolean(page.body_json?.review_methodology);
  const hasComparisonTable = Boolean(page.body_json?.comparison_table?.rows?.length);
  const hasPriceSnapshots = Boolean(page.body_json?.info_gain_feeds?.price_performance?.snapshots?.length);
  const appReviewSignals = Array.isArray(page.metadata?.app_review_signals) ? page.metadata?.app_review_signals.length : 0;
  const communitySignals = Array.isArray(page.metadata?.community_signals) ? page.metadata?.community_signals.length : 0;
  const claimStatus = readString(page.metadata?.claim_verification_status);
  const signals = extractKeywordSignals(page);

  return DIMENSION_CONFIG.map((dimension) => {
    let score = dimension.fallback;
    let rationale = dimension.rationale;

    switch (dimension.id) {
      case 'signal':
        if (page.template === 'metrics' || page.template === 'reviews') score += 10;
        if (signals.hasAccuracyCue) score += 8;
        if (appReviewSignals > 0) score += 4;
        if (communitySignals > 0) score += 2;
        rationale = signals.hasAccuracyCue
          ? 'RecoveryStack is framing the raw metrics around usable buyer signals instead of just repeating specs.'
          : 'This page gives a usable signal read, but it is not entirely built around measurement quality.';
        break;
      case 'wearability':
        if (page.template === 'compatibility' || page.template === 'guides') score += 8;
        if (signals.hasComfortCue) score += 10;
        if (hasComparisonTable) score += 3;
        rationale = signals.hasComfortCue
          ? 'Comfort, sizing, and daily wear tradeoffs are part of the decision instead of being treated as an afterthought.'
          : 'Wearability is covered enough to guide a purchase, but not as deeply as a fit-specific page would.';
        break;
      case 'cost':
        if (page.template === 'costs') score += 18;
        if (page.template === 'alternatives' || page.template === 'reviews') score += 6;
        if (signals.hasCostCue) score += 10;
        if (hasPriceSnapshots) score += 6;
        rationale = signals.hasCostCue || hasPriceSnapshots
          ? 'The page exposes real pricing pressure and subscription burden instead of hiding behind feature lists.'
          : 'Cost is present, but the price story is not the primary spine of the page.';
        break;
      case 'ecosystem':
        if (page.template === 'compatibility') score += 18;
        if (signals.hasEcosystemCue) score += 10;
        if (appReviewSignals > 0) score += 5;
        rationale = signals.hasEcosystemCue
          ? 'App behavior, platform fit, and integration friction are acknowledged as part of the buying decision.'
          : 'The page touches ecosystem expectations, but compatibility is not its main job.';
        break;
      case 'buyer_fit':
        if (page.template === 'alternatives' || page.template === 'reviews') score += 12;
        if (page.template === 'guides' || page.template === 'costs') score += 8;
        if (hasComparisonTable) score += 6;
        if (page.body_json?.verdict?.length) score += 4;
        if (signals.hasAthleteCue) score += 4;
        rationale = hasComparisonTable
          ? 'The page is organized to help a buyer narrow a shortlist rather than just consume information.'
          : 'The page gives a directional buying view, though it is less decisive than a comparison-led asset.';
        break;
      case 'trust':
        if (hasMethodology) score += 10;
        score += Math.min(10, referencesCount * 2);
        if (claimStatus === 'verified') score += 8;
        else if (claimStatus === 'mixed') score += 3;
        rationale = hasMethodology || referencesCount > 0
          ? 'Methodology, references, and review cues make the page feel judged rather than auto-published.'
          : 'The page has editorial structure, but it would be stronger with more explicit evidence signals.';
        break;
      default:
        break;
    }

    return {
      id: dimension.id,
      label: dimension.label,
      score: clampScore(score),
      rationale,
    };
  });
}

function deriveOverall(dimensions: RecoveryStackScoreDimension[]) {
  const weighted = dimensions.reduce((sum, dimension) => {
    const config = DIMENSION_CONFIG.find((item) => item.id === dimension.id);
    const weight = config?.weight ?? 1 / Math.max(dimensions.length, 1);
    return sum + dimension.score * weight;
  }, 0);

  return clampScore(weighted);
}

function labelForScore(score: number) {
  if (score >= 90) return 'Category Leader';
  if (score >= 82) return 'High-Conviction Pick';
  if (score >= 74) return 'Strong Shortlist';
  if (score >= 66) return 'Context-Dependent';
  return 'Needs More Proof';
}

function parseVerdictLine(lines: string[], prefix: string) {
  const match = lines.find((line) => line.toLowerCase().startsWith(prefix));
  return match ? match.replace(new RegExp(`^${prefix}\\s*`, 'i'), '').trim() : null;
}

function buildFallbackVerdict(page: PageRecord, score: number): RecoveryStackScorecard['verdict'] {
  const keyword = page.primary_keyword ?? page.h1.toLowerCase();
  const templateLabel = page.template === 'alternatives' ? 'comparison-led smart ring buyers' : page.template;
  const confidenceLabel = score >= 74 ? 'clear enough to act on' : 'useful, but still worth cross-checking';

  return {
    bestFor:
      page.template === 'costs'
        ? 'Buyers who care about total cost of ownership before features.'
        : page.template === 'compatibility'
          ? 'Readers trying to avoid fit, app, or platform mistakes before buying.'
          : `Readers comparing ${templateLabel} options around "${keyword}".`,
    avoidIf:
      page.template === 'metrics'
        ? 'You only want lifestyle inspiration and not a concrete explanation of what the signal means.'
        : 'You want a final purchase decision without considering your own budget, app, and comfort priorities.',
    bottomLine: `RecoveryStack sees this page as ${confidenceLabel} for buyers evaluating ${keyword}.`,
  };
}

function readStructuredVerdict(page: PageRecord): RecoveryStackScorecard['verdict'] | null {
  const lines = page.body_json?.verdict ?? [];
  if (!lines.length) return null;

  const bestFor = parseVerdictLine(lines, 'best for:');
  const avoidIf = parseVerdictLine(lines, 'avoid if:');
  const bottomLine = parseVerdictLine(lines, 'bottom line:');

  if (!bestFor && !avoidIf && !bottomLine) return null;

  return {
    bestFor: bestFor ?? 'Buyers who fit the strongest use case described on this page.',
    avoidIf: avoidIf ?? 'Your priorities conflict with the main use case this page supports.',
    bottomLine: bottomLine ?? lines[0],
  };
}

export function getRecoveryStackScorecard(page: PageRecord): RecoveryStackScorecard {
  const explicitOverall = readScore(page.metadata?.recoverystack_score);
  const explicitSummary =
    readString(page.metadata?.recoverystack_score_summary) ??
    readString(page.metadata?.recoverystack_score_thesis);
  const explicitLabel = readString(page.metadata?.recoverystack_score_label);

  const dimensions = deriveDimensions(page);
  const overall = explicitOverall ?? deriveOverall(dimensions);
  const verdict = readStructuredVerdict(page) ?? buildFallbackVerdict(page, overall);

  return {
    overall,
    label: explicitLabel ?? labelForScore(overall),
    summary:
      explicitSummary ??
      `RecoveryStack Score reflects how decisively this page helps a buyer judge signal quality, cost reality, fit, and trust before acting.`,
    dimensions,
    verdict: {
      bestFor: readString(page.metadata?.recoverystack_best_for) ?? verdict.bestFor,
      avoidIf: readString(page.metadata?.recoverystack_avoid_if) ?? verdict.avoidIf,
      bottomLine: readString(page.metadata?.recoverystack_bottom_line) ?? verdict.bottomLine,
    },
  };
}
