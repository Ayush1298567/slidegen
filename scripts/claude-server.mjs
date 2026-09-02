#!/usr/bin/env node
// slidegen Claude server — gstack-style persistent local HTTP service.
// Spawns the local `claude` CLI per request. No Anthropic API key required.
//
// Endpoints:
//   GET  /health                  → { ok, version, pid }
//   POST /plan   { topic, slideCount, styleHint? }
//                                 → { title, suggestedStyle, slides: [{ n, title, imagePrompt }] }
//   POST /refine { outline, instruction }
//                                 → updated outline JSON
//   GET  /events?id=...           → SSE stream for in-flight requests
//
// Auth: every request must include `x-slidegen-token: <token>` matching the
// token stored in .slidegen/claude-server.json. Server binds to 127.0.0.1.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const STATE_DIR = join(ROOT, '.slidegen');
const STATE_FILE = join(STATE_DIR, 'claude-server.json');
const VERSION = '0.1.0';
const HOST = '127.0.0.1';
const SHUTDOWN_AFTER_MS = 1000 * 60 * 30; // idle timeout

const CLAUDE_BIN = process.env.SLIDEGEN_CLAUDE_BIN || 'claude';

// --- Provider configuration (claude | deepseek) --------------------------
// `claude`  → spawn the local Claude Code CLI (existing behavior).
// `deepseek`→ call the DeepSeek API directly (no Claude Code needed).
// Provider can be forced via SLIDEGEN_PROVIDER and/or overridden per request.
const DEFAULT_PROVIDER = process.env.SLIDEGEN_PROVIDER === 'deepseek' ? 'deepseek' : 'claude';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
// DeepSeek pricing in $ per 1M tokens — approximate; override via env if rates change.
const DEEPSEEK_INPUT_USD_PER_MTOKEN = Number(process.env.DEEPSEEK_INPUT_USD_PER_MTOKEN ?? 0.27);
const DEEPSEEK_OUTPUT_USD_PER_MTOKEN = Number(process.env.DEEPSEEK_OUTPUT_USD_PER_MTOKEN ?? 1.1);
const PROVIDER_LABEL = { claude: 'Claude', deepseek: 'DeepSeek' };

function resolveProvider(value) {
  if (value === 'claude' || value === 'deepseek') return value;
  return DEFAULT_PROVIDER;
}

const sessions = new Map(); // id → { events: [], done: bool, error?, result? }
let lastActivity = Date.now();

function touch() { lastActivity = Date.now(); }

function writeState({ port, token, pid }) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ port, token, pid, version: VERSION, startedAt: Date.now() }, null, 2),
  );
}

