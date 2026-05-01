// HTML/CSS preview that mirrors the slide-html.ts server renderer.
// In-browser preview only; same chrome (eyebrows, page number, deck wordmark, accent lines).

'use client';

import type { ComponentType, SVGProps } from 'react';
import * as LucideIcons from 'lucide-react';
import type { Slide, Theme, DeckAspect } from '@/lib/types';

function pascalCase(kebab: string): string {
  return kebab.split(/[-_\s]+/).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number }>;

function lookupIcon(name?: string): LucideIcon | null {
  if (!name) return null;
  const map = LucideIcons as unknown as Record<string, LucideIcon>;
  return (map[name] || map[pascalCase(name)] || null) as LucideIcon | null;
}

type ChromeCtx = {
  deckTitle: string;
  pageTotal: number;
};

type Props = {
  slide: Slide;
  theme: Theme;
  imageDataUrl?: string;
  aspect?: DeckAspect;
  className?: string;
  /** Optional context: deck wordmark + total page count for chrome rendering */
  chrome?: ChromeCtx;
};

function fonts(theme: Theme) {
  return {
    h: `'${theme.fontHeading}', system-ui, sans-serif`,
    b: `'${theme.fontBody}', system-ui, sans-serif`,
  };
}

const PIE_CYCLE = (theme: Theme) => [
  theme.palette.primary,
  theme.palette.secondary,
  theme.palette.muted,
  theme.palette.text,
];

export function SlidePreview({ slide, theme, imageDataUrl, aspect = '16:9', className, chrome }: Props) {
  const f = fonts(theme);
  const aspectClass = aspect === '4:3' ? 'aspect-[4/3]' : 'aspect-video';
  const ctx = { deckTitle: chrome?.deckTitle ?? '', pageNum: slide.n, pageTotal: chrome?.pageTotal ?? slide.n };

  return (
    <div
      className={`relative overflow-hidden ${aspectClass} ${className ?? ''}`}
      style={{ background: theme.palette.background, color: theme.palette.text, containerType: 'size' }}
    >
      {slide.layout === 'title-hero' && <TitleHero slide={slide} theme={theme} img={imageDataUrl} f={f} ctx={ctx} />}
      {slide.layout === 'content-image-right' && <ContentImage slide={slide} theme={theme} img={imageDataUrl} f={f} ctx={ctx} side="right" />}
      {slide.layout === 'content-image-left' && <ContentImage slide={slide} theme={theme} img={imageDataUrl} f={f} ctx={ctx} side="left" />}
      {slide.layout === 'two-column' && <TwoColumn slide={slide} theme={theme} f={f} ctx={ctx} />}
      {slide.layout === 'big-stat' && <BigStat slide={slide} theme={theme} img={imageDataUrl} f={f} ctx={ctx} />}
      {slide.layout === 'full-bleed-quote' && <FullBleedQuote slide={slide} theme={theme} img={imageDataUrl} f={f} ctx={ctx} />}
      {slide.layout === 'section-divider' && <SectionDivider slide={slide} theme={theme} img={imageDataUrl} f={f} ctx={ctx} />}
      {slide.layout === 'comparison' && <Comparison slide={slide} theme={theme} f={f} ctx={ctx} />}
      {slide.layout === 'agenda' && <Agenda slide={slide} theme={theme} f={f} ctx={ctx} />}
      {slide.layout === 'bar-chart' && <BarChart slide={slide} theme={theme} f={f} ctx={ctx} />}
      {slide.layout === 'pie-chart' && <PieChart slide={slide} theme={theme} f={f} ctx={ctx} />}
      {slide.layout === 'closing-cta' && <ClosingCta slide={slide} theme={theme} img={imageDataUrl} f={f} ctx={ctx} />}
    </div>
  );
}

type Ctx = { deckTitle: string; pageNum: number; pageTotal: number };
type Fonts = { h: string; b: string };

