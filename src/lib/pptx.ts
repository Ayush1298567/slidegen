// PPTX renderer — v2.
// Real text frames + theme colors/fonts. Image is one element among many,
// not the entire slide. Per-layout positioning replicates Genspark/Manus-style decks.

import PptxGenJS from 'pptxgenjs';
import type { Deck, DeckAspect, Slide, Theme } from './types';

export type ExportInput = {
  deck: Deck;
  /** Map of slide n → image data URL (from /api/generate). Slides with imageAspect="none" omit this. */
  images: Record<number, string>;
  aspect?: DeckAspect;
};

type ChromeCtx = {
  deckTitle: string;
  pageNum: number;
  pageTotal: number;
};

// --- Color helpers (pptxgenjs wants RRGGBB without leading #) ----------------

function hex(c: string): string {
  return c.replace('#', '').toUpperCase();
}

/** Compute relative luminance to decide if a color is "light" (for overlay decisions). */
function luminance(c: string): number {
  const m = c.trim().match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 0.5;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const adj = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * adj(r) + 0.7152 * adj(g) + 0.0722 * adj(b);
}

// --- Slide dimensions ---------------------------------------------------------

type Geom = { w: number; h: number };

function geom(aspect: DeckAspect): Geom {
  return aspect === '4:3' ? { w: 10, h: 7.5 } : { w: 13.333, h: 7.5 };
}

type SlideRef = ReturnType<PptxGenJS['addSlide']>;

// --- chrome (deck wordmark + page number + accent rule) ----------------------

function addChrome(s: SlideRef, theme: Theme, ctx: ChromeCtx, G: Geom, light = false) {
  const color = light ? 'FFFFFFB3' : hex(theme.palette.muted);
  // Top-right deck wordmark
  if (ctx.deckTitle) {
    s.addText(ctx.deckTitle.toUpperCase().slice(0, 40), {
      x: G.w - 4.5, y: 0.25, w: 4.2, h: 0.25,
      fontFace: theme.fontBody, fontSize: 9, bold: true,
      color, charSpacing: 6, align: 'right', valign: 'top',
      transparency: 30,
    });
  }
  // Bottom-right page number
  s.addText(
    [
      { text: String(ctx.pageNum).padStart(2, '0'), options: { color, bold: true } },
      { text: `  / ${String(ctx.pageTotal).padStart(2, '0')}`, options: { color, transparency: 50 } },
    ],
    {
      x: G.w - 1.5, y: G.h - 0.5, w: 1.2, h: 0.25,
      fontFace: theme.fontBody, fontSize: 10,
      charSpacing: 4, align: 'right', valign: 'bottom',
      transparency: 30,
    },
  );
  // Bottom-left short accent line
  s.addShape('line', {
    x: 0.6, y: G.h - 0.4, w: 0.6, h: 0,
    line: { color: light ? 'FFFFFF' : hex(theme.palette.muted), width: 1 },
  });
}

function addEyebrow(
  s: SlideRef,
  text: string | undefined,
  theme: Theme,
  x: number,
  y: number,
  color?: string,
) {
  if (!text) return;
  const c = color ?? hex(theme.palette.primary);
  s.addShape('rect', {
    x, y: y + 0.08, w: 0.3, h: 0.04,
    fill: { color: c }, line: { color: c, width: 0 },
  });
  s.addText(text.toUpperCase(), {
    x: x + 0.4, y, w: 5, h: 0.3,
    fontFace: theme.fontBody, fontSize: 11, bold: true,
    color: c, charSpacing: 5, align: 'left', valign: 'top',
  });
}

