// Server-side HTML renderer that mirrors SlidePreview.tsx pixel-for-pixel.
// Outputs a complete self-contained HTML document for puppeteer to screenshot.
//
// Design language:
//   - Every slide has top-right deck wordmark + bottom-right page number "01 / 07"
//   - Content slides have an "eyebrow" label above the title (e.g. "01 · PROBLEM")
//   - Title underlined with a primary-color accent rule
//   - Bullet markers are small filled chevrons (▸) in the primary color
//   - Image-bg slides use a dual-stop gradient overlay, not flat dim
//   - Big-stat is dramatically larger (18cqw) with a side accent

import type { Deck, DeckAspect, Slide, Theme } from './types';
import { lucideSvg } from './icon';

const SIZES: Record<DeckAspect, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 },
  '4:3': { w: 1440, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function fontImport(theme: Theme): string {
  const fams = [theme.fontHeading, theme.fontBody]
    .filter(Boolean)
    .map((f) => `family=${encodeURIComponent(f.replace(/\s+/g, '+'))}:wght@400;500;600;700;800;900`);
  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fams.join('&')}&display=swap">`;
}

// --- chrome (page number, deck wordmark, separator) -------------------------

type Chrome = {
  deckTitle: string;
  pageNum: number;
  pageTotal: number;
  // Color overrides (e.g. when slide is dark-image-on-bg, use white chrome)
  chromeColor?: string;
  faintColor?: string;
};

function chromeWrapper(chrome: Chrome, theme: Theme): { topRight: string; bottomRight: string; bottomLeft: string } {
  const c = chrome.chromeColor ?? theme.palette.muted;
  const faint = chrome.faintColor ?? theme.palette.muted;
  const num = String(chrome.pageNum).padStart(2, '0');
  const total = String(chrome.pageTotal).padStart(2, '0');
  return {
    topRight: `<div style="position:absolute; top:3.5%; right:4%; font-family:'${theme.fontBody}',sans-serif; font-size:0.85cqw; font-weight:600; letter-spacing:0.25em; text-transform:uppercase; color:${c}; opacity:0.7; z-index:10;">${escapeHtml(chrome.deckTitle.slice(0, 40))}</div>`,
    bottomRight: `<div style="position:absolute; bottom:3.5%; right:4%; font-family:'${theme.fontBody}',sans-serif; font-size:0.85cqw; font-weight:600; letter-spacing:0.2em; color:${c}; opacity:0.7; z-index:10;">${num} <span style="opacity:0.5;">/ ${total}</span></div>`,
    bottomLeft: `<div style="position:absolute; bottom:3.5%; left:4%; width:3cqw; height:0.15cqw; background:${faint}; opacity:0.4; z-index:10;"></div>`,
  };
}

function eyebrowEl(slide: Slide, theme: Theme, color?: string): string {
  if (!slide.eyebrow && !slide.icon) return '';
  const c = color ?? theme.palette.primary;
  const iconSvg = slide.icon ? lucideSvg(slide.icon, { color: c, size: 28, strokeWidth: 2.4 }) : '';
  const iconWrap = iconSvg
    ? `<span style="display:inline-flex; align-items:center; justify-content:center; width:2.6cqw; height:2.6cqw; flex-shrink:0;">${iconSvg.replace('width="28"', 'width="100%"').replace('height="28"', 'height="100%"')}</span>`
    : '';
  return `<div style="display:flex; align-items:center; gap:0.8cqw; margin-bottom:1.2cqw;">
    ${iconWrap || `<span style="display:inline-block; width:2cqw; height:0.18cqw; background:${c};"></span>`}
    ${slide.eyebrow ? `<span style="font-family:'${theme.fontBody}',sans-serif; font-size:1.05cqw; font-weight:700; letter-spacing:0.3em; text-transform:uppercase; color:${c};">
      ${escapeHtml(slide.eyebrow)}
    </span>` : ''}
  </div>`;
}