function Chrome({ theme, ctx, light, f }: { theme: Theme; ctx: Ctx; light?: boolean; f: Fonts }) {
  const c = light ? 'rgba(255,255,255,0.7)' : theme.palette.muted;
  const num = String(ctx.pageNum).padStart(2, '0');
  const total = String(ctx.pageTotal).padStart(2, '0');
  return (
    <>
      <div
        className="absolute top-[3.5%] right-[4%] z-10 truncate"
        style={{
          maxWidth: '50%',
          fontFamily: f.b,
          fontSize: '0.85cqw',
          fontWeight: 600,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: c,
          opacity: 0.7,
          whiteSpace: 'nowrap',
        }}
      >
        {ctx.deckTitle}
      </div>
      <div
        className="absolute bottom-[3.5%] right-[4%] z-10"
        style={{ fontFamily: f.b, fontSize: '0.85cqw', fontWeight: 600, letterSpacing: '0.2em', color: c, opacity: 0.7 }}
      >
        {num} <span style={{ opacity: 0.5 }}>/ {total}</span>
      </div>
      <div
        className="absolute bottom-[3.5%] left-[4%] z-10"
        style={{ width: '3cqw', height: '0.15cqw', background: c, opacity: 0.4 }}
      />
    </>
  );
}

function Eyebrow({ text, icon, theme, color, f }: { text?: string; icon?: string; theme: Theme; color?: string; f: Fonts }) {
  if (!text && !icon) return null;
  const c = color ?? theme.palette.primary;
  const Icon = lookupIcon(icon);
  return (
    <div className="flex items-center gap-[0.8cqw] mb-[1.2cqw]">
      {Icon ? (
        <span className="inline-flex items-center justify-center shrink-0" style={{ width: '2.6cqw', height: '2.6cqw', color: c }}>
          <Icon size="100%" strokeWidth={2.4} />
        </span>
      ) : (
        <span style={{ display: 'inline-block', width: '2cqw', height: '0.18cqw', background: c }} />
      )}
      {text && (
        <span style={{ fontFamily: f.b, fontSize: '1.05cqw', fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase', color: c }}>
          {text}
        </span>
      )}
    </div>
  );
}

function Bullets({ items, theme, f, fontSize = '1.7cqw', textColor }: { items: string[]; theme: Theme; f: Fonts; fontSize?: string; textColor?: string }) {
  return (
    <ul className="list-none p-0 flex flex-col gap-[1.4cqw]">
      {items.map((it, i) => (
        <li key={i} className="flex gap-[1.2cqw] items-baseline" style={{ lineHeight: 1.4 }}>
          <span style={{ fontSize, color: theme.palette.primary, fontWeight: 700, flexShrink: 0 }}>▸</span>
          <span style={{ fontFamily: f.b, fontSize, color: textColor ?? theme.palette.text }}>{it}</span>
        </li>
      ))}
    </ul>
  );
}

// --- layouts ----------------------------------------------------------------

function TitleHero({ slide, theme, img, f, ctx }: { slide: Slide; theme: Theme; img?: string; f: Fonts; ctx: Ctx }) {
  return (
    <>
      {img && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(135deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.35) 50%, rgba(0,0,0,0.6) 100%)' }}
          />
        </>
      )}
      <div className="absolute inset-0 flex flex-col justify-center px-[6%]">
        {slide.eyebrow && (
          <div className="flex items-center gap-[0.8cqw] mb-[2cqw]">
            <span style={{ display: 'inline-block', width: '3cqw', height: '0.2cqw', background: theme.palette.primary }} />
            <span style={{ fontFamily: f.b, fontSize: '1.1cqw', fontWeight: 700, letterSpacing: '0.35em', textTransform: 'uppercase', color: theme.palette.primary }}>
              {slide.eyebrow}
            </span>
          </div>
        )}
        <h1
          className="text-[9.5cqw] leading-[0.92] tracking-tight font-extrabold m-0"
          style={{ fontFamily: f.h, color: img ? '#fff' : theme.palette.primary }}
        >
          {slide.title}
        </h1>
        {slide.subtitle && (
          <p
            className="mt-[2cqw] pl-[2cqw] text-[2cqw] max-w-[65%]"
            style={{
              fontFamily: f.b,
              borderLeft: `0.3cqw solid ${theme.palette.primary}`,
              color: img ? 'rgba(255,255,255,0.85)' : theme.palette.text,
            }}
          >
            {slide.subtitle}
          </p>
        )}
      </div>
      <Chrome theme={theme} ctx={ctx} light={!!img} f={f} />
    </>
  );
}

