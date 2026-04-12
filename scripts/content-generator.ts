import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { countRequiredCtaMentions } from '@/lib/publish-guards';
import { buildInfoFeedSections, collectInfoGainFeeds } from '@/lib/info-gain-feeds';
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

const verdictPrefixes = ['Best for:', 'Avoid if:', 'Bottom line:'] as const;

const BodySchema = z.object({
  comparison_table: z.object({ headers: z.array(z.string()), rows: z.array(z.array(z.string())) }).optional(),
  verdict: z.array(z.string()).length(3),
  sections: z.array(
    z.object({
      id: z.string(),
      heading: z.string(),
      kind: z.enum(['paragraphs', 'faq', 'steps', 'list', 'table']),
      content: z.unknown(),
    }),
  ),
  faqs: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  info_gain_feeds: z.record(z.string(), z.unknown()).optional(),
});

const GeneratedSchema = z.object({
  intro: z.string().min(1),
  body_json: BodySchema,
});

type ProviderMode = 'auto' | 'openai' | 'ollama';
type TemplateRule = {
  minFaqs?: number;
  requiresComparisonSlots?: boolean;
};

const TEMPLATE_RULES: Record<string, TemplateRule> = {
  guides: { minFaqs: 4, requiresComparisonSlots: true },
  alternatives: { minFaqs: 4, requiresComparisonSlots: true },
  protocols: { minFaqs: 3 },
  metrics: { minFaqs: 3 },
  costs: { minFaqs: 3 },
  compatibility: { minFaqs: 3, requiresComparisonSlots: true },
  trends: { minFaqs: 3 },
  pillars: {},
};

const mode = (process.env.GENERATION_PROVIDER as ProviderMode | undefined) ?? 'auto';
const openaiModel = process.env.CODEX_MODEL ?? 'gpt-4o';
const ollamaPrimary = process.env.OLLAMA_MODEL_PRIMARY ?? 'qwen2.5:14b';
const ollamaFallback = process.env.OLLAMA_MODEL_FALLBACK ?? 'qwen2.5-coder:7b';
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const targetPageId = process.env.CONTENT_GENERATE_PAGE_ID?.trim();
const targetPageSlug = process.env.CONTENT_GENERATE_PAGE_SLUG?.trim();

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
  };
  return join(process.cwd(), 'content-prompts', byTemplate[template] ?? 'comparison.md');
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

  const ctaCounts = countRequiredCtaMentions(content);
  (Object.keys(ctaCounts) as Array<keyof typeof ctaCounts>).forEach((keyword) => {
    const count = ctaCounts[keyword];
    if (count !== 1) {
      errors.push(`required CTA mention '${keyword}' must appear exactly once (found ${count})`);
    }
  });

  return errors;
}

async function callOpenAI(prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

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

async function loadPagesForGeneration() {
  let query = supabase.from('pages').select('*');

  if (targetPageId) {
    query = query.eq('id', targetPageId).in('status', ['draft', 'published']);
  } else if (targetPageSlug) {
    query = query.eq('slug', targetPageSlug).in('status', ['draft', 'published']);
  } else {
    query = query.eq('status', 'draft').limit(20);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function run() {
  const pages = await loadPagesForGeneration();
  const { data: products } = await supabase.from('products').select('*');

  for (const page of pages) {
    const promptTemplate = readFileSync(promptPathForTemplate(page.template), 'utf8');
    const { data: gapRows } = await supabase
      .from('content_gaps')
      .select('*')
      .eq('page_slug', page.slug)
      .order('created_at', { ascending: false })
      .limit(1);

    const rule = TEMPLATE_RULES[page.template] ?? {};

    let attempts = 0;
    let valid = false;
    const attemptErrors: string[] = [];

    const recentFingerprints = await fetchRecentFingerprints(supabase, 5);

    while (attempts < 4 && !valid) {
      attempts += 1;

      const selectedComponents: SelectedComponents = await selectRandomComponents({
        supabase,
        template: page.template,
        primaryKeyword: page.primary_keyword ?? '',
        recentFingerprints,
      });

      const prompt = [
        promptTemplate,
        `Template: ${page.template}`,
        `Title: ${page.title}`,
        `Primary keyword: ${page.primary_keyword ?? ''}`,
        'Return ONLY valid JSON. Do not include markdown fences.',
        'Output schema must be exactly: {"intro":"string <=60 words","body_json":{"comparison_table?":{},"verdict":["Best for: ...","Avoid if: ...","Bottom line: ..."],"sections":[],"faqs?":[]}}',
        'Verdict is mandatory with exactly 3 bullets in this order: Best for, Avoid if, Bottom line.',
        `If FAQs are included for this template, minimum FAQ count is ${rule.minFaqs ?? 0}.`,
        `Comparison slots required for this template: ${rule.requiresComparisonSlots ? 'yes' : 'no'}.`,
        'Mention RecoveryStack Smart Ring exactly once, newsletter exactly once, free PDF exactly once in natural context.',
        '',
        '## E-E-A-T content quality rules',
        '- Include at least 1 specific citation (author/year or named standard) in the body sections.',
        '- Add a "How we tested" or "Methodology" section when template is guides, alternatives, or compatibility.',
        '- Reference first-hand testing experience with specific numbers (days tested, metrics observed, firmware versions).',
        '- Include a "Last reviewed: [current month year]" line in the intro or first section.',
        '- For protocols and metrics templates, add a brief medical disclaimer.',
        '- Attribute expert-level claims to named organizations or published research.',
        '- In FAQs, ground answers in evidence rather than opinion.',
        '',
        `Selected intro hook component JSON: ${JSON.stringify(selectedComponents.introHook.content)}`,
        `Selected verdict style component JSON: ${JSON.stringify(selectedComponents.verdictStyle.content)}`,
        `Selected newsletter offer component JSON: ${JSON.stringify(selectedComponents.newsletterOffer.content)}`,
        `Selected layout pattern component JSON: ${JSON.stringify(selectedComponents.layoutPattern.content)}`,
        `Required section layout order: ${JSON.stringify(selectedComponents.layoutOrder)}`,
        `SERP gap JSON: ${JSON.stringify(gapRows?.[0] ?? {})}`,
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
        };

        const structuralErrors = deterministicChecks(page.template, enriched as z.infer<typeof GeneratedSchema>);
        if (structuralErrors.length > 0) {
          attemptErrors.push(`attempt ${attempts}: ${structuralErrors.join('; ')}`);
          continue;
        }

        const { error: pageUpdateError } = await supabase
          .from('pages')
          .update({
            intro: enriched.intro,
            body_json: enriched.body_json,
            status: 'published',
            published_at: new Date().toISOString(),
          })
          .eq('id', page.id);

        if (pageUpdateError) {
          throw pageUpdateError;
        }

        const { error: fingerprintError } = await supabase.from('generated_page_fingerprints').insert({
          page_id: page.id,
          page_slug: page.slug,
          template: page.template,
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
      console.error(`Failed to generate page '${page.slug}' (${page.template}) after ${attempts} attempts:`);
      attemptErrors.forEach((err) => console.error(`  - ${err}`));
    }
  }

  console.log(
    `Generation pass complete. pages=${pages.length} targetPageId=${targetPageId ?? ''} targetPageSlug=${targetPageSlug ?? ''} provider=${mode} openaiModel=${openaiModel} ollamaPrimary=${ollamaPrimary}`,
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
