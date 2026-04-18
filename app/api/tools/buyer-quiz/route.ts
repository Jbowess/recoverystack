import { NextResponse } from 'next/server';
import { buildBuyerQuizResult } from '@/lib/company-growth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    priority?: 'sleep' | 'cost' | 'accuracy' | 'training';
    hatesSubscription?: boolean;
    prefersNoScreen?: boolean;
  } | null;

  if (!body?.priority) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const result = buildBuyerQuizResult({
    priority: body.priority,
    hatesSubscription: Boolean(body.hatesSubscription),
    prefersNoScreen: Boolean(body.prefersNoScreen),
  });

  const { error } = await supabaseAdmin.from('tool_usage_events').insert({
    tool_slug: 'smart-ring-fit',
    event_type: 'quiz_completed',
    metadata: {
      priority: body.priority,
      hates_subscription: Boolean(body.hatesSubscription),
      prefers_no_screen: Boolean(body.prefersNoScreen),
      segment: result.segment,
      lead_magnet: result.nextStep.slug,
    },
  });

  if (error && !error.message.includes('tool_usage_events')) {
    console.warn('[buyer-quiz] telemetry insert failed:', error.message);
  }

  return NextResponse.json({ result });
}