/** Decorative SVG accents in slide corners. Subtle theme-tinted dot grid + accent shape. */
function decoration(theme: Theme, opts: { kind?: 'dots' | 'corner-grid' | 'orb'; color?: string } = {}): string {
  const c = opts.color ?? theme.palette.primary;
  const kind = opts.kind ?? 'dots';
  if (kind === 'dots') {
    // 6×6 grid of small dots, faint, top-right corner
    let dots = '';
    for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) {
      dots += `<circle cx="${10 + g * 14}" cy="${10 + r * 14}" r="1.6" fill="${c}" opacity="0.35"/>`;
    }
    return `<svg style="position:absolute; top:5%; right:6%; width:8cqw; height:8cqw; pointer-events:none;" viewBox="0 0 100 100">${dots}</svg>`;
  }
  if (kind === 'orb') {
    return `<svg style="position:absolute; bottom:-10%; right:-8%; width:30cqw; height:30cqw; pointer-events:none; opacity:0.08;" viewBox="0 0 200 200"><defs><radialGradient id="og" cx="0.5" cy="0.5" r="0.5"><stop offset="0%" stop-color="${c}" stop-opacity="1"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></radialGradient></defs><circle cx="100" cy="100" r="100" fill="url(#og)"/></svg>`;
  }
  // corner-grid (4 short lines)
  return `<svg style="position:absolute; bottom:5%; left:6%; width:5cqw; height:5cqw; pointer-events:none;" viewBox="0 0 60 60"><g stroke="${c}" stroke-width="1.5" opacity="0.45"><line x1="0" y1="20" x2="20" y2="20"/><line x1="0" y1="40" x2="40" y2="40"/><line x1="0" y1="60" x2="60" y2="60"/><line x1="20" y1="0" x2="20" y2="20"/><line x1="40" y1="0" x2="40" y2="40"/></g></svg>`;
}

function bullets(items: string[], color: string, fontSize = '1.7cqw', textColor?: string, fontFamily = 'inherit'): string {
  return items
    .map(
      (b) => `
    <li style="display:flex; gap:1.2cqw; align-items:baseline; line-height:1.4;">
      <span style="font-size:${fontSize}; color:${color}; font-weight:700; flex-shrink:0;">▸</span>
      <span style="font-family:${fontFamily}; font-size:${fontSize}; color:${textColor ?? 'inherit'};">${escapeHtml(b)}</span>
    </li>`,
    )
    .join('');
}

// --- per-layout HTML --------------------------------------------------------

function titleHero(slide: Slide, theme: Theme, img: string | undefined, chrome: Chrome): string {
  const hasImg = !!img;
  const titleColor = hasImg ? '#ffffff' : theme.palette.primary;
  const subColor = hasImg ? 'rgba(255,255,255,0.85)' : theme.palette.text;
  const ch = chromeWrapper({ ...chrome, chromeColor: hasImg ? 'rgba(255,255,255,0.7)' : theme.palette.muted, faintColor: hasImg ? 'rgba(255,255,255,0.4)' : theme.palette.muted }, theme);
  return `
  ${
    hasImg
      ? `<img src="${img}" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover;">
         <div style="position:absolute; inset:0; background:linear-gradient(135deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.35) 50%, rgba(0,0,0,0.6) 100%);"></div>`
      : ''
  }
  ${ch.topRight}
  <div style="position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; padding:0 6%;">
    ${slide.eyebrow ? `
      <div style="display:flex; align-items:center; gap:0.8cqw; margin-bottom:2cqw;">
        <span style="display:inline-block; width:3cqw; height:0.2cqw; background:${theme.palette.primary};"></span>
        <span style="font-family:'${theme.fontBody}',sans-serif; font-size:1.1cqw; font-weight:700; letter-spacing:0.35em; text-transform:uppercase; color:${theme.palette.primary};">
          ${escapeHtml(slide.eyebrow)}
        </span>
      </div>` : ''}
    <h1 style="font-family:'${theme.fontHeading}',sans-serif; font-size:9.5cqw; font-weight:800; line-height:0.92; letter-spacing:-0.035em; color:${titleColor}; margin:0;">
      ${escapeHtml(slide.title)}
    </h1>
    ${
      slide.subtitle
        ? `<p style="margin-top:2cqw; padding-left:2cqw; border-left:0.3cqw solid ${theme.palette.primary}; font-family:'${theme.fontBody}',sans-serif; font-size:2cqw; font-weight:400; max-width:65%; color:${subColor}; margin-bottom:0;">${escapeHtml(slide.subtitle)}</p>`
        : ''
    }
  </div>
  ${ch.bottomRight}
  ${ch.bottomLeft}`;
}

