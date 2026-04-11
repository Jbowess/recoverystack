import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { countRequiredCtaMentions } from '@/lib/publish-guards';

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
const openaiModel = process.env.CODEX_MODEL ?? 'gpt-5.3-codex';
const ollamaPrimary = process.env.OLLAMA_MODEL_PRIMARY ?? 'qwen2.5:14b';
const ollamaFallback = process.env.OLLAMA_MODEL_FALLBACK ?? 'qwen2.5-coder:7b';
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

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

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      max_output_tokens: 2400,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const text =
    json?.output_text ??
    json?.output?.flatMap((o: any) => o?.content ?? []).find((c: any) => c?.type === 'output_text')?.text;

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

async function run() {
  const { data: drafts } = await supabase.from('pages').select('*').eq('status', 'draft').limit(20);
  const { data: products } = await supabase.from('products').select('*');

  for (const page of drafts ?? []) {
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

    while (attempts < 4 && !valid) {
      attempts += 1;
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
        `SERP gap JSON: ${JSON.stringify(gapRows?.[0] ?? {})}`,
        `Product specs JSON: ${JSON.stringify(products ?? [])}`,
      ].join('\n\n');

      const text = await generateWithBestAvailable(prompt);
      if (includesBanned(text)) {
        attemptErrors.push(`attempt ${attempts}: generated banned phrase`);
        continue;
      }

      try {
        const parsed = extractJsonObject(text);
        const generated = GeneratedSchema.parse(parsed);
        const structuralErrors = deterministicChecks(page.template, generated);
        if (structuralErrors.length > 0) {
          attemptErrors.push(`attempt ${attempts}: ${structuralErrors.join('; ')}`);
          continue;
        }

        await supabase
          .from('pages')
          .update({
            intro: generated.intro,
            body_json: generated.body_json,
            status: 'published',
            published_at: new Date().toISOString(),
          })
          .eq('id', page.id);
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

  console.log(`Generation pass complete. provider=${mode} openaiModel=${openaiModel} ollamaPrimary=${ollamaPrimary}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
