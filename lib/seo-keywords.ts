import type { TemplateType } from '@/lib/types';

export type QueueTemplateId =
  | 'comparison'
  | 'guide'
  | 'protocol'
  | TemplateType;

export type QueueSource =
  | 'evergreen'
  | 'trend'
  | 'paa'
  | 'related_search'
  | 'modifier_expansion'
  | 'topical_gap';

export type QueueStatus =
  | 'new'
  | 'queued'
  | 'generated'
  | 'published'
  | 'skipped';

export function normalizeKeyword(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function templateIdToPageTemplate(templateId: QueueTemplateId): TemplateType {
  switch (templateId) {
    case 'comparison':
      return 'alternatives';
    case 'guide':
      return 'guides';
    case 'protocol':
      return 'protocols';
    default:
      return templateId;
  }
}

export function pageTemplateToQueueTemplateId(template: TemplateType): QueueTemplateId {
  return template;
}

export function queueTemplateLabel(templateId: QueueTemplateId): string {
  return templateIdToPageTemplate(templateId);
}

export function buildClusterName(topic: string): string {
  return topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'general';
}

export function buildTrendSlugTerm(term: string): string {
  return normalizeKeyword(term).replace(/\s+/g, '-');
}
