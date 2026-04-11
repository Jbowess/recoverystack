import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ComponentKind = 'intro_hook' | 'verdict_style' | 'newsletter_offer' | 'layout_pattern';

const REQUIRED_KINDS: ComponentKind[] = ['intro_hook', 'verdict_style', 'newsletter_offer', 'layout_pattern'];

type Json = Record<string, unknown>;

export type ComponentRow = {
  id: string;
  kind: ComponentKind;
  template: string | null;
  weight: number;
  content: Json;
};

export type SelectedComponents = {
  introHook: ComponentRow;
  verdictStyle: ComponentRow;
  newsletterOffer: ComponentRow;
  layoutPattern: ComponentRow;
  layoutOrder: string[];
  fingerprint: string;
};

function toComponentKind(value: unknown): ComponentKind | null {
  if (typeof value !== 'string') return null;
  if ((REQUIRED_KINDS as string[]).includes(value)) return value as ComponentKind;
  return null;
}

function toContent(raw: Record<string, unknown>): Json {
  const fromJson = raw.content_json;
  if (fromJson && typeof fromJson === 'object' && !Array.isArray(fromJson)) return fromJson as Json;

  const fromBody = raw.body_json;
  if (fromBody && typeof fromBody === 'object' && !Array.isArray(fromBody)) return fromBody as Json;

  if (typeof raw.content === 'object' && raw.content !== null && !Array.isArray(raw.content)) {
    return raw.content as Json;
  }

  if (typeof raw.value === 'string') return { text: raw.value };
  if (typeof raw.text === 'string') return { text: raw.text };
  return {};
}

function normalizeRow(raw: Record<string, unknown>): ComponentRow | null {
  const kind = toComponentKind(raw.kind ?? raw.component_type ?? raw.type ?? raw.slot);
  if (!kind) return null;

  const id = String(raw.id ?? '');
  if (!id) return null;

  const weightRaw = Number(raw.weight ?? raw.priority_weight ?? 1);
  const weight = Number.isFinite(weightRaw) && weightRaw > 0 ? weightRaw : 1;

  return {
    id,
    kind,
    template: typeof raw.template === 'string' ? raw.template : null,
    weight,
    content: toContent(raw),
  };
}

function weightedPick<T extends { weight: number }>(rows: T[]): T {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.weight), 0);
  if (total <= 0) return rows[Math.floor(Math.random() * rows.length)];

  let needle = Math.random() * total;
  for (const row of rows) {
    needle -= Math.max(0, row.weight);
    if (needle <= 0) return row;
  }

  return rows[rows.length - 1];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export function replacePrimaryKeyword<T>(value: T, primaryKeyword: string): T {
  if (!primaryKeyword) return value;

  if (typeof value === 'string') {
    return value.replace(/\{\{\s*Primary_Keyword\s*\}\}/gi, primaryKeyword) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => replacePrimaryKeyword(item, primaryKeyword)) as T;
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = replacePrimaryKeyword(child, primaryKeyword);
    }
    return output as T;
  }

  return value;
}

export function getLayoutOrder(layoutPattern: ComponentRow): string[] {
  const content = layoutPattern.content;
  return asStringArray(content.order ?? content.layout_order ?? content.sections ?? content.sequence);
}

export function buildLayoutFingerprint(input: { template: string; componentIds: string[]; layoutOrder: string[] }): string {
  const normalized = {
    template: input.template,
    componentIds: input.componentIds,
    layoutOrder: input.layoutOrder,
  };

  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export async function fetchRecentFingerprints(supabase: SupabaseClient, limit = 5): Promise<string[]> {
  const { data, error } = await supabase
    .from('generated_page_fingerprints')
    .select('fingerprint')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row: any) => String(row.fingerprint ?? '')).filter(Boolean);
}

export async function selectRandomComponents(params: {
  supabase: SupabaseClient;
  template: string;
  primaryKeyword: string;
  recentFingerprints: string[];
  maxAttempts?: number;
}): Promise<SelectedComponents> {
  const { supabase, template, primaryKeyword, recentFingerprints, maxAttempts = 12 } = params;

  const { data, error } = await supabase.from('component_library').select('*');

  if (error) throw error;

  const rows = (data ?? [])
    .map((row: any) => row as Record<string, unknown>)
    .filter((row) => {
      const active = row.active ?? row.enabled ?? row.is_active;
      return active == null || Boolean(active);
    })
    .filter((row) => {
      const rowTemplate = row.template;
      return rowTemplate == null || String(rowTemplate) === template;
    })
    .map((row) => normalizeRow(row))
    .filter((row): row is ComponentRow => row !== null);

  const byKind = new Map<ComponentKind, ComponentRow[]>();
  for (const kind of REQUIRED_KINDS) byKind.set(kind, []);

  for (const row of rows) {
    byKind.get(row.kind)?.push(row);
  }

  for (const kind of REQUIRED_KINDS) {
    if (!byKind.get(kind)?.length) {
      throw new Error(`component_library is missing active rows for kind='${kind}' template='${template}'`);
    }
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const introHook = weightedPick(byKind.get('intro_hook')!);
    const verdictStyle = weightedPick(byKind.get('verdict_style')!);
    const newsletterOffer = weightedPick(byKind.get('newsletter_offer')!);
    const layoutPattern = weightedPick(byKind.get('layout_pattern')!);

    const applied = {
      introHook: { ...introHook, content: replacePrimaryKeyword(introHook.content, primaryKeyword) },
      verdictStyle: { ...verdictStyle, content: replacePrimaryKeyword(verdictStyle.content, primaryKeyword) },
      newsletterOffer: { ...newsletterOffer, content: replacePrimaryKeyword(newsletterOffer.content, primaryKeyword) },
      layoutPattern: { ...layoutPattern, content: replacePrimaryKeyword(layoutPattern.content, primaryKeyword) },
    };

    const layoutOrder = getLayoutOrder(applied.layoutPattern);
    const fingerprint = buildLayoutFingerprint({
      template,
      componentIds: [applied.introHook.id, applied.verdictStyle.id, applied.newsletterOffer.id, applied.layoutPattern.id],
      layoutOrder,
    });

    if (!recentFingerprints.includes(fingerprint)) {
      return {
        ...applied,
        layoutOrder,
        fingerprint,
      };
    }
  }

  throw new Error(`Unable to select non-repeating component layout after ${maxAttempts} attempts`);
}
