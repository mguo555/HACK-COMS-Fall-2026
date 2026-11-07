import { Card, Rng, createDeck, sameCard } from './cards';
import { evaluateHand } from './evaluator';

/**
 * Estimates the chance that `hole` wins against `opponents` random hands, given the board so
 * far. Returns a number in [0, 1]. Ties count as a fractional share.
 *
 * This only uses information the player could know (their cards + the board), so it's safe to
 * hand to a bot as its "read" on hand strength.
 */
export function estimateWinChance(
  hole: readonly Card[],
  board: readonly Card[],
  opponents: number,
  iterations = 600,
  random: Rng = Math.random,
): number {
  return estimateWinChanceVsRanges(
    hole,
    board,
    Array(Math.max(0, opponents)).fill(1),
    iterations,
    random,
  );
}

/**
 * Like estimateWinChance, but each opponent holds a hand from the top `range` fraction of
 * starting hands (1 = any two cards, 0.1 = the best 10%). A player who goes all-in every round
 * has a range near 1; one who almost never bets has a narrow range. Monte Carlo with rejection
 * sampling for the ranged hands.
 */
export function estimateWinChanceVsRanges(
  hole: readonly Card[],
  board: readonly Card[],
  ranges: readonly number[],
  iterations = 600,
  random: Rng = Math.random,
): number {
  if (ranges.length === 0) return 1;

  const known = [...hole, ...board];
  const deck = createDeck().filter((c) => !known.some((k) => sameCard(k, c)));
  const taken = new Uint8Array(deck.length);
  const boardNeeded = 5 - board.length;

  const drawIndex = (): number => {
    let i: number;
    do i = Math.floor(random() * deck.length);
    while (taken[i]);
    taken[i] = 1;
    return i;
  };

  let total = 0;
  for (let iter = 0; iter < iterations; iter++) {
    taken.fill(0);
    const hands: Card[][] = [];
    for (const range of ranges) {
      let a = drawIndex();
      let b = drawIndex();
      // Redraw until the hand fits the range (capped, so a very narrow range can't stall).
      for (
        let tries = 0;
        range < 1 && tries < 60 && startingHandPercentile(deck[a], deck[b]) >= range;
        tries++
      ) {
        taken[a] = 0;
        taken[b] = 0;
        a = drawIndex();
        b = drawIndex();
      }
      hands.push([deck[a], deck[b]]);
    }
    const fullBoard = [...board];
    for (let j = 0; j < boardNeeded; j++) fullBoard.push(deck[drawIndex()]);

    const heroScore = evaluateHand([...hole, ...fullBoard]).score;
    let best = heroScore;
    let tiedAtBest = 1;
    let heroBest = true;
    for (const hand of hands) {
      const score = evaluateHand([...hand, ...fullBoard]).score;
      if (score > best) {
        best = score;
        heroBest = false;
        tiedAtBest = 1;
      } else if (score === best) {
        tiedAtBest++;
      }
    }
    if (heroBest) total += 1 / tiedAtBest;
  }
  return total / iterations;
}

/**
 * Bill Chen's quick score for a two-card starting hand (higher is better, AA = 20). Used to
 * rank hands into ranges; it's a well-known approximation, not an exact equity.
 */
export function chenScore(a: Card, b: Card): number {
  const hi = Math.max(a.rank, b.rank);
  const lo = Math.min(a.rank, b.rank);
  const value = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
  if (hi === lo) return Math.ceil(Math.max(5, value(hi) * 2));
  let score = value(hi);
  if (a.suit === b.suit) score += 2;
  const gap = hi - lo - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && hi < 12) score += 1;
  return Math.ceil(score);
}

let percentileByScore: Map<number, number> | null = null;

/** Fraction of all 1326 starting hands that rank strictly better than this one (0 = best). */
export function startingHandPercentile(a: Card, b: Card): number {
  if (!percentileByScore) {
    const deck = createDeck();
    const counts = new Map<number, number>();
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) {
        const s = chenScore(deck[i], deck[j]);
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    }
    percentileByScore = new Map();
    let better = 0;
    for (const score of [...counts.keys()].sort((x, y) => y - x)) {
      percentileByScore.set(score, better / 1326);
      better += counts.get(score)!;
    }
  }
  return percentileByScore.get(chenScore(a, b)) ?? 1;
}