function renderTitleHero(
  s: SlideRef,
  slide: Slide,
  theme: Theme,
  imageDataUrl: string | undefined,
  G: Geom,
) {
  const dim = luminance(theme.palette.background) > 0.5 ? '0F1419' : '000000';
  if (imageDataUrl) {
    s.addImage({ data: imageDataUrl, x: 0, y: 0, w: G.w, h: G.h, sizing: { type: 'cover', w: G.w, h: G.h } });
    s.addShape('rect', {
      x: 0, y: 0, w: G.w, h: G.h,
      fill: { color: dim, transparency: 45 },
      line: { color: dim, width: 0 },
    });
  } else {
    s.background = { color: hex(theme.palette.background) };
  }
  const titleColor = imageDataUrl ? 'FFFFFF' : hex(theme.palette.primary);
  const subColor = imageDataUrl ? 'FFFFFF' : hex(theme.palette.text);
  s.addText(slide.title, {
    x: 0.8, y: G.h / 2 - 1.6, w: G.w - 1.6, h: 2.0,
    fontFace: theme.fontHeading,
    fontSize: 96,
    bold: true,
    color: titleColor,
    align: 'left',
    valign: 'bottom',
    charSpacing: -2,
  });
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: 0.8, y: G.h / 2 + 0.5, w: (G.w - 1.6) * 0.75, h: 1.0,
      fontFace: theme.fontBody,
      fontSize: 26,
      color: subColor,
      align: 'left',
      valign: 'top',
      transparency: imageDataUrl ? 10 : 30,
    });
  }
}

function renderContentImage(
  s: SlideRef,
  slide: Slide,
  theme: Theme,
  imageDataUrl: string | undefined,
  G: Geom,
  imageSide: 'left' | 'right',
) {
  s.background = { color: hex(theme.palette.background) };
  const halfW = G.w / 2;
  const imgX = imageSide === 'right' ? halfW : 0;
  const txtX = imageSide === 'right' ? 0.7 : halfW + 0.6;
  const txtW = halfW - 1.2;

  if (imageDataUrl) {
    s.addImage({
      data: imageDataUrl,
      x: imgX, y: 0, w: halfW, h: G.h,
      sizing: { type: 'cover', w: halfW, h: G.h },
    });
  }

  addEyebrow(s, slide.eyebrow, theme, txtX, 0.75);
  s.addText(slide.title, {
    x: txtX, y: 1.15, w: txtW, h: 1.2,
    fontFace: theme.fontHeading,
    fontSize: 36,
    bold: true,
    color: hex(theme.palette.text),
    align: 'left',
    valign: 'bottom',
  });
  s.addShape('rect', {
    x: txtX, y: 2.4, w: 0.55, h: 0.06,
    fill: { color: hex(theme.palette.primary) },
    line: { color: hex(theme.palette.primary), width: 0 },
  });
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: txtX, y: 2.6, w: txtW, h: 0.5,
      fontFace: theme.fontBody,
      fontSize: 16,
      italic: true,
      color: hex(theme.palette.secondary),
      align: 'left',
    });
  }

  const bullets = slide.body.map((b) => ({ text: b, options: { bullet: { code: '25B8' } } }));
  if (bullets.length) {
    s.addText(bullets, {
      x: txtX, y: 3.2, w: txtW, h: G.h - 3.9,
      fontFace: theme.fontBody,
      fontSize: 18,
      color: hex(theme.palette.text),
      paraSpaceAfter: 10,
      lineSpacingMultiple: 1.3,
      valign: 'top',
    });
  }
}

function renderTwoColumn(s: SlideRef, slide: Slide, theme: Theme, G: Geom) {
  s.background = { color: hex(theme.palette.background) };
  addEyebrow(s, slide.eyebrow, theme, 0.7, 0.7);
  s.addText(slide.title, {
    x: 0.7, y: 1.1, w: G.w - 1.4, h: 1,
    fontFace: theme.fontHeading,
    fontSize: 36,
    bold: true,
    color: hex(theme.palette.text),
  });
  s.addShape('rect', {
    x: 0.7, y: 1.95, w: 0.55, h: 0.06,
    fill: { color: hex(theme.palette.primary) },
    line: { color: hex(theme.palette.primary), width: 0 },
  });
  const half = Math.ceil(slide.body.length / 2);
  const left = slide.body.slice(0, half).map((t) => ({ text: t, options: { bullet: { code: '25CF' } } }));
  const right = slide.body.slice(half).map((t) => ({ text: t, options: { bullet: { code: '25CF' } } }));
  const colW = (G.w - 2.0) / 2;
  s.addText(left, {
    x: 0.7, y: 2.0, w: colW, h: G.h - 2.5,
    fontFace: theme.fontBody, fontSize: 18, color: hex(theme.palette.text),
    paraSpaceAfter: 8, valign: 'top',
  });
  s.addText(right, {
    x: 0.7 + colW + 0.6, y: 2.0, w: colW, h: G.h - 2.5,
    fontFace: theme.fontBody, fontSize: 18, color: hex(theme.palette.text),
    paraSpaceAfter: 8, valign: 'top',
  });
}

