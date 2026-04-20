import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildNarrativeRows } from '@/lib/brand-operating-system';

config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const [voiceResult, memoryResult] = await Promise.all([
    supabase.from('brand_voice_profiles').select('slug,label,tone_rules,banned_phrases,required_frames,example_lines').limit(50),
    supabase.from('brand_memory_entries').select('memory_type,body,priority').eq('memory_type', 'claim').order('priority', { ascending: false }).limit(30),
  ]);

  const voice = voiceResult.error?.message?.includes('brand_voice_profiles') ? [] : (voiceResult.data ?? []);
  const memory = memoryResult.error?.message?.includes('brand_memory_entries') ? [] : (memoryResult.data ?? []);

  const primaryThesis = String(memory[0]?.body ?? 'Subscription burden, comfort, and evidence quality matter more than feature-count marketing.');
  const supporting = [
    'Comfort beats sensors when adherence collapses.',
    'Total cost of ownership should shape the shortlist before edge-case features do.',
    'RecoveryStack separates measured facts from useful buying inference.',
  ];
  const antiThesis = 'Do not publish generic “best device” hype that ignores buyer fit, evidence quality, and ownership friction.';
  const approvedFrames = [
    'Who this is for',
    'Who should avoid it',
    'What matters before buying',
    'What the data actually proves',
  ];
  const proofRequirements = [
    'Use named evidence sources where possible.',
    'Differentiate pricing facts from editorial inference.',
    'Surface the strongest counterargument before claiming a winner.',
  ];
  const disallowedPhrasing = Array.from(new Set(voice.flatMap((row: any) => row.banned_phrases ?? []))).slice(0, 20);
  const targetPersonas = ['subscription_averse', 'accuracy_first', 'sleep_buyers', 'runners'];
  const payload = buildNarrativeRows({
    primaryThesis,
    supporting,
    antiThesis,
    approvedFrames,
    proofRequirements,
    disallowedPhrasing,
    targetPersonas,
  });

  if (DRY_RUN) {
    console.log(`[narrative-control-sync] centers=${payload.centers.length} frames=${payload.frames.length} dryRun=true`);
    return;
  }

  const centerWrite = await supabase.from('narrative_control_centers').upsert(payload.centers, { onConflict: 'narrative_key' });
  if (centerWrite.error?.message?.includes('narrative_control_centers')) {
    console.log('[narrative-control-sync] narrative_control_centers missing - skipping persistence.');
    return;
  }
  if (centerWrite.error) throw centerWrite.error;

  const frameWrite = await supabase.from('narrative_message_frames').upsert(payload.frames, {
    onConflict: 'narrative_key,frame_key,channel,frame_type',
  } as never);
  if (frameWrite.error?.message?.includes('narrative_message_frames')) {
    console.log('[narrative-control-sync] narrative_message_frames missing - skipping frame persistence.');
    return;
  }
  if (frameWrite.error) throw frameWrite.error;

  console.log(`[narrative-control-sync] centers=${payload.centers.length} frames=${payload.frames.length} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