function jsonResponse(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  return await new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function pushEvent(id, evt) {
  const session = sessions.get(id);
  if (!session) return;
  session.events.push(evt);
  for (const sub of session.subscribers) sub(evt);
}

function makeSession() {
  const id = randomBytes(8).toString('hex');
  sessions.set(id, { events: [], subscribers: new Set(), done: false });
  return id;
}

// Run claude CLI with a prompt; return parsed JSON result.
function runClaude({ prompt, sessionId }) {
  return new Promise((resolveRun, reject) => {
    // --print: non-interactive mode
    // --output-format json: structured response so we can read .result + .total_cost_usd
    const args = ['--print', '--output-format', 'json'];
    const child = spawn(CLAUDE_BIN, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      const text = d.toString('utf8');
      stdout += text;
      if (sessionId) pushEvent(sessionId, { type: 'stdout', text });
    });
    child.stderr.on('data', (d) => {
      const text = d.toString('utf8');
      stderr += text;
      if (sessionId) pushEvent(sessionId, { type: 'stderr', text });
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        const wrapper = JSON.parse(stdout);
        resolveRun({
          text: typeof wrapper.result === 'string' ? wrapper.result : stdout,
          rawWrapper: wrapper,
        });
      } catch {
        // Fallback: claude printed raw text instead of JSON wrapper
        resolveRun({ text: stdout, rawWrapper: null });
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Run a single DeepSeek completion via their OpenAI-compatible HTTP API.
// Returns { text, costUsd }. Text-only: DeepSeek models have no vision, so the
// screenshot-review endpoint rejects provider=deepseek (see handleReview).
async function runDeepSeek({ prompt, sessionId }) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error(
      'DEEPSEEK_API_KEY is not set. Add it to .env.local (see .env.local.example) to use DeepSeek.',
    );
  }
  pushEvent(sessionId, { type: 'stdout', text: `\n[deepseek] calling ${DEEPSEEK_MODEL}…\n` });
  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert presentation designer. Follow the user\'s instructions exactly and output ONLY valid JSON — no prose, no markdown fences, no commentary.',
        },
        { role: 'user', content: prompt },
      ],
      stream: false,
      max_tokens: 8192,
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const errBody = await res.json();
      detail = errBody?.error?.message || JSON.stringify(errBody).slice(0, 300);
    } catch {
      detail = res.statusText;
    }
    throw new Error(`DeepSeek API ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('DeepSeek returned an empty response.');
  }
  const usage = data?.usage;
  const costUsd =
    usage && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens)
      ? (usage.prompt_tokens / 1e6) * DEEPSEEK_INPUT_USD_PER_MTOKEN +
        (usage.completion_tokens / 1e6) * DEEPSEEK_OUTPUT_USD_PER_MTOKEN
      : null;
  return { text, costUsd };
}

// Normalized transport: returns { text, costUsd, rawWrapper } for both providers.
async function runLLM({ provider, prompt, sessionId }) {
  if (resolveProvider(provider) === 'deepseek') {
    const r = await runDeepSeek({ prompt, sessionId });
    return { text: r.text, costUsd: r.costUsd, rawWrapper: null };
  }
  const r = await runClaude({ prompt, sessionId });
  return { text: r.text, costUsd: r.rawWrapper?.total_cost_usd ?? null, rawWrapper: r.rawWrapper };
}

// Extract a JSON object/array from a possibly-fenced/text response.
function extractJson(text) {
  if (!text) throw new Error('empty response from claude');
  const trimmed = text.trim();

  // Try direct parse
  try { return JSON.parse(trimmed); } catch {}

  // Try fenced ```json ... ``` block
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch {}
  }

  // Try first {...} or [...] block
  const obj = trimmed.match(/\{[\s\S]*\}/);
  if (obj) {
    try { return JSON.parse(obj[0]); } catch {}
  }

  throw new Error(`could not extract JSON from model output: ${trimmed.slice(0, 200)}`);
}

const TEMPLATE_GUIDANCE = {
  pitch: `PITCH DECK structure (in order, adapt count to fit ${'$count'}): title → problem → solution → market opportunity → product/demo → traction → business model → competition → team → ask/CTA. Use big-stat slides for traction/market numbers. Use comparison for vs-competition. End on closing-cta with the ask.`,
  'saas-pitch': `SaaS PITCH (B2B-flavored): title → problem (with stats on cost of inaction) → solution (product hero) → how it works (content slides) → ICP fit → pricing/business model → traction (bar-chart with ARR or logos) → competition (comparison vs incumbents) → team → ask. Lean into stats and comparison slides.`,
  'consumer-pitch': `CONSUMER PITCH: title → problem (relatable consumer story) → solution → product (full-bleed-quote with user testimonial) → market sizing (big-stat / pie-chart) → distribution / GTM → traction → team → ask. Emotional, story-driven, image-rich.`,
  lecture: `LECTURE structure: title → learning objectives (agenda) → concept slides (content-image-* with rich body) → key takeaways → Q&A/discussion. Heavy on body bullets, use big-stat for memorable numbers, use full-bleed-quote for key quotes from authorities.`,
  status: `STATUS UPDATE structure: title → headline metrics (big-stat) → wins (content) → blockers/risks (content) → next steps (agenda) → asks/decisions needed (closing-cta). Concise body, max 4 bullets per slide.`,
  'product-launch': `PRODUCT LAUNCH structure: title-hero → why now (problem) → introducing the product → key features (multiple content slides) → demo highlight (full-bleed-quote or big-stat for impact) → who it's for → pricing → CTA. Image-heavy.`,
  retro: `RETRO structure: title → period summary (big-stat) → what went well (content) → what didn't (content) → root causes (content or comparison) → action items (agenda with owners) → closing-cta with commitments.`,
  custom: `CUSTOM deck — pick whatever structure fits the topic best. Use a varied mix of layouts. Always start with title-hero and end with closing-cta or section-divider.`,
};

const LUCIDE_ICON_HINTS = `
Pick ONE Lucide icon name per non-title-hero, non-section-divider slide that fits the slide's idea.
Use kebab-case names from Lucide (https://lucide.dev). Common useful ones:
  Subject icons:     zap, shield, target, trophy, rocket, lightbulb, flag, compass, map, sparkles, gem, crown, heart, star, eye, key, lock, link, network
  Data / metrics:    bar-chart-3, line-chart, pie-chart, trending-up, trending-down, activity, gauge, percent, dollar-sign, hash, calculator
  Time / process:    clock, calendar, timer, hourglass, refresh-cw, zap, repeat, history
  People / team:     users, user-check, user-plus, handshake, briefcase, award, badge-check
  Cloud / tech:      cloud, server, database, cpu, code-2, terminal, git-branch, layers, package
  Status / verdict:  check-circle-2, x-circle, alert-triangle, info, thumbs-up, thumbs-down, star, flame
  Money / business:  banknote, credit-card, coins, piggy-bank, scale, store, building-2
  Nav / arrows:      arrow-right, arrow-up-right, chevrons-up, corner-down-right, move-right, send
You may invent reasonable kebab-case lucide names; the renderer falls back to a simple chevron if a name isn't recognized.
`;

function planPrompt({ topic, slideCount, styleHint, template = 'custom', themeOverride, brandPrimary }) {
  const layoutList = `
Layouts you can pick from (pick the right one per slide for variety and rhythm):
  - "title-hero": opening title slide. Big title + subtitle. Image as full-bleed dim background. Empty body.
  - "content-image-right": title + 3-5 bullets on left, image on right. Most common content slide.
  - "content-image-left": image on left, title + 3-5 bullets on right. Alternate to break rhythm.
  - "two-column": two columns of bullets, no image. Use sparingly — for dense info.
  - "big-stat": ONE huge number/figure (e.g. "87%", "$1.2M") + caption. Optional image accent. Use for memorable metrics.
  - "full-bleed-quote": a powerful quote over a full-bleed image. Use for emotional/impact moments, max 1-2 per deck.
  - "section-divider": "Section 02 — Solution". Big section title, image background dimmed. Use to chunk longer decks.
  - "comparison": A vs B side-by-side. Two columns of bullets with clear left/right labels. No image.
  - "agenda": numbered list of items. No image. Use for objectives, next steps, agenda.
  - "bar-chart": real bar chart with title + caption. Use for time-series, distributions, growth. Requires "chart" field with labels[] (categories like "Q1","Q2") and values[] (numbers). 3-7 data points.
  - "pie-chart": real pie chart with title + legend. Use for breakdowns, market share, allocations. Requires "chart" field. 2-6 slices.
  - "closing-cta": closing slide with call-to-action / contact / next step. Image + bold title + 1-3 supporting bullets.

Image aspect ratios per layout (use exactly these, the renderer depends on them):
  title-hero=16:9, content-image-right=1:1, content-image-left=1:1, two-column=none, big-stat=1:1,
  full-bleed-quote=16:9, section-divider=16:9, comparison=none, agenda=none, bar-chart=none,
  pie-chart=none, closing-cta=16:9
`;

  const themeBlock = themeOverride
    ? `THEME — USE EXACTLY THIS THEME (DO NOT INVENT YOUR OWN):
${JSON.stringify(themeOverride, null, 2)}
Copy these palette values, fontHeading, fontBody, and mood VERBATIM into the output's "theme" field.`
    : `THEME — PICK ONE that matches the topic mood (described below in VISUAL THEME).`;

  const brandBlock = brandPrimary
    ? `BRAND OVERRIDE — The user has specified their brand primary color: ${brandPrimary}. Use this color as theme.palette.primary. Choose the rest of the palette to harmonize with it (background should usually be white or near-black, text high-contrast against background).`
    : '';

  return `You are a senior deck designer planning a real presentation. Output ONLY valid JSON. No prose. No fences.

USER REQUEST
Topic: ${topic}
Template: ${template}
Slide count: EXACTLY ${slideCount} slides — not fewer, not more.
Style hint from user: ${styleHint || '(none — pick the best aesthetic yourself)'}

${themeBlock}
${brandBlock}

TEMPLATE GUIDANCE
${TEMPLATE_GUIDANCE[template].replace('$count', slideCount)}

ICONS PER SLIDE
${LUCIDE_ICON_HINTS}

${layoutList}

VARIETY RULE: Use at least 4 different layouts across the deck. No more than 2 consecutive slides may share a layout. Decks should feel rhythmic, not uniform.

CONTENT RULE: Every body bullet is short and concrete (under 12 words). No lorem ipsum. No empty filler. If a slide doesn't need bullets (title-hero, full-bleed-quote, section-divider), use an empty body array. Speaker notes ("notes" field) MUST be substantive — 2-3 sentences explaining what the presenter says.

VISUAL THEME: Pick ONE cohesive theme that runs through the entire deck:
  - palette: 5 hex colors — { background, text, primary, secondary, muted }. background should usually be white-ish or near-black depending on mood. text must contrast with background. primary is the boldest accent.
  - fontHeading: a Google Fonts heading family that matches the topic mood (Inter, Playfair Display, Space Grotesk, DM Serif Display, JetBrains Mono, Bricolage Grotesque, Fraunces, etc.)
  - fontBody: a Google Fonts body family that pairs with the heading
  - mood: 1-2 sentences appended to every image prompt so all images feel like one deck (e.g. "warm editorial photography, golden hour light, muted earth tones, shallow depth of field")

IMAGE PROMPTS: For slides where imageAspect !== "none", write a detailed (30-60 word) visual prompt. Focus on subject, composition, mood, light. NEVER include text, numbers, labels, charts, UI mockups, watermarks, or letterforms in the image — text is rendered by PowerPoint, not Gemini. NEVER write prompts that describe slide-like content (e.g. "a slide with..." or "an infographic showing...").

EYEBROWS: Every NON-title-hero, NON-section-divider, NON-closing-cta slide should have a short "eyebrow" label (1-3 words, will be RENDERED IN UPPERCASE) that names the section. Examples: "PROBLEM", "SOLUTION", "MARKET", "TRACTION", "PRODUCT", "TEAM", "ASK", "OBJECTIVES", "WINS", "BLOCKERS". Skip eyebrow on title-hero (n=1), section-divider, and closing-cta — those don't need it. The eyebrow is what makes the deck feel like a real designed deck instead of generic templates.

OUTPUT SCHEMA (exact field names, all required):
{
  "title": "deck title (under 60 chars)",
  "template": "${template}",
  "theme": {
    "palette": { "background": "#hex", "text": "#hex", "primary": "#hex", "secondary": "#hex", "muted": "#hex" },
    "fontHeading": "Inter",
    "fontBody": "Inter",
    "mood": "..."
  },
  "slides": [
    {
      "n": 1,
      "layout": "title-hero",
      "eyebrow": "optional 1-3 word section label, ALL CAPS PROFILE-STYLE",
      "icon": "optional kebab-case lucide icon name; omit on title-hero/section-divider",
      "title": "...",
      "subtitle": "optional, omit if not used",
      "body": [],
      "stat": { "value": "...", "label": "..." },          // ONLY for big-stat layout
      "quote": { "text": "...", "attribution": "..." },     // ONLY for full-bleed-quote layout
      "comparison": { "leftLabel": "...", "rightLabel": "...", "left": [], "right": [] }, // ONLY for comparison
      "chart": { "labels": ["Q1","Q2","Q3","Q4"], "values": [12,18,27,41], "unit": "%" }, // ONLY for bar-chart or pie-chart
      "imagePrompt": "...",
      "imageAspect": "16:9",
      "notes": "speaker notes, 2-3 sentences"
    }
  ]
}

REQUIREMENTS
- slides array MUST have EXACTLY ${slideCount} entries with n = 1, 2, ..., ${slideCount} contiguous
- Use ONLY the layout names listed above
- imageAspect MUST match the layout per the table
- Include stat field ONLY on big-stat layouts; omit on others
- Include quote field ONLY on full-bleed-quote layouts
- Include comparison field ONLY on comparison layouts
- Include chart field ONLY on bar-chart or pie-chart layouts (with labels.length === values.length)
- For chart values, use REAL plausible numbers grounded in the topic — don't invent "100, 200, 300" placeholders
- Output the JSON object now and nothing else.`;
}

function reviewPrompt({ imagePath, imagePrompt, style, slideTitle }) {
  return `You are reviewing a screenshot of a FINAL composed slide — image + real text overlay, exactly as it will appear in the exported PowerPoint deck. Read the image at this absolute path using your Read tool, then assess the FULL composition (not just the AI-generated background image).

Slide screenshot: ${imagePath}
Slide title: ${slideTitle}
Original image prompt (for context): ${imagePrompt}
Required visual style for the AI image portion: ${style}

CRITICAL FAILURE MODES (verdict MUST be "improve" if any apply):
  1. ANY of the slide's real PowerPoint text is unreadable due to low contrast against the background — title, subtitle, bullets, stats, chart labels. The eye must instantly read every word.
  2. The AI background image contains its OWN text/numbers/letters/labels/UI/charts (those would be in addition to the real PowerPoint text and look amateur). Anything that looks like typography baked into the image is a fail.
  3. The image overlaps or fights the title/body text — composition is unbalanced, focal point sits where the title sits, busy details where bullets need quiet.
  4. Text overflows, gets cut off, or wraps awkwardly in the visible frame.
  5. Slide looks cluttered, AI-slop, or unprofessional. A senior designer at a top-tier firm would reject it.

Assess these dimensions (1-10 each, take the MIN):
  - readability (every word legible at first glance)
  - composition (image + text feel intentional, not fighting)
  - text-in-image (zero text inside the AI image — instant fail if present)
  - typography (heading and body sizing/spacing look professional, no overflow)
  - color/contrast (palette feels cohesive, contrast meets accessibility bar)
  - polish (overall: would you put this in an investor deck or a YC final pitch?)

Output ONLY valid JSON, no prose, no fences:
{
  "verdict": "approve" | "improve",
  "score": 1-10,
  "issues": ["short bullet — what specifically looks bad and why", ...],
  "improvedPrompt": "if verdict is improve AND the fix is in the AI image (composition, mood, focal point, OR text leaked into image): a sharper Nano Banana prompt. Lead with 'absolutely NO text, numbers, letters, labels, UI, charts — pure visual imagery only.' if text was present. If the issue is purely text-overflow / theme color choice (not the image), omit improvedPrompt — the user fixes those by editing the slide directly."
}

A 7+ slide with minor nits = approve. Anything below 7 OR text-in-image OR illegible PowerPoint text = improve. Output JSON now.`;
}

function refinePrompt({ deck, instruction }) {
  return `You are revising a slide-deck. Output ONLY valid JSON matching the EXACT same schema as the input — no prose, no fences.

Current deck:
${JSON.stringify(deck, null, 2)}

User instruction:
${instruction}

Apply the instruction precisely. You may:
  - Add slides (renumber n contiguously)
  - Remove slides (renumber n contiguously)
  - Change a slide's layout, title, body, imagePrompt, etc.
  - Swap layouts to vary rhythm
  - Adjust theme palette or fonts if user asks

You MUST keep:
  - The same JSON schema (theme + slides[] with same fields)
  - n values 1, 2, ..., contiguous, no gaps
  - imageAspect values matching layout (title-hero/section-divider/full-bleed-quote/closing-cta=16:9, content-image-*/big-stat=1:1, two-column/comparison/agenda=none)
  - Layout-specific fields (stat for big-stat, quote for full-bleed-quote, comparison for comparison)
  - Image prompts free of text/numbers/UI

Output the full revised deck JSON now.`;
}

const ALL_LAYOUTS = [
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
const VALID_ASPECTS = ['16:9', '4:3', '1:1', 'none'];

function isHex(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim());
}

function validateDeck(deck, expectedCount) {
  if (!deck || typeof deck !== 'object') return 'deck is not an object';
  if (typeof deck.title !== 'string' || !deck.title.trim()) return 'title missing';
  if (typeof deck.template !== 'string') return 'template missing';

  const t = deck.theme;
  if (!t || typeof t !== 'object') return 'theme missing';
  if (!t.palette || typeof t.palette !== 'object') return 'theme.palette missing';
  for (const k of ['background', 'text', 'primary', 'secondary', 'muted']) {
    if (!isHex(t.palette[k])) return `theme.palette.${k} must be #RRGGBB`;
  }
  if (typeof t.fontHeading !== 'string' || !t.fontHeading.trim()) return 'theme.fontHeading missing';
  if (typeof t.fontBody !== 'string' || !t.fontBody.trim()) return 'theme.fontBody missing';
  if (typeof t.mood !== 'string' || !t.mood.trim()) return 'theme.mood missing';

  if (!Array.isArray(deck.slides)) return 'slides not an array';
  if (deck.slides.length !== expectedCount) {
    return `expected ${expectedCount} slides, got ${deck.slides.length}`;
  }

  for (let i = 0; i < deck.slides.length; i++) {
    const s = deck.slides[i];
    const where = `slide ${i + 1}`;
    if (s.n !== i + 1) return `${where} has n=${s.n}, expected ${i + 1}`;
    if (!ALL_LAYOUTS.includes(s.layout)) return `${where} unknown layout "${s.layout}"`;
    if (typeof s.title !== 'string' || !s.title.trim()) return `${where} missing title`;
    // Normalize body / imagePrompt / notes — Claude sometimes omits empty fields.
    if (s.body == null) s.body = [];
    if (!Array.isArray(s.body)) return `${where} body must be an array`;
    if (s.imagePrompt == null) s.imagePrompt = '';
    if (typeof s.imagePrompt !== 'string') return `${where} imagePrompt must be a string`;
    if (s.notes == null) s.notes = '';
    if (typeof s.notes !== 'string') return `${where} notes must be a string`;
    if (s.eyebrow != null && typeof s.eyebrow !== 'string') return `${where} eyebrow must be a string if present`;
    if (s.icon != null && typeof s.icon !== 'string') return `${where} icon must be a string if present`;
    // Auto-normalize imageAspect — Claude sometimes returns "9:16", "4:5", or
    // a value that doesn't match the layout. Snap it to the canonical aspect
    // for the chosen layout instead of bouncing the whole plan.
    const layoutDefaults = {
      'title-hero': '16:9', 'content-image-right': '1:1', 'content-image-left': '1:1',
      'two-column': 'none', 'big-stat': '1:1', 'full-bleed-quote': '16:9',
      'section-divider': '16:9', 'comparison': 'none', 'agenda': 'none',
      'bar-chart': 'none', 'pie-chart': 'none', 'closing-cta': '16:9',
    };
    if (layoutDefaults[s.layout]) {
      s.imageAspect = layoutDefaults[s.layout];
    } else if (!VALID_ASPECTS.includes(s.imageAspect)) {
      s.imageAspect = '16:9';
    }

    if (s.layout === 'big-stat') {
      if (!s.stat || typeof s.stat.value !== 'string' || typeof s.stat.label !== 'string') {
        return `${where} (big-stat) requires stat.value and stat.label`;
      }
    }
    if (s.layout === 'full-bleed-quote') {
      if (!s.quote || typeof s.quote.text !== 'string') {
        return `${where} (full-bleed-quote) requires quote.text`;
      }
    }
    if (s.layout === 'comparison') {
      const c = s.comparison;
      if (
        !c ||
        typeof c.leftLabel !== 'string' ||
        typeof c.rightLabel !== 'string' ||
        !Array.isArray(c.left) ||
        !Array.isArray(c.right)
      ) {
        return `${where} (comparison) requires comparison.leftLabel/rightLabel/left/right`;
      }
    }
    if (s.layout === 'bar-chart' || s.layout === 'pie-chart') {
      const c = s.chart;
      if (!c || !Array.isArray(c.labels) || !Array.isArray(c.values)) {
        return `${where} (${s.layout}) requires chart.labels[] and chart.values[]`;
      }
      if (c.labels.length !== c.values.length) {
        return `${where} (${s.layout}) labels (${c.labels.length}) and values (${c.values.length}) length mismatch`;
      }
      if (c.labels.length < 2 || c.labels.length > 8) {
        return `${where} (${s.layout}) chart needs 2-8 data points (got ${c.labels.length})`;
      }
      if (!c.values.every((v) => typeof v === 'number' && Number.isFinite(v))) {
        return `${where} (${s.layout}) chart.values must all be finite numbers`;
      }
      if (c.unit != null && typeof c.unit !== 'string') {
        return `${where} (${s.layout}) chart.unit must be a string if present`;
      }
    }
    if (s.imageAspect !== 'none' && (!s.imagePrompt || !s.imagePrompt.trim())) {
      return `${where} has imageAspect ${s.imageAspect} but empty imagePrompt`;
    }
  }
  // Variety check: at most 2 consecutive same-layout slides
  for (let i = 2; i < deck.slides.length; i++) {
    if (
      deck.slides[i].layout === deck.slides[i - 1].layout &&
      deck.slides[i].layout === deck.slides[i - 2].layout
    ) {
      return `slides ${i - 1}-${i + 1} all use the same layout "${deck.slides[i].layout}" — vary the rhythm`;
    }
  }
  return null;
}

async function handlePlan(req, res) {
  touch();
  const body = await readBody(req);
  const provider = resolveProvider(body.provider);
  const { topic, slideCount = 10, styleHint, template = 'custom', themeOverride, brandPrimary } = body;
  if (!topic || typeof topic !== 'string') {
    return jsonResponse(res, 400, { error: 'topic required' });
  }
  const sessionId = makeSession();
  jsonResponse(res, 202, { sessionId });

  (async () => {
    try {
      pushEvent(sessionId, { type: 'status', text: `${PROVIDER_LABEL[provider]} is designing the deck…` });
      let deck;
      let totalCost = 0;
      let lastError = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const { text, costUsd } = await runLLM({
          provider,
          prompt: planPrompt({ topic, slideCount, styleHint, template, themeOverride, brandPrimary }),
          sessionId,
        });
        totalCost += costUsd ?? 0;
        try {
          deck = extractJson(text);
        } catch (e) {
          lastError = e.message;
          pushEvent(sessionId, { type: 'status', text: `Plan attempt ${attempt} unparseable, retrying…` });
          continue;
        }
        const issue = validateDeck(deck, slideCount);
        if (!issue) {
          lastError = null;
          break;
        }
        lastError = issue;
        pushEvent(sessionId, { type: 'status', text: `Plan attempt ${attempt}: ${issue}, retrying…` });
        deck = undefined;
      }
      if (!deck) throw new Error(lastError || 'failed to produce a valid plan');
      const session = sessions.get(sessionId);
      session.result = { deck, llmCostUsd: totalCost || null };
      session.done = true;
      pushEvent(sessionId, { type: 'done', result: session.result });
    } catch (err) {
      const session = sessions.get(sessionId);
      session.error = err.message;
      session.done = true;
      pushEvent(sessionId, { type: 'error', error: err.message });
    }
  })();
}

