import { NextResponse } from 'next/server';
import { reviewDeck } from '@/lib/claude-client';
import type { Deck } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const deck = body?.deck as Deck | undefined;
    if (!deck) return NextResponse.json({ error: 'deck required' }, { status: 400 });
    const result = await reviewDeck(deck);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'deck review failed' },
      { status: 500 },
    );
  }
}