function contentImage(slide: Slide, theme: Theme, img: string | undefined, side: 'left' | 'right', chrome: Chrome): string {
  const ch = chromeWrapper(chrome, theme);
  const decoEl = decoration(theme, { kind: 'dots' });
  const txt = `
    <div style="display:flex; flex-direction:column; justify-content:center; padding:6% 5%; width:50%;">
      ${eyebrowEl(slide, theme)}
      <h2 style="font-family:'${theme.fontHeading}',sans-serif; font-size:3.6cqw; font-weight:700; line-height:1.08; color:${theme.palette.text}; margin:0;">
        ${escapeHtml(slide.title)}
      </h2>
      <div style="margin-top:1.4cqw; height:0.2cqw; width:5.5cqw; background:${theme.palette.primary};"></div>
      ${
        slide.subtitle
          ? `<p style="margin-top:1.4cqw; font-style:italic; font-size:1.5cqw; font-family:'${theme.fontBody}',sans-serif; color:${theme.palette.secondary}; margin-bottom:0;">${escapeHtml(slide.subtitle)}</p>`
          : ''
      }
      <ul style="margin-top:2.4cqw; list-style:none; padding:0; display:flex; flex-direction:column; gap:1.4cqw; color:${theme.palette.text};">
        ${bullets(slide.body, theme.palette.primary, '1.6cqw', theme.palette.text, `'${theme.fontBody}',sans-serif`)}
      </ul>
    </div>`;
  const image = `
    <div style="width:50%; height:100%; overflow:hidden; position:relative; background:${theme.palette.muted};">
      ${img ? `<img src="${img}" style="width:100%; height:100%; object-fit:cover;">` : ''}
      ${img ? `<div style="position:absolute; inset:0; background:linear-gradient(${side === 'right' ? '270deg' : '90deg'}, transparent 70%, ${theme.palette.background} 100%); pointer-events:none;"></div>` : ''}
    </div>`;
  return `<div style="position:absolute; inset:0; display:flex;">${side === 'left' ? image + txt : txt + image}</div>${decoEl}${ch.topRight}${ch.bottomRight}${ch.bottomLeft}`;
}

function twoColumn(slide: Slide, theme: Theme, chrome: Chrome): string {
  const ch = chromeWrapper(chrome, theme);
  const half = Math.ceil(slide.body.length / 2);
  return `
  ${ch.topRight}
  <div style="position:absolute; inset:0; padding:6% 5% 5%; display:flex; flex-direction:column;">
    ${eyebrowEl(slide, theme)}
    <h2 style="font-family:'${theme.fontHeading}',sans-serif; font-size:3.6cqw; font-weight:700; color:${theme.palette.text}; margin:0;">
      ${escapeHtml(slide.title)}
    </h2>
    <div style="margin-top:1.4cqw; height:0.2cqw; width:5.5cqw; background:${theme.palette.primary};"></div>
    <div style="margin-top:3cqw; flex:1; display:grid; grid-template-columns:1fr 1fr; gap:4cqw; align-content:start;">
      ${[slide.body.slice(0, half), slide.body.slice(half)]
        .map(
          (col) => `
        <ul style="list-style:none; padding:0; display:flex; flex-direction:column; gap:1.4cqw; color:${theme.palette.text};">
          ${bullets(col, theme.palette.primary, '1.7cqw', theme.palette.text, `'${theme.fontBody}',sans-serif`)}
        </ul>`,
        )
        .join('')}
    </div>
  </div>
  ${ch.bottomRight}${ch.bottomLeft}`;
}

