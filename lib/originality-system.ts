import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeSimhash, similarity } from '@/lib/content-uniqueness';
import type { PageRecord } from '@/lib/types';

type JsonObject = Record<string, unknown>;

export type OriginalityProfile = {
  intent: string;
  funnelStage: string;
  audienceSegment: string;
  entityFocus: string;
  angle: string;
  structureSignature: string;
  evidenceMix: string[];
  layoutFingerprint: string | null;
};

export type BlockFingerprint = {
  blockType: string;
  blockKey: string;
  fingerprint: string;
  simhash: string;
  preview: string;
  wordCount: number;
};

export type OriginalityPeer = {
  id: string | null;
  slug: string;
  template: string | null;
  simhash: string;
  profile: OriginalityProfile;
  blocks: BlockFingerprint[];
};

export type OriginalityAssessment = {
  totalScore: number;
  status: 'pass' | 'review' | 'fail';
  summary: string;
  breakdown: {
    intentDistance: number;
    angleNovelty: number;
    evidenceNovelty: number;
    structureVariation: number;
    blockVariation: number;
  };
  profile: OriginalityProfile;
  nearestMatch: {
    slug: string | null;
    similarity: number;
  };
  matchedPages: Array<{
    slug: string;
    similarity: number;
    reasons: string[];
  }>;
  blockFingerprints: BlockFingerprint[];
  failReasons: string[];
};

type PageLike = Pick<
  PageRecord,
  | 'id'
  | 'slug'
  | 'template'
  | 'title'
  | 'h1'
  | 'intro'
  | 'primary_keyword'
  | 'secondary_keywords'
  | 'body_json'
  | 'metadata'
> & {
  status?: string | null;
};

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprintText(value: string) {
  return createHash('sha256').update(normalizeText(value)).digest('hex');
}

function countWords(value: string) {
  return normalizeText(value).split(/\s+/).filter(Boolean).length;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
  return [];
}

export function collectPageText(page: PageLike) {
  const parts = [
    page.title ?? '',
    page.h1 ?? '',
    page.intro ?? '',
    ...(page.body_json?.key_takeaways ?? []),
    ...(page.body_json?.verdict ?? []),
  ];

  for (const section of page.body_json?.sections ?? []) {
    parts.push(section.heading ?? '');
    parts.push(...collectStrings(section.content));
  }

  for (const faq of page.body_json?.faqs ?? []) {
    parts.push(faq.q ?? '');
    parts.push(faq.a ?? '');
  }

  return parts.join('\n');
}

function detectIntent(page: PageLike) {
  const override = readString(page.metadata?.content_intent);
  if (override) return override;

  const keyword = `${page.primary_keyword ?? ''} ${page.title ?? ''} ${page.h1 ?? ''}`.toLowerCase();
  if (page.template === 'reviews') return 'review';
  if (page.template === 'alternatives') return 'comparison';
  if (page.template === 'costs') return 'pricing';
  if (page.template === 'compatibility') return 'compatibility';
  if (page.template === 'news') return 'news';
  if (/(vs|versus|alternative|compare|best)/.test(keyword)) return 'comparison';
  if (/(price|cost|subscription|value)/.test(keyword)) return 'pricing';
  if (/(accuracy|scientific|validation|hrv|sleep)/.test(keyword)) return 'evidence';
  return 'informational';
}

function detectFunnelStage(page: PageLike) {
  const override = readString(page.metadata?.conversion_stage);
  if (override) return override;
  if (['reviews', 'alternatives', 'costs', 'compatibility'].includes(page.template ?? '')) return 'decision';
  if (['guides', 'metrics', 'checklists'].includes(page.template ?? '')) return 'consideration';
  if (page.template === 'news') return 'awareness';
  return 'awareness';
}