async function handleReview(req, res) {
  touch();
  const body = await readBody(req);
  const provider = resolveProvider(body.provider);
  const { imagePath, imagePrompt, style, slideTitle } = body;
  if (!imagePath || !style) {
    return jsonResponse(res, 400, { error: 'imagePath and style required' });
  }
  if (!existsSync(imagePath)) {
    return jsonResponse(res, 400, { error: `image not found: ${imagePath}` });
  }
  if (provider === 'deepseek') {
    // Unreachable from the app (DeepSeek slide review is routed to Gemini in
    // /api/review); kept as a safety net since the local server only has the
    // Claude vision path.
    return jsonResponse(res, 400, {
      error:
        'DeepSeek is text-only (no vision). DeepSeek slide review must go through /api/review, which uses Gemini.',
    });
  }
  const sessionId = makeSession();
  jsonResponse(res, 202, { sessionId });

  (async () => {
    try {
      pushEvent(sessionId, { type: 'status', text: `${PROVIDER_LABEL[provider]} is reviewing the image…` });
      const { text, costUsd } = await runLLM({
        provider,
        prompt: reviewPrompt({ imagePath, imagePrompt: imagePrompt || '(text-only slide — no AI image)', style, slideTitle: slideTitle || '' }),
        sessionId,
      });
      const review = extractJson(text);
      const session = sessions.get(sessionId);
      session.result = { review, llmCostUsd: costUsd ?? null };
      session.done = true;
      pushEvent(sessionId, { type: 'done', result: session.result });
    } catch (err) {
      const session = sessions.get(sessionId);
      session.error = err.message;
      session.done = true;
      pushEvent(sessionId, { type: 'error', error: err.message });
    }
  })();
}

