'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { NANO_BANANA_PRICE_PER_IMAGE_USD, formatUsd } from '@/lib/pricing';
import {
  ALL_LAYOUTS,
  LAYOUT_IMAGE_ASPECT,
  THEME_PRESETS,
  type DeckAspect,
  type DeckTemplate,
  type Deck,
  type Layout,
  type Slide,
  type ThemePresetId,
  type Theme,
} from '@/lib/types';
import { SlidePreview } from '@/components/slides/SlidePreview';

type Review = {
  verdict: 'approve' | 'improve';
  score: number;
  issues: string[];
  improvedPrompt?: string;
};
type SlideImage = {
  dataUrl: string;
  costUsd: number;
  iterations: number;
  review?: Review;
};

const MAX_REVIEW_RETRIES = 2;

type Phase = 'idle' | 'planning' | 'plan-ready' | 'generating' | 'done';

type StreamEvent =
  | { type: 'status'; text: string }
  | { type: 'result'; deck?: unknown; claudeCostUsd?: number | null }
  | { type: 'error'; error: string };

async function readNdjson(
  url: string,
  body: unknown,
  onEvent: (evt: StreamEvent) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    throw new Error(`${url} ${res.status}${detail ? ': ' + detail : ''}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as StreamEvent);
      } catch {
        /* ignore malformed line */
      }
    }
  }
  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer) as StreamEvent);
    } catch {
      /* ignore */
    }
  }
}

type TemplateMeta = {
  id: DeckTemplate;
  label: string;
  blurb: string;
  starter: string;
  defaultCount: number;
};

const TEMPLATES: TemplateMeta[] = [
  {
    id: 'pitch',
    label: 'Pitch deck',
    blurb: 'Problem → solution → market → product → ask',
    starter: 'A 12-slide pitch deck for a ',
    defaultCount: 12,
  },
  {
    id: 'saas-pitch',
    label: 'SaaS pitch',
    blurb: 'B2B-flavored. Stats, ICP, ARR chart, vs incumbents',
    starter: 'A 12-slide SaaS pitch deck for a B2B tool that ',
    defaultCount: 12,
  },
  {
    id: 'consumer-pitch',
    label: 'Consumer pitch',
    blurb: 'Story-driven. User testimonial, market sizing, GTM',
    starter: 'A 12-slide consumer pitch deck for an app that ',
    defaultCount: 12,
  },
  {
    id: 'lecture',
    label: 'Lecture',
    blurb: 'Objectives → concepts → takeaways → Q&A',
    starter: 'A 14-slide lecture on ',
    defaultCount: 14,
  },
  {
    id: 'status',
    label: 'Status update',
    blurb: 'Metrics → wins → blockers → next steps',
    starter: 'A 6-slide status update on ',
    defaultCount: 6,
  },
  {
    id: 'product-launch',
    label: 'Product launch',
    blurb: 'Why now → product → features → CTA',
    starter: 'A 10-slide product launch deck for ',
    defaultCount: 10,
  },
  {
    id: 'retro',
    label: 'Retro',
    blurb: 'Wins → misses → causes → action items',
    starter: 'A 8-slide retro for ',
    defaultCount: 8,
  },
  {
    id: 'custom',
    label: 'Custom',
    blurb: 'Pick your own structure',
    starter: '',
    defaultCount: 10,
  },
];

const ASPECTS: { id: DeckAspect; label: string }[] = [
  { id: '16:9', label: '16:9 widescreen' },
  { id: '4:3', label: '4:3 classic' },
  { id: '9:16', label: '9:16 vertical / Stories' },
  { id: '1:1', label: '1:1 square' },
];

const PARALLEL_GEN_LIMIT = 3;

export default function Home() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [topic, setTopic] = useState('');
  const [slideCount, setSlideCount] = useState(10);
  const [styleHint, setStyleHint] = useState('');
  const [template, setTemplate] = useState<DeckTemplate>('custom');
  const [deck, setDeck] = useState<Deck | null>(null);
  const [selectedSlideN, setSelectedSlideN] = useState<number>(1);
  const [images, setImages] = useState<Record<number, SlideImage | undefined>>({});
  const [busySlides, setBusySlides] = useState<Set<number>>(new Set());
  const [slideStatus, setSlideStatus] = useState<Record<number, string>>({});
  const [sessionCostUsd, setSessionCostUsd] = useState(0);
  const [autoReview, setAutoReview] = useState(true);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [refining, setRefining] = useState(false);
  const [planStatus, setPlanStatus] = useState('');
  const [themePresetId, setThemePresetId] = useState<ThemePresetId>('auto');
  const [brandPrimary, setBrandPrimary] = useState('');
  const [aspect, setAspect] = useState<DeckAspect>('16:9');
  const [variationsModal, setVariationsModal] = useState<{ slideN: number; loading: boolean; options: string[]; cost: number } | null>(null);
  const [deckReview, setDeckReview] = useState<{
    verdict: 'ship' | 'revise';
    score: number;
    strengths: string[];
    issues: string[];
    suggestions: string[];
  } | null>(null);
  const [deckReviewing, setDeckReviewing] = useState(false);
  const [savedDecks, setSavedDecks] = useState<{ id: string; title: string; updatedAt: number }[]>([]);

  // Save / load decks via localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const idx = JSON.parse(localStorage.getItem('slidegen.deckIndex') || '[]') as typeof savedDecks;
      if (Array.isArray(idx)) setSavedDecks(idx.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch { /* ignore */ }
  }, []);

  function saveCurrentDeck() {
    if (!deck) return;
    const id = `deck-${Date.now().toString(36)}`;
    const payload = { deck, images, aspect, savedAt: Date.now() };
    try {
      localStorage.setItem(`slidegen.deck.${id}`, JSON.stringify(payload));
      const next = [{ id, title: deck.title, updatedAt: Date.now() }, ...savedDecks].slice(0, 20);
      localStorage.setItem('slidegen.deckIndex', JSON.stringify(next));
      setSavedDecks(next);
      toast.success('Deck saved.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'save failed (probably localStorage full)');
    }
  }

  function loadDeck(id: string) {
    try {
      const raw = localStorage.getItem(`slidegen.deck.${id}`);
      if (!raw) return;
      const data = JSON.parse(raw) as { deck: Deck; images: Record<number, SlideImage | undefined>; aspect: DeckAspect };
      setDeck(data.deck);
      setImages(data.images || {});
      if (data.aspect) setAspect(data.aspect);
      setSelectedSlideN(1);
      setPhase('plan-ready');
      toast.success(`Loaded: ${data.deck.title}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'load failed');
    }
  }

  function deleteDeck(id: string) {
    try {
      localStorage.removeItem(`slidegen.deck.${id}`);
      const next = savedDecks.filter((d) => d.id !== id);
      localStorage.setItem('slidegen.deckIndex', JSON.stringify(next));
      setSavedDecks(next);
    } catch { /* ignore */ }
  }

  // Inject Google Fonts when theme changes
  useEffect(() => {
    if (!deck?.theme) return;
    const fams = [deck.theme.fontHeading, deck.theme.fontBody]
      .filter(Boolean)
      .map((f) => f.replace(/\s+/g, '+'));
    const id = 'slidegen-fonts';
    let link = document.getElementById(id) as HTMLLinkElement | null;
    const href = `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f}:wght@400;600;700;800`).join('&')}&display=swap`;
    if (!link) {
      link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = href;
  }, [deck?.theme]);

  const estimatedCost = useMemo(() => {
    if (!deck) return 0;
    const imagedSlides = deck.slides.filter((s) => s.imageAspect !== 'none').length;
    return imagedSlides * NANO_BANANA_PRICE_PER_IMAGE_USD;
  }, [deck]);

  const selectedSlide = deck?.slides.find((s) => s.n === selectedSlideN) ?? null;

  function pickTemplate(tpl: TemplateMeta) {
    setTemplate(tpl.id);
    if (tpl.starter) setTopic(tpl.starter);
    setSlideCount(tpl.defaultCount);
  }

  async function plan() {
    if (!topic.trim()) {
      toast.error('Tell me what the deck is about first.');
      return;
    }
    setPhase('planning');
    setDeck(null);
    setImages({});
    setSessionCostUsd(0);
    setChatMessages([]);
    setDeckReview(null);
    setPlanStatus('Asking Claude…');
    const preset = THEME_PRESETS.find((p) => p.id === themePresetId);
    const themeOverride: Theme | undefined = preset?.theme ?? undefined;
    const brandPrimaryClean = brandPrimary.trim().match(/^#[0-9a-f]{6}$/i) ? brandPrimary.trim() : undefined;
    try {
      let resultDeck: Deck | null = null;
      let errMsg: string | null = null;
      await readNdjson(
        '/api/plan',
        {
          topic,
          slideCount,
          template,
          styleHint: styleHint.trim() || undefined,
          themeOverride,
          brandPrimary: brandPrimaryClean,
        },
        (evt) => {
          if (evt.type === 'status') setPlanStatus(evt.text);
          else if (evt.type === 'result') resultDeck = (evt.deck as Deck) ?? null;
          else if (evt.type === 'error') errMsg = evt.error;
        },
      );
      if (errMsg) throw new Error(errMsg);
      if (!resultDeck) throw new Error('no deck returned');
      setDeck(resultDeck);
      setSelectedSlideN(1);
      setPhase('plan-ready');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'plan failed');
      setPhase('idle');
    } finally {
      setPlanStatus('');
    }
  }

  function updateSlide(n: number, patch: Partial<Slide>) {
    setDeck((cur) =>
      cur ? { ...cur, slides: cur.slides.map((s) => (s.n === n ? { ...s, ...patch } : s)) } : cur,
    );
  }

  function addSlide(afterN: number) {
    setDeck((cur) => {
      if (!cur) return cur;
      const newSlide: Slide = {
        n: 0,
        layout: 'content-image-right',
        title: 'New slide',
        body: ['…', '…', '…'],
        imagePrompt: '',
        imageAspect: '1:1',
        notes: '',
      };
      const before = cur.slides.filter((s) => s.n <= afterN);
      const after = cur.slides.filter((s) => s.n > afterN);
      const next = [...before, newSlide, ...after].map((s, i) => ({ ...s, n: i + 1 }));
      return { ...cur, slides: next };
    });
  }

  function deleteSlide(n: number) {
    setDeck((cur) => {
      if (!cur) return cur;
      const next = cur.slides.filter((s) => s.n !== n).map((s, i) => ({ ...s, n: i + 1 }));
      return { ...cur, slides: next };
    });
    setImages((m) => {
      const next: typeof m = {};
      const oldEntries = Object.entries(m).map(([k, v]) => [parseInt(k), v] as const);
      let newN = 1;
      for (const [oldN, val] of oldEntries.sort((a, b) => a[0] - b[0])) {
        if (oldN === n) continue;
        next[newN] = val;
        newN++;
      }
      return next;
    });
    if (selectedSlideN === n) setSelectedSlideN(1);
  }

  function moveSlide(fromN: number, toN: number) {
    if (fromN === toN) return;
    setDeck((cur) => {
      if (!cur) return cur;
      const fromIdx = cur.slides.findIndex((s) => s.n === fromN);
      const toIdx = cur.slides.findIndex((s) => s.n === toN);
      if (fromIdx < 0 || toIdx < 0) return cur;
      const arr = [...cur.slides];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return { ...cur, slides: arr.map((s, i) => ({ ...s, n: i + 1 })) };
    });
    // Reindex images alongside slides
    setImages((m) => {
      const cur = deck;
      if (!cur) return m;
      const fromIdx = cur.slides.findIndex((s) => s.n === fromN);
      const toIdx = cur.slides.findIndex((s) => s.n === toN);
      if (fromIdx < 0 || toIdx < 0) return m;
      const order = cur.slides.map((s) => s.n);
      const [movedN] = order.splice(fromIdx, 1);
      order.splice(toIdx, 0, movedN);
      const next: typeof m = {};
      order.forEach((origN, i) => {
        if (m[origN]) next[i + 1] = m[origN];
      });
      return next;
    });
    if (selectedSlideN === fromN) setSelectedSlideN(toN);
  }

  function changeLayout(n: number, layout: Layout) {
    const aspect = LAYOUT_IMAGE_ASPECT[layout];
    updateSlide(n, { layout, imageAspect: aspect });
  }

  function setStatus(n: number, text: string) {
    setSlideStatus((s) => ({ ...s, [n]: text }));
  }

  async function callGenerate(prompt: string, slide: Slide) {
    if (!deck) throw new Error('no deck');
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        mood: deck.theme.mood,
        aspect: slide.imageAspect,
        layout: slide.layout,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'generate failed');
    return data as { dataUrl: string; costUsd: number };
  }

  async function callReview(slide: Slide, dataUrl: string, prompt: string): Promise<Review> {
    if (!deck) throw new Error('no deck');
    // Send the WHOLE slide (with the just-generated image) so /api/review can
    // screenshot the composed slide and have Claude assess the final result —
    // not just the raw Nano Banana image.
    const slideWithCurrentPrompt: Slide = { ...slide, imagePrompt: prompt };
    const res = await fetch('/api/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slide: slideWithCurrentPrompt,
        theme: deck.theme,
        imageDataUrl: dataUrl,
        aspect: '16:9',
        chrome: { deckTitle: deck.title, pageTotal: deck.slides.length },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'review failed');
    return data.review as Review;
  }

  async function generateOne(slide: Slide, opts: { review?: boolean } = {}) {
    if (slide.imageAspect === 'none') return; // text-only layout, nothing to do
    const useReview = opts.review ?? autoReview;
    setBusySlides((s) => new Set(s).add(slide.n));
    setStatus(slide.n, 'Generating image…');
    try {
      let prompt = slide.imagePrompt;
      let last = await callGenerate(prompt, slide);
      let totalCost = last.costUsd;
      let iterations = 1;
      let review: Review | undefined;

      if (useReview) {
        for (let attempt = 0; attempt < MAX_REVIEW_RETRIES; attempt++) {
          setStatus(slide.n, `Claude reviewing (pass ${attempt + 1})…`);
          review = await callReview(slide, last.dataUrl, prompt);
          if (review.verdict === 'approve' || !review.improvedPrompt) break;
          prompt = review.improvedPrompt;
          setStatus(slide.n, `Regenerating with Claude's notes (try ${attempt + 2})…`);
          last = await callGenerate(prompt, slide);
          totalCost += last.costUsd;
          iterations += 1;
        }
      }

      setImages((m) => ({
        ...m,
        [slide.n]: { dataUrl: last.dataUrl, costUsd: totalCost, iterations, review },
      }));
      setSessionCostUsd((c) => c + totalCost);
      setStatus(slide.n, '');
    } catch (err) {
      toast.error(`Slide ${slide.n}: ${err instanceof Error ? err.message : 'failed'}`);
      setStatus(slide.n, '');
    } finally {
      setBusySlides((s) => {
        const next = new Set(s);
        next.delete(slide.n);
        return next;
      });
    }
  }

  async function generateAll() {
    if (!deck) return;
    setPhase('generating');
    const targets = deck.slides.filter((s) => s.imageAspect !== 'none');
    // Parallel with concurrency cap
    let cursor = 0;
    async function worker() {
      while (cursor < targets.length) {
        const idx = cursor++;
        await generateOne(targets[idx]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL_GEN_LIMIT, targets.length) }, worker));
    setPhase('done');
  }

  async function generateVariations(slide: Slide) {
    if (!deck || slide.imageAspect === 'none') return;
    setVariationsModal({ slideN: slide.n, loading: true, options: [], cost: 0 });
    try {
      const res = await fetch('/api/generate-variations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: slide.imagePrompt,
          mood: deck.theme.mood,
          aspect: slide.imageAspect,
          layout: slide.layout,
          count: 3,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'variations failed');
      setVariationsModal({
        slideN: slide.n,
        loading: false,
        options: (data.variations as { dataUrl: string }[]).map((v) => v.dataUrl),
        cost: data.costUsd ?? 0,
      });
      setSessionCostUsd((c) => c + (data.costUsd ?? 0));
    } catch (err) {
      setVariationsModal(null);
      toast.error(err instanceof Error ? err.message : 'variations failed');
    }
  }

  function applyVariation(dataUrl: string) {
    if (!variationsModal) return;
    const slide = deck?.slides.find((s) => s.n === variationsModal.slideN);
    if (!slide) return;
    setImages((m) => ({
      ...m,
      [slide.n]: { dataUrl, costUsd: variationsModal.cost / 3, iterations: 1 },
    }));
    setVariationsModal(null);
  }

  async function runDeckReview() {
    if (!deck || deckReviewing) return;
    setDeckReviewing(true);
    setDeckReview(null);
    try {
      const res = await fetch('/api/deck-review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deck }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'review failed');
      setDeckReview(data.review);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'review failed');
    } finally {
      setDeckReviewing(false);
    }
  }

  async function exportPdf() {
    if (!deck) return;
    const imageMap: Record<number, string> = {};
    for (const s of deck.slides) {
      const img = images[s.n];
      if (img) imageMap[s.n] = img.dataUrl;
    }
    const res = await fetch('/api/render-pdf', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deck, images: imageMap, aspect }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || 'pdf export failed');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deck.title.replace(/[^a-z0-9-_]+/gi, '_') || 'deck'}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function refine() {
    const text = chatInput.trim();
    if (!text || !deck || refining) return;
    setRefining(true);
    setChatMessages((m) => [...m, { role: 'user', text }]);
    setChatInput('');
    const placeholderIdx = (() => {
      let cur = 0;
      setChatMessages((m) => {
        cur = m.length;
        return [...m, { role: 'assistant', text: 'thinking…' }];
      });
      return cur;
    })();
    try {
      let updated: Deck | null = null;
      let errMsg: string | null = null;
      await readNdjson('/api/refine', { deck, instruction: text }, (evt) => {
        if (evt.type === 'status') {
          setChatMessages((m) =>
            m.map((msg, i) => (i === placeholderIdx ? { ...msg, text: evt.text } : msg)),
          );
        } else if (evt.type === 'result') {
          updated = (evt.deck as Deck) ?? null;
        } else if (evt.type === 'error') {
          errMsg = evt.error;
        }
      });
      if (errMsg) throw new Error(errMsg);
      if (!updated) throw new Error('no deck returned');
      const finalDeck = updated as Deck;
      setDeck(finalDeck);
      setImages((m) => {
        const next: typeof m = {};
        for (const s of finalDeck.slides) {
          const old = deck.slides.find((o) => o.n === s.n);
          if (old && old.imagePrompt === s.imagePrompt && old.layout === s.layout) {
            next[s.n] = m[s.n];
          }
        }
        return next;
      });
      setChatMessages((m) =>
        m.map((msg, i) =>
          i === placeholderIdx
            ? {
                ...msg,
                text: `Updated. Now ${finalDeck.slides.length} slides; affected slides need regeneration.`,
              }
            : msg,
        ),
      );
      if (selectedSlideN > finalDeck.slides.length) setSelectedSlideN(1);
    } catch (err) {
      setChatMessages((m) =>
        m.map((msg, i) =>
          i === placeholderIdx
            ? { ...msg, text: `Failed: ${err instanceof Error ? err.message : 'unknown'}` }
            : msg,
        ),
      );
    } finally {
      setRefining(false);
    }
  }

  async function exportPptx() {
    if (!deck) return;
    const imageMap: Record<number, string> = {};
    for (const s of deck.slides) {
      const img = images[s.n];
      if (img) imageMap[s.n] = img.dataUrl;
    }
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deck, images: imageMap, aspect }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || 'export failed');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deck.title.replace(/[^a-z0-9-_]+/gi, '_') || 'deck'}.pptx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setPhase('idle');
    setDeck(null);
    setImages({});
    setSessionCostUsd(0);
    setChatMessages([]);
    setChatInput('');
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Toaster richColors position="top-right" />
      <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">slidegen</h1>
            <p className="text-sm text-muted-foreground">
              Local Nano Banana slide generator — planned by Claude Code, exported as .pptx.
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase text-muted-foreground tracking-wider">Session</div>
            <div className="font-mono text-lg">{formatUsd(sessionCostUsd)}</div>
            <div className="text-[10px] text-muted-foreground">Nano Banana spend (Claude is on your CC plan)</div>
          </div>
        </header>

        {(phase === 'idle' || phase === 'planning') && (
          <Card>
            <CardHeader>
              <CardTitle>Pick a starting point</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label className="text-xs uppercase tracking-wider opacity-70">Template</Label>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => pickTemplate(tpl)}
                      disabled={phase === 'planning'}
                      className={`text-left p-3 rounded-md border-2 transition-colors ${
                        template === tpl.id
                          ? 'border-foreground bg-accent'
                          : 'border-border hover:border-foreground/40'
                      }`}
                    >
                      <div className="font-medium text-sm">{tpl.label}</div>
                      <div className="text-[10px] text-muted-foreground mt-1 leading-tight">
                        {tpl.blurb}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs uppercase tracking-wider opacity-70">Theme</Label>
                <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                  {THEME_PRESETS.map((tp) => {
                    const isSelected = themePresetId === tp.id;
                    const swatchBg = tp.theme?.palette.background ?? '#222';
                    const swatchPrimary = tp.theme?.palette.primary ?? '#888';
                    const swatchText = tp.theme?.palette.text ?? '#fff';
                    return (
                      <button
                        key={tp.id}
                        onClick={() => setThemePresetId(tp.id)}
                        disabled={phase === 'planning'}
                        className={`text-left p-2 rounded-md border-2 transition-colors ${
                          isSelected ? 'border-foreground' : 'border-border hover:border-foreground/40'
                        }`}
                        title={tp.description}
                      >
                        <div className="h-10 rounded mb-1.5 overflow-hidden flex" style={{ background: swatchBg }}>
                          <div className="flex-1" style={{ background: swatchBg }} />
                          <div className="w-1/3" style={{ background: swatchPrimary }} />
                          <div className="w-1/6" style={{ background: swatchText, opacity: 0.4 }} />
                        </div>
                        <div className="text-[11px] font-medium leading-tight truncate">{tp.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="topic">Topic / brief</Label>
                <Textarea
                  id="topic"
                  placeholder="e.g. A pitch deck for a coffee subscription startup, friendly retro vibe."
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  rows={3}
                  disabled={phase === 'planning'}
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>Slide count: {slideCount}</Label>
                  <Slider
                    min={3}
                    max={25}
                    step={1}
                    value={[slideCount]}
                    onValueChange={([v]) => setSlideCount(v)}
                    disabled={phase === 'planning'}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Aspect</Label>
                  <Select value={aspect} onValueChange={(v) => setAspect(v as DeckAspect)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ASPECTS.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brandPrimary">Brand color (optional)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="brandPrimary"
                      placeholder="#1F4FA8"
                      value={brandPrimary}
                      onChange={(e) => setBrandPrimary(e.target.value)}
                      disabled={phase === 'planning'}
                      className="flex-1 font-mono text-xs"
                    />
                    {brandPrimary.match(/^#[0-9a-f]{6}$/i) && (
                      <div className="size-9 rounded-md border" style={{ background: brandPrimary }} />
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="styleHint">Style hint (optional)</Label>
                  <Input
                    id="styleHint"
                    placeholder="e.g. minimalist editorial"
                    value={styleHint}
                    onChange={(e) => setStyleHint(e.target.value)}
                    disabled={phase === 'planning'}
                  />
                </div>
              </div>

              {savedDecks.length > 0 && (
                <div className="space-y-2 border-t pt-3">
                  <Label className="text-xs uppercase tracking-wider opacity-70">Recent decks</Label>
                  <div className="flex flex-wrap gap-2">
                    {savedDecks.map((d) => (
                      <div key={d.id} className="flex items-center rounded border bg-muted/30 text-xs">
                        <button
                          onClick={() => loadDeck(d.id)}
                          className="px-2 py-1 hover:bg-accent transition-colors"
                          title={`Saved ${new Date(d.updatedAt).toLocaleString()}`}
                        >
                          {d.title.slice(0, 40)}
                        </button>
                        <button
                          onClick={() => deleteDeck(d.id)}
                          className="px-2 py-1 opacity-50 hover:opacity-100"
                          title="Delete"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Button onClick={plan} disabled={phase === 'planning'} size="lg">
                  {phase === 'planning' ? 'Designing…' : 'Plan deck'}
                </Button>
                {phase === 'planning' && planStatus && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-block size-1.5 rounded-full bg-foreground animate-pulse" />
                    <span className="font-mono">{planStatus}</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Claude picks layouts, writes content, and chooses a cohesive theme (color palette + fonts). Image generation costs {formatUsd(NANO_BANANA_PRICE_PER_IMAGE_USD)} per image (text-only slides like agendas/comparisons cost $0).
              </p>
            </CardContent>
          </Card>
        )}

        {deck && phase !== 'idle' && phase !== 'planning' && (
          <DeckWorkspace
            deck={deck}
            selectedSlideN={selectedSlideN}
            setSelectedSlideN={setSelectedSlideN}
            selectedSlide={selectedSlide!}
            images={images}
            busySlides={busySlides}
            slideStatus={slideStatus}
            phase={phase}
            estimatedCost={estimatedCost}
            autoReview={autoReview}
            setAutoReview={setAutoReview}
            updateSlide={updateSlide}
            addSlide={addSlide}
            deleteSlide={deleteSlide}
            moveSlide={moveSlide}
            changeLayout={changeLayout}
            generateOne={generateOne}
            generateAll={generateAll}
            generateVariations={generateVariations}
            exportPptx={exportPptx}
            exportPdf={exportPdf}
            saveDeck={saveCurrentDeck}
            reset={reset}
            chatMessages={chatMessages}
            chatInput={chatInput}
            setChatInput={setChatInput}
            refine={refine}
            refining={refining}
            aspect={aspect}
            setAspect={setAspect}
            deckReview={deckReview}
            runDeckReview={runDeckReview}
            deckReviewing={deckReviewing}
          />
        )}

        {variationsModal && (
          <VariationsModal
            modal={variationsModal}
            close={() => setVariationsModal(null)}
            apply={applyVariation}
          />
        )}
      </div>
    </main>
  );
}

type WorkspaceProps = {
  deck: Deck;
  selectedSlideN: number;
  setSelectedSlideN: (n: number) => void;
  selectedSlide: Slide;
  images: Record<number, SlideImage | undefined>;
  busySlides: Set<number>;
  slideStatus: Record<number, string>;
  phase: Phase;
  estimatedCost: number;
  autoReview: boolean;
  setAutoReview: (v: boolean) => void;
  updateSlide: (n: number, patch: Partial<Slide>) => void;
  addSlide: (afterN: number) => void;
  deleteSlide: (n: number) => void;
  moveSlide: (fromN: number, toN: number) => void;
  changeLayout: (n: number, layout: Layout) => void;
  generateOne: (slide: Slide) => void;
  generateAll: () => void;
  generateVariations: (slide: Slide) => void;
  exportPptx: () => void;
  exportPdf: () => void;
  saveDeck: () => void;
  reset: () => void;
  chatMessages: { role: 'user' | 'assistant'; text: string }[];
  chatInput: string;
  setChatInput: (v: string) => void;
  refine: () => void;
  refining: boolean;
  aspect: DeckAspect;
  setAspect: (a: DeckAspect) => void;
  deckReview: {
    verdict: 'ship' | 'revise';
    score: number;
    strengths: string[];
    issues: string[];
    suggestions: string[];
  } | null;
  runDeckReview: () => void;
  deckReviewing: boolean;
};

function DeckWorkspace(p: WorkspaceProps) {
  const totalImaged = p.deck.slides.filter((s) => s.imageAspect !== 'none').length;
  const generated = p.deck.slides.filter(
    (s) => s.imageAspect === 'none' || p.images[s.n],
  ).length;
  const allReady = generated === p.deck.slides.length;

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Outline column */}
      <Card className="col-span-3 sticky top-4 self-start max-h-[calc(100vh-2rem)] overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{p.deck.title}</CardTitle>
            <Badge variant="secondary">{p.deck.slides.length}</Badge>
          </div>
          <ThemeChip theme={p.deck.theme} />
        </CardHeader>
        <CardContent className="overflow-y-auto max-h-[calc(100vh-12rem)] space-y-1 pb-4">
          <DraggableOutline
            slides={p.deck.slides}
            theme={p.deck.theme}
            deckTitle={p.deck.title}
            aspect={p.aspect}
            selectedN={p.selectedSlideN}
            images={p.images}
            onSelect={p.setSelectedSlideN}
            onMove={p.moveSlide}
          />
        </CardContent>
      </Card>

      {/* Main editor column */}
      <div className="col-span-6 space-y-4">
        <Card className="overflow-hidden">
          <SlidePreview
            slide={p.selectedSlide}
            theme={p.deck.theme}
            imageDataUrl={p.images[p.selectedSlideN]?.dataUrl}
            aspect={p.aspect}
            chrome={{ deckTitle: p.deck.title, pageTotal: p.deck.slides.length }}
            className="border-b"
          />
          <CardContent className="p-3 flex items-center justify-between text-xs gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => p.addSlide(p.selectedSlideN)}>
                + slide
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => p.deleteSlide(p.selectedSlideN)}
                disabled={p.deck.slides.length <= 1}
              >
                delete
              </Button>
              <span className="text-[10px] text-muted-foreground">drag thumbnails to reorder</span>
            </div>
            <div className="flex items-center gap-2">
              {p.images[p.selectedSlideN]?.review && (
                <Badge variant="secondary">
                  {p.images[p.selectedSlideN]!.review!.score}/10
                </Badge>
              )}
              {p.images[p.selectedSlideN] && (
                <span className="text-muted-foreground">
                  {formatUsd(p.images[p.selectedSlideN]!.costUsd)}
                  {p.images[p.selectedSlideN]!.iterations > 1 && (
                    <span className="ml-1 opacity-70">· {p.images[p.selectedSlideN]!.iterations} tries</span>
                  )}
                </span>
              )}
              {p.selectedSlide.imageAspect !== 'none' && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => p.generateVariations(p.selectedSlide)}
                    disabled={p.busySlides.has(p.selectedSlideN) || p.phase === 'generating'}
                    title="Generate 3 variations to pick from"
                  >
                    3-up
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => p.generateOne(p.selectedSlide)}
                    disabled={p.busySlides.has(p.selectedSlideN) || p.phase === 'generating'}
                  >
                    {p.busySlides.has(p.selectedSlideN)
                      ? p.slideStatus[p.selectedSlideN] || '…'
                      : p.images[p.selectedSlideN]
                        ? 'Regenerate'
                        : 'Generate image'}
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Layout</Label>
                <Select
                  value={p.selectedSlide.layout}
                  onValueChange={(v) => p.changeLayout(p.selectedSlideN, v as Layout)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_LAYOUTS.map((l) => (
                      <SelectItem key={l} value={l}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Image aspect</Label>
                <div className="px-3 py-2 text-xs rounded-md border border-input bg-muted/30">
                  {p.selectedSlide.imageAspect}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Title</Label>
              <Input
                value={p.selectedSlide.title}
                onChange={(e) => p.updateSlide(p.selectedSlideN, { title: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Subtitle (optional)</Label>
              <Input
                value={p.selectedSlide.subtitle ?? ''}
                onChange={(e) => p.updateSlide(p.selectedSlideN, { subtitle: e.target.value || undefined })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Body bullets (one per line)</Label>
              <Textarea
                value={p.selectedSlide.body.join('\n')}
                onChange={(e) =>
                  p.updateSlide(p.selectedSlideN, {
                    body: e.target.value.split('\n').filter((l) => l.trim()),
                  })
                }
                rows={4}
              />
            </div>

            {p.selectedSlide.layout === 'big-stat' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Stat value</Label>
                  <Input
                    value={p.selectedSlide.stat?.value ?? ''}
                    onChange={(e) =>
                      p.updateSlide(p.selectedSlideN, {
                        stat: { value: e.target.value, label: p.selectedSlide.stat?.label ?? '' },
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Stat label</Label>
                  <Input
                    value={p.selectedSlide.stat?.label ?? ''}
                    onChange={(e) =>
                      p.updateSlide(p.selectedSlideN, {
                        stat: { value: p.selectedSlide.stat?.value ?? '', label: e.target.value },
                      })
                    }
                  />
                </div>
              </div>
            )}

            {p.selectedSlide.layout === 'full-bleed-quote' && (
              <div className="grid grid-cols-1 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Quote</Label>
                  <Textarea
                    value={p.selectedSlide.quote?.text ?? ''}
                    onChange={(e) =>
                      p.updateSlide(p.selectedSlideN, {
                        quote: { text: e.target.value, attribution: p.selectedSlide.quote?.attribution },
                      })
                    }
                    rows={2}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Attribution</Label>
                  <Input
                    value={p.selectedSlide.quote?.attribution ?? ''}
                    onChange={(e) =>
                      p.updateSlide(p.selectedSlideN, {
                        quote: {
                          text: p.selectedSlide.quote?.text ?? '',
                          attribution: e.target.value || undefined,
                        },
                      })
                    }
                  />
                </div>
              </div>
            )}

            {p.selectedSlide.imageAspect !== 'none' && (
              <div className="space-y-1">
                <Label className="text-xs">Image prompt (Nano Banana)</Label>
                <Textarea
                  value={p.selectedSlide.imagePrompt}
                  onChange={(e) => p.updateSlide(p.selectedSlideN, { imagePrompt: e.target.value })}
                  rows={3}
                />
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Speaker notes</Label>
              <Textarea
                value={p.selectedSlide.notes}
                onChange={(e) => p.updateSlide(p.selectedSlideN, { notes: e.target.value })}
                rows={2}
              />
            </div>

            {p.images[p.selectedSlideN]?.review?.issues.length ? (
              <div className="text-[10px] text-muted-foreground space-y-0.5 pt-2 border-t">
                <div className="font-medium">Claude review:</div>
                {p.images[p.selectedSlideN]!.review!.issues.map((iss, i) => (
                  <div key={i}>· {iss}</div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <label className="flex items-start gap-2 cursor-pointer flex-1">
              <input
                type="checkbox"
                checked={p.autoReview}
                onChange={(e) => p.setAutoReview(e.target.checked)}
                className="mt-1 size-4"
              />
              <div>
                <div className="text-sm font-medium">Auto-review with Claude</div>
                <div className="text-xs text-muted-foreground">
                  Claude inspects each image and re-prompts up to {MAX_REVIEW_RETRIES}× if it can be improved. Adds {formatUsd(NANO_BANANA_PRICE_PER_IMAGE_USD)} per retry.
                </div>
              </div>
            </label>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <div className="text-xs text-muted-foreground">
                Est: <span className="font-mono">{formatUsd(p.estimatedCost)}</span>
                {' · '}
                {totalImaged} of {p.deck.slides.length} slides have images
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <Select value={p.aspect} onValueChange={(v) => p.setAspect(v as DeckAspect)}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASPECTS.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={p.reset}>Start over</Button>
                <Button variant="outline" size="sm" onClick={p.saveDeck}>Save</Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={p.runDeckReview}
                  disabled={p.deckReviewing}
                  title="Have Claude review the whole deck"
                >
                  {p.deckReviewing ? 'Reviewing…' : 'Review deck'}
                </Button>
                <Button onClick={p.generateAll} disabled={p.phase === 'generating'} size="sm">
                  {p.phase === 'generating' ? 'Generating…' : `Generate all (${totalImaged})`}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={p.exportPdf}
                  disabled={!allReady}
                  title={allReady ? 'Download .pdf' : 'Generate all images first'}
                >
                  .pdf
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={p.exportPptx}
                  disabled={!allReady}
                  title={allReady ? 'Download .pptx' : 'Generate all images first'}
                >
                  .pptx
                </Button>
              </div>
              {p.deckReview && (
                <div className="w-full mt-2 border rounded-md p-3 bg-muted/30 text-xs space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={p.deckReview.verdict === 'ship' ? 'default' : 'secondary'}>
                      {p.deckReview.verdict === 'ship' ? 'Ship' : 'Revise'}
                    </Badge>
                    <span className="font-mono">{p.deckReview.score}/10</span>
                  </div>
                  {p.deckReview.strengths.length > 0 && (
                    <div>
                      <div className="font-medium text-emerald-600 dark:text-emerald-400">Strengths</div>
                      {p.deckReview.strengths.map((s, i) => <div key={i}>· {s}</div>)}
                    </div>
                  )}
                  {p.deckReview.issues.length > 0 && (
                    <div>
                      <div className="font-medium text-amber-600 dark:text-amber-400">Issues</div>
                      {p.deckReview.issues.map((s, i) => <div key={i}>· {s}</div>)}
                    </div>
                  )}
                  {p.deckReview.suggestions.length > 0 && (
                    <div>
                      <div className="font-medium">Suggestions</div>
                      {p.deckReview.suggestions.map((s, i) => <div key={i}>· {s}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chat refine column */}
      <Card className="col-span-3 sticky top-4 self-start max-h-[calc(100vh-2rem)] flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            Refine with Claude
            {p.refining && <span className="text-xs text-muted-foreground">thinking…</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-2 overflow-hidden p-3">
          <div className="flex-1 overflow-y-auto space-y-2 text-xs">
            {p.chatMessages.length === 0 && (
              <div className="text-muted-foreground space-y-1">
                <div>Ask Claude to revise the deck. Try:</div>
                <div className="italic opacity-80">&quot;Make slide 3 punchier.&quot;</div>
                <div className="italic opacity-80">&quot;Add a slide about pricing.&quot;</div>
                <div className="italic opacity-80">&quot;Swap to a darker palette.&quot;</div>
                <div className="italic opacity-80">&quot;Use Playfair for headings.&quot;</div>
              </div>
            )}
            {p.chatMessages.map((m, i) => (
              <div
                key={i}
                className={`rounded-md px-2 py-1.5 ${
                  m.role === 'user' ? 'bg-foreground text-background ml-4' : 'bg-muted mr-4'
                }`}
              >
                {m.text}
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Textarea
              placeholder="What should Claude change?"
              value={p.chatInput}
              onChange={(e) => p.setChatInput(e.target.value)}
              rows={2}
              disabled={p.refining}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) p.refine();
              }}
            />
            <Button onClick={p.refine} disabled={p.refining || !p.chatInput.trim()} size="sm" className="w-full">
              {p.refining ? 'Refining…' : 'Send (⌘↵)'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type SlideImageRecord = Record<number, SlideImage | undefined>;

function DraggableOutline({
  slides,
  theme,
  deckTitle,
  aspect,
  selectedN,
  images,
  onSelect,
  onMove,
}: {
  slides: Slide[];
  theme: Theme;
  deckTitle: string;
  aspect: DeckAspect;
  selectedN: number;
  images: SlideImageRecord;
  onSelect: (n: number) => void;
  onMove: (fromN: number, toN: number) => void;
}) {
  const [dragN, setDragN] = useState<number | null>(null);
  const [overN, setOverN] = useState<number | null>(null);

  return (
    <div className="space-y-1">
      {slides.map((slide) => {
        const img = images[slide.n];
        const ready = slide.imageAspect === 'none' || img;
        const selected = slide.n === selectedN;
        const isOver = overN === slide.n && dragN !== null && dragN !== slide.n;
        return (
          <button
            key={slide.n}
            draggable
            onDragStart={(e) => {
              setDragN(slide.n);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(slide.n));
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (overN !== slide.n) setOverN(slide.n);
            }}
            onDragLeave={() => {
              if (overN === slide.n) setOverN(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = Number(e.dataTransfer.getData('text/plain'));
              if (Number.isFinite(from) && from !== slide.n) onMove(from, slide.n);
              setDragN(null);
              setOverN(null);
            }}
            onDragEnd={() => {
              setDragN(null);
              setOverN(null);
            }}
            onClick={() => onSelect(slide.n)}
            className={`w-full text-left rounded-md border p-1.5 transition-all cursor-grab active:cursor-grabbing block ${
              selected ? 'border-foreground bg-accent' : 'border-border hover:bg-accent/50'
            } ${isOver ? 'border-t-4 border-t-foreground' : ''} ${dragN === slide.n ? 'opacity-50' : ''}`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[10px] font-mono opacity-50">
                ⋮⋮ {String(slide.n).padStart(2, '0')}
              </span>
              <span
                className={`size-2 rounded-full ${ready ? 'bg-emerald-500' : 'bg-muted'}`}
                title={ready ? 'ready' : 'no image'}
              />
            </div>
            {/* Live mini preview — same renderer as the main editor, just small */}
            <div className="overflow-hidden rounded border border-black/5 mb-1 pointer-events-none">
              <SlidePreview
                slide={slide}
                theme={theme}
                imageDataUrl={images[slide.n]?.dataUrl}
                aspect={aspect}
                chrome={{ deckTitle, pageTotal: slides.length }}
              />
            </div>
            <div className="text-[10px] uppercase tracking-wider opacity-60 line-clamp-1">
              {slide.layout.replace(/-/g, ' ')}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function VariationsModal({
  modal,
  close,
  apply,
}: {
  modal: { slideN: number; loading: boolean; options: string[]; cost: number };
  close: () => void;
  apply: (dataUrl: string) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={close}
    >
      <div
        className="bg-background border rounded-lg shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <div className="font-medium">3 image variations for slide {modal.slideN}</div>
            <div className="text-xs text-muted-foreground">
              {modal.loading
                ? 'Generating in parallel…'
                : `Done — ${formatUsd(modal.cost)} spent. Click an image to use it.`}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={close}>×</Button>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {modal.loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="aspect-video">
                  <Skeleton className="w-full h-full" />
                </div>
              ))
            : modal.options.map((url, i) => (
                <button
                  key={i}
                  onClick={() => apply(url)}
                  className="aspect-video rounded overflow-hidden border-2 border-transparent hover:border-foreground transition-colors"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
        </div>
      </div>
    </div>
  );
}

function ThemeChip({ theme }: { theme: Deck['theme'] }) {
  return (
    <div className="flex items-center gap-2 mt-1 text-[10px]">
      <div className="flex">
        {[theme.palette.background, theme.palette.text, theme.palette.primary, theme.palette.secondary, theme.palette.muted].map(
          (c) => (
            <div key={c} className="size-3 rounded-sm border border-black/5" style={{ background: c }} />
          ),
        )}
      </div>
      <span className="text-muted-foreground truncate">
        {theme.fontHeading} / {theme.fontBody}
      </span>
    </div>
  );
}
