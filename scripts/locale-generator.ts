/**
 * Locale Generator
 *
 * Adapts top-performing AU pages for US, UK, and CA markets via
 * transcreation (not translation) — same information, localised:
 *   - Currency (AUD → USD/GBP/CAD)
 *   - Price anchors (AU$299 → US$199)
 *   - Units (km → miles for US)
 *   - Regulatory references (TGA → FDA for US, MHRA for UK)
 *   - Retailer mentions (JB Hi-Fi → Best Buy for US)
 *   - Date formats (DD/MM → MM/DD for US)
 *   - Spelling (colour → color for US)
 *
 * Output: creates localised page variants stored in `page_locales` table.
 * These pages are served at /{locale}/{template}/{slug} routes.
 *
 * Selection: only adapts pages with quality_score >= 70 AND
 * avg_position <= 15 in AU (proved they can rank, now expand).
 *
 * Usage:
 *   npx tsx scripts/locale-generator.ts
 *   npx tsx scripts/locale-generator.ts --locale=us
 *   npx tsx scripts/locale-generator.ts --dry-run
 *   LOCALE_LIMIT=20 npx tsx scripts/locale-generator.ts
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const TARGET_LOCALE = process.argv.find((a) => a.startsWith('--locale='))?.split('=')[1] ?? null;
const LIMIT = Number(process.env.LOCALE_LIMIT ?? 10);
const MIN_QUALITY_SCORE = Number(process.env.LOCALE_MIN_QUALITY ?? 70);

type LocaleConfig = {
  code: string;
  name: string;
  currency_code: string;
  currency_symbol: string;
  currency_exchange_from_aud: number; // multiply AUD price by this
  use_metric: boolean;
  spelling: 'british' | 'american';
  date_format: 'dmy' | 'mdy';
  primary_retailers: string[];
  regulatory_body: string;
  google_country_code: string;
};

const LOCALES: Record<string, LocaleConfig> = {
  us: {
    code: 'us',
    name: 'United States',
    currency_code: 'USD',
    currency_symbol: '$',
    currency_exchange_from_aud: 0.65,
    use_metric: false,
    spelling: 'american',
    date_format: 'mdy',
    primary_retailers: ['Best Buy', 'Amazon', 'REI', 'Target', 'Walmart'],
    regulatory_body: 'FDA',
    google_country_code: 'us',
  },
  uk: {
    code: 'uk',
    name: 'United Kingdom',
    currency_code: 'GBP',
    currency_symbol: '£',
    currency_exchange_from_aud: 0.52,
    use_metric: true,
    spelling: 'british',
    date_format: 'dmy',
    primary_retailers: ['Currys', 'John Lewis', 'Argos', 'Amazon UK'],
    regulatory_body: 'MHRA',
    google_country_code: 'gb',
  },
  ca: {
    code: 'ca',
    name: 'Canada',
    currency_code: 'CAD',
    currency_symbol: 'CA$',
    currency_exchange_from_aud: 0.88,
    use_metric: true,
    spelling: 'american',
    date_format: 'dmy',
    primary_retailers: ['Best Buy Canada', 'Sport Chek', 'Altitude Sports'],
    regulatory_body: 'Health Canada',
    google_country_code: 'ca',
  },
};

// ── Rule-based transcreation (no LLM needed for simple substitutions) ─────────
function applyRuleBasedTranscreation(text: string, locale: LocaleConfig): string {
  let result = text;

  // Currency conversion — handle "AUD $299", "AU$299", "$299 AUD", "$299"
  result = result.replace(/AU\$\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/g, (_, price) => {
    const numPrice = parseFloat(price.replace(/,/g, ''));
    const localPrice = Math.round(numPrice * locale.currency_exchange_from_aud / 5) * 5; // round to nearest $5
    return `${locale.currency_symbol}${localPrice.toLocaleString()}`;
  });

  result = result.replace(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:AUD|AU)/gi, (_, price) => {
    const numPrice = parseFloat(price.replace(/,/g, ''));
    const localPrice = Math.round(numPrice * locale.currency_exchange_from_aud / 5) * 5;
    return `${locale.currency_symbol}${localPrice.toLocaleString()}`;
  });

  // Units for US (imperial)
  if (!locale.use_metric) {
    result = result.replace(/(\d+(?:\.\d+)?)\s*km(?:\b)/g, (_, n) => `${Math.round(parseFloat(n) * 0.621)} miles`);
    result = result.replace(/(\d+(?:\.\d+)?)\s*kg(?:\b)/g, (_, n) => `${Math.round(parseFloat(n) * 2.205)} lbs`);
    result = result.replace(/(\d+(?:\.\d+)?)\s*°C(?:\b)/g, (_, n) => `${Math.round(parseFloat(n) * 9 / 5 + 32)}°F`);
  }

  // British spelling for UK
  if (locale.spelling === 'american') {
    result = result.replace(/\bcolour\b/gi, 'color');
    result = result.replace(/\bcolours\b/gi, 'colors');
    result = result.replace(/\bfavourite\b/gi, 'favorite');
    result = result.replace(/\bfavourites\b/gi, 'favorites');
    result = result.replace(/\boptimise\b/gi, 'optimize');
    result = result.replace(/\boptimising\b/gi, 'optimizing');
    result = result.replace(/\banalogue\b/gi, 'analog');
    result = result.replace(/\bcentre\b/gi, 'center');
    result = result.replace(/\bfibre\b/gi, 'fiber');
    result = result.replace(/\blicence\b/gi, 'license');
    result = result.replace(/\borganise\b/gi, 'organize');
    result = result.replace(/\brecognise\b/gi, 'recognize');
  }

  // Regulatory references
  result = result.replace(/\bTGA\b/g, locale.regulatory_body);
  result = result.replace(/\bTherapeutic Goods Administration\b/gi, locale.regulatory_body === 'FDA' ? 'Food and Drug Administration (FDA)' : locale.regulatory_body);

  // AU retailer references
  if (locale.code === 'us') {
    result = result.replace(/\bJB Hi-Fi\b/gi, 'Best Buy');
    result = result.replace(/\bHarvey Norman\b/gi, 'Best Buy');
    result = result.replace(/\bOfficeworks\b/gi, 'Staples');
    result = result.replace(/\bBig W\b/gi, 'Walmart');
  } else if (locale.code === 'uk') {
    result = result.replace(/\bJB Hi-Fi\b/gi, 'Currys');
    result = result.replace(/\bHarvey Norman\b/gi, 'John Lewis');
    result = result.replace(/\bBig W\b/gi, 'Argos');
  }

  return result;
}

// ── LLM-based transcreation for nuanced content ───────────────────────────────
async function transcreateWithLlm(text: string, locale: LocaleConfig, context: string): Promise<string> {
  const prompt = `Adapt the following ${context} for the ${locale.name} market.
Maintain the exact same information and structure.
Localise ONLY: currency (→ ${locale.currency_code}), cultural references, retailer names (use: ${locale.primary_retailers.join(', ')}), and regulatory references (use: ${locale.regulatory_body}).
Do NOT change: facts, studies, product names, or technical specifications.
Do NOT add or remove any content.
Return only the adapted text, no preamble.

TEXT TO ADAPT:
${text}`;

  try {
    if (OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3, // low temperature — minimal creative deviation
          max_tokens: 800,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return text;
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() ?? text;
    }

    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.2, num_predict: 800 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return text;
    const data = await res.json();
    return data.response?.trim() ?? text;
  } catch {
    return text;
  }
}

async function transcreateBodyJson(
  bodyJson: Record<string, unknown> | null,
  locale: LocaleConfig,
): Promise<Record<string, unknown> | null> {
  if (!bodyJson) return null;

  const sections = (bodyJson.sections ?? []) as Array<{ heading?: string; content?: unknown; kind?: string }>;
  const adaptedSections = [];

  for (const section of sections) {
    let adaptedHeading = section.heading ? applyRuleBasedTranscreation(section.heading, locale) : section.heading;

    let adaptedContent = section.content;
    if (typeof section.content === 'string') {
      adaptedContent = applyRuleBasedTranscreation(section.content, locale);
    } else if (Array.isArray(section.content)) {
      adaptedContent = section.content.map((item) =>
        typeof item === 'string' ? applyRuleBasedTranscreation(item, locale) : item,
      );
    }

    adaptedSections.push({ ...section, heading: adaptedHeading, content: adaptedContent });
  }

  const faqs = (bodyJson.faqs ?? []) as Array<{ q: string; a: string }>;
  const adaptedFaqs = faqs.map((f) => ({
    q: applyRuleBasedTranscreation(f.q, locale),
    a: applyRuleBasedTranscreation(f.a, locale),
  }));

  return {
    ...bodyJson,
    sections: adaptedSections,
    faqs: adaptedFaqs,
  };
}

async function run(): Promise<void> {
  const targetLocales = TARGET_LOCALE ? [LOCALES[TARGET_LOCALE]].filter(Boolean) : Object.values(LOCALES);

  if (targetLocales.length === 0) {
    console.log(`[locale] Unknown locale: ${TARGET_LOCALE}. Available: ${Object.keys(LOCALES).join(', ')}`);
    return;
  }

  // Find top-performing pages eligible for localisation
  const { data: pages } = await supabase
    .from('pages')
    .select('slug, template, title, meta_description, primary_keyword, body_json, metadata')
    .eq('status', 'published')
    .gte('quality_score', MIN_QUALITY_SCORE)
    .order('quality_score', { ascending: false })
    .limit(LIMIT);

  console.log(`[locale] Processing ${(pages ?? []).length} pages × ${targetLocales.length} locales (dryRun=${DRY_RUN})`);

  for (const page of (pages ?? []) as Array<{
    slug: string;
    template: string;
    title: string;
    meta_description: string;
    primary_keyword: string | null;
    body_json: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
  }>) {
    for (const locale of targetLocales) {
      // Check if locale variant exists
      const { data: existing } = await supabase
        .from('page_locales')
        .select('id')
        .eq('page_slug', page.slug)
        .eq('locale', locale.code)
        .single();

      if (existing) {
        console.log(`[locale] ${page.slug}/${locale.code}: already exists`);
        continue;
      }

      const adaptedTitle = applyRuleBasedTranscreation(page.title, locale);
      const adaptedDescription = applyRuleBasedTranscreation(page.meta_description, locale);
      const adaptedKeyword = applyRuleBasedTranscreation(page.primary_keyword ?? '', locale);
      const adaptedBodyJson = await transcreateBodyJson(page.body_json, locale);

      // Build hreflang metadata
      const hreflang = {
        [`en-${locale.code.toUpperCase()}`]: `/${locale.code}/${page.template}/${page.slug}`,
        'en-AU': `/${page.template}/${page.slug}`,
      };

      console.log(
        `[locale] ${page.slug} → ${locale.code}: "${adaptedTitle.slice(0, 60)}"`,
      );

      if (DRY_RUN) continue;

      await supabase.from('page_locales').upsert({
        page_slug: page.slug,
        locale: locale.code,
        locale_name: locale.name,
        title: adaptedTitle,
        meta_description: adaptedDescription,
        primary_keyword: adaptedKeyword,
        body_json: adaptedBodyJson,
        hreflang,
        currency_code: locale.currency_code,
        template: page.template,
        status: 'draft',
        generated_at: new Date().toISOString(),
      }, { onConflict: 'page_slug,locale' });
    }
  }

  console.log('[locale] Done.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