function deckReviewPrompt({ deck }) {
  return `You are a senior deck reviewer. The user has just finished a deck and wants your end-to-end critique. Output ONLY valid JSON, no prose, no fences.

Deck:
${JSON.stringify(deck, null, 2)}

Assess the FULL deck on:
  - flow (does the narrative build logically slide-to-slide?)
  - redundancy (any two slides making the same point?)
  - missing gaps (for a ${deck.template} deck, what important section is missing?)
  - tone consistency (are bullets all in similar voice and length?)
  - cohesion (does the visual style — palette/mood — fit the topic?)
  - punch (does the opening hook? does the closing call to action?)

Output schema:
{
  "verdict": "ship" | "revise",
  "score": 1-10,
  "strengths": ["short bullet — what's working", ...],
  "issues": ["short bullet — what to fix and why", ...],
  "suggestions": ["short concrete actionable change, with the slide number when relevant", ...]
}

Be candid. A 7+ deck with minor nits = ship. Otherwise revise.`;
}

async function handleDeckReview(req, res) {
  touch();
  const body = await readBody(req);
  const provider = resolveProvider(body.provider);
  const { deck } = body;
  if (!deck) return jsonResponse(res, 400, { error: 'deck required' });
  const sessionId = makeSession();
  jsonResponse(res, 202, { sessionId });

  (async () => {
    try {
      pushEvent(sessionId, { type: 'status', text: `${PROVIDER_LABEL[provider]} is reviewing the whole deck…` });
      const { text, costUsd } = await runLLM({
        provider,
        prompt: deckReviewPrompt({ deck }),
        sessionId,
      });
      const review = extractJson(text);
      const session = sessions.get(sessionId);
      session.result = { review, llmCostUsd: costUsd ?? null };
      session.done = true;
      pushEvent(sessionId, { type: 'done', result: session.result });
    } catch (err) {
      const session = sessions.get(sessionId);
      session.error = err.message;
      session.done = true;
      pushEvent(sessionId, { type: 'error', error: err.message });
    }
  })();
}

