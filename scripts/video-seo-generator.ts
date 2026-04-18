/**
 * Video SEO Generator
 *
 * For keywords with detected video carousels (from serp_features), generates:
 *   1. A video script in transcript format (300–600 words)
 *   2. A VideoObject schema block for embedding in the page
 *   3. A YouTube description optimised for the keyword
 *   4. Timestamp chapters for YouTube
 *
 * The video script is stored as a page section (kind: 'transcript') and
 * injected into the content by content-generator. The VideoObject schema
 * is merged into the page's schema_org array.
 *
 * Content strategy: these scripts are designed to rank in video carousels
 * AND serve as transcript-style content sections that pass Helpful Content
 * criteria — providing genuine information gain over what competitors offer.
 *
 * Usage:
 *   npx tsx scripts/video-seo-generator.ts
 *   npx tsx scripts/video-seo-generator.ts --dry-run
 *   VIDEO_SEO_LIMIT=20 npx tsx scripts/video-seo-generator.ts
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.VIDEO_SEO_LIMIT ?? 10);
const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

type VideoScript = {
  hook: string;           // 15-second opening hook
  chapters: Array<{
    timestamp: string;    // e.g. "0:30"
    title: string;
    content: string;      // 80–150 words per chapter
  }>;
  cta: string;           // 30-second closing CTA
  youtube_description: string;
  youtube_tags: string[];
  estimated_duration_minutes: number;
};

// ── Generate video script via LLM ─────────────────────────────────────────────
async function generateVideoScript(
  keyword: string,
  pageTitle: string,
  template: string,
  paaQuestions: string[],
): Promise<VideoScript | null> {
  const prompt = `You are a sports science video content creator for RecoveryStack. Generate a YouTube video script for the keyword "${keyword}".

Page title: ${pageTitle}
Template: ${template}

PAA questions to answer in the video:
${paaQuestions.slice(0, 4).map((q, i) => `${i + 1}. ${q}`).join('\n')}

Requirements:
- 4-5 chapters with timestamp markers
- Hook must be 1-2 punchy sentences that create urgency or curiosity
- Each chapter: 80-120 words of spoken content
- Evidence-based, specific numbers and studies where possible
- CTA: drive viewers to the full guide at ${SITE_URL}/${template}
- YouTube description: 200 words, keyword-rich, includes timestamps
- 8-12 relevant YouTube tags

Return JSON only, matching this schema:
{
  "hook": "string",
  "chapters": [{"timestamp": "0:00", "title": "string", "content": "string"}],
  "cta": "string",
  "youtube_description": "string",
  "youtube_tags": ["string"],
  "estimated_duration_minutes": number
}`;

  try {
    if (OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.7,
          max_tokens: 1500,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      return content ? JSON.parse(content) : null;
    }

    // Ollama fallback
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        format: 'json',
        options: { temperature: 0.7, num_predict: 1500 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.response ? JSON.parse(data.response) : null;
  } catch {
    return null;
  }
}

// ── Build VideoObject schema ───────────────────────────────────────────────────
function buildVideoObjectSchema(
  keyword: string,
  script: VideoScript,
  pageUrl: string,
  thumbnailUrl: string | null,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: `${keyword} — Complete Guide`,
    description: script.youtube_description.slice(0, 500),
    thumbnailUrl: thumbnailUrl ?? `${SITE_URL}/og-default.jpg`,
    uploadDate: new Date().toISOString().split('T')[0],
    duration: `PT${script.estimated_duration_minutes}M`,
    contentUrl: pageUrl,
    embedUrl: pageUrl,
    interactionStatistic: {
      '@type': 'InteractionCounter',
      interactionType: { '@type': 'WatchAction' },
      userInteractionCount: 0,
    },
    hasPart: script.chapters.map((ch, i) => ({
      '@type': 'Clip',
      name: ch.title,
      startOffset: i * Math.floor((script.estimated_duration_minutes * 60) / script.chapters.length),
      endOffset: (i + 1) * Math.floor((script.estimated_duration_minutes * 60) / script.chapters.length),
      url: pageUrl,
    })),
  };
}

async function run(): Promise<void> {
  // Find pages with video carousel SERP features
  const { data: serpData } = await supabase
    .from('serp_features')
    .select('keyword, page_slug, paa_questions, has_video_carousel')
    .eq('has_video_carousel', true)
    .not('page_slug', 'is', null)
    .limit(LIMIT);

  if (!serpData || serpData.length === 0) {
    console.log('[video-seo] No keywords with video carousels found.');
    return;
  }

  console.log(`[video-seo] Generating video scripts for ${serpData.length} keywords (dryRun=${DRY_RUN})`);

  for (const row of serpData as Array<{ keyword: string; page_slug: string; paa_questions: Array<{ question: string }> }>) {
    const { data: page } = await supabase
      .from('pages')
      .select('slug, template, title, metadata, schema_org, body_json')
      .eq('slug', row.page_slug)
      .single();

    if (!page) continue;

    // Check if video script already exists
    const bodyJson = (page as any).body_json ?? {};
    const sections = (bodyJson.sections ?? []) as Array<{ kind: string }>;
    if (sections.some((s) => s.kind === 'transcript')) {
      console.log(`[video-seo] ${row.page_slug}: already has transcript section`);
      continue;
    }

    const paaQuestions = (row.paa_questions ?? []).map((q: { question: string }) => q.question);

    console.log(`[video-seo] Generating script for "${row.keyword}"...`);
    const script = await generateVideoScript(
      row.keyword,
      (page as any).title,
      (page as any).template,
      paaQuestions,
    );

    if (!script) {
      console.warn(`[video-seo] Failed to generate script for "${row.keyword}"`);
      continue;
    }

    const pageUrl = `${SITE_URL}/${(page as any).template}/${row.page_slug}`;
    const thumbnailUrl = (page as any).metadata?.hero_image ?? null;
    const videoSchema = buildVideoObjectSchema(row.keyword, script, pageUrl, thumbnailUrl);

    // Build transcript section for body_json
    const transcriptSection = {
      id: 'video-transcript',
      heading: `Video: ${row.keyword} — Complete Guide`,
      kind: 'transcript',
      content: {
        hook: script.hook,
        chapters: script.chapters,
        cta: script.cta,
        estimated_duration_minutes: script.estimated_duration_minutes,
        youtube_description: script.youtube_description,
        youtube_tags: script.youtube_tags,
      },
    };

    console.log(
      `[video-seo] "${row.keyword}": ${script.chapters.length} chapters, ${script.estimated_duration_minutes}min script`,
    );

    if (DRY_RUN) continue;

    // Add transcript section to page body_json
    const updatedSections = [...sections, transcriptSection];
    const updatedBodyJson = { ...bodyJson, sections: updatedSections };

    // Merge VideoObject into schema_org array
    const currentSchema = Array.isArray((page as any).schema_org) ? (page as any).schema_org : [(page as any).schema_org].filter(Boolean);
    const updatedSchema = [...currentSchema, videoSchema];

    await supabase.from('pages').update({
      body_json: updatedBodyJson,
      schema_org: updatedSchema,
      needs_revalidation: true,
    }).eq('slug', row.page_slug);

    // Store in video_scripts table for YouTube publishing workflow
    await supabase.from('video_scripts').upsert({
      page_slug: row.page_slug,
      keyword: row.keyword,
      hook: script.hook,
      chapters: script.chapters,
      cta: script.cta,
      youtube_description: script.youtube_description,
      youtube_tags: script.youtube_tags,
      estimated_duration_minutes: script.estimated_duration_minutes,
      status: 'draft',
      generated_at: new Date().toISOString(),
    }, { onConflict: 'page_slug' });
  }

  console.log('[video-seo] Done.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
