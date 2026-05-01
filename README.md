# slidegen

Local Nano Banana slide generator. Claude Code plans the deck, Gemini 2.5 Flash Image (Nano Banana) makes one full-bleed image per slide, you download a .pptx and drop it into Google Slides.

## Setup

1. Install deps: `pnpm install`
2. Copy `.env.local.example` → `.env.local` and paste your `GOOGLE_API_KEY` (get one at https://aistudio.google.com/apikey).
3. Make sure your local `claude` CLI is authed (`which claude` should resolve; the app uses your CC plan, no Anthropic API key needed).

## Run

```bash
pnpm dev
```

Open http://localhost:3000.

## Architecture

- **`src/app/`** — Next.js App Router UI + four route handlers (`/api/plan`, `/api/refine`, `/api/generate`, `/api/export`).
- **`scripts/claude-server.mjs`** — persistent local HTTP server (loopback only, token-authed) that owns the `claude` CLI subprocesses. Modeled on the gstack browse server pattern.
- **`bin/slidegen-claude`** — shell shim for manual control: `bin/slidegen-claude {status,start,stop,plan}`.
- **`src/lib/claude-client.ts`** — Next.js-side client; auto-spawns the server on first use.
- **`src/lib/gemini.ts`** — Nano Banana wrapper (`@google/genai`).
- **`src/lib/pptx.ts`** — PPTX builder via `pptxgenjs`.
- **`src/lib/pricing.ts`** — per-image cost calc.
- **`.slidegen/claude-server.json`** — runtime state (port, token, pid). Gitignored. Server idles out after 30 min.

## Cost model

Claude is "covered by your CC plan", not metered. Nano Banana is metered: ~$0.039 per image at current pricing (1290 output tokens × $30/1M). The session ticker tracks only Nano Banana spend.