async function handleRefine(req, res) {
  touch();
  const body = await readBody(req);
  const provider = resolveProvider(body.provider);
  const { deck, instruction } = body;
  if (!deck || !instruction) {
    return jsonResponse(res, 400, { error: 'deck and instruction required' });
  }
  const sessionId = makeSession();
  jsonResponse(res, 202, { sessionId });

  (async () => {
    try {
      pushEvent(sessionId, { type: 'status', text: `${PROVIDER_LABEL[provider]} is refining the deck…` });
      let updated;
      let totalCost = 0;
      let lastError = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const { text, costUsd } = await runLLM({
          provider,
          prompt: refinePrompt({ deck, instruction }),
          sessionId,
        });
        totalCost += costUsd ?? 0;
        try {
          updated = extractJson(text);
        } catch (e) {
          lastError = e.message;
          continue;
        }
        const issue = validateDeck(updated, updated?.slides?.length ?? 0);
        if (!issue) {
          lastError = null;
          break;
        }
        lastError = issue;
        updated = undefined;
      }
      if (!updated) throw new Error(lastError || 'refine failed');
      const session = sessions.get(sessionId);
      session.result = { deck: updated, llmCostUsd: totalCost || null };
      session.done = true;
      pushEvent(sessionId, { type: 'done', result: session.result });
    } catch (err) {
      const session = sessions.get(sessionId);
      session.error = err.message;
      session.done = true;
      pushEvent(sessionId, { type: 'error', error: err.message });
    }
  })();
}

