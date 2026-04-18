import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { countRequiredCtaMentions } from '@/lib/publish-guards';
import { buildInfoFeedSections, collectInfoGainFeeds } from '@/lib/info-gain-feeds';
import { buildNewsroomContext } from '@/lib/newsroom';
import { rateLimit } from '@/lib/rate-limiter';
import { buildGeneratedPageUpdate } from '@/lib/page-state';
import { buildReferenceRow } from '@/lib/seo-planning';
import {
  fetchRecentFingerprints,
  replacePrimaryKeyword,
  selectRandomComponents,
  type SelectedComponents,
} from '@/lib/component-library';

config({ path: '.env.local' });

const bannedPhrases = [
  'groundbreaking',
  'game-changer',
  'unleash',
  'revolutionary',
  "in today's fast-paced world",
];

// Distinct editorial angles — one is deterministically assigned per page slug to
// prevent same-angle duplicate content across similar topics.
const CONTENT_ANGLES = [
  {
    id: 'beginner-first',
    label: 'Beginner-first',
    instruction:
      'Write for someone completely new to this topic. Lead with fundamentals, avoid jargon, build up progressively. Prioritise confidence-building over technical depth.',
  },
  {
    id: 'athlete-performance',
    label: 'Athlete performance',
    instruction:
      'Write for competitive athletes and high-performers. Lead with measurable performance outcomes. Use precise terminology and reference real training protocols and benchmarks.',
  },
  {
    id: 'science-deep-dive',
    label: 'Science deep-dive',
    instruction:
      'Lead with underlying physiology and research. Cite mechanisms, reference studies, and explain the "why" behind every recommendation. Readers are analytically inclined.',
  },
  {
    id: 'practical-quick-wins',
    label: 'Practical quick wins',
    instruction:
      'Lead with the 2–3 most immediately actionable steps. Frame everything around implementation, not theory. Use numbered steps and concrete timelines.',
  },
  {
    id: 'myth-busting',
    label: 'Myth-busting',
    instruction:
      'Open by naming the most common misconception about this topic. Debunk it with evidence, then present the more nuanced truth. Readers are skeptical and have seen conflicting advice.',
  },
  {
    id: 'cost-vs-benefit',
    label: 'Cost vs benefit',
    instruction:
      'Frame every recommendation through a cost-benefit lens — time, money, and effort vs. expected gain. Help readers make explicit trade-off decisions with clear numbers.',
  },
  {
    id: 'data-driven',
    label: 'Data-driven',
    instruction:
      'Lead with specific numbers, benchmarks, and metrics. Every claim should have a number attached. Use percentages, timeframes, and measurable thresholds throughout.',
  },
  {
    id: 'worst-case-avoidance',
    label: 'Worst-case avoidance',
    instruction:
      'Risk-first framing — open with what goes wrong when this is done incorrectly, the consequences, and how to avoid the most common failure modes. Readers are cautious and want safety.',
  },
  {
    id: 'comparison-focused',
    label: 'Comparison-focused',
    instruction:
      'Structure content primarily as a comparison. Multiple options, approaches, or products evaluated side-by-side with explicit winners called out for different use cases.',
  },
  {
    id: 'long-term-habit',
    label: 'Long-term habit building',
    instruction:
      'Focus on sustainability and habit formation rather than short-term results. Frame for people who have tried quick fixes and want something that sticks over months.',
  },
  {
    id: 'recoverystack-integration',
    label: 'RecoveryStack wearable integration',
    instruction:
      'Frame content around how this topic integrates with wearable technology and data-driven recovery tracking. Reference smart ring metrics, sleep scores, and HRV data naturally throughout.',
  },
  {
    id: 'elite-insider',
    label: 'Elite insider knowledge',
    instruction:
      'Write from the perspective of what elite coaches and sports scientists actually do vs. what mainstream sources recommend. Insider framing — "what most guides don\'t tell you".',
  },
] as const;

type ContentAngle = (typeof CONTENT_ANGLES)[number];

// News-specific editorial angles — assigned deterministically per slug.
// These are distinct from evergreen angles: they frame the story, not the reader profile.
const NEWS_CONTENT_ANGLES = [
  {
    id: 'breaking-analysis',
    label: 'Breaking analysis',
    instruction:
      'Lead with why this development matters right now. Frame the article around the immediate implications of the news — what it changes, what it means for the field, and what to watch next. Avoid excessive background; assume the reader is following the space.',
  },
  {
    id: 'research-translation',
    label: 'Research translation',
    instruction:
      'Bridge the gap between study findings and real-world application. Lead with the key finding, explain the methodology briefly, then translate the result into concrete guidance for athletes and coaches. Avoid jargon without explanation.',
  },
  {
    id: 'what-this-means-for-athletes',
    label: 'What this means for athletes',
    instruction:
      'Anchor every paragraph around practical impact on training, recovery, or performance. Open with "Here\'s what this means for your [training/recovery/sleep]" framing. Every development should be filtered through: "does this change what athletes should do tomorrow?"',
  },
  {
    id: 'counter-narrative',
    label: 'Counter-narrative',
    instruction:
      'Lead by identifying the dominant industry narrative around this topic, then present evidence or expert opinion that challenges or complicates it. This isn\'t contrarianism — it\'s honest journalism. Give the mainstream view fair coverage before presenting the counter-evidence.',
  },
  {
    id: 'expert-synthesis',
    label: 'Expert synthesis',
    instruction:
      'Synthesise what multiple experts or sources are saying about this development. Identify where they agree, where they diverge, and what remains unresolved. Structure the article as a landscape of expert opinion rather than a single authoritative take.',
  },
] as const;