function renderBigStat(
  s: SlideRef,
  slide: Slide,
  theme: Theme,
  imageDataUrl: string | undefined,
  G: Geom,
) {
  s.background = { color: hex(theme.palette.background) };
  const imgW = imageDataUrl ? G.h * 0.65 : 0;
  const statX = 0.8;
  const statW = G.w - imgW - 1.8;

  if (imageDataUrl) {
    s.addImage({
      data: imageDataUrl,
      x: G.w - imgW - 0.7, y: (G.h - imgW) / 2, w: imgW, h: imgW,
      sizing: { type: 'cover', w: imgW, h: imgW },
      rounding: true,
    });
  }

  // Eyebrow at top
  addEyebrow(s, slide.eyebrow, theme, statX, 0.75);
  // Slide title (smaller, descriptive label)
  s.addText(slide.title, {
    x: statX, y: 1.2, w: statW, h: 0.6,
    fontFace: theme.fontBody,
    fontSize: 18,
    color: hex(theme.palette.text),
    align: 'left',
  });
  // The HUGE stat — bigger and more dramatic
  s.addText(slide.stat?.value ?? '', {
    x: statX, y: G.h / 2 - 2.0, w: statW, h: 3.2,
    fontFace: theme.fontHeading,
    fontSize: 180,
    bold: true,
    color: hex(theme.palette.primary),
    align: 'left',
    valign: 'middle',
    charSpacing: -4,
  });
  // Accent rule under stat
  s.addShape('rect', {
    x: statX, y: G.h / 2 + 1.4, w: 0.85, h: 0.08,
    fill: { color: hex(theme.palette.primary) },
    line: { color: hex(theme.palette.primary), width: 0 },
  });
  // Caption under
  s.addText(slide.stat?.label ?? slide.subtitle ?? '', {
    x: statX, y: G.h / 2 + 1.7, w: statW, h: 1.0,
    fontFace: theme.fontBody,
    fontSize: 18,
    color: hex(theme.palette.text),
    align: 'left',
    valign: 'top',
  });
}

function renderFullBleedQuote(
  s: SlideRef,
  slide: Slide,
  theme: Theme,
  imageDataUrl: string | undefined,
  G: Geom,
) {
  if (imageDataUrl) {
    s.addImage({ data: imageDataUrl, x: 0, y: 0, w: G.w, h: G.h, sizing: { type: 'cover', w: G.w, h: G.h } });
    s.addShape('rect', {
      x: 0, y: 0, w: G.w, h: G.h,
      fill: { color: '0A0A0A', transparency: 35 },
      line: { color: '0A0A0A', width: 0 },
    });
  } else {
    s.background = { color: hex(theme.palette.primary) };
  }
  const quote = slide.quote?.text ?? slide.title;
  s.addText(`“${quote}”`, {
    x: 1.0, y: G.h / 2 - 1.6, w: G.w - 2.0, h: 2.5,
    fontFace: theme.fontHeading,
    fontSize: 40,
    italic: true,
    color: 'FFFFFF',
    align: 'center',
    valign: 'middle',
  });
  if (slide.quote?.attribution) {
    s.addText(`— ${slide.quote.attribution}`, {
      x: 1.0, y: G.h / 2 + 1.2, w: G.w - 2.0, h: 0.6,
      fontFace: theme.fontBody,
      fontSize: 18,
      color: 'FFFFFF',
      align: 'center',
      transparency: 15,
    });
  }
}

