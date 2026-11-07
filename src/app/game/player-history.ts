import { Card, cardLabel } from '../poker/cards';
import { LegalActions, PlayerAction, TableState } from '../poker/engine';
import { startingHandPercentile } from '../poker/equity';
import { evaluateHand } from '../poker/evaluator';

/**
 * What the bots remember about how everyone plays, and about what the human told each of them.
 *
 * After every round all hole cards are revealed to the bots (not only at showdown), so they
 * learn what each player raises and shoves with, and whether the human's claims were bluffs.
 *
 * Compaction keeps this small however long the game runs, with no extra AI calls:
 * - Betting stats decay by DECAY each round, so recent play counts most (roughly the last 20
 *   rounds matter).
 * - The hands behind each player's raises are kept as starting-hand percentiles, last
 *   MAX_SAMPLES only.
 * - The human's messages to a bot are folded into counters (big-hand claims, how many were
 *   bluffs) plus one short note per round, last MAX_NOTES only.
 * A bot's prompt gets a few lines, not the whole chat log.
 */

/** Per-player betting habits. Counts decay each round, so they can be fractional. */
export interface PlayerStats {
  hands: number;
  /** Put chips in voluntarily (call or raise, not blinds or checks). */
  played: number;
  raised: number;
  /** Raised all-in. */
  shoved: number;
  /** Rounds they raised in with a weak hand (seen when cards were revealed). */
  weakRaises: number;
}

/** A hand someone raised with: its starting-hand percentile (0 = best) and if it was a shove. */
export interface RaiseSample {
  pct: number;
  shove: boolean;
}

/** One bot's memory of the human's messages to it. Counters are lifetime totals. */
export interface BotMemory {
  messages: number;
  /** Messages that claimed a strong hand ("I have aces", "the nuts"...). */
  claims: number;
  /** Claims where the human's revealed hand was weak. */
  bluffsCaught: number;
  /** Claims where the human's revealed hand was strong. */
  claimsBackedUp: number;
  /** Newest last, at most MAX_NOTES. */
  notes: string[];
}

export interface HistoryData {
  version: 2;
  /** Rounds observed in total (not decayed). */
  rounds: number;
  stats: Record<string, PlayerStats>;
  samples: Record<string, RaiseSample[]>;
  memories: Record<string, BotMemory>;
}

/** The compact profile of the human sent with each bot request. */
export interface HumanProfile {
  rounds: number;
  /** Weighted number of recent rounds the percentages are based on. */
  recentRounds: number;
  playedPct: number;
  raisedPct: number;
  shovedPct: number;
  /** Of their recent raises, the share made with weak hands. Null until they've raised. */
  weakRaisePct: number | null;
  messages: number;
  claims: number;
  bluffsCaught: number;
  claimsBackedUp: number;
  notes: string[];
}

export type HandStrength = 'strong' | 'medium' | 'weak';