type NewsContentAngle = (typeof NEWS_CONTENT_ANGLES)[number];

function pickContentAngle(slug: string, template?: string): ContentAngle | NewsContentAngle {
  // Deterministic per slug so retries use the same angle, but different slugs get different angles.
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash * 31) + slug.charCodeAt(i)) >>> 0;
  }
  if (template === 'news') {
    return NEWS_CONTENT_ANGLES[hash % NEWS_CONTENT_ANGLES.length];
  }
  return CONTENT_ANGLES[hash % CONTENT_ANGLES.length];
}

const verdictPrefixes = ['Best for:', 'Avoid if:', 'Bottom line:'] as const;

const BodySchema = z.object({
  comparison_table: z.object({ headers: z.array(z.string()), rows: z.array(z.array(z.string())) }).optional(),
  verdict: z.array(z.string()).length(3),
  sections: z.array(
    z.object({
      id: z.string(),
      heading: z.string(),
      kind: z.enum(['paragraphs', 'faq', 'steps', 'list', 'table', 'definition_box']),
      content: z.unknown(),
    }),
  ),
  faqs: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  key_takeaways: z.array(z.string()).max(6).optional(),
  references: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().url(),
        source: z.string().optional(),
        year: z.string().optional(),
      }),
    )
    .optional(),
  review_methodology: z
    .object({
      summary: z.string().optional(),
      tested: z.array(z.string()).optional(),
      scoring: z.array(z.string()).optional(),
      use_cases: z.array(z.string()).optional(),
    })
    .optional(),
  info_gain_feeds: z.record(z.string(), z.unknown()).optional(),
  newsroom_context: z.record(z.string(), z.unknown()).optional(),
  news_format: z.string().optional(),
});

