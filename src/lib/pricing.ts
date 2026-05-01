// Pricing for Nano Banana (Gemini 2.5 Flash Image).
// Source: Google Gemini API pricing — image output tokenized at ~1290 tokens/image.
// Updated 2026-01. Adjust here if Google changes rates.

export const NANO_BANANA_IMAGE_OUTPUT_TOKENS_PER_IMAGE = 1290;
export const NANO_BANANA_OUTPUT_USD_PER_MTOKEN = 30; // $30 per 1M output tokens
export const NANO_BANANA_INPUT_USD_PER_MTOKEN = 0.3;  // text input
export const NANO_BANANA_PRICE_PER_IMAGE_USD =
  (NANO_BANANA_IMAGE_OUTPUT_TOKENS_PER_IMAGE / 1_000_000) * NANO_BANANA_OUTPUT_USD_PER_MTOKEN;

export function estimateImageCost(count: number): number {
  return count * NANO_BANANA_PRICE_PER_IMAGE_USD;
}

export function formatUsd(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