function ContentImage({ slide, theme, img, f, ctx, side }: { slide: Slide; theme: Theme; img?: string; f: Fonts; ctx: Ctx; side: 'left' | 'right' }) {
  const txt = (
    <div className="flex flex-col justify-center px-[5%] py-[6%] w-1/2">
      <Eyebrow text={slide.eyebrow} icon={slide.icon} theme={theme} f={f} />
      <h2 className="text-[3.6cqw] leading-[1.08] font-bold m-0" style={{ fontFamily: f.h, color: theme.palette.text }}>
        {slide.title}
      </h2>
      <div className="mt-[1.4cqw]" style={{ height: '0.2cqw', width: '5.5cqw', background: theme.palette.primary }} />
      {slide.subtitle && (
        <p className="mt-[1.4cqw] italic text-[1.5cqw]" style={{ fontFamily: f.b, color: theme.palette.secondary }}>
          {slide.subtitle}
        </p>
      )}
      <div className="mt-[2.4cqw]">
        <Bullets items={slide.body} theme={theme} f={f} fontSize="1.6cqw" />
      </div>
    </div>
  );
  const image = (
    <div className="w-1/2 h-full overflow-hidden relative" style={{ background: theme.palette.muted }}>
      {img && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt="" className="w-full h-full object-cover" />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: `linear-gradient(${side === 'right' ? '270deg' : '90deg'}, transparent 70%, ${theme.palette.background} 100%)` }}
          />
        </>
      )}
    </div>
  );
  return (
    <>
      <div className="absolute inset-0 flex">
        {side === 'left' ? (
          <>
            {image}
            {txt}
          </>
        ) : (
          <>
            {txt}
            {image}
          </>
        )}
      </div>
      <Chrome theme={theme} ctx={ctx} f={f} />
    </>
  );
}

function TwoColumn({ slide, theme, f, ctx }: { slide: Slide; theme: Theme; f: Fonts; ctx: Ctx }) {
  const half = Math.ceil(slide.body.length / 2);
  return (
    <>
      <div className="absolute inset-0 px-[5%] pt-[6%] pb-[5%] flex flex-col">
        <Eyebrow text={slide.eyebrow} icon={slide.icon} theme={theme} f={f} />
        <h2 className="text-[3.6cqw] font-bold m-0" style={{ fontFamily: f.h, color: theme.palette.text }}>
          {slide.title}
        </h2>
        <div className="mt-[1.4cqw]" style={{ height: '0.2cqw', width: '5.5cqw', background: theme.palette.primary }} />
        <div className="mt-[3cqw] flex-1 grid grid-cols-2 gap-[4cqw] content-start">
          <Bullets items={slide.body.slice(0, half)} theme={theme} f={f} fontSize="1.7cqw" />
          <Bullets items={slide.body.slice(half)} theme={theme} f={f} fontSize="1.7cqw" />
        </div>
      </div>
      <Chrome theme={theme} ctx={ctx} f={f} />
    </>
  );
}