function bigStat(slide: Slide, theme: Theme, img: string | undefined, chrome: Chrome): string {
  const ch = chromeWrapper(chrome, theme);
  const value = slide.stat?.value ?? slide.title;
  const label = slide.stat?.label ?? slide.subtitle ?? '';
  const decoEl = decoration(theme, { kind: 'orb' });
  return `
  ${decoEl}
  ${ch.topRight}
  <div style="position:absolute; inset:0; display:grid; grid-template-columns: 1fr ${img ? 'auto' : ''}; gap:4cqw; padding:6% 5%; align-items:center;">
    <div style="display:flex; flex-direction:column;">
      ${eyebrowEl(slide, theme)}
      <p style="font-family:'${theme.fontBody}',sans-serif; font-size:1.4cqw; font-weight:600; color:${theme.palette.text}; max-width:75%; margin:0; opacity:0.9;">
        ${escapeHtml(slide.title)}
      </p>
      <div style="margin-top:1.4cqw; font-family:'${theme.fontHeading}',sans-serif; font-size:18cqw; font-weight:900; line-height:0.85; letter-spacing:-0.05em; color:${theme.palette.primary};">
        ${escapeHtml(value)}
      </div>
      <div style="margin-top:1.5cqw; height:0.25cqw; width:8cqw; background:${theme.palette.primary};"></div>
      <p style="margin-top:1.4cqw; font-family:'${theme.fontBody}',sans-serif; font-size:1.7cqw; max-width:75%; color:${theme.palette.text}; line-height:1.4; margin-bottom:0;">
        ${escapeHtml(label)}
      </p>
    </div>
    ${
      img
        ? `<div style="width:50cqh; height:50cqh; border-radius:50%; overflow:hidden; box-shadow: 0 30px 80px rgba(0,0,0,0.4);">
             <img src="${img}" style="width:100%; height:100%; object-fit:cover;">
           </div>`
        : ''
    }
  </div>
  ${ch.bottomRight}${ch.bottomLeft}`;
}

function fullBleedQuote(slide: Slide, theme: Theme, img: string | undefined, chrome: Chrome): string {
  const ch = chromeWrapper({ ...chrome, chromeColor: 'rgba(255,255,255,0.7)', faintColor: 'rgba(255,255,255,0.3)' }, theme);
  return `
  ${
    img
      ? `<img src="${img}" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover;">
         <div style="position:absolute; inset:0; background:linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 50%, rgba(0,0,0,0.6) 100%);"></div>`
      : `<div style="position:absolute; inset:0; background:linear-gradient(135deg, ${theme.palette.primary} 0%, ${theme.palette.secondary} 100%);"></div>`
  }
  <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:0 10%;">
    <div style="font-family:'${theme.fontHeading}',sans-serif; font-size:8cqw; font-weight:700; line-height:0.5; color:${theme.palette.primary}; opacity:0.9; margin-bottom:0.5cqw;">"</div>
    <p style="font-family:'${theme.fontHeading}',sans-serif; font-size:3.8cqw; font-style:italic; font-weight:500; line-height:1.25; color:#ffffff; max-width:80%; margin:0;">
      ${escapeHtml(slide.quote?.text ?? slide.title)}
    </p>
    ${
      slide.quote?.attribution
        ? `<div style="margin-top:3cqw; display:flex; align-items:center; gap:1cqw;">
             <div style="width:2.5cqw; height:0.2cqw; background:#ffffff; opacity:0.6;"></div>
             <p style="font-family:'${theme.fontBody}',sans-serif; font-size:1.5cqw; font-weight:600; letter-spacing:0.1em; color:rgba(255,255,255,0.85); margin:0;">${escapeHtml(slide.quote.attribution)}</p>
           </div>`
        : ''
    }
  </div>
  ${ch.topRight}${ch.bottomRight}${ch.bottomLeft}`;
}

