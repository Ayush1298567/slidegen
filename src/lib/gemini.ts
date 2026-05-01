// Wrapper for Nano Banana (Gemini 2.5 Flash Image) via @google/genai.
// Returns the generated image as a base64 PNG plus the raw bytes.
//
// Slidegen v2: real PowerPoint text is rendered separately, so images
// must be PURE visuals — no text, no numbers, no UI elements.

import { GoogleGenAI, Modality } from '@google/genai';
import type { ImageAspect, Layout } from './types';

// Nano Banana Pro (Gemini 3 Pro Image Preview) when available, with automatic
// fallback to the stable Flash Image model. Pro produces noticeably stronger
// composition, lighting, and finish at the cost of slightly higher latency.
const MODEL_PRIMARY = process.env.SLIDEGEN_GEMINI_MODEL || 'gemini-3-pro-image-preview';
const MODEL_FALLBACK = 'gemini-2.5-flash-image';

function getClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not set. Add it to .env.local.');
  }
  return new GoogleGenAI({ apiKey });
}

export type GeneratedImage = {
  bytes: Buffer;
  dataUrl: string;
  mimeType: string;
};

const NO_TEXT_RULE =
  'CRITICAL: The image must contain absolutely NO text, NO numbers, NO letters, NO captions, NO labels, NO watermarks, NO UI mockups, NO charts/graphs/tables, NO infographics. Real text will be rendered by PowerPoint over this image. Output PURE visual imagery only — photo, illustration, scene. Treat any letterforms, digits, or typography as forbidden.';

const COMPOSITION_HINTS: Partial<Record<Layout, string>> = {
  'title-hero':
    'Will be used as a full-bleed background with a dark overlay and centered title text on top. Composition should have a clear focal point that survives a dim overlay; avoid critical detail in the dead-center where the title sits.',
  'content-image-right':
    'Will sit on the right half of a slide as a square crop. Subject should be well-centered within a 1:1 frame.',
  'content-image-left':
    'Will sit on the left half of a slide as a square crop. Subject should be well-centered within a 1:1 frame.',
  'big-stat':
    'Small accent image next to a huge stat number. Should be a single clean focal element on a clean background. Square framing.',
  'full-bleed-quote':
    'Full-bleed background for a large quote overlay. Composition should be quiet and atmospheric — moody lighting, negative space, nothing distracting from the quote.',
  'section-divider':
    'Full-bleed background, will be heavily dimmed with a section title overlaid. Atmospheric, moody, quiet composition.',
  'closing-cta':
    'Will sit on one side of the slide as a hero image with the CTA text adjacent. Strong single focal point, hopeful or forward-looking mood.',
};

function aspectToGemini(a: ImageAspect): '16:9' | '4:3' | '1:1' {
  if (a === '16:9') return '16:9';
  if (a === '4:3') return '4:3';
  return '1:1';
}

export async function generateSlideImage(input: {
  prompt: string;
  mood: string;
  aspect: ImageAspect;
  layout?: Layout;
}): Promise<GeneratedImage> {
  if (input.aspect === 'none') {
    throw new Error('cannot generate image for layout with imageAspect=none');
  }
  const ai = getClient();
  const compositionHint = input.layout ? COMPOSITION_HINTS[input.layout] : undefined;

  const fullPrompt = [
    input.prompt,
    `Visual mood / style (must match exactly across every slide in this deck): ${input.mood}.`,
    compositionHint || '',
    NO_TEXT_RULE,
  ]
    .filter(Boolean)
    .join('\n\n');

  // Reliability ladder:
  //   1) Nano Banana Pro (gemini-3-pro-image-preview), 2 attempts
  //   2) Same prompt, fallback to gemini-2.5-flash-image, 2 attempts
  //   3) Reword prompt to be more concrete + retry on Flash, 1 attempt
  // Each attempt is followed by short exponential backoff.
  const tryModel = async (model: string, prompt: string): Promise<GeneratedImage | { reason: string }> => {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseModalities: [Modality.IMAGE],
        imageConfig: { aspectRatio: aspectToGemini(input.aspect) },
      },
    });
    const candidates = response.candidates ?? [];
    for (const cand of candidates) {
      const parts = cand.content?.parts ?? [];
      for (const part of parts) {
        const inline = part.inlineData;
        if (inline?.data && inline?.mimeType?.startsWith('image/')) {
          const bytes = Buffer.from(inline.data, 'base64');
          return {
            bytes,
            mimeType: inline.mimeType,
            dataUrl: `data:${inline.mimeType};base64,${inline.data}`,
          };
        }
      }
    }
    return { reason: String(candidates[0]?.finishReason ?? 'unknown') };
  };

  const attempts: { model: string; prompt: string }[] = [
    { model: MODEL_PRIMARY, prompt: fullPrompt },
    { model: MODEL_PRIMARY, prompt: fullPrompt },
    { model: MODEL_FALLBACK, prompt: fullPrompt },
    { model: MODEL_FALLBACK, prompt: fullPrompt },
    // Last-ditch: simpler, more concrete reword
    { model: MODEL_FALLBACK, prompt: `A clean, high-quality visual: ${input.prompt}. Style: ${input.mood}. ${NO_TEXT_RULE}` },
  ];

  let lastReason = '';
  for (let i = 0; i < attempts.length; i++) {
    try {
      const result = await tryModel(attempts[i].model, attempts[i].prompt);
      if ('bytes' in result) return result;
      lastReason = result.reason;
    } catch (err) {
      lastReason = err instanceof Error ? err.message : 'unknown';
      // If the primary model is unavailable on this account, skip ahead
      // to the fallback model for the next attempt.
      const msg = lastReason.toLowerCase();
      if (msg.includes('not found') || msg.includes('unsupported') || msg.includes('permission')) {
        // Jump to first fallback attempt
        while (i + 1 < attempts.length && attempts[i + 1].model === MODEL_PRIMARY) i++;
      }
    }
    await new Promise((r) => setTimeout(r, 350 * (i + 1)));
  }

  throw new Error(`Gemini returned no image data after ${attempts.length} attempts. Last reason: ${lastReason}`);
}
