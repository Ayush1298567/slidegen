import { NextResponse } from 'next/server';
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { reviewSlide } from '@/lib/claude-client';
import { reviewSlideImage as geminiReviewSlide } from '@/lib/gemini-review';
import { screenshotSlide } from '@/lib/screenshot';
import { toLlmProvider, type DeckAspect, type LlmProvider, type Slide, type Theme } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEMP_DIR = resolve(process.cwd(), '.slidegen', 'review-temp');

function dataUrlToBuffer(dataUrl: string): Buffer {
  const m = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!m) throw new Error('invalid image data URL');
  return Buffer.from(m[1], 'base64');
}

type ReviewBody = {
  /** Full slide object with layout, title, body, etc. */
  slide: Slide;
  /** Deck theme (palette, fonts, mood). */
  theme: Theme;
  /** The Nano Banana image for this slide. May be omitted for text-only layouts. */
  imageDataUrl?: string;
  /** Optional override; defaults to '16:9' */
  aspect?: DeckAspect;
  /** Optional context for slide chrome (deck wordmark + page count). */
  chrome?: { deckTitle: string; pageTotal: number };
  /**
   * Text provider for the deck. claude → Claude Code reads the screenshot;
   * deepseek → DeepSeek is text-only, so Gemini (vision) reviews it instead.
   */
  provider?: LlmProvider;
};

export async function POST(req: Request) {
  let tempPath: string | null = null;
  try {
    const body = (await req.json()) as ReviewBody;
    if (!body?.slide || !body?.theme) {
      return NextResponse.json({ error: 'slide and theme required' }, { status: 400 });
    }
    const provider = toLlmProvider(body?.provider);

    // Render the COMPOSED slide (image + text overlay) and screenshot it.
    const { pngBuffer } = await screenshotSlide({
      slide: body.slide,
      theme: body.theme,
      imageDataUrl: body.imageDataUrl,
      aspect: body.aspect ?? '16:9',
      chrome: body.chrome,
    });

    // DeepSeek's chat models are text-only, so its slide review is delegated to
    // Gemini (vision) instead — no Claude involved anywhere in this path.
    if (provider === 'deepseek') {
      const result = await geminiReviewSlide({
        imageDataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`,
        imagePrompt: body.slide.imagePrompt,
        style: body.theme.mood,
        slideTitle: body.slide.title,
      });
      return NextResponse.json({ review: result.review, llmCostUsd: result.costUsd });
    }

    // Claude provider → Claude Code reads the screenshot from disk.
    mkdirSync(TEMP_DIR, { recursive: true });
    tempPath = join(TEMP_DIR, `${randomBytes(8).toString('hex')}.png`);
    writeFileSync(tempPath, pngBuffer);

    const result = await reviewSlide({
      imagePath: tempPath,
      imagePrompt: body.slide.imagePrompt,
      style: body.theme.mood,
      slideTitle: body.slide.title,
      provider,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'review failed' },
      { status: 500 },
    );
  } finally {
    if (tempPath) {
      try {
        unlinkSync(tempPath);
      } catch {
        /* best-effort */
      }
    }
  }
  // dataUrlToBuffer kept for legacy callers — silence unused warning.
  void dataUrlToBuffer;
}