function sectionDivider(slide: Slide, theme: Theme, img: string | undefined, chrome: Chrome): string {
  const ch = chromeWrapper({ ...chrome, chromeColor: 'rgba(255,255,255,0.7)', faintColor: 'rgba(255,255,255,0.3)' }, theme);
  return `
  ${
    img
      ? `<img src="${img}" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover;">
         <div style="position:absolute; inset:0; background:linear-gradient(135deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.4) 100%);"></div>`
      : `<div style="position:absolute; inset:0; background:linear-gradient(135deg, ${theme.palette.primary} 0%, ${theme.palette.secondary} 100%);"></div>`
  }
  <div style="position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; padding:0 6%;">
    <div style="display:flex; align-items:center; gap:1.2cqw; margin-bottom:2cqw;">
      <span style="display:inline-block; width:5cqw; height:0.25cqw; background:#ffffff; opacity:0.8;"></span>
      <span style="font-family:'${theme.fontBody}',sans-serif; font-size:1.3cqw; font-weight:700; letter-spacing:0.4em; text-transform:uppercase; color:rgba(255,255,255,0.85);">
        ${escapeHtml(slide.subtitle ?? slide.eyebrow ?? `Section ${chrome.pageNum}`)}
      </span>
    </div>
    <h2 style="font-family:'${theme.fontHeading}',sans-serif; font-size:8cqw; font-weight:800; line-height:0.95; letter-spacing:-0.02em; color:#ffffff; margin:0; max-width:85%;">
      ${escapeHtml(slide.title)}
    </h2>
  </div>
  ${ch.topRight}${ch.bottomRight}${ch.bottomLeft}`;
}

function comparison(slide: Slide, theme: Theme, chrome: Chrome): string {
  const ch = chromeWrapper(chrome, theme);
  const c = slide.comparison ?? { leftLabel: '', rightLabel: '', left: [], right: [] };
  return `
  ${ch.topRight}
  <div style="position:absolute; inset:0; padding:5% 5% 6%; display:flex; flex-direction:column;">
    ${eyebrowEl(slide, theme)}
    <h2 style="font-family:'${theme.fontHeading}',sans-serif; font-size:3.4cqw; font-weight:700; line-height:1.1; color:${theme.palette.text}; margin:0;">
      ${escapeHtml(slide.title)}
    </h2>
    <div style="margin-top:1.4cqw; height:0.2cqw; width:5.5cqw; background:${theme.palette.primary};"></div>
    <div style="margin-top:2.6cqw; display:grid; grid-template-columns:1fr 1fr; gap:2.5cqw; flex:1;">
      ${[
        { label: c.leftLabel, items: c.left, mark: '×', accent: theme.palette.muted, isWin: false },
        { label: c.rightLabel, items: c.right, mark: '✓', accent: theme.palette.primary, isWin: true },
      ]
        .map(
          (col) => `
        <div style="display:flex; flex-direction:column; border-top:0.25cqw solid ${col.accent};">
          <div style="font-family:'${theme.fontHeading}',sans-serif; font-size:1.5cqw; font-weight:700; letter-spacing:0.15em; text-transform:uppercase; padding:1.4cqw 0 0.4cqw; color:${col.accent};">
            ${escapeHtml(col.label)}
          </div>
          <ul style="flex:1; margin-top:0.5cqw; padding:0; list-style:none; display:flex; flex-direction:column; justify-content:flex-start; gap:1.4cqw; font-family:'${theme.fontBody}',sans-serif; font-size:1.7cqw; line-height:1.4; color:${theme.palette.text};">
            ${col.items.map((it) => `
              <li style="display:flex; gap:1cqw; align-items:baseline;">
                <span style="font-weight:800; color:${col.accent}; flex-shrink:0; font-size:1.6cqw;">${col.mark}</span>
                <span>${escapeHtml(it)}</span>
              </li>`).join('')}
          </ul>
        </div>`,
        )
        .join('')}
    </div>
  </div>
  ${ch.bottomRight}${ch.bottomLeft}`;
}

