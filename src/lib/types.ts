// Shared types for slidegen v2.
// A "deck" is a Theme + ordered Slides. Each slide picks one Layout.

export type Layout =
  | 'title-hero'           // big title + subtitle, image as full-bleed background w/ dark overlay
  | 'content-image-right'  // title + bullets on left, image on right
  | 'content-image-left'   // image on left, title + bullets on right
  | 'two-column'           // two columns of content, no image
  | 'big-stat'             // huge number/stat + label + small image accent
  | 'full-bleed-quote'     // quote text over image
  | 'section-divider'      // section label + big section title (image background, dim)
  | 'comparison'           // two columns side-by-side comparing options
  | 'agenda'               // numbered list of items
  | 'bar-chart'            // bar chart with title + caption
  | 'pie-chart'            // pie chart with title + legend
  | 'closing-cta';         // CTA + image

export const ALL_LAYOUTS: Layout[] = [
  'title-hero',
  'content-image-right',
  'content-image-left',
  'two-column',
  'big-stat',
  'full-bleed-quote',
  'section-divider',
  'comparison',
  'agenda',
  'bar-chart',
  'pie-chart',
  'closing-cta',
];

export type ImageAspect = '16:9' | '4:3' | '1:1' | 'none';

export type Stat = {
  /** The big number/figure: "87%", "$1.2M", "10x" */
  value: string;
  /** Caption below the number: "of users opened the app weekly" */
  label: string;
};

export type Quote = {
  text: string;
  attribution?: string;
};

export type Comparison = {
  leftLabel: string;
  rightLabel: string;
  left: string[];
  right: string[];
};

export type ChartData = {
  /** One label per data point, e.g. ["Q1", "Q2", "Q3", "Q4"] */
  labels: string[];
  /** Numeric values matching labels[] length */
  values: number[];
  /** Optional unit suffix shown in labels (e.g. "%", "M users", "$"). Empty string if none. */
  unit?: string;
};

export type Slide = {
  n: number;
  layout: Layout;
  /** Optional small label above the title (e.g. "PROBLEM", "MARKET", "TRACTION"). */
  eyebrow?: string;
  /** Optional Lucide icon name (kebab-case: "bar-chart-3", "shield", "zap"). Renders next to eyebrow on content slides. */
  icon?: string;
  title: string;
  subtitle?: string;
  /** Bullet points or short paragraphs. Used by content-* / agenda / two-column / closing-cta. */
  body: string[];
  stat?: Stat;
  quote?: Quote;
  comparison?: Comparison;
  chart?: ChartData;
  /** Visual description for Nano Banana. Empty string for layouts that don't need an image. */
  imagePrompt: string;
  /** Aspect ratio Gemini should generate at; 'none' = no image. */
  imageAspect: ImageAspect;
  /** Speaker notes for Google Slides / Keynote. */
  notes: string;
};

export type Palette = {
  /** Background color of most slides */
  background: string;
  /** Body text color (high contrast against background) */
  text: string;
  /** Primary accent — used for titles, buttons, key emphasis */
  primary: string;
  /** Secondary accent — used for subtitles, secondary emphasis */
  secondary: string;
  /** Tertiary accent — used for dividers, muted ui */
  muted: string;
};

export type Theme = {
  palette: Palette;
  /** Google Fonts heading family (e.g. "Inter", "Playfair Display") */
  fontHeading: string;
  /** Google Fonts body family */
  fontBody: string;
  /** Mood string appended to every Nano Banana prompt for visual cohesion */
  mood: string;
};

export type ThemePresetId =
  | 'auto'
  | 'editorial-warm'
  | 'tech-noir'
  | 'cool-mint'
  | 'bold-magazine'
  | 'hand-drawn'
  | 'corporate';

export type ThemePreset = {
  id: ThemePresetId;
  label: string;
  description: string;
  /** When non-null, this exact theme is used (the model won't invent one). */
  theme: Theme | null;
};

// Which LLM handles the text work (plan / refine / review).
// `claude` uses your local Claude Code CLI. `deepseek` calls the DeepSeek API
// (text-only — no vision, so per-slide image review is unavailable).
export type LlmProvider = 'claude' | 'deepseek';

export const LLM_PROVIDERS: LlmProvider[] = ['claude', 'deepseek'];