const GeneratedSchema = z.object({
  intro: z.string().min(1),
  body_json: BodySchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type ProviderMode = 'auto' | 'openai' | 'ollama';
type TemplateRule = {
  minFaqs?: number;
  requiresComparisonSlots?: boolean;
  minChildLinks?: number;
};

const TEMPLATE_RULES: Record<string, TemplateRule> = {
  guides: { minFaqs: 4, requiresComparisonSlots: true },
  alternatives: { minFaqs: 4, requiresComparisonSlots: true },
  protocols: { minFaqs: 3 },
  metrics: { minFaqs: 3 },
  costs: { minFaqs: 3 },
  compatibility: { minFaqs: 3, requiresComparisonSlots: true },
  trends: { minFaqs: 3 },
  pillars: { minFaqs: 3, minChildLinks: 5 },
  reviews: { minFaqs: 5, requiresComparisonSlots: true },
  checklists: { minFaqs: 3 },
  news: { minFaqs: 3 },
};

const mode = (process.env.GENERATION_PROVIDER as ProviderMode | undefined) ?? 'auto';
const openaiModel = process.env.CODEX_MODEL ?? 'gpt-4o';
const ollamaPrimary = process.env.OLLAMA_MODEL_PRIMARY ?? 'qwen2.5:14b';
const ollamaFallback = process.env.OLLAMA_MODEL_FALLBACK ?? 'qwen2.5-coder:7b';
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const targetPageId = process.env.CONTENT_GENERATE_PAGE_ID?.trim();
const targetPageSlug = process.env.CONTENT_GENERATE_PAGE_SLUG?.trim();

function effectiveTemplateForPage(page: { template: string; metadata?: Record<string, unknown> | null }) {
  return typeof page.metadata?.desired_template_id === 'string'
    ? page.metadata.desired_template_id
    : page.template;
}

function includesBanned(text: string) {
  const lower = text.toLowerCase();
  return bannedPhrases.some((p) => lower.includes(p.toLowerCase()));
}

function wordCount(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function promptPathForTemplate(template: string) {
  const byTemplate: Record<string, string> = {
    guides: 'comparison.md',
    alternatives: 'alternative.md',
    protocols: 'protocol.md',
    metrics: 'metric.md',
    costs: 'cost.md',
    compatibility: 'compatibility.md',
    trends: 'trends.md',
    pillars: 'pillar.md',
    reviews: 'review.md',
    checklists: 'checklist.md',
    news: 'news.md',
  };
  return join(process.cwd(), 'content-prompts', byTemplate[template] ?? 'comparison.md');
}

// Shared E-E-A-T partial — loaded once and injected into every prompt
let eeaPartialCache: string | null = null;
function loadEeatPartial(): string {
  if (eeaPartialCache != null) return eeaPartialCache;
  const partialPath = join(process.cwd(), 'content-prompts', '_eeat-partial.md');
  try {
    eeaPartialCache = readFileSync(partialPath, 'utf8');
  } catch {
    console.warn('[content-generator] _eeat-partial.md not found — E-E-A-T rules will be omitted');
    eeaPartialCache = '';
  }
  return eeaPartialCache;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const source = fenced?.[1]?.trim() || trimmed;

  const firstBrace = source.indexOf('{');
  if (firstBrace < 0) {
    throw new Error('No JSON object found in model response');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = firstBrace; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = source.slice(firstBrace, i + 1);
        return JSON.parse(candidate);
      }
    }
  }

  throw new Error('Could not find a complete JSON object in model response');
}

function normalizeGeneratedPayload(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;

  const root = { ...(input as Record<string, unknown>) };
  const body = {
    ...((root.body_json && typeof root.body_json === 'object' ? root.body_json : {}) as Record<string, unknown>),
  };

  const comparisonTable = body.comparison_table;
  if (Array.isArray(comparisonTable)) {
    if (comparisonTable.length > 0 && Array.isArray(comparisonTable[0])) {
      const rows = comparisonTable as unknown[];
      body.comparison_table = {
        headers: (rows[0] as unknown[]).map((cell) => String(cell ?? '')),
        rows: rows.slice(1).map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [String(row ?? '')])),
      };
    } else {
      const tableRows = comparisonTable.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row));
      if (tableRows.length) {
        const headers = Object.keys(tableRows[0]);
        body.comparison_table = {
          headers,
          rows: tableRows.map((row) => headers.map((h) => String((row as Record<string, unknown>)[h] ?? ''))),
        };
      }
    }
  }

  const faqs = body.faqs;
  if (Array.isArray(faqs)) {
    body.faqs = faqs
      .map((item) => {
        if (typeof item === 'string') {
          const q = item.includes('?') ? `${item.split('?')[0]}?` : item;
          const a = item.includes('?') ? item.split('?').slice(1).join('?').trim() : item;
          return { q: q.trim(), a: (a || 'Answer pending.').trim() };
        }

        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const q = String(obj.q ?? obj.question ?? '').trim();
          const a = String(obj.a ?? obj.answer ?? '').trim();
          if (!q && !a) return null;
          return { q: q || 'Common question', a: a || 'Answer pending.' };
        }

        return null;
      })
      .filter((x): x is { q: string; a: string } => Boolean(x));
  }

  if (!Array.isArray(body.sections)) {
    body.sections = [
      {
        id: 'overview',
        heading: 'Overview',
        kind: 'paragraphs',
        content: ['Practical guidance focused on implementation, trade-offs, and outcomes.'],
      },
    ];
  }

  if (!Array.isArray(body.verdict) || body.verdict.length < 3) {
    body.verdict = [
      'Best for: athletes who need practical recovery guidance',
      'Avoid if: you want one-size-fits-all advice',
      'Bottom line: use this as a baseline and personalize based on response',
    ];
  }

  if (Array.isArray(body.key_takeaways)) {
    body.key_takeaways = body.key_takeaways.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 4);
  }

  if (Array.isArray(body.references)) {
    body.references = body.references
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        const title = String(row.title ?? row.name ?? '').trim();
        const url = String(row.url ?? row.link ?? '').trim();
        const source = String(row.source ?? row.publisher ?? '').trim();
        const year = String(row.year ?? row.date ?? '').trim();
        if (!title || !url) return null;
        return { title, url, ...(source ? { source } : {}), ...(year ? { year } : {}) };
      })
      .filter(Boolean);
  }

  root.body_json = body;
  return root;
}

function normalizeLayoutToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function applyLayoutOrder(
  sections: Array<z.infer<typeof BodySchema>['sections'][number]>,
  layoutOrder: string[],
) {
  if (!layoutOrder.length) return sections;

  const sectionByKey = new Map<string, (typeof sections)[number]>();
  for (const section of sections) {
    sectionByKey.set(normalizeLayoutToken(section.id), section);
    sectionByKey.set(normalizeLayoutToken(section.heading), section);
  }

  const used = new Set<string>();
  const ordered: typeof sections = [];

  for (const token of layoutOrder) {
    const match = sectionByKey.get(normalizeLayoutToken(token));
    if (!match || used.has(match.id)) continue;
    ordered.push(match);
    used.add(match.id);
  }

  for (const section of sections) {
    if (!used.has(section.id)) ordered.push(section);
  }

  return ordered;
}