function BigStat({ slide, theme, img, f, ctx }: { slide: Slide; theme: Theme; img?: string; f: Fonts; ctx: Ctx }) {
  const value = slide.stat?.value ?? slide.title;
  const label = slide.stat?.label ?? slide.subtitle ?? '';
  return (
    <>
      <div
        className="absolute inset-0 grid gap-[4cqw] px-[5%] py-[6%] items-center"
        style={{ gridTemplateColumns: img ? '1fr auto' : '1fr' }}
      >
        <div className="flex flex-col">
          <Eyebrow text={slide.eyebrow} icon={slide.icon} theme={theme} f={f} />
          <p className="text-[1.4cqw] font-semibold max-w-[75%] m-0" style={{ fontFamily: f.b, color: theme.palette.text, opacity: 0.9 }}>
            {slide.title}
          </p>
          <div
            className="mt-[1.4cqw] text-[18cqw] font-black tracking-tight"
            style={{ fontFamily: f.h, color: theme.palette.primary, lineHeight: 0.85, letterSpacing: '-0.05em' }}
          >
            {value}
          </div>
          <div className="mt-[1.5cqw]" style={{ height: '0.25cqw', width: '8cqw', background: theme.palette.primary }} />
          <p className="mt-[1.4cqw] text-[1.7cqw] max-w-[75%] m-0" style={{ fontFamily: f.b, color: theme.palette.text, lineHeight: 1.4 }}>
            {label}
          </p>
        </div>
        {img && (
          <div className="rounded-full overflow-hidden" style={{ width: '50cqh', height: '50cqh', boxShadow: '0 30px 80px rgba(0,0,0,0.4)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt="" className="w-full h-full object-cover" />
          </div>
        )}
      </div>
      <Chrome theme={theme} ctx={ctx} f={f} />
    </>
  );
}

function FullBleedQuote({ slide, theme, img, f, ctx }: { slide: Slide; theme: Theme; img?: string; f: Fonts; ctx: Ctx }) {
  return (
    <>
      {img ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 50%, rgba(0,0,0,0.6) 100%)' }} />
        </>
      ) : (
        <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${theme.palette.primary} 0%, ${theme.palette.secondary} 100%)` }} />
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-[10%]">
        <div className="text-[8cqw] font-bold leading-[0.5] mb-[0.5cqw]" style={{ fontFamily: f.h, color: theme.palette.primary, opacity: 0.9 }}>
          &ldquo;
        </div>
        <p className="text-[3.8cqw] italic font-medium leading-[1.25] text-white max-w-[80%] m-0" style={{ fontFamily: f.h }}>
          {slide.quote?.text ?? slide.title}
        </p>
        {slide.quote?.attribution && (
          <div className="mt-[3cqw] flex items-center gap-[1cqw]">
            <div style={{ width: '2.5cqw', height: '0.2cqw', background: '#fff', opacity: 0.6 }} />
            <p className="text-[1.5cqw] font-semibold tracking-wider m-0" style={{ fontFamily: f.b, color: 'rgba(255,255,255,0.85)' }}>
              {slide.quote.attribution}
            </p>
          </div>
        )}
      </div>
      <Chrome theme={theme} ctx={ctx} light f={f} />
    </>
  );
}

function SectionDivider({ slide, theme, img, f, ctx }: { slide: Slide; theme: Theme; img?: string; f: Fonts; ctx: Ctx }) {
  return (
    <>
      {img ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.4) 100%)' }} />
        </>
      ) : (
        <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${theme.palette.primary} 0%, ${theme.palette.secondary} 100%)` }} />
      )}
      <div className="absolute inset-0 flex flex-col justify-center px-[6%]">
        <div className="flex items-center gap-[1.2cqw] mb-[2cqw]">
          <span style={{ display: 'inline-block', width: '5cqw', height: '0.25cqw', background: '#fff', opacity: 0.8 }} />
          <span style={{ fontFamily: f.b, fontSize: '1.3cqw', fontWeight: 700, letterSpacing: '0.4em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)' }}>
            {slide.subtitle ?? slide.eyebrow ?? `Section ${ctx.pageNum}`}
          </span>
        </div>
        <h2 className="text-[8cqw] font-extrabold leading-[0.95] text-white m-0 max-w-[85%]" style={{ fontFamily: f.h, letterSpacing: '-0.02em' }}>
          {slide.title}
        </h2>
      </div>
      <Chrome theme={theme} ctx={ctx} light f={f} />
    </>
  );
}