/** Coerce an unknown value (e.g. a request body field) into a valid provider. */
export function toLlmProvider(value: unknown): LlmProvider {
  return value === 'deepseek' ? 'deepseek' : 'claude';
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'auto',
    label: 'Auto',
    description: 'Let the model pick the theme based on your topic',
    theme: null,
  },
  {
    id: 'editorial-warm',
    label: 'Editorial Warm',
    description: 'Cream, terracotta, sage. Magazine illustration. Fraunces + Inter.',
    theme: {
      palette: {
        background: '#F5EFE6',
        text: '#1F1A17',
        primary: '#B85C2C',
        secondary: '#3F6B4E',
        muted: '#A89684',
      },
      fontHeading: 'Fraunces',
      fontBody: 'Inter',
      mood: 'warm editorial illustration, cream and terracotta palette with sage accents, hand-drawn feel, golden afternoon light, slightly textured paper aesthetic',
    },
  },
  {
    id: 'tech-noir',
    label: 'Tech Noir',
    description: 'Deep navy, bioluminescent teal. Moody cinematic. Space Grotesk + Inter.',
    theme: {
      palette: {
        background: '#0B1020',
        text: '#F5F7FB',
        primary: '#7CF5C4',
        secondary: '#6B8AFF',
        muted: '#8A93A6',
      },
      fontHeading: 'Space Grotesk',
      fontBody: 'Inter',
      mood: 'moody cinematic tech photography, deep midnight blue with bioluminescent teal accents, soft volumetric light, minimal abstract compositions, shallow depth of field',
    },
  },
  {
    id: 'cool-mint',
    label: 'Cool Mint',
    description: 'Off-white, mint green, charcoal. Calm clarity. DM Serif + DM Sans.',
    theme: {
      palette: {
        background: '#F4F6F2',
        text: '#0F1714',
        primary: '#2E8F6B',
        secondary: '#5C7C76',
        muted: '#9DA8A0',
      },
      fontHeading: 'DM Serif Display',
      fontBody: 'DM Sans',
      mood: 'soft natural daylight photography, mint and sage palette, clean modern compositions, organic and uncluttered, minimalist editorial feel',
    },
  },
  {
    id: 'bold-magazine',
    label: 'Bold Magazine',
    description: 'Black, white, vivid red. High-contrast editorial. Playfair + Inter.',
    theme: {
      palette: {
        background: '#FFFFFF',
        text: '#0A0A0A',
        primary: '#E8341A',
        secondary: '#0A0A0A',
        muted: '#9C9C9C',
      },
      fontHeading: 'Playfair Display',
      fontBody: 'Inter',
      mood: 'high-contrast black-and-white editorial photography with bold red accent objects, magazine cover aesthetic, dramatic lighting, confident strong compositions',
    },
  },
  {
    id: 'hand-drawn',
    label: 'Hand-drawn',
    description: 'Cream, ink, accent ochre. Sketchy and human. Caveat + DM Sans.',
    theme: {
      palette: {
        background: '#FBF7EE',
        text: '#1A1A1A',
        primary: '#C97A2B',
        secondary: '#3E5C76',
        muted: '#A8A292',
      },
      fontHeading: 'Bricolage Grotesque',
      fontBody: 'DM Sans',
      mood: 'loose hand-drawn ink illustration, watercolor washes, sketchy textures, paper grain, friendly and human, warm cream paper background',
    },
  },
  {
    id: 'corporate',
    label: 'Corporate',
    description: 'Deep blue, white, cool gray. Professional polish. Inter throughout.',
    theme: {
      palette: {
        background: '#FFFFFF',
        text: '#0F1B2D',
        primary: '#1F4FA8',
        secondary: '#6E84A3',
        muted: '#C7D0DC',
      },
      fontHeading: 'Inter',
      fontBody: 'Inter',
      mood: 'polished corporate photography, soft natural light, professional modern offices and abstract data visualizations, deep blue accent palette, premium business aesthetic',
    },
  },
];

export function getThemePreset(id: ThemePresetId): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0];
}

export type DeckTemplate =
  | 'pitch'
  | 'saas-pitch'
  | 'consumer-pitch'
  | 'lecture'
  | 'status'
  | 'product-launch'
  | 'retro'
  | 'custom';

export type Deck = {
  title: string;
  /** Which template the planner used. Helps the renderer pick layout patterns. */
  template: DeckTemplate;
  theme: Theme;
  slides: Slide[];
};

export type DeckAspect = '16:9' | '4:3' | '9:16' | '1:1';

/**
 * Per-layout default image aspect. Used when planning to keep images
 * proportionate to the slide region they'll occupy.
 */
export const LAYOUT_IMAGE_ASPECT: Record<Layout, ImageAspect> = {
  'title-hero': '16:9',
  'content-image-right': '1:1',
  'content-image-left': '1:1',
  'two-column': 'none',
  'big-stat': '1:1',
  'full-bleed-quote': '16:9',
  'section-divider': '16:9',
  'comparison': 'none',
  'agenda': 'none',
  'bar-chart': 'none',
  'pie-chart': 'none',
  'closing-cta': '16:9',
};

/** Layouts that don't need an image at all. */
export const TEXT_ONLY_LAYOUTS: Layout[] = [
  'two-column',
  'comparison',
  'agenda',
  'bar-chart',
  'pie-chart',
];

export const CHART_LAYOUTS: Layout[] = ['bar-chart', 'pie-chart'];