function deterministicChecks(template: string, content: z.infer<typeof GeneratedSchema>): string[] {
  const errors: string[] = [];
  const rule = TEMPLATE_RULES[template] ?? {};

  if (wordCount(content.intro) > 60) {
    errors.push('intro must be 60 words or fewer');
  }

  const verdict = content.body_json.verdict;
  for (let i = 0; i < verdictPrefixes.length; i += 1) {
    if (!verdict[i]?.trim().startsWith(verdictPrefixes[i])) {
      errors.push(`verdict[${i}] must start with '${verdictPrefixes[i]}'`);
    }
  }

  if (rule.minFaqs != null) {
    const faqCount = content.body_json.faqs?.length ?? 0;
    if (faqCount < rule.minFaqs) {
      errors.push(`faqs must include at least ${rule.minFaqs} items for template '${template}'`);
    }
  }

  if (rule.requiresComparisonSlots) {
    const table = content.body_json.comparison_table;
    if (!table) {
      errors.push(`comparison_table is required for template '${template}'`);
    } else {
      if (table.headers.length < 3) {
        errors.push('comparison_table.headers must include at least 3 columns');
      }

      if (table.rows.length < 4) {
        errors.push('comparison_table.rows must include at least 4 comparison slots');
      }

      const flat = [...table.headers, ...table.rows.flat()].join(' ').toLowerCase();
      if (!flat.includes('recoverystack smart ring')) {
        errors.push("comparison_table must include 'RecoveryStack Smart Ring' as a slot");
      }

      if (!flat.includes('competitor') && !flat.includes('alternative')) {
        errors.push("comparison_table must include a competitor/alternative slot");
      }
    }
  }

  // Pillar child-link requirement: the body must mention enough child-page links
  if (rule.minChildLinks != null) {
    const allText = [content.intro, ...content.body_json.sections.map((s) => JSON.stringify(s.content))].join(' ');
    // Count markdown-style or inline links — heuristic: count occurrences of "/" path references
    // The real check happens in publish-guards validateInternalLinks; here we check the generated body
    const linkMatches = allText.match(/\/(?:guides|alternatives|protocols|metrics|costs|compatibility|trends)\/[\w-]+/g) ?? [];
    const uniqueLinks = new Set(linkMatches);
    if (uniqueLinks.size < rule.minChildLinks) {
      errors.push(`pillar body must reference at least ${rule.minChildLinks} child-page links (found ${uniqueLinks.size})`);
    }
  }

  const ctaCounts = countRequiredCtaMentions(content);
  (Object.keys(ctaCounts) as Array<keyof typeof ctaCounts>).forEach((keyword) => {
    const count = ctaCounts[keyword];
    if (count !== 1) {
      errors.push(`required CTA mention '${keyword}' must appear exactly once (found ${count})`);
    }
  });

  if ((template === 'reviews' || template === 'alternatives') && !content.body_json.review_methodology) {
    errors.push(`review_methodology is required for template '${template}'`);
  }

  if (template === 'news') {
    const headings = content.body_json.sections.map((section) => section.heading.toLowerCase());
    if (!headings.some((heading) => heading.includes("don't know") || heading.includes('do not know'))) {
      errors.push(`news pages must include a "What we don't know yet" section`);
    }
  }

  return errors;
}

async function callOpenAI(prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  await rateLimit('openai');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2400,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content;

  if (!text || typeof text !== 'string') throw new Error('OpenAI response did not include output text');
  return text;
}

