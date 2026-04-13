/**
 * AI hero image generation using OpenAI DALL-E 3.
 *
 * Generates a 1792×1024 hero image per page, uploads it to Supabase Storage
 * (bucket: page-images), and returns the public URL.
 *
 * No-ops silently when OPENAI_API_KEY is not set (returns null).
 */

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

const TEMPLATE_PROMPTS: Record<string, string> = {
  guides: 'A clean, clinical sports science illustration showing athlete recovery data on a dark background. Minimal, professional, no text.',
  alternatives: 'A flat-design product comparison chart with wearable devices arranged side by side, dark slate background, tech aesthetic, no text.',
  protocols: 'A structured protocol diagram with numbered steps and flow arrows, sports medicine aesthetic, dark background, minimal, no text.',
  metrics: 'A sleek data dashboard with HRV graphs, sleep stage charts, and biometric readouts, dark background, clinical, no text.',
  costs: 'A clean price comparison infographic with budget tiers shown as ascending blocks, dark background, modern minimal design, no text.',
  compatibility: 'A network diagram showing devices and apps connected by lines, wearable tech aesthetic, dark background, no text.',
  trends: 'A dynamic line chart showing upward trends in recovery performance metrics, gradient background from dark navy to teal, no text.',
  pillars: 'A comprehensive hub illustration with interconnected topics radiating from a central recovery icon, dark background, minimal, no text.',
};

export async function generatePageHeroImage(
  title: string,
  template: string,
  keyword: string,
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const basePrompt = TEMPLATE_PROMPTS[template] ?? TEMPLATE_PROMPTS.guides;
  const prompt = `${basePrompt} Subject matter: ${keyword}. Style: professional health-tech brand, high contrast, suitable as a web article hero image. No human faces, no logos.`;

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1792x1024',
        quality: 'standard',
        response_format: 'url',
      }),
    });

    if (!res.ok) {
      console.warn(`[image-generator] DALL-E API error ${res.status}: ${await res.text()}`);
      return null;
    }

    const json = await res.json();
    const imageUrl = json?.data?.[0]?.url as string | undefined;
    if (!imageUrl) return null;

    // Download image bytes
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return null;
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    // Upload to Supabase Storage
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const fileName = `${template}/${keyword.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.webp`;

    const { error: uploadError } = await supabase.storage
      .from('page-images')
      .upload(fileName, buffer, {
        contentType: 'image/webp',
        upsert: true,
      });

    if (uploadError) {
      console.warn(`[image-generator] Storage upload failed: ${uploadError.message}`);
      // Fall back to direct URL (ephemeral — expires in ~1hr, but better than nothing)
      return imageUrl;
    }

    const { data: publicData } = supabase.storage.from('page-images').getPublicUrl(fileName);
    return publicData?.publicUrl ?? imageUrl;
  } catch (err) {
    console.warn('[image-generator] Error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
