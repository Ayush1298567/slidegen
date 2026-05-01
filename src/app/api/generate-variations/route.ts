import { generateSlideImage } from '@/lib/gemini';
import { NANO_BANANA_PRICE_PER_IMAGE_USD } from '@/lib/pricing';
import type { ImageAspect, Layout } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ASPECTS: ImageAspect[] = ['16:9', '4:3', '1:1'];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const prompt = String(body?.prompt ?? '').trim();
    const mood = String(body?.mood ?? '').trim();
    const aspect: ImageAspect = VALID_ASPECTS.includes(body?.aspect) ? body.aspect : '16:9';
    const layout = body?.layout as Layout | undefined;
    const count = Math.min(4, Math.max(2, Number(body?.count) || 3));
    if (!prompt || !mood) {
      return Response.json({ error: 'prompt and mood required' }, { status: 400 });
    }

    // Run N image generations in parallel.
    const tasks = Array.from({ length: count }, () =>
      generateSlideImage({ prompt, mood, aspect, layout }).then(
        (img) => ({ ok: true as const, dataUrl: img.dataUrl, mimeType: img.mimeType }),
        (err: Error) => ({ ok: false as const, error: err.message }),
      ),
    );
    const results = await Promise.all(tasks);
    const variations = results
      .filter((r): r is { ok: true; dataUrl: string; mimeType: string } => r.ok)
      .map((r) => ({ dataUrl: r.dataUrl, mimeType: r.mimeType }));
    return Response.json({
      variations,
      costUsd: variations.length * NANO_BANANA_PRICE_PER_IMAGE_USD,
      failed: results.length - variations.length,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'variations failed' },
      { status: 500 },
    );
  }
}
