import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    toolSlug?: string;
    eventType?: string;
    pageSlug?: string | null;
    metadata?: Record<string, unknown>;
  } | null;

  if (!body?.toolSlug || !body?.eventType) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('tool_usage_events').insert({
    tool_slug: body.toolSlug,
    event_type: body.eventType,
    page_slug: body.pageSlug ?? null,
    metadata: body.metadata ?? {},
  });

  if (error && !error.message.includes('tool_usage_events')) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
