import { supabaseAdmin } from '@/lib/supabase-admin';

export type AuditAction =
  | 'approve_trend'
  | 'reject_trend'
  | 'publish_draft'
  | 'run_pipeline'
  | 'regenerate_page'
  | 'reseed_component_library'
  | 'enqueue_trends'
  | 'approve_refresh'
  | 'reject_refresh'
  | 'defer_refresh'
  | 'bulk_update_pages';

type AuditEntry = {
  action: AuditAction;
  actor?: string;
  target_type?: string;
  target_id?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Write an admin audit log entry. Non-blocking — logs errors to console but
 * never throws so audit failures cannot interrupt the primary action.
 */
export async function logAdminAction(entry: AuditEntry): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('admin_audit_log').insert({
      action: entry.action,
      actor: entry.actor ?? 'admin',
      target_type: entry.target_type ?? null,
      target_id: entry.target_id ?? null,
      metadata: entry.metadata ?? null,
    });

    if (error) {
      console.error('[admin-audit] failed to write audit log:', error.message);
    }
  } catch (err) {
    console.error('[admin-audit] unexpected error:', err instanceof Error ? err.message : String(err));
  }
}
