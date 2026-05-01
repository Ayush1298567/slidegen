import { buildPdf } from '@/lib/pdf';
import type { Deck, DeckAspect } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  deck: Deck;
  images: Record<number, string>;
  aspect?: DeckAspect;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body?.deck?.slides?.length) {
      return Response.json({ error: 'deck.slides required' }, { status: 400 });
    }
    const buf = await buildPdf(body);
    const fileName = `${(body.deck.title || 'deck').replace(/[^a-z0-9-_]+/gi, '_')}.pdf`;
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${fileName}"`,
        'content-length': String(buf.length),
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'pdf failed' },
      { status: 500 },
    );
  }
}
