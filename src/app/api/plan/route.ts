import { startPlan, streamEvents } from '@/lib/claude-client';
import { toLlmProvider, type DeckTemplate, type LlmProvider, type Theme } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TEMPLATES: DeckTemplate[] = [
  'pitch', 'saas-pitch', 'consumer-pitch', 'lecture', 'status', 'product-launch', 'retro', 'custom',
];

function ndjson(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj) + '\n');
}

export async function POST(req: Request) {
  let topic = '';
  let slideCount = 10;
  let styleHint: string | undefined;
  let template: DeckTemplate = 'custom';
  let themeOverride: Theme | undefined;
  let brandPrimary: string | undefined;
  let provider: LlmProvider = 'claude';
  try {
    const body = await req.json();
    topic = String(body?.topic ?? '').trim();
    slideCount = Math.max(1, Math.min(25, Number(body?.slideCount) || 10));
    styleHint = body?.styleHint ? String(body.styleHint) : undefined;
    template = VALID_TEMPLATES.includes(body?.template) ? body.template : 'custom';
    if (body?.themeOverride && typeof body.themeOverride === 'object') {
      themeOverride = body.themeOverride as Theme;
    }
    if (typeof body?.brandPrimary === 'string' && /^#[0-9a-f]{6}$/i.test(body.brandPrimary.trim())) {
      brandPrimary = body.brandPrimary.trim();
    }
    provider = toLlmProvider(body?.provider);
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!topic) return Response.json({ error: 'topic required' }, { status: 400 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(ndjson(obj)); } catch { /* closed */ }
      };
      try {
        send({ type: 'status', text: `Spawning ${provider === 'deepseek' ? 'DeepSeek' : 'Claude'}…` });
        const { sessionId } = await startPlan({ topic, slideCount, styleHint, template, themeOverride, brandPrimary, provider });
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
        send({ type: 'error', error: err instanceof Error ? err.message : 'plan failed' });
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