function agenda(slide: Slide, theme: Theme, chrome: Chrome): string {
  const ch = chromeWrapper(chrome, theme);
  const decoEl = decoration(theme, { kind: 'corner-grid' });
  return `
  ${decoEl}
  ${ch.topRight}
  <div style="position:absolute; inset:0; padding:6% 6% 5%; display:flex; flex-direction:column;">
    ${eyebrowEl(slide, theme)}
    <h2 style="font-family:'${theme.fontHeading}',sans-serif; font-size:3.6cqw; font-weight:700; color:${theme.palette.text}; margin:0;">
      ${escapeHtml(slide.title)}
    </h2>
    <div style="margin-top:1.4cqw; height:0.2cqw; width:5.5cqw; background:${theme.palette.primary};"></div>
    <ol style="margin-top:3cqw; flex:1; list-style:none; padding:0; display:flex; flex-direction:column; justify-content:space-around;">
      ${slide.body
        .map(
          (item, i) => `
        <li style="display:flex; align-items:center; gap:2.5cqw; border-bottom:1px solid ${theme.palette.muted}33; padding:1.2cqw 0;">
          <span style="font-family:'${theme.fontHeading}',sans-serif; font-size:3cqw; font-weight:800; min-width:5cqw; color:${theme.palette.primary}; line-height:1;">${String(i + 1).padStart(2, '0')}</span>
          <span style="font-family:'${theme.fontBody}',sans-serif; font-size:2cqw; color:${theme.palette.text}; font-weight:500;">${escapeHtml(item)}</span>
        </li>`,
        )
        .join('')}
    </ol>
  </div>
  ${ch.bottomRight}${ch.bottomLeft}`;
}

function barChart(slide: Slide, theme: Theme, chrome: Chrome): string {
  const ch = chromeWrapper(chrome, theme);
  const c = slide.chart;
  if (!c) return ch.topRight + ch.bottomRight + ch.bottomLeft;
  const max = Math.max(...c.values, 1);
  const unit = c.unit ?? '';
  return `
  ${ch.topRight}
  <div style="position:absolute; inset:0; padding:5% 5% 6%; display:flex; flex-direction:column;">
    ${eyebrowEl(slide, theme)}
    <h2 style="font-family:'${theme.fontHeading}',sans-serif; font-size:3.4cqw; font-weight:700; line-height:1.1; color:${theme.palette.text}; margin:0;">
      ${escapeHtml(slide.title)}
    </h2>
    <div style="margin-top:1.4cqw; height:0.2cqw; width:5.5cqw; background:${theme.palette.primary};"></div>
    ${
      slide.subtitle
        ? `<p style="margin-top:1cqw; font-family:'${theme.fontBody}',sans-serif; font-size:1.4cqw; font-style:italic; color:${theme.palette.secondary}; margin-bottom:0;">${escapeHtml(slide.subtitle)}</p>`
        : ''
    }
    <div style="flex:1; margin-top:2.5cqw; display:flex; align-items:flex-end; gap:2cqw; padding:0 1cqw;">
      ${c.values
        .map(
          (v, i) => `
        <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%;">
          <div style="font-family:'${theme.fontHeading}',sans-serif; font-size:1.6cqw; font-weight:800; margin-bottom:0.6cqw; color:${theme.palette.text}; letter-spacing:-0.01em;">
            ${escapeHtml(String(v))}${escapeHtml(unit)}
          </div>
          <div style="width:100%; height:${Math.max((v / max) * 100, 3)}%; background:linear-gradient(180deg, ${theme.palette.primary} 0%, ${theme.palette.primary}cc 100%); border-top-left-radius:6px; border-top-right-radius:6px;"></div>
          <div style="margin-top:0.9cqw; font-family:'${theme.fontBody}',sans-serif; font-size:1.2cqw; font-weight:500; color:${theme.palette.muted};">
            ${escapeHtml(String(c.labels[i]))}
          </div>
        </div>`,
        )
        .join('')}
    </div>
  </div>
  ${ch.bottomRight}${ch.bottomLeft}`;
}

