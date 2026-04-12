import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * Simple simhash for content deduplication.
 * Generates a 64-bit fingerprint from text content that can be compared
 * using Hamming distance to detect near-duplicates.
 */

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function hashToken(token: string): bigint {
  // FNV-1a 64-bit hash
  let hash = 14695981039346656037n;
  for (let i = 0; i < token.length; i++) {
    hash ^= BigInt(token.charCodeAt(i));
    hash = (hash * 1099511628211n) & 0xFFFFFFFFFFFFFFFFn;
  }
  return hash;
}

export function computeSimhash(text: string): string {
  const tokens = tokenize(text);
  if (tokens.length === 0) return '0'.repeat(16);

  // Use 3-gram shingles for better accuracy
  const shingles: string[] = [];
  for (let i = 0; i < tokens.length - 2; i++) {
    shingles.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  if (shingles.length === 0 && tokens.length > 0) {
    shingles.push(tokens.join(' '));
  }

  const v = new Array<number>(64).fill(0);

  for (const shingle of shingles) {
    const h = hashToken(shingle);
    for (let bit = 0; bit < 64; bit++) {
      if ((h >> BigInt(bit)) & 1n) {
        v[bit] += 1;
      } else {
        v[bit] -= 1;
      }
    }
  }

  let result = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (v[bit] > 0) {
      result |= 1n << BigInt(bit);
    }
  }

  return result.toString(16).padStart(16, '0');
}

export function hammingDistance(a: string, b: string): number {
  const av = BigInt(`0x${a}`);
  const bv = BigInt(`0x${b}`);
  let xor = av ^ bv;
  let dist = 0;
  while (xor > 0n) {
    dist += Number(xor & 1n);
    xor >>= 1n;
  }
  return dist;
}

/**
 * Similarity score between 0 and 1.
 * 1 = identical, 0 = completely different.
 * Threshold of 0.85+ indicates near-duplicate content.
 */
export function similarity(a: string, b: string): number {
  return 1 - hammingDistance(a, b) / 64;
}

export function extractKeywordSignature(title: string, primaryKeyword: string | null): string {
  const combined = `${title} ${primaryKeyword ?? ''}`.toLowerCase();
  return tokenize(combined)
    .filter((w) => w.length > 3)
    .sort()
    .slice(0, 8)
    .join('|');
}

/**
 * Check if a page's content is too similar to any existing published page.
 * Returns the closest match if similarity > threshold, or null if unique enough.
 */
export async function checkContentUniqueness(
  pageSlug: string,
  text: string,
  title: string,
  primaryKeyword: string | null,
  threshold = 0.85,
): Promise<{ isDuplicate: boolean; closestSlug?: string; similarity?: number }> {
  const hash = computeSimhash(text);
  const kwSig = extractKeywordSignature(title, primaryKeyword);

  // First check keyword signature overlap (fast path)
  const { data: kwMatches } = await supabase
    .from('content_fingerprints')
    .select('slug, simhash, keyword_signature')
    .neq('slug', pageSlug)
    .eq('keyword_signature', kwSig)
    .limit(5);

  // Then check simhash similarity for keyword matches
  let closestSlug: string | undefined;
  let closestSim = 0;

  for (const match of kwMatches ?? []) {
    const sim = similarity(hash, match.simhash);
    if (sim > closestSim) {
      closestSim = sim;
      closestSlug = match.slug;
    }
  }

  // Also do a broader simhash check (sample recent pages)
  const { data: recentPages } = await supabase
    .from('content_fingerprints')
    .select('slug, simhash')
    .neq('slug', pageSlug)
    .order('created_at', { ascending: false })
    .limit(200);

  for (const page of recentPages ?? []) {
    const sim = similarity(hash, page.simhash);
    if (sim > closestSim) {
      closestSim = sim;
      closestSlug = page.slug;
    }
  }

  return {
    isDuplicate: closestSim >= threshold,
    closestSlug: closestSim >= threshold ? closestSlug : undefined,
    similarity: closestSim >= threshold ? Math.round(closestSim * 100) / 100 : undefined,
  };
}

/**
 * Store a content fingerprint after a page passes quality gates.
 */
export async function storeContentFingerprint(
  pageId: string,
  slug: string,
  template: string,
  text: string,
  title: string,
  primaryKeyword: string | null,
) {
  const simhash = computeSimhash(text);
  const kwSig = extractKeywordSignature(title, primaryKeyword);

  const { error } = await supabase
    .from('content_fingerprints')
    .upsert(
      { page_id: pageId, slug, template, simhash, keyword_signature: kwSig },
      { onConflict: 'slug' },
    );

  if (error) {
    console.warn(`[uniqueness] Failed to store fingerprint for ${slug}: ${error.message}`);
  }
}
