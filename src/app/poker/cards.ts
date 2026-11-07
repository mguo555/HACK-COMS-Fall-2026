export type Suit = 's' | 'h' | 'd' | 'c';

/** 2–10 are face value, then J=11, Q=12, K=13, A=14. */
export type Rank = number;

export interface Card {
  rank: Rank;
  suit: Suit;
}

/** Returns a float in [0, 1). Injectable so tests can use a seeded generator. */
export type Rng = () => number;

export const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const RANK_LABELS: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SUIT_SYMBOLS: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

const RANK_WORDS: Record<number, [singular: string, plural: string]> = {
  2: ['Two', 'Twos'],
  3: ['Three', 'Threes'],
  4: ['Four', 'Fours'],
  5: ['Five', 'Fives'],
  6: ['Six', 'Sixes'],
  7: ['Seven', 'Sevens'],
  8: ['Eight', 'Eights'],
  9: ['Nine', 'Nines'],
  10: ['Ten', 'Tens'],
  11: ['Jack', 'Jacks'],
  12: ['Queen', 'Queens'],
  13: ['King', 'Kings'],
  14: ['Ace', 'Aces'],
};

export function rankLabel(rank: Rank): string {
  return RANK_LABELS[rank] ?? String(rank);
}

export function suitSymbol(suit: Suit): string {
  return SUIT_SYMBOLS[suit];
}

export function isRed(card: Card): boolean {
  return card.suit === 'h' || card.suit === 'd';
}

/** "A♠", "10♥" */
export function cardLabel(card: Card): string {
  return rankLabel(card.rank) + suitSymbol(card.suit);
}

export function rankName(rank: Rank, plural = false): string {
  const words = RANK_WORDS[rank === 1 ? 14 : rank];
  return plural ? words[1] : words[0];
}

/** Parses "As", "Td", "10h", "Kc" — handy for tests. */
export function parseCard(code: string): Card {
  const suit = code.slice(-1) as Suit;
  const r = code.slice(0, -1).toUpperCase();
  const map: Record<string, number> = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
  const rank = map[r] ?? Number(r);
  if (!SUITS.includes(suit) || !(rank >= 2 && rank <= 14)) {
    throw new Error(`Bad card code: ${code}`);
  }
  return { rank, suit };
}

export function parseCards(codes: string): Card[] {
  return codes.trim() ? codes.trim().split(/\s+/).map(parseCard) : [];
}

export function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/** Fisher–Yates shuffle. Returns a new array. */
export function shuffle<T>(items: readonly T[], random: Rng = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Small deterministic RNG (mulberry32) for tests and reproducible games. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