function Comparison({ slide, theme, f, ctx }: { slide: Slide; theme: Theme; f: Fonts; ctx: Ctx }) {
  const c = slide.comparison ?? { leftLabel: '', rightLabel: '', left: [], right: [] };
  const cols = [
    { label: c.leftLabel, items: c.left, mark: '×', accent: theme.palette.muted },
    { label: c.rightLabel, items: c.right, mark: '✓', accent: theme.palette.primary },
  ];
  return (
    <>
      <div className="absolute inset-0 px-[5%] pt-[5%] pb-[6%] flex flex-col">
        <Eyebrow text={slide.eyebrow} icon={slide.icon} theme={theme} f={f} />
        <h2 className="text-[3.4cqw] font-bold leading-[1.1] m-0" style={{ fontFamily: f.h, color: theme.palette.text }}>
          {slide.title}
        </h2>
        <div className="mt-[1.4cqw]" style={{ height: '0.2cqw', width: '5.5cqw', background: theme.palette.primary }} />
        <div className="mt-[2.6cqw] grid grid-cols-2 gap-[2.5cqw] flex-1">
          {cols.map((col, idx) => (
            <div key={idx} className="flex flex-col" style={{ borderTop: `0.25cqw solid ${col.accent}` }}>
              <div
                className="font-bold uppercase tracking-wider pt-[1.4cqw] pb-[0.4cqw]"
                style={{ fontFamily: f.h, fontSize: '1.5cqw', letterSpacing: '0.15em', color: col.accent }}
              >
                {col.label}
              </div>
              <ul className="flex-1 mt-[0.5cqw] list-none p-0 flex flex-col gap-[1.4cqw]">
                {col.items.map((it, i) => (
                  <li key={i} className="flex gap-[1cqw] items-baseline">
                    <span style={{ fontWeight: 800, color: col.accent, flexShrink: 0, fontSize: '1.6cqw' }}>{col.mark}</span>
                    <span style={{ fontFamily: f.b, fontSize: '1.7cqw', color: theme.palette.text, lineHeight: 1.4 }}>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <Chrome theme={theme} ctx={ctx} f={f} />
    </>
  );
}

function Agenda({ slide, theme, f, ctx }: { slide: Slide; theme: Theme; f: Fonts; ctx: Ctx }) {
  return (
    <>
      <div className="absolute inset-0 px-[6%] pt-[6%] pb-[5%] flex flex-col">
        <Eyebrow text={slide.eyebrow} icon={slide.icon} theme={theme} f={f} />
        <h2 className="text-[3.6cqw] font-bold m-0" style={{ fontFamily: f.h, color: theme.palette.text }}>
          {slide.title}
        </h2>
        <div className="mt-[1.4cqw]" style={{ height: '0.2cqw', width: '5.5cqw', background: theme.palette.primary }} />
        <ol className="mt-[3cqw] flex-1 list-none p-0 flex flex-col justify-around">
          {slide.body.map((item, i) => (
            <li key={i} className="flex items-center gap-[2.5cqw] py-[1.2cqw]" style={{ borderBottom: `1px solid ${theme.palette.muted}33` }}>
              <span style={{ fontFamily: f.h, fontSize: '3cqw', fontWeight: 800, minWidth: '5cqw', color: theme.palette.primary, lineHeight: 1 }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span style={{ fontFamily: f.b, fontSize: '2cqw', color: theme.palette.text, fontWeight: 500 }}>{item}</span>
            </li>
          ))}
        </ol>
      </div>
      <Chrome theme={theme} ctx={ctx} f={f} />
    </>
  );
}

function BarChart({ slide, theme, f, ctx }: { slide: Slide; theme: Theme; f: Fonts; ctx: Ctx }) {
  const c = slide.chart;
  return (
    <>
      <div className="absolute inset-0 px-[5%] pt-[5%] pb-[6%] flex flex-col">
        <Eyebrow text={slide.eyebrow} icon={slide.icon} theme={theme} f={f} />
        <h2 className="text-[3.4cqw] font-bold leading-[1.1] m-0" style={{ fontFamily: f.h, color: theme.palette.text }}>
          {slide.title}
        </h2>
        <div className="mt-[1.4cqw]" style={{ height: '0.2cqw', width: '5.5cqw', background: theme.palette.primary }} />
        {slide.subtitle && (
          <p className="mt-[1cqw] italic text-[1.4cqw] m-0" style={{ fontFamily: f.b, color: theme.palette.secondary }}>
            {slide.subtitle}
          </p>
        )}
        {c && c.values.length > 0 && (
          <div className="flex-1 mt-[2.5cqw] flex items-end gap-[2cqw] px-[1cqw]">
            {(() => {
              const max = Math.max(...c.values, 1);
              return c.values.map((v, i) => {
                const heightPct = (v / max) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                    <div
                      className="text-[1.6cqw] font-extrabold mb-[0.6cqw] tracking-tight"
                      style={{ fontFamily: f.h, color: theme.palette.text }}
                    >
                      {v}
                      {c.unit ?? ''}
                    </div>
                    <div
                      className="w-full rounded-t-md"
                      style={{
                        background: `linear-gradient(180deg, ${theme.palette.primary} 0%, ${theme.palette.primary}cc 100%)`,
                        height: `${Math.max(heightPct, 3)}%`,
                      }}
                    />
                    <div
                      className="mt-[0.9cqw] text-[1.2cqw] font-medium"
                      style={{ fontFamily: f.b, color: theme.palette.muted }}
                    >
                      {c.labels[i]}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>
      <Chrome theme={theme} ctx={ctx} f={f} />
    </>
  );
}

function PieChart({ slide, theme, f, ctx }: { slide: Slide; theme: Theme; f: Fonts; ctx: Ctx }) {
  const c = slide.chart;
  const colors = PIE_CYCLE(theme);
  return (
    <>
      <div className="absolute inset-0 px-[5%] pt-[5%] pb-[6%] flex flex-col">
        <Eyebrow text={slide.eyebrow} icon={slide.icon} theme={theme} f={f} />
        <h2 className="text-[3.4cqw] font-bold leading-[1.1] m-0" style={{ fontFamily: f.h, color: theme.palette.text }}>
          {slide.title}
        </h2>
        <div className="mt-[1.4cqw]" style={{ height: '0.2cqw', width: '5.5cqw', background: theme.palette.primary }} />
        {slide.subtitle && (
          <p className="mt-[1cqw] italic text-[1.4cqw] m-0" style={{ fontFamily: f.b, color: theme.palette.secondary }}>
            {slide.subtitle}
          </p>
        )}
        {c && c.values.length > 0 && (
          <div className="flex-1 mt-[2.5cqw] grid grid-cols-[auto_1fr] gap-[5cqw] items-center">
            <div className="flex justify-center">
              <PieSvg theme={theme} values={c.values} />
            </div>
            <ul className="list-none p-0 flex flex-col gap-[1.4cqw]">
              {c.labels.map((label, i) => {
                const total = c.values.reduce((a, v) => a + v, 0) || 1;
                return (
                  <li key={i} className="flex items-center gap-[1.2cqw] text-[1.6cqw]" style={{ fontFamily: f.b, color: theme.palette.text }}>
                    <span style={{ width: '1.4cqw', height: '1.4cqw', borderRadius: 3, background: colors[i % colors.length], flexShrink: 0 }} />
                    <span style={{ flex: 1, fontWeight: 500 }}>{label}</span>
                    <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                      {Math.round((c.values[i] / total) * 100)}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
      <Chrome theme={theme} ctx={ctx} f={f} />
    </>
  );
}

function PieSvg({ theme, values }: { theme: Theme; values: number[] }) {
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const colors = PIE_CYCLE(theme);
  const r = 95;
  const cx = 100;
  const cy = 100;
  let acc = 0;
  return (
    <svg viewBox="0 0 200 200" style={{ width: '60cqh', height: '60cqh', maxWidth: '100%' }}>
      {values.map((v, i) => {
        const start = (acc / total) * 2 * Math.PI - Math.PI / 2;
        acc += v;
        const end = (acc / total) * 2 * Math.PI - Math.PI / 2;
        const x1 = cx + r * Math.cos(start);
        const y1 = cy + r * Math.sin(start);
        const x2 = cx + r * Math.cos(end);
        const y2 = cy + r * Math.sin(end);
        const large = end - start > Math.PI ? 1 : 0;
        return (
          <path
            key={i}
            d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
            fill={colors[i % colors.length]}
            stroke={theme.palette.background}
            strokeWidth="1.5"
          />
        );
      })}
    </svg>
  );
}

function ClosingCta({ slide, theme, img, f, ctx }: { slide: Slide; theme: Theme; img?: string; f: Fonts; ctx: Ctx }) {
  return (
    <>
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: img ? '58% 42%' : '1fr' }}>
        <div className="flex flex-col justify-center px-[5%] py-[6%]">
          <Eyebrow text={slide.eyebrow} icon={slide.icon} theme={theme} f={f} />
          <h2 className="text-[5.5cqw] font-extrabold m-0" style={{ fontFamily: f.h, lineHeight: 0.98, letterSpacing: '-0.02em', color: theme.palette.text }}>
            {slide.title}
          </h2>
          <div className="mt-[1.6cqw]" style={{ height: '0.25cqw', width: '6cqw', background: theme.palette.primary }} />
          {slide.subtitle && (
            <p className="mt-[1.6cqw] text-[1.7cqw] max-w-[90%] m-0" style={{ fontFamily: f.b, color: theme.palette.text, opacity: 0.9 }}>
              {slide.subtitle}
            </p>
          )}
          {slide.body.length > 0 && (
            <ul className="mt-[2.5cqw] list-none p-0 flex flex-col gap-[1.2cqw]">
              {slide.body.map((b, i) => (
                <li
                  key={i}
                  className="flex items-center gap-[1.2cqw] py-[1cqw] px-[1.4cqw] rounded"
                  style={{
                    background: `${theme.palette.primary}1A`,
                    borderLeft: `0.25cqw solid ${theme.palette.primary}`,
                    fontFamily: f.b,
                    fontSize: '1.5cqw',
                    color: theme.palette.text,
                    fontWeight: 500,
                  }}
                >
                  <span style={{ color: theme.palette.primary, fontWeight: 800 }}>→</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {img && (
          <div className="w-full h-full overflow-hidden relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${theme.palette.background} 0%, transparent 25%)` }} />
          </div>
        )}
      </div>
      <Chrome theme={theme} ctx={ctx} f={f} />
    </>
  );
}