function detectAudienceSegment(page: PageLike) {
  const override =
    readString(page.metadata?.audience_segment) ??
    readString(page.metadata?.target_segment) ??
    readString(page.metadata?.market_focus);
  if (override) return override;

  const keyword = `${page.primary_keyword ?? ''} ${page.title ?? ''}`.toLowerCase();
  if (/(runner|marathon|training)/.test(keyword)) return 'runners';
  if (/(sleep)/.test(keyword)) return 'sleep_buyers';
  if (/(cost|price|subscription|budget)/.test(keyword)) return 'subscription_averse';
  if (/(accuracy|validation|evidence)/.test(keyword)) return 'accuracy_first';
  return 'general_buyers';
}

function detectEntityFocus(page: PageLike) {
  const keyword = `${page.primary_keyword ?? ''} ${page.title ?? ''}`.toLowerCase();
  if (keyword.includes('oura')) return 'oura';
  if (keyword.includes('ringconn')) return 'ringconn';
  if (keyword.includes('ultrahuman')) return 'ultrahuman';
  if (keyword.includes('samsung')) return 'samsung';
  if (keyword.includes('volo')) return 'volo';
  if (keyword.includes('smart ring')) return 'smart_ring_category';
  return page.template ?? 'general';
}

function detectAngle(page: PageLike) {
  const override =
    readString(page.metadata?.recoverystack_angle) ??
    readString(page.metadata?.content_angle) ??
    readString(page.metadata?.content_angle_label);
  if (override) return override.toLowerCase().replace(/\s+/g, '_');

  const keyword = `${page.primary_keyword ?? ''} ${page.title ?? ''} ${page.h1 ?? ''}`.toLowerCase();
  if (page.template === 'costs' || /(price|cost|subscription|value)/.test(keyword)) return 'cost_of_ownership';
  if (page.template === 'compatibility' || /(compatib|iphone|android|app)/.test(keyword)) return 'ecosystem_fit';
  if (/(accuracy|validation|science|methodology|hrv)/.test(keyword)) return 'evidence_and_signal_quality';
  if (/(comfort|fit|size|sizing|overnight)/.test(keyword)) return 'comfort_and_adherence';
  if (page.template === 'alternatives' || page.template === 'reviews') return 'buyer_decision';
  if (page.template === 'news') return 'market_change';
  return 'category_education';
}

function detectStructureSignature(page: PageLike) {
  const body = (page.body_json ?? {}) as NonNullable<PageLike['body_json']> & { generation_metadata?: JsonObject };
  const generationMeta = (body.generation_metadata ?? {}) as JsonObject;
  const layoutFingerprint =
    readString(generationMeta.layout_fingerprint) ??
    readString(page.metadata?.layout_fingerprint) ??
    readString(page.metadata?.recoverystack_structure);

  if (layoutFingerprint) return `layout:${layoutFingerprint.slice(0, 12)}`;

  const sectionIds = (body.sections ?? []).slice(0, 5).map((section) => section.id || section.heading.toLowerCase().replace(/\s+/g, '-'));
  if (sectionIds.length > 0) return `sections:${sectionIds.join('|')}`;

  return `template:${page.template ?? 'unknown'}`;
}

function detectEvidenceMix(page: PageLike) {
  const out = new Set<string>();
  const refs = page.body_json?.references ?? [];
  const feeds = page.body_json?.info_gain_feeds;

  if (page.body_json?.review_methodology) out.add('review_methodology');
  if (page.body_json?.comparison_table?.rows?.length) out.add('comparison_table');
  if (refs.length > 0) out.add('references');
  if (feeds?.scientific_alpha?.items?.length) out.add('scientific_references');
  if (feeds?.social_sentiment?.complaints?.length) out.add('community_sentiment');
  if (feeds?.price_performance?.snapshots?.length) out.add('price_snapshots');
  if (Array.isArray(page.metadata?.app_review_signals) && page.metadata.app_review_signals.length > 0) out.add('app_reviews');
  if (Array.isArray(page.metadata?.community_signals) && page.metadata.community_signals.length > 0) out.add('community_signals');
  if (page.body_json?.newsroom_context?.source_events?.length) out.add('newsroom_events');

  const refHaystack = refs
    .flatMap((ref) => [ref.title, ref.source, ref.url])
    .filter((item): item is string => typeof item === 'string')
    .join(' ')
    .toLowerCase();

  if (/(spec|battery|sensor|water resistance|dimensions|weight)/.test(refHaystack)) out.add('product_specs');
  if (/(reddit|community|forum)/.test(refHaystack)) out.add('community_sentiment');
  if (/(pubmed|journal|study|clinical)/.test(refHaystack)) out.add('scientific_references');

  return [...out].sort();
}