function handleEvents(req, res, url) {
  const id = url.searchParams.get('id');
  const session = id && sessions.get(id);
  if (!session) {
    return jsonResponse(res, 404, { error: 'unknown session' });
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });

  const send = (evt) => {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
    if (evt.type === 'done' || evt.type === 'error') {
      res.end();
    }
  };

  // Replay buffered events
  for (const evt of session.events) send(evt);
  if (session.done) return; // already finished

  session.subscribers.add(send);
  req.on('close', () => session.subscribers.delete(send));
}

function handleResult(req, res, url) {
  const id = url.searchParams.get('id');
  const session = id && sessions.get(id);
  if (!session) return jsonResponse(res, 404, { error: 'unknown session' });
  if (!session.done) return jsonResponse(res, 202, { pending: true });
  if (session.error) return jsonResponse(res, 500, { error: session.error });
  jsonResponse(res, 200, session.result);
}

function start() {
  const token = randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${HOST}`);

      if (url.pathname === '/health') {
        return jsonResponse(res, 200, { ok: true, version: VERSION, pid: process.pid });
      }

      // Auth check for everything else
      const provided = req.headers['x-slidegen-token'];
      if (provided !== token) {
        return jsonResponse(res, 401, { error: 'unauthorized' });
      }

      if (url.pathname === '/plan' && req.method === 'POST') return handlePlan(req, res);
      if (url.pathname === '/refine' && req.method === 'POST') return handleRefine(req, res);
      if (url.pathname === '/review' && req.method === 'POST') return handleReview(req, res);
      if (url.pathname === '/deck-review' && req.method === 'POST') return handleDeckReview(req, res);
      if (url.pathname === '/events' && req.method === 'GET') return handleEvents(req, res, url);
      if (url.pathname === '/result' && req.method === 'GET') return handleResult(req, res, url);

      jsonResponse(res, 404, { error: 'not found' });
    } catch (err) {
      jsonResponse(res, 500, { error: err.message });
    }
  });

  server.listen(0, HOST, () => {
    const port = server.address().port;
    writeState({ port, token, pid: process.pid });
    console.log(`slidegen claude server listening on ${HOST}:${port} (pid ${process.pid})`);
  });

  // Idle shutdown
  setInterval(() => {
    if (Date.now() - lastActivity > SHUTDOWN_AFTER_MS) {
      console.log('idle timeout reached, shutting down');
      process.exit(0);
    }
  }, 60_000).unref();

  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

start();