function pieChart(slide: Slide, theme: Theme, chrome: Chrome): string {
  const ch = chromeWrapper(chrome, theme);
  const c = slide.chart;
  if (!c) return ch.topRight + ch.bottomRight + ch.bottomLeft;
  const colors = [theme.palette.primary, theme.palette.secondary, theme.palette.muted, theme.palette.text];
  const total = c.values.reduce((a, b) => a + b, 0) || 1;
  const r = 95;
  const cx = 100;
  const cy = 100;
  let acc = 0;
  const slices = c.values
    .map((v, i) => {
      const start = (acc / total) * 2 * Math.PI - Math.PI / 2;
      acc += v;
      const end = (acc / total) * 2 * Math.PI - Math.PI / 2;
      const x1 = cx + r * Math.cos(start);
      const y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const large = end - start > Math.PI ? 1 : 0;
      return `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${colors[i % colors.length]}" stroke="${theme.palette.background}" stroke-width="1.5"/>`;
    })
    .join('');
  return `
  ${ch.topRight}
  <div style="position:absolute; inset:0; padding:5% 5% 6%; display:flex; flex-direction:column;">
    ${eyebrowEl(slide, theme)}
    <h2 style="font-family:'${theme.fontHeading}',sans-serif; font-size:3.4cqw; font-weight:700; line-height:1.1; color:${theme.palette.text}; margin:0;">
      ${escapeHtml(slide.title)}
    </h2>
    <div style="margin-top:1.4cqw; height:0.2cqw; width:5.5cqw; background:${theme.palette.primary};"></div>
    <div style="flex:1; margin-top:2.5cqw; display:grid; grid-template-columns:auto 1fr; gap:5cqw; align-items:center;">
      <div style="display:flex; justify-content:center;">
        <svg viewBox="0 0 200 200" style="width:60cqh; height:60cqh; max-width:100%;">${slices}</svg>
      </div>
      <ul style="list-style:none; padding:0; display:flex; flex-direction:column; gap:1.4cqw; font-family:'${theme.fontBody}',sans-serif; color:${theme.palette.text};">
        ${c.labels
          .map(
            (label, i) => `
          <li style="display:flex; align-items:center; gap:1.2cqw; font-size:1.6cqw;">
            <span style="width:1.4cqw; height:1.4cqw; border-radius:3px; background:${colors[i % colors.length]}; flex-shrink:0;"></span>
            <span style="flex:1; font-weight:500;">${escapeHtml(label)}</span>
            <span style="opacity:0.7; font-variant-numeric:tabular-nums; font-weight:700;">${Math.round((c.values[i] / total) * 100)}%</span>
          </li>`,
          )
          .join('')}
      </ul>
    </div>
  </div>
  ${ch.bottomRight}${ch.bottomLeft}`;
}