export function buildOriginalityProfile(page: PageLike): OriginalityProfile {
  const body = (page.body_json ?? {}) as NonNullable<PageLike['body_json']> & { generation_metadata?: JsonObject };
  const generationMeta = (body.generation_metadata ?? {}) as JsonObject;

  return {
    intent: detectIntent(page),
    funnelStage: detectFunnelStage(page),
    audienceSegment: detectAudienceSegment(page),
    entityFocus: detectEntityFocus(page),
    angle: detectAngle(page),
    structureSignature: detectStructureSignature(page),
    evidenceMix: detectEvidenceMix(page),
    layoutFingerprint:
      readString(generationMeta.layout_fingerprint) ??
      readString(page.metadata?.layout_fingerprint),
  };
}

function preview(value: string, max = 140) {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function extractCtaText(page: PageLike) {
  const ctaish = collectStrings([
    page.body_json,
    page.title,
    page.intro,
  ]).filter((line) => /\b(newsletter|ring|pdf|subscribe|brief|buyer guide|next step)\b/i.test(line));

  return ctaish.slice(0, 6).join('\n');
}

export function extractBlockFingerprints(page: PageLike): BlockFingerprint[] {
  const body = page.body_json ?? {};
  const blocks: Array<{ blockType: string; blockKey: string; text: string }> = [
    { blockType: 'title', blockKey: 'title', text: page.title ?? '' },
    { blockType: 'intro', blockKey: 'intro', text: page.intro ?? '' },
    { blockType: 'verdict', blockKey: 'verdict', text: (body.verdict ?? []).join('\n') },
    {
      blockType: 'headings',
      blockKey: 'headings',
      text: (body.sections ?? []).map((section) => section.heading).join('\n'),
    },
    {
      blockType: 'faq',
      blockKey: 'faq',
      text: (body.faqs ?? []).map((faq) => `${faq.q}\n${faq.a}`).join('\n'),
    },
    { blockType: 'cta', blockKey: 'cta', text: extractCtaText(page) },
  ];

  return blocks
    .map((block) => {
      const text = block.text.trim();
      if (!text) return null;
      return {
        blockType: block.blockType,
        blockKey: block.blockKey,
        fingerprint: fingerprintText(text),
        simhash: computeSimhash(text),
        preview: preview(text),
        wordCount: countWords(text),
      };
    })
    .filter((row): row is BlockFingerprint => Boolean(row));
}

export function buildOriginalityPeer(page: PageLike): OriginalityPeer {
  return {
    id: page.id ?? null,
    slug: page.slug,
    template: page.template ?? null,
    simhash: computeSimhash(collectPageText(page)),
    profile: buildOriginalityProfile(page),
    blocks: extractBlockFingerprints(page),
  };
}

function overlapScore(a: string[], b: string[]) {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  let shared = 0;
  for (const item of left) {
    if (right.has(item)) shared += 1;
  }
  return shared / union.size;
}

function topMatches(current: OriginalityPeer, peers: OriginalityPeer[]) {
  return peers
    .filter((peer) => peer.slug !== current.slug)
    .map((peer) => {
      const reasons: string[] = [];
      const contentSimilarity = similarity(current.simhash, peer.simhash);
      if (current.profile.intent === peer.profile.intent) reasons.push('same intent');
      if (current.profile.angle === peer.profile.angle) reasons.push('same angle');
      if (current.profile.structureSignature === peer.profile.structureSignature) reasons.push('same structure');

      const evidenceOverlap = overlapScore(current.profile.evidenceMix, peer.profile.evidenceMix);
      if (evidenceOverlap >= 0.75) reasons.push('same evidence mix');

      const duplicatedBlocks = current.blocks.filter((block) =>
        peer.blocks.some((candidate) => candidate.blockType === block.blockType && candidate.fingerprint === block.fingerprint),
      ).length;
      if (duplicatedBlocks > 0) reasons.push(`${duplicatedBlocks} repeated block${duplicatedBlocks === 1 ? '' : 's'}`);

      return {
        slug: peer.slug,
        similarity: Number(contentSimilarity.toFixed(3)),
        reasons,
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);
}

export function assessOriginality(page: PageLike, peers: OriginalityPeer[]): OriginalityAssessment {
  const current = buildOriginalityPeer(page);
  const otherPeers = peers.filter((peer) => peer.slug !== current.slug);
  const matches = topMatches(current, peers);

  const sameIntentCount = otherPeers.filter((peer) =>
    peer.profile.intent === current.profile.intent &&
    peer.profile.funnelStage === current.profile.funnelStage &&
    peer.profile.entityFocus === current.profile.entityFocus,
  ).length;

  const sameAngleCount = otherPeers.filter((peer) =>
    peer.template === current.template && peer.profile.angle === current.profile.angle,
  ).length;

  const sameStructureCount = otherPeers.filter((peer) =>
    peer.template === current.template && peer.profile.structureSignature === current.profile.structureSignature,
  ).length;

  const maxEvidenceOverlap = otherPeers.reduce((max, peer) => {
    const overlap = overlapScore(current.profile.evidenceMix, peer.profile.evidenceMix);
    return Math.max(max, overlap);
  }, 0);

  const duplicatedBlocks = current.blocks.reduce((sum, block) => {
    const duplicateCount = otherPeers.filter((peer) =>
      peer.blocks.some((candidate) => candidate.blockType === block.blockType && candidate.fingerprint === block.fingerprint),
    ).length;
    return sum + (duplicateCount > 0 ? 1 : 0);
  }, 0);

  const maxBlockSimilarity = current.blocks.reduce((max, block) => {
    const candidate = otherPeers.flatMap((peer) => peer.blocks)
      .filter((peerBlock) => peerBlock.blockType === block.blockType)
      .reduce((best, peerBlock) => Math.max(best, similarity(block.simhash, peerBlock.simhash)), 0);
    return Math.max(max, candidate);
  }, 0);

  const nearestMatch = matches[0] ?? { slug: null, similarity: 0, reasons: [] as string[] };
  const contentPenalty = nearestMatch.similarity >= 0.92 ? 18 : nearestMatch.similarity >= 0.88 ? 12 : nearestMatch.similarity >= 0.83 ? 6 : 0;

  const breakdown = {
    intentDistance: Math.max(0, 20 - Math.min(18, sameIntentCount * 5)),
    angleNovelty: Math.max(0, 20 - Math.min(16, sameAngleCount * 4)),
    evidenceNovelty: Math.min(
      20,
      Math.max(4, current.profile.evidenceMix.length * 3 + (maxEvidenceOverlap < 0.45 ? 6 : maxEvidenceOverlap < 0.75 ? 3 : 0)),
    ),
    structureVariation: Math.max(0, 20 - Math.min(16, sameStructureCount * 4)),
    blockVariation: Math.max(
      0,
      20 - Math.min(12, duplicatedBlocks * 4) - (maxBlockSimilarity >= 0.95 ? 6 : maxBlockSimilarity >= 0.9 ? 3 : 0),
    ),
  };

  const totalScore = clampScore(
    breakdown.intentDistance +
      breakdown.angleNovelty +
      breakdown.evidenceNovelty +
      breakdown.structureVariation +
      breakdown.blockVariation -
      contentPenalty,
  );

  const failReasons: string[] = [];
  if (nearestMatch.similarity >= 0.88) failReasons.push(`content too close to ${nearestMatch.slug} (${Math.round(nearestMatch.similarity * 100)}%)`);
  if (duplicatedBlocks >= 2) failReasons.push(`${duplicatedBlocks} repeated content blocks detected`);
  if (current.profile.evidenceMix.length < 2) failReasons.push('evidence mix is too narrow');
  if (sameStructureCount >= 3) failReasons.push('structure pattern is overused');
  if (totalScore < 62) failReasons.push(`originality score ${totalScore} is below threshold`);

  const status: OriginalityAssessment['status'] =
    failReasons.length > 0 ? 'fail' : totalScore < 75 ? 'review' : 'pass';

  const summary =
    status === 'pass'
      ? `Strong originality profile. Angle, structure, and evidence mix are sufficiently separated from nearby pages.`
      : status === 'review'
        ? `Originality is usable but not yet distinctive. The page is drifting toward existing patterns.`
        : `Originality risk is high. The page is too close to existing inventory and should be rewritten before publish.`;

  return {
    totalScore,
    status,
    summary,
    breakdown,
    profile: current.profile,
    nearestMatch: {
      slug: nearestMatch.slug,
      similarity: nearestMatch.similarity,
    },
    matchedPages: matches,
    blockFingerprints: current.blocks,
    failReasons,
  };
}

export async function persistOriginalityAssessment(
  supabase: SupabaseClient,
  page: Pick<PageLike, 'id' | 'slug' | 'template'>,
  assessment: OriginalityAssessment,
) {
  if (!page.id) return;

  const now = new Date().toISOString();
  const row = {
    page_id: page.id,
    page_slug: page.slug,
    template: page.template ?? null,
    total_score: assessment.totalScore,
    status: assessment.status,
    summary: assessment.summary,
    profile: assessment.profile,
    breakdown: {
      ...assessment.breakdown,
      nearest_match_slug: assessment.nearestMatch.slug,
      nearest_match_similarity: assessment.nearestMatch.similarity,
      fail_reasons: assessment.failReasons,
    },
    matched_pages: assessment.matchedPages,
    created_at: now,
  };

  const snapshotWrite = await supabase.from('page_originality_scores').insert(row);
  if (snapshotWrite.error && !snapshotWrite.error.message.includes('page_originality_scores')) {
    throw snapshotWrite.error;
  }

  const blockDelete = await supabase.from('content_block_fingerprints').delete().eq('page_slug', page.slug);
  if (blockDelete.error && !blockDelete.error.message.includes('content_block_fingerprints')) {
    throw blockDelete.error;
  }

  if (assessment.blockFingerprints.length > 0) {
    const blockInsert = await supabase.from('content_block_fingerprints').insert(
      assessment.blockFingerprints.map((block) => ({
        page_id: page.id,
        page_slug: page.slug,
        template: page.template ?? null,
        block_type: block.blockType,
        block_key: block.blockKey,
        fingerprint: block.fingerprint,
        simhash: block.simhash,
        preview: block.preview,
        metadata: { word_count: block.wordCount },
      })),
    );

    if (blockInsert.error && !blockInsert.error.message.includes('content_block_fingerprints')) {
      throw blockInsert.error;
    }
  }

  const pageUpdate = await supabase
    .from('pages')
    .update({
      originality_score: assessment.totalScore,
      originality_status: assessment.status,
      originality_profile: assessment.profile,
    })
    .eq('id', page.id);

  if (pageUpdate.error && !pageUpdate.error.message.includes('originality_')) {
    throw pageUpdate.error;
  }
}
