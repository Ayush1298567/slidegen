// Singleton puppeteer browser → screenshot any HTML to PNG bytes.
// Persistent across requests for warm reuse during a session.

import puppeteer, { type Browser } from 'puppeteer';
import { renderSlideHtml, type RenderArgs } from './slide-html';

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

export async function screenshotSlide(args: RenderArgs): Promise<{ pngBuffer: Buffer; width: number; height: number }> {
  const { html, width, height } = renderSlideHtml(args);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 });
    // Best-effort wait for fonts to load.
    await page.evaluate(() => (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
    const png = (await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } })) as Buffer;
    return { pngBuffer: png, width, height };
  } finally {
    await page.close();
  }
}

export async function shutdownBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise;
  browserPromise = null;
  await b.close();
}
