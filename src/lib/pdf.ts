// Multi-slide PDF renderer using puppeteer.
// Composes every slide into one HTML doc with page breaks, then renders to PDF.

import puppeteer, { type Browser } from 'puppeteer';
import { renderSlideHtml } from './slide-html';
import type { Deck, DeckAspect } from './types';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
    });
  }
  return browserPromise;
}

export async function buildPdf(input: {
  deck: Deck;
  images: Record<number, string>;
  aspect?: DeckAspect;
}): Promise<Buffer> {
  const aspect: DeckAspect = input.aspect ?? '16:9';
  const slidesHtml = input.deck.slides
    .map((slide) => {
      const { html, width, height } = renderSlideHtml({
        slide,
        theme: input.deck.theme,
        imageDataUrl: input.images[slide.n],
        aspect,
        chrome: { deckTitle: input.deck.title, pageTotal: input.deck.slides.length },
      });
      // Pull just the body of the per-slide doc (we wrap in our own multi-slide doc below).
      const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
      const body = bodyMatch ? bodyMatch[1] : html;
      const headMatch = html.match(/<head>([\s\S]*?)<\/head>/);
      return { body, head: headMatch?.[1] ?? '', width, height };
    });
  if (!slidesHtml.length) throw new Error('deck has no slides');
  const { width, height } = slidesHtml[0];
  const head = slidesHtml[0].head;

  const html = `<!doctype html>
<html>
<head>
${head}
<style>
  @page { size: ${width}px ${height}px; margin: 0; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${input.deck.theme.palette.background}; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
</style>
</head>
<body>
${slidesHtml.map((s) => `<div class="page">${s.body}</div>`).join('')}
</body>
</html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60_000 });
    await page.evaluate(() => (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
    const pdf = (await page.pdf({
      width: `${width}px`,
      height: `${height}px`,
      printBackground: true,
      pageRanges: '',
      preferCSSPageSize: true,
    })) as Buffer;
    return pdf;
  } finally {
    await page.close();
  }
}
