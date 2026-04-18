import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { BRAND_VOICE_SEEDS } from '@/lib/company-growth';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  let seeded = 0;
  for (const seed of BRAND_VOICE_SEEDS) {
    seeded += 1;
    if (DRY_RUN) continue;
    const { error } = await supabase.from('brand_voice_profiles').upsert({
      ...seed,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'slug' });
    if (error?.message?.includes('brand_voice_profiles')) {
      console.log('[brand-voice-governor] brand_voice_profiles missing - skipping persistence.');
      break;
    }
  }

  const { data, error } = await supabase.from('pages').select('slug,title,body_json').eq('status', 'published').limit(200);
  if (error) throw error;
  const banned = new Set(BRAND_VOICE_SEEDS.flatMap((seed) => seed.banned_phrases.map((p) => p.toLowerCase())));
  let flagged = 0;
  for (const page of (data ?? []) as Array<any>) {
    const text = JSON.stringify(page.body_json ?? {}).toLowerCase();
    const hits = [...banned].filter((phrase) => text.includes(phrase));
    if (hits.length > 0) {
      flagged += 1;
      console.log(`[brand-voice-governor] ${page.slug} -> banned=${hits.join(', ')}`);
    }
  }

  console.log(`[brand-voice-governor] seeded=${seeded} flagged=${flagged} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
