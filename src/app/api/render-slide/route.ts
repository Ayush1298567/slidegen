import { screenshotSlide } from '@/lib/screenshot';
import type { Slide, Theme, DeckAspect } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  slide: Slide;
  theme: Theme;
  imageDataUrl?: string;
  aspect?: DeckAspect;
  /** Optional context for slide chrome (deck wordmark + page count). */
  chrome?: { deckTitle: string; pageTotal: number };
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body?.slide || !body?.theme) {
      return Response.json({ error: 'slide and theme required' }, { status: 400 });
    }
    const { pngBuffer } = await screenshotSlide(body);
    return new Response(new Uint8Array(pngBuffer), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'render failed' },
      { status: 500 },
    );
  }
}
