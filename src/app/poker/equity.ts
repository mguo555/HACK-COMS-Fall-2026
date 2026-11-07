import { Card, Rng, createDeck, sameCard } from './cards';
import { evaluateHand } from './evaluator';

/**
 * Estimates the chance that `hole` wins against `opponents` random hands, given the board so
 * far. Monte Carlo: deal the unknown cards at random many times and count wins (ties count as a
 * fractional share). Returns a number in [0, 1].
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
  if (opponents <= 0) return 1;

  const known = [...hole, ...board];
  const deck = createDeck().filter((c) => !known.some((k) => sameCard(k, c)));
  const boardNeeded = 5 - board.length;
  const draw = opponents * 2 + boardNeeded;

  let total = 0;
  for (let i = 0; i < iterations; i++) {
    // Partial Fisher–Yates: only shuffle the cards we need.
    for (let j = 0; j < draw; j++) {
      const k = j + Math.floor(random() * (deck.length - j));
      [deck[j], deck[k]] = [deck[k], deck[j]];
    }
    const fullBoard = [...board, ...deck.slice(opponents * 2, draw)];
    const heroScore = evaluateHand([...hole, ...fullBoard]).score;

    let best = heroScore;
    let tiedAtBest = 1;
    let heroBest = true;
    for (let o = 0; o < opponents; o++) {
      const score = evaluateHand([deck[o * 2], deck[o * 2 + 1], ...fullBoard]).score;
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
