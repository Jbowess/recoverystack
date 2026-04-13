/**
 * Semantic Embedding Sync
 *
 * Generates OpenAI text-embedding-3-small embeddings for all published pages
 * and stores them in the page_embeddings table (pgvector).
 *
 * Uses SHA-256 content hashing to skip pages whose content hasn't changed.
 *
 * After embedding, runs a similarity report to flag:
 *   - Near-duplicate pages (similarity > 0.95) — cannibalization risk
 *   - Related pages missing cross-links (similarity 0.75–0.95)
 *
 * No-ops when OPENAI_API_KEY is not set.
 *
 * Run: npm run embeddings:sync
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMENSIONS = 1536;
const BATCH_SIZE = 20; // Embed 20 pages per API call (OpenAI supports batch input)
const SIMILARITY_DUPLICATE_THRESHOLD = 0.95;
const SIMILARITY_RELATED_THRESHOLD = 0.75;
const DELAY_MS = 200;

function buildPageText(page: {
  title: string;
  meta_description: string | null;
  intro: string | null;
  primary_keyword: string | null;
  secondary_keywords: string[] | null;
  body_json: Record<string, unknown> | null;
}): string {
  const parts = [
    page.title,
    page.primary_keyword ?? '',
    (page.secondary_keywords ?? []).join(' '),
    page.meta_description ?? '',
    page.intro ?? '',
  ];

  const sections = (page.body_json?.sections ?? []) as Array<{ heading: string; content: unknown }>;
  for (const s of sections.slice(0, 10)) {
    parts.push(s.heading);
    if (typeof s.content === 'string') {
      parts.push(s.content.slice(0, 300));
    } else if (Array.isArray(s.content)) {
      parts.push((s.content as string[]).slice(0, 3).join(' '));
    }
  }

  return parts.filter(Boolean).join('\n').slice(0, 8000); // Token limit safety
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function embedBatch(texts: string[]): Promise<number[][] | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: texts,
        dimensions: EMBED_DIMENSIONS,
      }),
    });

    if (!res.ok) {
      console.warn(`[embedding-sync] OpenAI embeddings error ${res.status}: ${await res.text()}`);
      return null;
    }

    const json = await res.json();
    return (json.data as Array<{ embedding: number[] }>).map((d) => d.embedding);
  } catch (err) {
    console.warn('[embedding-sync] Embed error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function run() {
  if (!process.env.OPENAI_API_KEY) {
    console.log('[embedding-sync] OPENAI_API_KEY not set — skipping.');
    return;
  }

  // Load all published pages
  const { data: pages, error } = await supabase
    .from('pages')
    .select('id, slug, template, title, meta_description, intro, primary_keyword, secondary_keywords, body_json')
    .eq('status', 'published');

  if (error) throw error;
  if (!pages || pages.length === 0) {
    console.log('[embedding-sync] No published pages found.');
    return;
  }

  // Load existing embeddings to check content hashes
  const { data: existing } = await supabase
    .from('page_embeddings')
    .select('page_slug, content_hash');

  const existingHashes = new Map(
    ((existing ?? []) as Array<{ page_slug: string; content_hash: string }>).map((e) => [e.page_slug, e.content_hash]),
  );

  // Build texts and filter to only pages that need re-embedding
  const toEmbed = pages
    .map((page) => {
      const text = buildPageText(page as Parameters<typeof buildPageText>[0]);
      const hash = sha256(text);
      return { page, text, hash, needsEmbed: existingHashes.get(page.slug) !== hash };
    })
    .filter((p) => p.needsEmbed);

  console.log(`[embedding-sync] ${pages.length} published pages, ${toEmbed.length} need embedding (${pages.length - toEmbed.length} unchanged).`);

  if (toEmbed.length === 0) {
    console.log('[embedding-sync] All embeddings up to date.');
  } else {
    let embedded = 0;

    for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + BATCH_SIZE);
      const texts = batch.map((b) => b.text);
      const vectors = await embedBatch(texts);

      if (!vectors) {
        console.warn(`[embedding-sync] Batch ${i / BATCH_SIZE + 1} failed — stopping.`);
        break;
      }

      const upsertRows = batch.map((b, idx) => ({
        page_id: b.page.id,
        page_slug: b.page.slug,
        model: EMBED_MODEL,
        embedding: JSON.stringify(vectors[idx]), // pgvector accepts JSON array
        content_hash: b.hash,
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertErr } = await supabase
        .from('page_embeddings')
        .upsert(upsertRows, { onConflict: 'page_slug' });

      if (upsertErr) {
        console.warn(`[embedding-sync] Upsert error: ${upsertErr.message}`);
      } else {
        embedded += batch.length;
        console.log(`  Embedded ${embedded}/${toEmbed.length}...`);
      }

      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    console.log(`[embedding-sync] Embedded ${embedded} page(s).`);
  }

  // Similarity analysis — find near-duplicates and cross-link candidates
  console.log('\n[embedding-sync] Running similarity analysis...');

  const { data: allEmbeddings } = await supabase
    .from('page_embeddings')
    .select('page_slug')
    .limit(200);

  if (!allEmbeddings || allEmbeddings.length < 2) {
    console.log('[embedding-sync] Not enough embeddings for similarity analysis yet.');
    return;
  }

  const duplicateRisks: Array<{ a: string; b: string; similarity: number }> = [];
  const crossLinkSuggestions: Array<{ slug: string; similar: string; similarity: number }> = [];

  // Sample a subset to avoid O(n²) cost — check 20 pages
  const sample = (allEmbeddings as Array<{ page_slug: string }>).slice(0, 20);

  for (const { page_slug } of sample) {
    const { data: similar } = await supabase.rpc('find_similar_pages', {
      target_slug: page_slug,
      match_count: 5,
      min_similarity: SIMILARITY_RELATED_THRESHOLD,
    });

    if (!similar) continue;

    for (const match of similar as Array<{ slug: string; similarity: number }>) {
      if (match.similarity >= SIMILARITY_DUPLICATE_THRESHOLD) {
        duplicateRisks.push({ a: page_slug, b: match.slug, similarity: match.similarity });
      } else {
        crossLinkSuggestions.push({ slug: page_slug, similar: match.slug, similarity: match.similarity });
      }
    }
  }

  if (duplicateRisks.length > 0) {
    console.log('\n  ⚠ NEAR-DUPLICATE RISKS (potential cannibalization):');
    for (const d of duplicateRisks) {
      console.log(`    ${d.a} ↔ ${d.b} (${(d.similarity * 100).toFixed(1)}% similar)`);
    }
  }

  if (crossLinkSuggestions.length > 0) {
    console.log('\n  → Cross-link opportunities (semantically related, could share links):');
    crossLinkSuggestions.slice(0, 10).forEach((s) => {
      console.log(`    ${s.slug} → ${s.similar} (${(s.similarity * 100).toFixed(1)}%)`);
    });
  }

  console.log(`\n[embedding-sync] Done. Duplicate risks: ${duplicateRisks.length}, cross-link suggestions: ${crossLinkSuggestions.length}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
