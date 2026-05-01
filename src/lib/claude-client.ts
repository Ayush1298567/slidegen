// Thin HTTP client for the local Claude server. Mirrors gstack's browse-client.ts:
// reads the state file, auto-spawns the server if missing or stale, and posts
// commands. All network traffic is loopback-only.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Deck, DeckTemplate, Theme } from './types';

const ROOT = resolve(process.cwd());
const STATE_FILE = join(ROOT, '.slidegen', 'claude-server.json');
const SERVER_SCRIPT = join(ROOT, 'scripts', 'claude-server.mjs');
const LOG_FILE = join(ROOT, '.slidegen', 'claude-server.log');

type State = { port: number; token: string; pid: number; version: string; startedAt: number };

function readState(): State | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function healthCheck(state: State): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${state.port}/health`);
    if (!res.ok) return false;
    const body = await res.json();
    return Boolean(body?.ok);
  } catch {
    return false;
  }
}

async function spawnServer(): Promise<State> {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  const { openSync } = await import('node:fs');
  const out = openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [SERVER_SCRIPT], {
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.unref();

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    const state = readState();
    if (state && pidAlive(state.pid) && (await healthCheck(state))) {
      return state;
    }
  }
  throw new Error(`claude server failed to start; see ${LOG_FILE}`);
}

async function ensureServer(): Promise<State> {
  const state = readState();
  if (state && pidAlive(state.pid) && (await healthCheck(state))) return state;
  return spawnServer();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const state = await ensureServer();
  const res = await fetch(`http://127.0.0.1:${state.port}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slidegen-token': state.token,
    },
    body: JSON.stringify(body),
  });
  if (res.status >= 400 && res.status !== 202) {
    const text = await res.text();
    throw new Error(`claude server ${path} ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function getResult<T>(sessionId: string): Promise<T> {
  const state = await ensureServer();
  const deadline = Date.now() + 1000 * 60 * 5;
  while (Date.now() < deadline) {
    const res = await fetch(`http://127.0.0.1:${state.port}/result?id=${sessionId}`, {
      headers: { 'x-slidegen-token': state.token },
    });
    if (res.status === 200) return (await res.json()) as T;
    if (res.status === 202) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const text = await res.text();
    throw new Error(`claude server /result ${res.status}: ${text}`);
  }
  throw new Error('claude server timeout');
}

export type ServerEvent =
  | { type: 'status'; text: string }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'done'; result: unknown }
  | { type: 'error'; error: string };

/**
 * Subscribe to SSE /events from the claude server. Calls onEvent for each
 * JSON event. Resolves when the underlying stream closes (i.e. on done/error).
 * Errors in the stream are yielded as `{type:'error'}` events; this function
 * itself only rejects on transport failure.
 */
export async function streamEvents(
  sessionId: string,
  onEvent: (evt: ServerEvent) => void,
): Promise<void> {
  const state = await ensureServer();
  const res = await fetch(`http://127.0.0.1:${state.port}/events?id=${sessionId}`, {
    headers: { 'x-slidegen-token': state.token },
  });
  if (!res.ok || !res.body) {
    throw new Error(`claude server /events ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of frame.split('\n')) {
        if (line.startsWith('data:')) {
          const json = line.slice(5).trim();
          if (!json) continue;
          try {
            onEvent(JSON.parse(json) as ServerEvent);
          } catch {
            /* ignore malformed event */
          }
        }
      }
    }
  }
}

export type PlanResult = { deck: Deck; claudeCostUsd: number | null };

export type Review = {
  verdict: 'approve' | 'improve';
  score: number;
  issues: string[];
  improvedPrompt?: string;
};
export type ReviewResult = { review: Review; claudeCostUsd: number | null };

export type PlanInput = {
  topic: string;
  slideCount: number;
  template: DeckTemplate;
  styleHint?: string;
  /** When set, Claude must use this exact theme. */
  themeOverride?: Theme;
  /** Optional brand primary color (#RRGGBB). Claude harmonizes the rest of the palette. */
  brandPrimary?: string;
};

export async function planDeck(input: PlanInput): Promise<PlanResult> {
  const { sessionId } = await post<{ sessionId: string }>('/plan', input);
  return await getResult<PlanResult>(sessionId);
}

export async function startPlan(input: PlanInput): Promise<{ sessionId: string }> {
  return await post<{ sessionId: string }>('/plan', input);
}

export async function refineDeck(input: {
  deck: Deck;
  instruction: string;
}): Promise<PlanResult> {
  const { sessionId } = await post<{ sessionId: string }>('/refine', input);
  return await getResult<PlanResult>(sessionId);
}

export async function startRefine(input: {
  deck: Deck;
  instruction: string;
}): Promise<{ sessionId: string }> {
  return await post<{ sessionId: string }>('/refine', input);
}

export async function reviewSlide(input: {
  imagePath: string;
  imagePrompt: string;
  style: string;
  slideTitle: string;
}): Promise<ReviewResult> {
  const { sessionId } = await post<{ sessionId: string }>('/review', input);
  return await getResult<ReviewResult>(sessionId);
}

export type DeckReview = {
  verdict: 'ship' | 'revise';
  score: number;
  strengths: string[];
  issues: string[];
  suggestions: string[];
};
export type DeckReviewResult = { review: DeckReview; claudeCostUsd: number | null };

export async function reviewDeck(deck: Deck): Promise<DeckReviewResult> {
  const { sessionId } = await post<{ sessionId: string }>('/deck-review', { deck });
  return await getResult<DeckReviewResult>(sessionId);
}

export async function getServerInfo(): Promise<State> {
  return await ensureServer();
}