async function callOllama(prompt: string, model: string) {
  await rateLimit('ollama');
  const res = await fetch(`${ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: 0.3 },
    }),
  });

  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const text = json?.message?.content;
  if (!text || typeof text !== 'string') throw new Error('Ollama response missing message.content');
  return text;
}

async function generateWithBestAvailable(prompt: string) {
  if (mode === 'openai') return callOpenAI(prompt);

  if (mode === 'ollama') {
    try {
      return await callOllama(prompt, ollamaPrimary);
    } catch {
      return callOllama(prompt, ollamaFallback);
    }
  }

  // auto mode: prefer Codex when key exists, fallback to local models on quota/rate/any failure
  if (process.env.OPENAI_API_KEY) {
    try {
      return await callOpenAI(prompt);
    } catch {
      try {
        return await callOllama(prompt, ollamaPrimary);
      } catch {
        return callOllama(prompt, ollamaFallback);
      }
    }
  }

  try {
    return await callOllama(prompt, ollamaPrimary);
  } catch {
    return callOllama(prompt, ollamaFallback);
  }
}

async function canReach(url: string) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureGenerationProviderAvailable() {
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
  const hasOllama = await canReach(`${ollamaBaseUrl}/api/tags`);

  if (mode === 'openai' && !hasOpenAiKey) {
    throw new Error('GENERATION_PROVIDER=openai but OPENAI_API_KEY is missing');
  }

  if (mode === 'ollama' && !hasOllama) {
    throw new Error(`GENERATION_PROVIDER=ollama but Ollama is unavailable at ${ollamaBaseUrl}`);
  }

  if (mode === 'auto' && !hasOpenAiKey && !hasOllama) {
    throw new Error(`No generation provider available. OPENAI_API_KEY is missing and Ollama is unavailable at ${ollamaBaseUrl}`);
  }
}

async function loadPagesForGeneration() {
  let query = supabase.from('pages').select('*');

  if (targetPageId) {
    query = query.eq('id', targetPageId).in('status', ['draft', 'approved', 'published']);
  } else if (targetPageSlug) {
    query = query.eq('slug', targetPageSlug).in('status', ['draft', 'approved', 'published']);
  } else {
    query = query.eq('status', 'draft').limit(20);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// Semaphore for parallel generation — limits concurrent LLM calls
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY ?? 3));

async function processPage(page: Awaited<ReturnType<typeof loadPagesForGeneration>>[number], products: unknown[]) {
    const effectiveTemplate = effectiveTemplateForPage(page);
    const promptTemplate = readFileSync(promptPathForTemplate(effectiveTemplate), 'utf8');
    const [gapResult, briefResult, queryTargetsResult, sourceReferencesResult, visualAssetsResult, storylineResult, storyEventsResult, storyEntitiesResult] = await Promise.all([
      supabase
        .from('content_gaps')
        .select('*')
        .eq('page_slug', page.slug)
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('briefs')
        .select('*')
        .eq('page_slug', page.slug)
        .single<{
          target_word_count: number | null;
          required_subtopics: string[];
          required_paa_answers: string[];
          competitor_weaknesses: string[];
          search_volume: number | null;
          keyword_difficulty: number | null;
        }>(),
      supabase
        .from('page_query_targets')
        .select('query,intent,priority,search_volume,keyword_difficulty,is_primary,source')
        .eq('page_id', page.id)
        .order('priority', { ascending: false })
        .limit(20),
      supabase
        .from('page_source_references')
        .select('title,url,source_domain,source_type,authority_score,evidence_level,published_at')
        .eq('page_id', page.id)
        .order('authority_score', { ascending: false })
        .limit(12),
      supabase
        .from('page_visual_assets')
        .select('asset_kind,purpose,sort_order,alt_text,metadata')
        .eq('page_id', page.id)
        .order('sort_order', { ascending: true })
        .limit(10),
      effectiveTemplate === 'news' && page.storyline_id
        ? supabase
            .from('storylines')
            .select('id,slug,title,beat,storyline_type,status,authority_score,freshness_score,update_count,summary,latest_event_at,metadata')
            .eq('id', page.storyline_id)
            .single()
        : Promise.resolve({ data: null, error: null } as any),
      effectiveTemplate === 'news' && page.storyline_id
        ? supabase
            .from('storyline_events')
            .select(`
              significance_score,
              news_source_events (
                id,title,summary,url,source_domain,published_at,event_type,relevance_score,authority_score,freshness_score,beat,extraction,metadata
              )
            `)
            .eq('storyline_id', page.storyline_id)
            .order('significance_score', { ascending: false })
            .limit(6)
        : Promise.resolve({ data: [], error: null } as any),
      effectiveTemplate === 'news' && page.storyline_id
        ? supabase
            .from('storylines')
            .select(`
              canonical_entity_id,
              topic_entities!storylines_canonical_entity_id_fkey (
                id,slug,canonical_name,entity_type,beat,authority_score,confidence_score,metadata
              )
            `)
            .eq('id', page.storyline_id)
            .single()
        : Promise.resolve({ data: null, error: null } as any),
    ]);
    const gapRows = gapResult.data;
    const brief = briefResult.data;
    const queryTargets = queryTargetsResult.data ?? [];
    const sourceReferences = sourceReferencesResult.data ?? [];
    const visualAssets = visualAssetsResult.data ?? [];
    const storyline = storylineResult.data ?? null;
    const storyEvents = (storyEventsResult.data ?? [])
      .map((row: any) => row.news_source_events ? { ...row.news_source_events, significance_score: row.significance_score } : null)
      .filter(Boolean);
    const storyEntities = storyEntitiesResult.data?.topic_entities ? [storyEntitiesResult.data.topic_entities] : [];
    const newsroomContext = effectiveTemplate === 'news'
      ? buildNewsroomContext({ storyline, sourceEvents: storyEvents, entities: storyEntities })
      : null;

    const rule = TEMPLATE_RULES[effectiveTemplate] ?? {};
    const targetWordCount = Number(page.metadata?.target_word_count ?? brief?.target_word_count ?? 1400);

    let attempts = 0;
    let valid = false;
    const attemptErrors: string[] = [];

    const recentFingerprints = await fetchRecentFingerprints(supabase, 5);
    const contentAngle = pickContentAngle(page.slug, effectiveTemplate);

    while (attempts < 4 && !valid) {
      attempts += 1;

      const selectedComponents: SelectedComponents = await selectRandomComponents({
        supabase,
        template: effectiveTemplate,
        primaryKeyword: page.primary_keyword ?? '',
        recentFingerprints,
      });

      const prompt = [
        promptTemplate,
        `Template: ${effectiveTemplate}`,
        `Title: ${page.title}`,
        `Primary keyword: ${page.primary_keyword ?? ''}`,
        `## Content Angle (MANDATORY — uniquely differentiates this page from similar pages on the site)\nAngle: ${contentAngle.label}\nDirective: ${contentAngle.instruction}\nApply this angle consistently from the intro through the verdict. This is what makes this page's perspective distinct from other pages covering the same keyword.`,
        'Return ONLY valid JSON. Do not include markdown fences.',
        'Output schema must be exactly: {"intro":"string <=60 words","body_json":{"comparison_table?":{},"verdict":["Best for: ...","Avoid if: ...","Bottom line: ..."],"key_takeaways?":["..."],"sections":[],"faqs?":[],"references?":[{"title":"...","url":"https://...","source":"...","year":"..."}],"review_methodology?":{"summary":"...","tested":["..."],"scoring":["..."],"use_cases":["..."}],"news_format?":"string"},"metadata?":{"news_format?":"string","published_date?":"YYYY-MM-DD"}}',
        'Verdict is mandatory with exactly 3 bullets in this order: Best for, Avoid if, Bottom line.',
        'Include 3-4 concise key_takeaways.',
        'Whenever evidence is referenced, include source URLs in body_json.references.',
        `For ${effectiveTemplate} pages, include a substantive review_methodology object when the topic is evaluative or comparative.`,
        `If FAQs are included for this template, minimum FAQ count is ${rule.minFaqs ?? 0}.`,
        `Comparison slots required for this template: ${rule.requiresComparisonSlots ? 'yes' : 'no'}.`,
        `Target word count: at least ${targetWordCount} words of unique, useful content.`,
        `Target query coverage count: ${queryTargets.length}. Cover the priority intents rather than repeating the same point.`,
        'Mention RecoveryStack Smart Ring exactly once, newsletter exactly once, free PDF exactly once in natural context.',
        '',
        loadEeatPartial(),
        '',
        `Selected intro hook component JSON: ${JSON.stringify(selectedComponents.introHook.content)}`,
        `Selected verdict style component JSON: ${JSON.stringify(selectedComponents.verdictStyle.content)}`,
        `Selected newsletter offer component JSON: ${JSON.stringify(selectedComponents.newsletterOffer.content)}`,
        `Selected layout pattern component JSON: ${JSON.stringify(selectedComponents.layoutPattern.content)}`,
        `Required section layout order: ${JSON.stringify(selectedComponents.layoutOrder)}`,
        `SERP gap JSON: ${JSON.stringify(gapRows?.[0] ?? {})}`,
        `Query coverage plan JSON: ${JSON.stringify(queryTargets)}`,
        `High-authority sources to cite JSON: ${JSON.stringify(sourceReferences)}`,
        `Visual asset plan JSON: ${JSON.stringify(visualAssets)}`,
        ...(effectiveTemplate === 'news'
          ? [
              `Storyline context JSON: ${JSON.stringify(storyline ?? {})}`,
              `Recent source events JSON: ${JSON.stringify(storyEvents)}`,
              `Canonical entities JSON: ${JSON.stringify(storyEntities)}`,
              'For news pages, synthesize what changed, why it matters now, and what remains unknown from the supplied source events.',
            ]
          : []),
        // Feed People Also Ask questions for FAQ optimization
        ...(gapRows?.[0]?.serp_snapshot?.people_also_ask?.length
          ? [
              '## People Also Ask (optimize FAQs for these real search queries)',
              ...((gapRows[0].serp_snapshot as any).people_also_ask as Array<{ question: string; snippet?: string }>).map(
                (paa: { question: string; snippet?: string }, i: number) =>
                  `PAA ${i + 1}: "${paa.question}"${paa.snippet ? ` — Context: ${paa.snippet.slice(0, 120)}` : ''}`,
              ),
              'Use these PAA questions as the basis for your FAQ section. Answer each in 40-80 words with practical, evidence-based responses.',
            ]
          : []),
        `Product specs JSON: ${JSON.stringify(products ?? [])}`,
        // Inject brief data when available
        ...(brief
          ? [
              '',
              '## Content Brief (FOLLOW THESE REQUIREMENTS)',
              `Target word count: ${brief.target_word_count ?? 1200} words (beat competitors by 20%)`,
              brief.required_subtopics.length > 0
                ? `Required subtopics to cover: ${brief.required_subtopics.join(', ')}`
                : '',
              brief.required_paa_answers.length > 0
                ? `Required PAA answers (must address ALL of these): ${brief.required_paa_answers.join(' | ')}`
                : '',
              brief.competitor_weaknesses.length > 0
                ? `Competitor weaknesses to exploit (cover what they miss): ${brief.competitor_weaknesses.join(' | ')}`
                : '',
            ].filter(Boolean)
          : []),
      ].join('\n\n');

      const text = await generateWithBestAvailable(prompt);
      if (includesBanned(text)) {
        attemptErrors.push(`attempt ${attempts}: generated banned phrase`);
        continue;
      }

      try {
        const parsed = extractJsonObject(text);
        const normalized = normalizeGeneratedPayload(parsed);
        const generated = GeneratedSchema.parse(normalized);

        const intro = replacePrimaryKeyword(generated.intro, page.primary_keyword ?? '');
        const bodyWithKeyword = replacePrimaryKeyword(generated.body_json, page.primary_keyword ?? '');
        const orderedSections = applyLayoutOrder(bodyWithKeyword.sections, selectedComponents.layoutOrder);

        const infoFeeds = await collectInfoGainFeeds(page.primary_keyword ?? page.title ?? '');
        const feedSections = buildInfoFeedSections(infoFeeds);

        const enrichedBody = {
          ...bodyWithKeyword,
          sections: [...orderedSections, ...feedSections],
          ...(newsroomContext ? { newsroom_context: newsroomContext } : {}),
          ...(Object.keys(infoFeeds).length > 0 ? { info_gain_feeds: infoFeeds } : {}),
          generation_metadata: {
            component_ids: {
              intro_hook: selectedComponents.introHook.id,
              verdict_style: selectedComponents.verdictStyle.id,
              newsletter_offer: selectedComponents.newsletterOffer.id,
              layout_pattern: selectedComponents.layoutPattern.id,
            },
            layout_order: selectedComponents.layoutOrder,
            layout_fingerprint: selectedComponents.fingerprint,
            info_feed_sections_added: feedSections.length,
          },
        };

        const enriched = {
          intro,
          body_json: enrichedBody,
          metadata: generated.metadata,
        };

        const structuralErrors = deterministicChecks(effectiveTemplate, enriched as z.infer<typeof GeneratedSchema>);
        if (structuralErrors.length > 0) {
          attemptErrors.push(`attempt ${attempts}: ${structuralErrors.join('; ')}`);
          continue;
        }

        // Save current content as a revision before overwriting
        if (page.intro || page.body_json) {
          const { saveRevision } = await import('@/lib/page-revisions');
          await saveRevision(page.id, page.slug, page.intro ?? null, page.body_json, 'batch_generate');
        }

        const pageUpdate = buildGeneratedPageUpdate(page as any, enriched.intro, enriched.body_json as any);

        // Assign a named author to news pages for E-E-A-T
        const NEWS_AUTHORS = [
          { slug: 'dr-sarah-chen', name: 'Dr. Sarah Chen', title: 'Sports Scientist & Sleep Research Lead' },
          { slug: 'marcus-webb', name: 'Marcus Webb', title: 'Performance Technology Editor' },
          { slug: 'lena-kowalski', name: 'Lena Kowalski', title: 'Clinical Exercise Physiologist' },
        ];
        let authorMeta: Record<string, string> = {};
        if (effectiveTemplate === 'news') {
          let authorHash = 0;
          for (let i = 0; i < page.slug.length; i++) {
            authorHash = ((authorHash * 31) + page.slug.charCodeAt(i)) >>> 0;
          }
          const assignedAuthor = NEWS_AUTHORS[authorHash % NEWS_AUTHORS.length];
          authorMeta = {
            author_slug: assignedAuthor.slug,
            author_name: assignedAuthor.name,
            author_title: assignedAuthor.title,
          };
        }

        // Extract news_format from generated body if present
        const newsFormat = typeof (enriched.body_json as any).news_format === 'string'
          ? (enriched.body_json as any).news_format
          : typeof generated.metadata?.news_format === 'string'
            ? generated.metadata.news_format
          : null;

        const mergedMetadata = {
          ...(pageUpdate.metadata ?? {}),
          content_angle: contentAngle.id,
          content_angle_label: contentAngle.label,
          ...(effectiveTemplate === 'news'
            ? {
                source_diversity: Array.from(new Set(storyEvents.map((event: any) => event.source_domain).filter(Boolean))).length,
                news_significance_score: storyEvents.length
                  ? Math.round(
                      storyEvents.reduce((sum: number, event: any) => sum + Number(event.significance_score ?? event.relevance_score ?? 0), 0)
                        / storyEvents.length,
                    )
                  : null,
              }
            : {}),
          ...(generated.metadata ?? {}),
          ...authorMeta,
        };

        const extraColumns: Record<string, unknown> = {};
        if (effectiveTemplate === 'news') {
          extraColumns.content_type = 'news';
          if (newsFormat) extraColumns.news_format = newsFormat;
          if (storyline?.beat) extraColumns.beat = storyline.beat;
          if (storyline?.freshness_score != null) {
            extraColumns.freshness_tier = storyline.freshness_score >= 85 ? 'breaking' : storyline.freshness_score >= 70 ? 'active' : 'monitoring';
          }
          extraColumns.story_status = storyline?.status ?? 'active';
          extraColumns.last_verified_at = new Date().toISOString();
        }

        const { error: pageUpdateError } = await supabase
          .from('pages')
          .update({ ...pageUpdate, metadata: mergedMetadata, ...extraColumns })
          .eq('id', page.id);

        if (pageUpdateError) {
          throw pageUpdateError;
        }

        const generatedReferences = (enriched.body_json.references ?? [])
          .filter((reference) => reference?.title && reference?.url)
          .map((reference) =>
            buildReferenceRow(page.id, page.slug, {
              title: reference.title,
              url: reference.url,
              source_type: 'generated_reference',
              evidence_level: 'supporting',
              published_at: reference.year ?? null,
              metadata: {
                source: reference.source ?? null,
              },
            }),
          );

        if (generatedReferences.length > 0) {
          await supabase.from('page_source_references').upsert(generatedReferences, {
            onConflict: 'page_id,url',
          });
        }

        if (effectiveTemplate === 'news' && page.storyline_id) {
          await supabase.from('page_storylines').upsert(
            {
              page_id: page.id,
              storyline_id: page.storyline_id,
              relationship_type: 'primary_coverage',
            },
            { onConflict: 'page_id,storyline_id,relationship_type' },
          );

          await supabase.from('page_update_log').insert({
            page_id: page.id,
            page_slug: page.slug,
            update_type: page.published_at ? 'story_refresh' : 'initial_story_publication',
            reason: 'content_generator_newsroom_context',
            summary: newsroomContext?.story_summary ?? page.title,
            source_event_id: storyEvents[0]?.id ?? page.source_event_id ?? null,
            storyline_id: page.storyline_id,
          });
        }

        // Generate hero image and patch metadata (async, non-blocking for fingerprint)
        try {
          const { generatePageHeroImage } = await import('@/lib/image-generator');
          const heroUrl = await generatePageHeroImage(page.title, effectiveTemplate, page.primary_keyword ?? page.title);
          if (heroUrl) {
            await supabase
              .from('pages')
              .update({
                metadata: {
                  ...mergedMetadata,
                  hero_image: heroUrl,
                  hero_image_alt: `${page.title} illustration`,
                },
              })
              .eq('id', page.id);

            await supabase
              .from('page_visual_assets')
              .upsert({
                page_id: page.id,
                page_slug: page.slug,
                asset_kind: 'hero',
                purpose: 'hero',
                image_url: heroUrl,
                alt_text: `${page.title} illustration`,
                width: 1792,
                height: 1024,
                status: 'ready',
                sort_order: 0,
                metadata: { generated_by: 'content-generator' },
              }, {
                onConflict: 'page_id,asset_kind,sort_order',
              } as any);
          }
        } catch (imgErr) {
          console.warn(`[content-generator] Hero image generation failed for ${page.slug}:`, imgErr instanceof Error ? imgErr.message : String(imgErr));
        }

        const { error: fingerprintError } = await supabase.from('generated_page_fingerprints').insert({
          page_id: page.id,
          page_slug: page.slug,
          template: effectiveTemplate,
          fingerprint: selectedComponents.fingerprint,
          component_ids: {
            intro_hook: selectedComponents.introHook.id,
            verdict_style: selectedComponents.verdictStyle.id,
            newsletter_offer: selectedComponents.newsletterOffer.id,
            layout_pattern: selectedComponents.layoutPattern.id,
          },
          layout_order: selectedComponents.layoutOrder,
        });

        if (fingerprintError) {
          throw fingerprintError;
        }

        valid = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attemptErrors.push(`attempt ${attempts}: ${message}`);
      }
    }

    if (!valid) {
      console.error(`Failed to generate page '${page.slug}' (${effectiveTemplate}) after ${attempts} attempts:`);
      attemptErrors.forEach((err) => console.error(`  - ${err}`));
    }
}

async function run() {
  await ensureGenerationProviderAvailable();
  const pages = await loadPagesForGeneration();
  const { data: products } = await supabase.from('products').select('*');

  console.log(`[content-generator] Starting generation: ${pages.length} page(s), concurrency=${CONCURRENCY}`);

  // Process pages in parallel with a semaphore to limit concurrent LLM calls
  let active = 0;
  let next = 0;

  await new Promise<void>((resolve) => {
    function dispatch() {
      while (active < CONCURRENCY && next < pages.length) {
        const page = pages[next++];
        active++;
        processPage(page, products ?? []).finally(() => {
          active--;
          if (active === 0 && next >= pages.length) resolve();
          else dispatch();
        });
      }
      if (active === 0 && next >= pages.length) resolve();
    }
    dispatch();
  });

  console.log(
    `Generation pass complete. pages=${pages.length} targetPageId=${targetPageId ?? ''} targetPageSlug=${targetPageSlug ?? ''} provider=${mode} openaiModel=${openaiModel} ollamaPrimary=${ollamaPrimary} concurrency=${CONCURRENCY}`,
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
