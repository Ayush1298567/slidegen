// Slide-image reviewer backed by a Gemini *vision* model.
//
// DeepSeek's chat models are text-only, so when the text provider is DeepSeek
// the per-slide auto-review is delegated to Gemini — which can actually look at
// the composed slide screenshot. This uses the same GOOGLE_API_KEY / SDK as
// gemini.ts and returns the same { verdict, score, issues, improvedPrompt }
// shape the UI's review retry loop already expects.

import { GoogleGenAI } from '@google/genai';

const REVIEW_MODEL = process.env.SLIDEGEN_GEMINI_REVIEW_MODEL || 'gemini-2.5-flash';

function getClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not set. Add it to .env.local.');
  }
  return new GoogleGenAI({ apiKey });
}

export type SlideReview = {
  verdict: 'approve' | 'improve';
  score: number;
  issues: string[];
  improvedPrompt?: string;
};

export type GeminiReviewResult = {
  review: SlideReview;
  costUsd: number | null;
};

function reviewPrompt(input: { imagePrompt: string; style: string; slideTitle: string }): string {
  return `You are a meticulous senior deck designer reviewing a screenshot of a FINAL composed slide — real PowerPoint text overlaid on an AI-generated background image, exactly as it will appear in the exported PowerPoint deck. A screenshot of the composed slide is attached as an image; examine it carefully (text, layout, image, colors).

Slide title: ${input.slideTitle || '(none)'}
Original background-image prompt (context only): ${input.imagePrompt || '(text-only slide — no AI image)'}
Required visual style for the AI image portion: ${input.style}

CRITICAL FAILURE MODES (verdict MUST be "improve" if ANY applies):
  1. ANY of the slide's real PowerPoint text is unreadable due to low contrast against the background — title, subtitle, bullets, stats, chart labels. The eye must instantly read every word.
  2. The AI background image contains its OWN text/numbers/letters/labels/UI/charts (those would be in addition to the real PowerPoint text and look amateur). Anything that looks like typography baked into the image is a fail.
  3. The image overlaps or fights the title/body text — composition is unbalanced, focal point sits where the title sits, busy details where bullets need quiet.
  4. Text overflows, gets cut off, or wraps awkwardly in the visible frame.
  5. Slide looks cluttered, AI-slop, or unprofessional — a senior designer at a top-tier firm would reject it.

Assess these dimensions (1-10 each; the final score = the MINIMUM of all six):
  - readability (every word legible at first glance)
  - composition (image + text feel intentional, not fighting)
  - text-in-image (zero text inside the AI image — instant fail if present)
  - typography (heading and body sizing/spacing look professional, no overflow)
  - color/contrast (palette feels cohesive, contrast meets accessibility bar)
  - polish (overall: would you put this in an investor deck or a final pitch?)

Output ONLY valid JSON — no prose, no markdown fences:
{
  "verdict": "approve" | "improve",
  "score": 1-10,
  "issues": ["short bullet — what specifically looks bad and why", ...],
  "improvedPrompt": "only when verdict is improve AND the fix is in the AI image (composition, mood, focal point, OR text leaked into the image): a sharper background-image prompt. Lead with 'absolutely NO text, numbers, letters, labels, UI, charts — pure visual imagery only.' if text was present in the image. If the issue is purely text-overflow / theme color choice (not the image), omit improvedPrompt — the user fixes those by editing the slide directly."
}

A 7+ slide with minor nits = approve. Anything below 7 OR text-in-image OR illegible PowerPoint text = improve. Output the JSON now and nothing else.`;
}

function extractReviewJson(text: string): SlideReview {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') return parsed as SlideReview;
  } catch {
    /* fall through */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim()) as SlideReview;
    } catch {
      /* fall through */
    }
  }
  const obj = trimmed.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      return JSON.parse(obj[0]) as SlideReview;
    } catch {
      /* fall through */
    }
  }
  throw new Error(`could not extract review JSON from Gemini output: ${trimmed.slice(0, 200)}`);
}

export async function reviewSlideImage(input: {
  /** data URL of the composed-slide screenshot (PNG). */
  imageDataUrl: string;
  /** The Nano Banana prompt used for this slide's background image. */
  imagePrompt: string;
  /** Required visual style (deck theme mood). */
  style: string;
  slideTitle: string;
}): Promise<GeminiReviewResult> {
  const ai = getClient();
  const mimeMatch = input.imageDataUrl.match(/^data:([^;]+);base64,/);
  const mimeType = mimeMatch?.[1] ?? 'image/png';
  const base64 = input.imageDataUrl.replace(/^data:[^;]+;base64,/, '');

  const response = await ai.models.generateContent({
    model: REVIEW_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64 } },
          {
            text: reviewPrompt({
              imagePrompt: input.imagePrompt,
              style: input.style,
              slideTitle: input.slideTitle,
            }),
          },
        ],
      },
    ],
    config: { responseMimeType: 'application/json' },
  });

  const text = (response.text ?? '').trim();
  if (!text) throw new Error('Gemini returned an empty review.');
  return { review: extractReviewJson(text), costUsd: null };
}
