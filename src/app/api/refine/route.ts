import { startRefine, streamEvents } from '@/lib/claude-client';
import type { Deck } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ndjson(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj) + '\n');
}

export async function POST(req: Request) {
  let deck: Deck | undefined;
  let instruction = '';
  try {
    const body = await req.json();
    deck = body?.deck as Deck | undefined;
    instruction = String(body?.instruction ?? '').trim();
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!deck || !instruction) {
    return Response.json({ error: 'deck and instruction required' }, { status: 400 });
  }

  const safeDeck = deck;
  const safeInstruction = instruction;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(ndjson(obj)); } catch { /* closed */ }
      };
      try {
        send({ type: 'status', text: 'Spawning Claude…' });
        const { sessionId } = await startRefine({ deck: safeDeck, instruction: safeInstruction });
        let finalResult: unknown = null;
        let finalError: string | null = null;
        await streamEvents(sessionId, (evt) => {
          if (evt.type === 'status') send({ type: 'status', text: evt.text });
          else if (evt.type === 'done') finalResult = evt.result;
          else if (evt.type === 'error') finalError = evt.error;
        });
        if (finalError) send({ type: 'error', error: finalError });
        else if (finalResult) send({ type: 'result', ...finalResult });
        else send({ type: 'error', error: 'no result' });
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : 'refine failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
