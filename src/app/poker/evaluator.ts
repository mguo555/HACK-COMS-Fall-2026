import { Card, Rank, rankName } from './cards';

export const HAND_CATEGORIES = [
  'High Card',
  'Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
] as const;

export type HandCategory = (typeof HAND_CATEGORIES)[number];

export interface HandResult {
  /** Index into HAND_CATEGORIES (0 = high card … 8 = straight flush). */
  categoryIndex: number;
  category: HandCategory;
  /** Higher beats lower. Equal scores split the pot. */
  score: number;
  /** Human-readable, e.g. "Full House, Kings over Sevens". */
  description: string;
  /** The best five cards, most significant first. */
  cards: Card[];
}

/**
 * Finds the best five-card hand from 5–7 cards.
 *
 * Score = category * 15^5 + the five ranks in significance order (base 15), so two hands compare
 * correctly with a plain number comparison. In a wheel (A-2-3-4-5) the ace counts as 1.
 */
export function evaluateHand(cards: readonly Card[]): HandResult {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`evaluateHand needs 5–7 cards, got ${cards.length}`);
  }

  const sorted = cards.slice().sort((a, b) => b.rank - a.rank);

  // Flushes (and straight flushes).
  const bySuit = new Map<string, Card[]>();
  for (const card of sorted) {
    const list = bySuit.get(card.suit) ?? [];
    list.push(card);
    bySuit.set(card.suit, list);
  }
  const flushCards = [...bySuit.values()].find((list) => list.length >= 5);
  if (flushCards) {
    const straightFlush = findStraight(flushCards);
    if (straightFlush) {
      const high = straightFlush.ranks[0];
      const description = high === 14 ? 'Royal Flush' : `Straight Flush, ${rankName(high)}-high`;
      return result(8, straightFlush.cards, straightFlush.ranks, description);
    }
  }

  // Group by rank: biggest groups first, then higher rank first.
  const byRank = new Map<Rank, Card[]>();
  for (const card of sorted) {
    const list = byRank.get(card.rank) ?? [];
    list.push(card);
    byRank.set(card.rank, list);
  }
  const groups = [...byRank.values()].sort((a, b) => b.length - a.length || b[0].rank - a[0].rank);

  const kickers = (used: Card[], count: number) =>
    sorted.filter((c) => !used.includes(c)).slice(0, count);

  const [first, second] = groups;

  if (first.length === 4) {
    const five = [...first, ...kickers(first, 1)];
    return result(7, five, ranksOf(five), `Four of a Kind, ${rankName(first[0].rank, true)}`);
  }

  if (first.length === 3 && second && second.length >= 2) {
    const five = [...first, ...second.slice(0, 2)];
    const description = `Full House, ${rankName(first[0].rank, true)} over ${rankName(second[0].rank, true)}`;
    return result(6, five, ranksOf(five), description);
  }

  if (flushCards) {
    const five = flushCards.slice(0, 5);
    return result(5, five, ranksOf(five), `Flush, ${rankName(five[0].rank)}-high`);
  }

  const straight = findStraight(sorted);
  if (straight) {
    return result(
      4,
      straight.cards,
      straight.ranks,
      `Straight, ${rankName(straight.ranks[0])}-high`,
    );
  }

  if (first.length === 3) {
    const five = [...first, ...kickers(first, 2)];
    return result(3, five, ranksOf(five), `Three of a Kind, ${rankName(first[0].rank, true)}`);
  }

  if (first.length === 2 && second && second.length === 2) {
    const pairs = [...first, ...second];
    const five = [...pairs, ...kickers(pairs, 1)];
    const description = `Two Pair, ${rankName(first[0].rank, true)} and ${rankName(second[0].rank, true)}`;
    return result(2, five, ranksOf(five), description);
  }

  if (first.length === 2) {
    const five = [...first, ...kickers(first, 3)];
    return result(1, five, ranksOf(five), `Pair of ${rankName(first[0].rank, true)}`);
  }

  const five = sorted.slice(0, 5);
  return result(0, five, ranksOf(five), `High Card, ${rankName(five[0].rank)}`);
}

/** Compares two evaluated hands: positive if a wins, negative if b wins, 0 for a tie. */
export function compareHands(a: HandResult, b: HandResult): number {
  return a.score - b.score;
}

function result(
  categoryIndex: number,
  cards: Card[],
  ranks: number[],
  description: string,
): HandResult {
  let score = categoryIndex;
  for (let i = 0; i < 5; i++) {
    score = score * 15 + (ranks[i] ?? 0);
  }
  return {
    categoryIndex,
    category: HAND_CATEGORIES[categoryIndex],
    score,
    description,
    cards,
  };
}

function ranksOf(cards: Card[]): number[] {
  return cards.map((c) => c.rank);
}

/** Best straight within the given cards (sorted high→low), or null. */
function findStraight(sortedCards: Card[]): { cards: Card[]; ranks: number[] } | null {
  const byRank = new Map<number, Card>();
  for (const card of sortedCards) {
    if (!byRank.has(card.rank)) byRank.set(card.rank, card);
  }
  const ace = byRank.get(14);
  if (ace) byRank.set(1, ace); // ace plays low in A-2-3-4-5

  for (let high = 14; high >= 5; high--) {
    const run: Card[] = [];
    for (let r = high; r > high - 5; r--) {
      const card = byRank.get(r);
      if (!card) break;
      run.push(card);
    }
    if (run.length === 5) {
      return { cards: run, ranks: [high, high - 1, high - 2, high - 3, high - 4] };
    }
  }
  return null;
}