function renderSectionDivider(
  s: SlideRef,
  slide: Slide,
  theme: Theme,
  imageDataUrl: string | undefined,
  G: Geom,
) {
  if (imageDataUrl) {
    s.addImage({ data: imageDataUrl, x: 0, y: 0, w: G.w, h: G.h, sizing: { type: 'cover', w: G.w, h: G.h } });
    s.addShape('rect', {
      x: 0, y: 0, w: G.w, h: G.h,
      fill: { color: '0A0A0A', transparency: 25 },
      line: { color: '0A0A0A', width: 0 },
    });
  } else {
    s.background = { color: hex(theme.palette.primary) };
  }
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: 0.8, y: G.h / 2 - 1.2, w: G.w - 1.6, h: 0.6,
      fontFace: theme.fontBody,
      fontSize: 18,
      bold: true,
      color: 'FFFFFF',
      align: 'left',
      charSpacing: 6,
      transparency: 30,
    });
  }
  s.addText(slide.title, {
    x: 0.8, y: G.h / 2 - 0.4, w: G.w - 1.6, h: 1.6,
    fontFace: theme.fontHeading,
    fontSize: 64,
    bold: true,
    color: 'FFFFFF',
    align: 'left',
    valign: 'top',
  });
}

function renderComparison(s: SlideRef, slide: Slide, theme: Theme, G: Geom) {
  s.background = { color: hex(theme.palette.background) };
  addEyebrow(s, slide.eyebrow, theme, 0.7, 0.7);
  s.addText(slide.title, {
    x: 0.7, y: 1.05, w: G.w - 1.4, h: 0.9,
    fontFace: theme.fontHeading,
    fontSize: 32,
    bold: true,
    color: hex(theme.palette.text),
  });
  s.addShape('rect', {
    x: 0.7, y: 1.95, w: 0.55, h: 0.06,
    fill: { color: hex(theme.palette.primary) },
    line: { color: hex(theme.palette.primary), width: 0 },
  });

  const c = slide.comparison ?? { leftLabel: '', rightLabel: '', left: [], right: [] };
  const colW = (G.w - 2.0) / 2;
  const colH = G.h - 2.9;
  const colY = 2.3;

  // Left column (lose) — top accent rule + label
  s.addShape('rect', {
    x: 0.7, y: colY, w: colW, h: 0.05,
    fill: { color: hex(theme.palette.muted) },
    line: { color: hex(theme.palette.muted), width: 0 },
  });
  s.addText(c.leftLabel.toUpperCase(), {
    x: 0.7, y: colY + 0.15, w: colW, h: 0.4,
    fontFace: theme.fontHeading, fontSize: 16, bold: true,
    color: hex(theme.palette.muted),
    charSpacing: 3, align: 'left', valign: 'top',
  });
  s.addText(
    c.left.map((t) => ({ text: '×  ' + t, options: { color: hex(theme.palette.muted) } })),
    {
      x: 0.7, y: colY + 0.7, w: colW, h: colH - 0.7,
      fontFace: theme.fontBody, fontSize: 17, color: hex(theme.palette.text),
      paraSpaceAfter: 10, valign: 'top',
    },
  );

  // Right column (win) — top accent rule + label
  s.addShape('rect', {
    x: 0.7 + colW + 0.6, y: colY, w: colW, h: 0.05,
    fill: { color: hex(theme.palette.primary) },
    line: { color: hex(theme.palette.primary), width: 0 },
  });
  s.addText(c.rightLabel.toUpperCase(), {
    x: 0.7 + colW + 0.6, y: colY + 0.15, w: colW, h: 0.4,
    fontFace: theme.fontHeading, fontSize: 16, bold: true,
    color: hex(theme.palette.primary),
    charSpacing: 3, align: 'left', valign: 'top',
  });
  s.addText(
    c.right.map((t) => ({ text: '✓  ' + t, options: { color: hex(theme.palette.primary) } })),
    {
      x: 0.7 + colW + 0.6, y: colY + 0.7, w: colW, h: colH - 0.7,
      fontFace: theme.fontBody, fontSize: 17, color: hex(theme.palette.text),
      paraSpaceAfter: 10, valign: 'top',
    },
  );
}

