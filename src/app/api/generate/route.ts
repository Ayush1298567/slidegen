import { NextResponse } from 'next/server';
import { generateSlideImage } from '@/lib/gemini';
import { NANO_BANANA_PRICE_PER_IMAGE_USD } from '@/lib/pricing';
import type { ImageAspect, Layout } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ASPECTS: ImageAspect[] = ['16:9', '4:3', '1:1', 'none'];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const prompt = String(body?.prompt ?? '').trim();
    const mood = String(body?.mood ?? '').trim();
    const aspect: ImageAspect = VALID_ASPECTS.includes(body?.aspect) ? body.aspect : '16:9';
    const layout = body?.layout as Layout | undefined;
    if (!prompt || !mood) {
      return NextResponse.json({ error: 'prompt and mood required' }, { status: 400 });
    }
    if (aspect === 'none') {
      return NextResponse.json({ error: 'cannot generate image for aspect=none' }, { status: 400 });
    }
    const image = await generateSlideImage({ prompt, mood, aspect, layout });
    return NextResponse.json({
      dataUrl: image.dataUrl,
      mimeType: image.mimeType,
      costUsd: NANO_BANANA_PRICE_PER_IMAGE_USD,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'generate failed' },
      { status: 500 },
    );
  }
}