function closingCta(slide: Slide, theme: Theme, img: string | undefined, chrome: Chrome): string {
  const ch = chromeWrapper(chrome, theme);
  const cols = img ? '58% 42%' : '1fr';
  return `
  <div style="position:absolute; inset:0; display:grid; grid-template-columns:${cols};">
    <div style="display:flex; flex-direction:column; justify-content:center; padding:6% 5%;">
      ${eyebrowEl(slide, theme)}
      <h2 style="font-family:'${theme.fontHeading}',sans-serif; font-size:5.5cqw; font-weight:800; line-height:0.98; letter-spacing:-0.02em; color:${theme.palette.text}; margin:0;">
        ${escapeHtml(slide.title)}
      </h2>
      <div style="margin-top:1.6cqw; height:0.25cqw; width:6cqw; background:${theme.palette.primary};"></div>
      ${
        slide.subtitle
          ? `<p style="margin-top:1.6cqw; font-family:'${theme.fontBody}',sans-serif; font-size:1.7cqw; color:${theme.palette.text}; max-width:90%; opacity:0.9; margin-bottom:0;">${escapeHtml(slide.subtitle)}</p>`
          : ''
      }
      ${
        slide.body.length
          ? `<ul style="margin-top:2.5cqw; list-style:none; padding:0; display:flex; flex-direction:column; gap:1.2cqw;">
              ${slide.body.map((b) => `
                <li style="display:flex; align-items:center; gap:1.2cqw; padding:1cqw 1.4cqw; background:${theme.palette.primary}1A; border-left:0.25cqw solid ${theme.palette.primary}; border-radius:4px; font-family:'${theme.fontBody}',sans-serif; font-size:1.5cqw; color:${theme.palette.text}; font-weight:500;">
                  <span style="color:${theme.palette.primary}; font-weight:800;">→</span>
                  <span>${escapeHtml(b)}</span>
                </li>`).join('')}
            </ul>`
          : ''
      }
    </div>
    ${img ? `
      <div style="width:100%; height:100%; overflow:hidden; position:relative;">
        <img src="${img}" style="width:100%; height:100%; object-fit:cover;">
        <div style="position:absolute; inset:0; background:linear-gradient(90deg, ${theme.palette.background} 0%, transparent 25%);"></div>
      </div>` : ''}
  </div>
  ${ch.topRight}${ch.bottomRight}${ch.bottomLeft}`;
}

// --- top-level --------------------------------------------------------------

export function renderSlideHtml(input: {
  slide: Slide;
  theme: Theme;
  imageDataUrl?: string;
  aspect?: DeckAspect;
  chrome?: { deckTitle: string; pageTotal: number };
}): { html: string; width: number; height: number } {
  const { slide, theme, imageDataUrl, aspect = '16:9' } = input;
  const { w, h } = SIZES[aspect];

  const chrome: Chrome = {
    deckTitle: input.chrome?.deckTitle ?? '',
    pageNum: slide.n,
    pageTotal: input.chrome?.pageTotal ?? slide.n,
  };

  let body = '';
  switch (slide.layout) {
    case 'title-hero':
      body = titleHero(slide, theme, imageDataUrl, chrome);
      break;
    case 'content-image-right':
      body = contentImage(slide, theme, imageDataUrl, 'right', chrome);
      break;
    case 'content-image-left':
      body = contentImage(slide, theme, imageDataUrl, 'left', chrome);
      break;
    case 'two-column':
      body = twoColumn(slide, theme, chrome);
      break;
    case 'big-stat':
      body = bigStat(slide, theme, imageDataUrl, chrome);
      break;
    case 'full-bleed-quote':
      body = fullBleedQuote(slide, theme, imageDataUrl, chrome);
      break;
    case 'section-divider':
      body = sectionDivider(slide, theme, imageDataUrl, chrome);
      break;
    case 'comparison':
      body = comparison(slide, theme, chrome);
      break;
    case 'agenda':
      body = agenda(slide, theme, chrome);
      break;
    case 'bar-chart':
      body = barChart(slide, theme, chrome);
      break;
    case 'pie-chart':
      body = pieChart(slide, theme, chrome);
      break;
    case 'closing-cta':
      body = closingCta(slide, theme, imageDataUrl, chrome);
      break;
  }

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
${fontImport(theme)}
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: ${theme.palette.background}; color: ${theme.palette.text}; }
  .slide {
    position: relative;
    width: ${w}px;
    height: ${h}px;
    overflow: hidden;
    container-type: size;
    background: ${theme.palette.background};
  }
</style>
</head>
<body>
<div class="slide">${body}</div>
</body>
</html>`;

  return { html, width: w, height: h };
}

export type RenderArgs = Parameters<typeof renderSlideHtml>[0];

export function inputFromDeckSlide(deck: Deck, n: number, imageDataUrl?: string, aspect?: DeckAspect) {
  const slide = deck.slides.find((s) => s.n === n);
  if (!slide) throw new Error(`slide ${n} not found`);
  return {
    slide,
    theme: deck.theme,
    imageDataUrl,
    aspect,
    chrome: { deckTitle: deck.title, pageTotal: deck.slides.length },
  };
}