function renderAgenda(s: SlideRef, slide: Slide, theme: Theme, G: Geom) {
  s.background = { color: hex(theme.palette.background) };
  s.addText(slide.title, {
    x: 0.8, y: 0.7, w: G.w - 1.6, h: 1,
    fontFace: theme.fontHeading,
    fontSize: 36,
    bold: true,
    color: hex(theme.palette.primary),
  });
  const startY = 2.0;
  const rowH = Math.min(0.9, (G.h - startY - 0.5) / Math.max(slide.body.length, 1));
  slide.body.forEach((item, i) => {
    const y = startY + i * rowH;
    s.addText(`${String(i + 1).padStart(2, '0')}`, {
      x: 0.8, y, w: 1.0, h: rowH,
      fontFace: theme.fontHeading, fontSize: 28, bold: true,
      color: hex(theme.palette.secondary),
      align: 'left', valign: 'middle',
    });
    s.addText(item, {
      x: 1.9, y, w: G.w - 2.7, h: rowH,
      fontFace: theme.fontBody, fontSize: 20,
      color: hex(theme.palette.text),
      align: 'left', valign: 'middle',
    });
    if (i < slide.body.length - 1) {
      s.addShape('line', {
        x: 1.9, y: y + rowH - 0.02, w: G.w - 2.7, h: 0,
        line: { color: hex(theme.palette.muted), width: 0.5 },
      });
    }
  });
}

function chartColorsPie(theme: Theme): string[] {
  // Pies need slice differentiation, so cycle through the theme palette
  // (no random rainbow — just 4 muted theme tones, then repeat).
  return [
    hex(theme.palette.primary),
    hex(theme.palette.secondary),
    hex(theme.palette.muted),
    hex(theme.palette.text),
  ];
}

function chartColorsBar(theme: Theme): string[] {
  // Bars look professional when they're ALL the primary accent.
  return [hex(theme.palette.primary)];
}

function renderBarChart(s: SlideRef, slide: Slide, theme: Theme, G: Geom) {
  s.background = { color: hex(theme.palette.background) };
  s.addText(slide.title, {
    x: 0.7, y: 0.6, w: G.w - 1.4, h: 0.9,
    fontFace: theme.fontHeading,
    fontSize: 30,
    bold: true,
    color: hex(theme.palette.primary),
  });
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: 0.7, y: 1.5, w: G.w - 1.4, h: 0.4,
      fontFace: theme.fontBody, fontSize: 14, italic: true,
      color: hex(theme.palette.secondary),
    });
  }
  const c = slide.chart;
  if (!c) return;
  const unit = c.unit ?? '';
  const data = [
    {
      name: slide.title,
      labels: c.labels.map(String),
      values: c.values,
    },
  ];
  s.addChart('bar' as never, data, {
    x: 0.7, y: 2.0, w: G.w - 1.4, h: G.h - 2.7,
    barDir: 'col',
    chartColors: chartColorsBar(theme),
    showLegend: false,
    showTitle: false,
    catAxisLabelFontFace: theme.fontBody,
    catAxisLabelFontSize: 14,
    catAxisLabelColor: hex(theme.palette.text),
    valAxisLabelFontFace: theme.fontBody,
    valAxisLabelFontSize: 12,
    valAxisLabelColor: hex(theme.palette.muted),
    showValue: true,
    dataLabelFontFace: theme.fontBody,
    dataLabelFontSize: 12,
    dataLabelColor: hex(theme.palette.text),
    dataLabelFormatCode: unit ? `0"${unit}"` : '0',
  });
}

function renderPieChart(s: SlideRef, slide: Slide, theme: Theme, G: Geom) {
  s.background = { color: hex(theme.palette.background) };
  s.addText(slide.title, {
    x: 0.7, y: 0.6, w: G.w - 1.4, h: 0.9,
    fontFace: theme.fontHeading,
    fontSize: 30,
    bold: true,
    color: hex(theme.palette.primary),
  });
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: 0.7, y: 1.5, w: G.w - 1.4, h: 0.4,
      fontFace: theme.fontBody, fontSize: 14, italic: true,
      color: hex(theme.palette.secondary),
    });
  }
  const c = slide.chart;
  if (!c) return;
  const unit = c.unit ?? '';
  const data = [
    {
      name: slide.title,
      labels: c.labels.map(String),
      values: c.values,
    },
  ];
  s.addChart('pie' as never, data, {
    x: 0.7, y: 2.0, w: G.w - 1.4, h: G.h - 2.7,
    chartColors: chartColorsPie(theme),
    showLegend: true,
    legendPos: 'r',
    legendFontFace: theme.fontBody,
    legendFontSize: 14,
    legendColor: hex(theme.palette.text),
    showTitle: false,
    showPercent: true,
    dataLabelFontFace: theme.fontBody,
    dataLabelFontSize: 12,
    dataLabelColor: 'FFFFFF',
    dataLabelFormatCode: unit ? `0"${unit}"` : '0',
  });
}

