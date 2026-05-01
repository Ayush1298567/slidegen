import { buildPptx, type ExportInput } from '@/lib/pptx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ExportInput;
    if (!body?.deck?.slides?.length) {
      return Response.json({ error: 'deck.slides required' }, { status: 400 });
    }
    const buf = await buildPptx(body);
    const fileName = `${(body.deck.title || 'deck').replace(/[^a-z0-9-_]+/gi, '_')}.pptx`;
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type':
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'content-disposition': `attachment; filename="${fileName}"`,
        'content-length': String(buf.length),
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'export failed' },
      { status: 500 },
    );
  }
}
