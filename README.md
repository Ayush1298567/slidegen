# slidegen

A **local-first AI slide generator**. Claude Code (or DeepSeek) plans the deck, Nano Banana renders the imagery, real PowerPoint text gets overlaid by the renderer, and you walk away with a `.pptx` (or `.pdf`) you can drop into Google Slides, Keynote, or PowerPoint.

Runs entirely on your machine. The planning/refining/review text work is handled by your choice of model — the local `claude` CLI (uses your CC subscription) or the DeepSeek API (pay-per-token). You bring a Google API key for image generation. No server to deploy, no data leaves your laptop except the API calls.

## What it does

- **Plans** the deck — Claude picks layouts, writes content, generates speaker notes, picks an icon and a section eyebrow per slide
- **Themes** — 7 curated presets (Editorial Warm, Tech Noir, Cool Mint, Bold Magazine, Hand-drawn, Corporate, Auto) or paste a brand hex color
- **12 layouts** — title-hero, content-image-right/left, two-column, big-stat, full-bleed-quote, section-divider, comparison, agenda, bar-chart, pie-chart, closing-cta
- **Generates** the imagery — Nano Banana (Gemini 2.5 Flash Image) renders one image per slide where it makes sense
- **Reviews** the composed slide — Claude screenshots the rendered slide and re-prompts up to 2× if it can be improved (text-in-image, off-style, low contrast)
- **Native PPTX charts** — bar and pie charts ship as real editable PowerPoint charts, not images
- **Refines** via chat — type "make slide 3 punchier" or "add a pricing slide" and Claude updates the deck
- **Exports** — `.pptx` (with editable text frames) or `.pdf` (full-fidelity)
- **Aspects** — 16:9, 4:3, 9:16 (Stories/Reels), 1:1 (square)
- **Saves** decks to localStorage so you can come back later

## Setup

```bash
git clone https://github.com/ayushg8/slidegen.git
cd slidegen
pnpm install
cp .env.local.example .env.local
# edit .env.local and paste your GOOGLE_API_KEY (get one at https://aistudio.google.com/apikey)
```

You also need:

- **Node 20+** (Next.js 16 minimum)
- **pnpm**
- **A planning model** — either:
  - **Claude Code CLI** (default) authed on your machine — `which claude` should resolve. The app shells out to your local `claude` binary, which uses your existing CC subscription. No `ANTHROPIC_API_KEY` is read by the app.
  - **DeepSeek** — add a `DEEPSEEK_API_KEY` to `.env.local`, then pick DeepSeek in the planner UI (or set `SLIDEGEN_PROVIDER=deepseek`). No Claude Code / Anthropic account required. See [Providers](#providers-claude-or-deepseek) below.

## Run

```bash
pnpm dev
```

Open <http://localhost:3000>. Pick a template + theme, write a topic, click **Plan deck**, then **Generate all**. Export with `.pptx` or `.pdf`.

## Providers: Claude or DeepSeek

The text side of slidegen (planning, refining, whole-deck review) is provider-agnostic. Pick the model in the planner UI, or force a default with `SLIDEGEN_PROVIDER`.

| | Claude (default) | DeepSeek |
|---|---|---|
| Backend | Your local Claude Code CLI | DeepSeek API (OpenAI-compatible) |
| Auth | CC subscription — no key needed | `DEEPSEEK_API_KEY` in `.env.local` |
| Per-slide image auto-review | ✅ Claude Code (vision) | ✅ Gemini (vision) — DeepSeek is text-only |
| Typical text cost | $0 metered (subscription) | Pay-per-token (cents per deck) |

DeepSeek env vars (all optional except the API key):

- `DEEPSEEK_API_KEY` — required to use DeepSeek
- `DEEPSEEK_MODEL` — default `deepseek-chat`; try `deepseek-reasoner` for deeper reasoning
- `DEEPSEEK_BASE_URL` — default `https://api.deepseek.com`
- `DEEPSEEK_INPUT_USD_PER_MTOKEN` / `DEEPSEEK_OUTPUT_USD_PER_MTOKEN` — token price overrides used for the cost estimate

> **Note:** DeepSeek's chat models are text-only, so the per-slide **auto-review** (which reads a screenshot of the composed slide) is automatically handled by **Gemini** — the same Google key you already use for image generation. That means **you can drop Claude entirely**: DeepSeek does planning/refining/deck review, Gemini does images + slide review.

## Cost model

| Operation | Where it bills | Typical cost |
|---|---|---|
| Plan / Refine / Deck review (Claude) | Your Claude Code subscription seat | Covered by plan, $0 metered |
| Plan / Refine / Deck review (DeepSeek) | Your DeepSeek API key | Cents per deck (pay per token) |
| Slide image auto-review (Claude) | Claude Code (vision) | Covered by plan, $0 metered |
| Slide image auto-review (DeepSeek) | Your Google API key (Gemini) | ~$0.001–0.002 per review |
| Image generation (Nano Banana) | Your Google API key | **~$0.039 per image** (1290 output tokens × $30/1M) |
| Text-only slides (comparison, agenda, charts) | — | $0 |
| `.pptx` / `.pdf` export | — | $0 (local) |

A typical 10-slide deck has 5–6 imaged slides → **~$0.20–$0.25 per deck**. The UI shows a live cost ticker.

## How it works

```
┌──────────────────────────────────────────────────────────────────┐
│ Browser (localhost:3000)                                         │
│  ↳ Pick template/theme, write topic                              │
│  ↳ Live SlidePreview mirrors the PPTX renderer 1:1               │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ Next.js (App Router) routes                                      │
│  /api/plan        → streams NDJSON status + final deck JSON      │
│  /api/refine      → chat-style edit                              │
│  /api/generate    → Nano Banana → PNG data URL                   │
│  /api/generate-variations → 3 images in parallel                 │
│  /api/render-slide→ puppeteer → composed-slide PNG screenshot    │
│  /api/review      → screenshot the slide, send to Claude         │
│  /api/deck-review → Claude reviews the whole deck end-to-end     │
│  /api/export      → pptxgenjs → .pptx                            │
│  /api/render-pdf  → puppeteer multi-page → .pdf                  │
└────────┬─────────────────────────────────┬───────────────────────┘
         │                                 │
         ▼                                 ▼
 ┌──────────────────────┐     ┌─────────────────────────────┐
 │ scripts/claude-      │     │ Google Generative AI SDK    │
 │   server.mjs         │     │ (Nano Banana / Flash Image) │
 │  loopback only       │     └─────────────────────────────┘
 │  token-authed        │
 │  spawns `claude` CLI │
 │  per request         │
 └──────────────────────┘
```

The LLM server is modeled on `gstack browse`'s pattern: persistent loopback HTTP service, token in `.slidegen/claude-server.json`, auto-respawn on first request, idle-shuts-down at 30 min. By default it spawns your local `claude` CLI per request; when a request asks for the DeepSeek provider it calls the DeepSeek API directly instead.

## Project layout

```
slidegen/
  bin/slidegen-claude              # shell control: status / start / stop / plan
  scripts/claude-server.mjs        # local HTTP service that owns the claude CLI
  src/
    app/
      page.tsx                     # the whole UI
      api/{plan,refine,generate,...}/route.ts
    components/
      slides/SlidePreview.tsx      # live HTML preview, mirrors the PPTX
    lib/
      claude-client.ts             # NDJSON streaming client to claude-server
      gemini.ts                    # Nano Banana wrapper
      slide-html.ts                # server-side HTML renderer (12 layouts)
      pptx.ts                      # pptxgenjs builder (12 layouts, charts, chrome)
      pdf.ts                       # multi-page PDF via puppeteer
      screenshot.ts                # singleton puppeteer browser
      icon.ts                      # lucide kebab-case → SVG
      types.ts                     # Slide / Deck / Theme / preset definitions
      pricing.ts                   # cost calc
  .env.local.example               # GOOGLE_API_KEY=
```

## Roadmap / known gaps

- Real-time SSE for image generation status (currently per-slide polling)
- Custom logo upload (currently brand color only)
- "Push to Google Slides" via OAuth (currently `.pptx` upload)
- More chart types (line, scatter, doughnut)
- Web access for Claude planning (currently subscription-mode CLI = no web search)

PRs welcome.

## License

MIT — see [LICENSE](./LICENSE).