function renderClosingCta(
  s: SlideRef,
  slide: Slide,
  theme: Theme,
  imageDataUrl: string | undefined,
  G: Geom,
) {
  s.background = { color: hex(theme.palette.background) };
  if (imageDataUrl) {
    const imgW = G.w * 0.45;
    s.addImage({
      data: imageDataUrl,
      x: G.w - imgW, y: 0, w: imgW, h: G.h,
      sizing: { type: 'cover', w: imgW, h: G.h },
    });
  }
  const txtW = imageDataUrl ? G.w * 0.55 - 1.2 : G.w - 1.4;
  s.addText(slide.title, {
    x: 0.7, y: G.h / 2 - 1.4, w: txtW, h: 1.6,
    fontFace: theme.fontHeading,
    fontSize: 48,
    bold: true,
    color: hex(theme.palette.primary),
    align: 'left',
    valign: 'bottom',
  });
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: 0.7, y: G.h / 2 + 0.3, w: txtW, h: 0.6,
      fontFace: theme.fontBody, fontSize: 20,
      color: hex(theme.palette.text),
      align: 'left',
    });
  }
  if (slide.body.length) {
    s.addText(
      slide.body.map((t) => ({ text: t, options: { bullet: { code: '25CF' } } })),
      {
        x: 0.7, y: G.h / 2 + 1.0, w: txtW, h: G.h / 2 - 1.5,
        fontFace: theme.fontBody, fontSize: 16,
        color: hex(theme.palette.secondary),
        paraSpaceAfter: 6, valign: 'top',
      },
    );
  }
}

export async function buildPptx(input: ExportInput): Promise<Buffer> {
  const aspect: DeckAspect = input.aspect ?? '16:9';
  const G = geom(aspect);
  const { deck, images } = input;

  const pptx = new PptxGenJS();
  pptx.title = deck.title;
  pptx.layout = aspect === '4:3' ? 'LAYOUT_4x3' : 'LAYOUT_WIDE';

  for (const slide of deck.slides) {
    const s = pptx.addSlide();
    const img = images[slide.n];
    const ctx: ChromeCtx = {
      deckTitle: deck.title,
      pageNum: slide.n,
      pageTotal: deck.slides.length,
    };
    // Slides with full-bleed images need light chrome (white)
    const lightChrome =
      slide.layout === 'title-hero' && !!img
        ? true
        : slide.layout === 'full-bleed-quote' || slide.layout === 'section-divider';

    switch (slide.layout) {
      case 'title-hero':
        renderTitleHero(s, slide, deck.theme, img, G);
        break;
      case 'content-image-right':
        renderContentImage(s, slide, deck.theme, img, G, 'right');
        break;
      case 'content-image-left':
        renderContentImage(s, slide, deck.theme, img, G, 'left');
        break;
      case 'two-column':
        renderTwoColumn(s, slide, deck.theme, G);
        break;
      case 'big-stat':
        renderBigStat(s, slide, deck.theme, img, G);
        break;
      case 'full-bleed-quote':
        renderFullBleedQuote(s, slide, deck.theme, img, G);
        break;
      case 'section-divider':
        renderSectionDivider(s, slide, deck.theme, img, G);
        break;
      case 'comparison':
        renderComparison(s, slide, deck.theme, G);
        break;
      case 'agenda':
        renderAgenda(s, slide, deck.theme, G);
        break;
      case 'bar-chart':
        renderBarChart(s, slide, deck.theme, G);
        break;
      case 'pie-chart':
        renderPieChart(s, slide, deck.theme, G);
        break;
      case 'closing-cta':
        renderClosingCta(s, slide, deck.theme, img, G);
        break;
    }

    addChrome(s, deck.theme, ctx, G, lightChrome);

    if (slide.notes && slide.notes.trim()) {
      s.addNotes(slide.notes);
    }
  }

  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return out;
}