const DECAY = 0.95;
const MAX_NOTES = 3;
const MAX_SAMPLES = 20;
const NOTE_QUOTE_CHARS = 70;
/** Prior for range estimates, so one early shove doesn't swing a bot's read too far. */
const PRIOR_HANDS = 4;
/** Revealed raises needed before the cards seen outweigh the raise rate. */
const MIN_SAMPLES = 3;
const STRONG_CLAIM =
  /\b(aces|pocket|nuts|monster|set|trips|straight|flush|full house|boat|quads|royal|best hand|strong hand|big hand|can'?t lose|unbeatable|loaded|kings)\b/i;

const emptyStats = (): PlayerStats => ({
  hands: 0,
  played: 0,
  raised: 0,
  shoved: 0,
  weakRaises: 0,
});
const emptyMemory = (): BotMemory => ({
  messages: 0,
  claims: 0,
  bluffsCaught: 0,
  claimsBackedUp: 0,
  notes: [],
});

type Flag = 'played' | 'raised' | 'shoved';

export class PlayerHistory {
  private readonly data: HistoryData;
  /** Which stats each player already earned this round (each counts once per round). */
  private readonly flags = new Map<string, Set<Flag>>();
  private readonly messages = new Map<string, string[]>();

  constructor(saved?: HistoryData | null) {
    this.data =
      saved?.version === 2 && saved.stats && saved.samples && saved.memories
        ? structuredClone(saved)
        : { version: 2, rounds: 0, stats: {}, samples: {}, memories: {} };
  }

  get rounds(): number {
    return this.data.rounds;
  }

  toJSON(): HistoryData {
    return this.data;
  }

  stats(playerId: string): PlayerStats {
    return (this.data.stats[playerId] ??= emptyStats());
  }

  memory(botId: string): BotMemory {
    return (this.data.memories[botId] ??= emptyMemory());
  }

  startRound(playerIds: string[]): void {
    this.flags.clear();
    this.messages.clear();
    for (const id of playerIds) this.stats(id).hands++;
  }

  recordAction(playerId: string, action: PlayerAction, legal: LegalActions): void {
    if ((action.type === 'call' && legal.callAmount > 0) || action.type === 'raise') {
      this.flag(playerId, 'played');
    }
    if (action.type === 'raise') {
      this.flag(playerId, 'raised');
      if (action.to >= legal.maxRaiseTo) this.flag(playerId, 'shoved');
    }
  }

  recordMessage(botId: string, text: string): void {
    const list = this.messages.get(botId) ?? [];
    list.push(text);
    this.messages.set(botId, list);
  }

  /**
   * The reveal and compaction step, run once when a round ends. Every player's hole cards are
   * looked at here. `botMoves` lists what each bot did this round (e.g. "Called 40").
   */
  endRound(table: TableState, humanId: string, botMoves: Record<string, string[]>): void {
    this.data.rounds++;

    for (const p of table.players) {
      if (p.hole.length !== 2 || !this.flags.get(p.id)?.has('raised')) continue;
      const samples = (this.data.samples[p.id] ??= []);
      samples.push({
        pct: round3(startingHandPercentile(p.hole[0], p.hole[1])),
        shove: this.flags.get(p.id)!.has('shoved'),
      });
      if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
      if (handStrength(p.hole, table.board) === 'weak') this.stats(p.id).weakRaises++;
    }

    const human = table.players.find((p) => p.id === humanId);
    for (const [botId, said] of this.messages) {
      const m = this.memory(botId);
      m.messages += said.length;
      let verdict = '';
      if (human && human.hole.length === 2 && said.some((text) => STRONG_CLAIM.test(text))) {
        m.claims++;
        const strength = handStrength(human.hole, table.board);
        if (strength === 'weak') {
          m.bluffsCaught++;
          verdict = ' It was a bluff.';
        } else if (strength === 'strong') {
          m.claimsBackedUp++;
          verdict = ' It was true.';
        }
      }
      const quote = clip(said.join(' / '), NOTE_QUOTE_CHARS);
      const moves = botMoves[botId]?.join(', ') || 'no move';
      const had = human ? describeHolding(human.hole, table.board) : 'unknown cards';
      m.notes.push(
        `Round ${table.round}: they said "${quote}". You: ${moves}. They had ${had}.${verdict}`,
      );
      if (m.notes.length > MAX_NOTES) m.notes.splice(0, m.notes.length - MAX_NOTES);
    }

    // Older rounds fade, so a player who changes style is re-read within ~20 rounds.
    for (const s of Object.values(this.data.stats)) {
      for (const key of Object.keys(s) as (keyof PlayerStats)[]) s[key] *= DECAY;
    }
  }

  /**
   * Estimated share of starting hands (0 to 1) a player bets with. Uses the hands seen behind
   * their past raises once there are a few (a bluffer who raises with junk gets a wide range),
   * and their raise or all-in rate otherwise. `shove` = they went all-in this time.
   */
  bettingRange(playerId: string, shove: boolean): number {
    const s = this.stats(playerId);
    const count = shove ? s.shoved : s.raised;
    const prior = shove ? 0.1 : 0.25;
    let range = (count + prior * PRIOR_HANDS) / (s.hands + PRIOR_HANDS);

    const all = this.data.samples[playerId] ?? [];
    const shoves = all.filter((x) => x.shove);
    const seen = shove && shoves.length >= MIN_SAMPLES ? shoves : all;
    if (seen.length >= MIN_SAMPLES) {
      // The worst quarter of the hands they've bet with marks how far down their range goes.
      const sorted = seen.map((x) => x.pct).sort((a, b) => a - b);
      range = Math.max(range, sorted[Math.floor(sorted.length * 0.75)]);
    }
    return Math.min(1, Math.max(0.05, range));
  }

  /** Compact profile of the human for one bot's prompt. Its size is bounded. */
  profileFor(botId: string, humanId: string): HumanProfile {
    const s = this.stats(humanId);
    const pct = (n: number, of = s.hands) => (of > 0 ? Math.round((n / of) * 100) : 0);
    const m = this.memory(botId);
    return {
      rounds: this.data.rounds,
      recentRounds: Math.round(s.hands),
      playedPct: pct(s.played),
      raisedPct: pct(s.raised),
      shovedPct: pct(s.shoved),
      weakRaisePct: s.raised >= 0.5 ? pct(s.weakRaises, s.raised) : null,
      messages: m.messages,
      claims: m.claims,
      bluffsCaught: m.bluffsCaught,
      claimsBackedUp: m.claimsBackedUp,
      notes: [...m.notes],
    };
  }

  private flag(playerId: string, flag: Flag): void {
    const set = this.flags.get(playerId) ?? new Set<Flag>();
    if (set.has(flag)) return;
    set.add(flag);
    this.flags.set(playerId, set);
    this.stats(playerId)[flag]++;
  }
}

/** Rough strength of a holding on the board as it ended (preflop: by starting-hand rank). */
export function handStrength(hole: readonly Card[], board: readonly Card[]): HandStrength {
  if (board.length >= 3) {
    const category = evaluateHand([...hole, ...board]).categoryIndex;
    return category >= 2 ? 'strong' : category === 1 ? 'medium' : 'weak';
  }
  const pct = startingHandPercentile(hole[0], hole[1]);
  return pct < 0.15 ? 'strong' : pct < 0.5 ? 'medium' : 'weak';
}

/** "7♣ 2♦ (High Card, King)" or "7♣ 2♦ (a weak starting hand)". */
export function describeHolding(hole: readonly Card[], board: readonly Card[]): string {
  const cards = hole.map(cardLabel).join(' ');
  if (board.length >= 3) return `${cards} (${evaluateHand([...hole, ...board]).description})`;
  return `${cards} (a ${handStrength(hole, board)} starting hand)`;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// --- Saving between games (browser only; every call tolerates missing storage) ---------------

const storageKey = (name: string) =>
  `willaibeatus.history.v2.${name.trim().toLowerCase() || 'player'}`;

export function loadHistory(name: string): HistoryData | null {
  try {
    const raw = localStorage.getItem(storageKey(name));
    return raw ? (JSON.parse(raw) as HistoryData) : null;
  } catch {
    return null;
  }
}

export function saveHistory(name: string, data: HistoryData): void {
  try {
    localStorage.setItem(storageKey(name), JSON.stringify(data));
  } catch {
    // Storage full or blocked: memory just won't carry over to the next game.
  }
}

export function forgetHistory(name: string): void {
  try {
    localStorage.removeItem(storageKey(name));
  } catch {
    // Nothing to do.
  }
}
