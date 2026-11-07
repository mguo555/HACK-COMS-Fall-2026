import { Card, cardLabel } from '../poker/cards';
import { LegalActions, PlayerAction, TableState } from '../poker/engine';
import { startingHandPercentile } from '../poker/equity';
import { evaluateHand } from '../poker/evaluator';

/**
 * What the bots remember about how everyone plays, and about what each human told each bot.
 *
 * After every round all hole cards are revealed to the bots (not only at showdown), so they
 * learn what each player raises and shoves with, and whether a human's claims were bluffs.
 *
 * Compaction keeps this small however long the game runs, with no extra AI calls:
 * - Betting stats decay by DECAY each round, so recent play counts most (roughly the last 20
 *   rounds matter).
 * - The hands behind each player's raises are kept as starting-hand percentiles, last
 *   MAX_SAMPLES only.
 * - A human's messages to a bot are folded into counters (big-hand claims, how many were
 *   bluffs) plus one short note per round, last MAX_NOTES only.
 * A bot's prompt gets a few lines per human, not the whole chat log.
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

/** One bot's memory of one human's messages. Counters are lifetime totals. */
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
  /** How the bot feels about this human, -1 (can't stand them) to 1 (adores them). */
  feeling: number;
}

/** Everything remembered about one human, for saving between games. */
export interface SavedPlayer {
  version: 3;
  rounds: number;
  stats: PlayerStats;
  samples: RaiseSample[];
  /** By bot (persona) id. */
  memories: Record<string, BotMemory>;
}

/** The compact profile of a human sent with each bot request. */
export interface HumanProfile {
  name: string;
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
  /** How this bot feels about them, -1 to 1. */
  feeling: number;
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
  feeling: 0,
});

type Flag = 'played' | 'raised' | 'shoved';
const memoryKey = (botId: string, humanId: string) => `${botId}|${humanId}`;

export class PlayerHistory {
  private rounds = 0;
  private readonly roundsByPlayer = new Map<string, number>();
  private readonly statsById = new Map<string, PlayerStats>();
  private readonly samplesById = new Map<string, RaiseSample[]>();
  private readonly memories = new Map<string, BotMemory>();
  /** Which stats each player already earned this round (each counts once per round). */
  private readonly flags = new Map<string, Set<Flag>>();
  /** This round's messages, by bot|human. */
  private readonly messages = new Map<string, string[]>();

  get totalRounds(): number {
    return this.rounds;
  }

  stats(playerId: string): PlayerStats {
    let s = this.statsById.get(playerId);
    if (!s) this.statsById.set(playerId, (s = emptyStats()));
    return s;
  }

  memory(botId: string, humanId: string): BotMemory {
    const key = memoryKey(botId, humanId);
    let m = this.memories.get(key);
    if (!m) this.memories.set(key, (m = emptyMemory()));
    return m;
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

  recordMessage(botId: string, humanId: string, text: string): void {
    const key = memoryKey(botId, humanId);
    const list = this.messages.get(key) ?? [];
    list.push(text);
    this.messages.set(key, list);
  }

  /**
   * The reveal and compaction step, run once when a round ends. Every player's hole cards are
   * looked at here. `botMoves` lists what each bot did this round (e.g. "Called 40").
   */
  endRound(table: TableState, humanIds: string[], botMoves: Record<string, string[]>): void {
    this.rounds++;
    for (const id of humanIds) this.roundsByPlayer.set(id, (this.roundsByPlayer.get(id) ?? 0) + 1);

    for (const p of table.players) {
      if (p.hole.length !== 2 || !this.flags.get(p.id)?.has('raised')) continue;
      const samples = this.samplesById.get(p.id) ?? [];
      samples.push({
        pct: round3(startingHandPercentile(p.hole[0], p.hole[1])),
        shove: this.flags.get(p.id)!.has('shoved'),
      });
      if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
      this.samplesById.set(p.id, samples);
      if (handStrength(p.hole, table.board) === 'weak') this.stats(p.id).weakRaises++;
    }

    for (const [key, said] of this.messages) {
      const [botId, humanId] = key.split('|');
      const human = table.players.find((p) => p.id === humanId);
      const m = this.memory(botId, humanId);
      m.messages += said.length;
      let verdict = '';
      if (human && human.hole.length === 2 && said.some((text) => STRONG_CLAIM.test(text))) {
        m.claims++;
        const strength = handStrength(human.hole, table.board);
        if (strength === 'weak') {
          m.bluffsCaught++;
          m.feeling = clampFeeling(m.feeling - 0.35); // being lied to stings
          verdict = ' It was a bluff.';
        } else if (strength === 'strong') {
          m.claimsBackedUp++;
          m.feeling = clampFeeling(m.feeling + 0.15);
          verdict = ' It was true.';
        }
      }
      const quote = clip(said.join(' / '), NOTE_QUOTE_CHARS);
      const moves = botMoves[botId]?.join(', ') || 'no move';
      const had =
        human?.hole.length === 2 ? describeHolding(human.hole, table.board) : 'unknown cards';
      m.notes.push(
        `Round ${table.round}: they said "${quote}". You: ${moves}. They had ${had}.${verdict}`,
      );
      if (m.notes.length > MAX_NOTES) m.notes.splice(0, m.notes.length - MAX_NOTES);
    }

    // Older rounds fade, so a player who changes style is re-read within ~20 rounds.
    for (const s of this.statsById.values()) {
      for (const key of Object.keys(s) as (keyof PlayerStats)[]) s[key] *= DECAY;
    }
  }

  /** Nudges how a bot feels about a human (e.g. after a kind or rude message). */
  adjustFeeling(botId: string, humanId: string, delta: number): void {
    const m = this.memory(botId, humanId);
    m.feeling = clampFeeling(m.feeling + delta);
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

    const all = this.samplesById.get(playerId) ?? [];
    const shoves = all.filter((x) => x.shove);
    const seen = shove && shoves.length >= MIN_SAMPLES ? shoves : all;
    if (seen.length >= MIN_SAMPLES) {
      // The worst quarter of the hands they've bet with marks how far down their range goes.
      const sorted = seen.map((x) => x.pct).sort((a, b) => a - b);
      range = Math.max(range, sorted[Math.floor(sorted.length * 0.75)]);
    }
    return Math.min(1, Math.max(0.05, range));
  }

  /** Compact profile of one human for one bot's prompt. Its size is bounded. */
  profileFor(botId: string, humanId: string, name: string): HumanProfile {
    const s = this.stats(humanId);
    const pct = (n: number, of = s.hands) => (of > 0 ? Math.round((n / of) * 100) : 0);
    const m = this.memory(botId, humanId);
    return {
      name,
      rounds: this.roundsByPlayer.get(humanId) ?? 0,
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
      feeling: Math.round(m.feeling * 100) / 100,
    };
  }

  /** Everything about one human, for saving between games. */
  exportPlayer(humanId: string): SavedPlayer {
    const memories: Record<string, BotMemory> = {};
    for (const [key, m] of this.memories) {
      const [botId, id] = key.split('|');
      if (id === humanId) memories[botId] = structuredClone(m);
    }
    return {
      version: 3,
      rounds: this.roundsByPlayer.get(humanId) ?? 0,
      stats: { ...this.stats(humanId) },
      samples: [...(this.samplesById.get(humanId) ?? [])],
      memories,
    };
  }

  /** Restores a saved human under `humanId` (their id at this table). */
  importPlayer(humanId: string, saved: SavedPlayer | null | undefined): void {
    if (!saved || saved.version !== 3) return;
    this.roundsByPlayer.set(humanId, saved.rounds);
    this.statsById.set(humanId, { ...emptyStats(), ...saved.stats });
    this.samplesById.set(humanId, [...saved.samples].slice(-MAX_SAMPLES));
    for (const [botId, m] of Object.entries(saved.memories ?? {})) {
      this.memories.set(memoryKey(botId, humanId), {
        ...emptyMemory(),
        ...m,
        notes: [...(m.notes ?? [])].slice(-MAX_NOTES),
      });
    }
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

/** How a feeling value reads in words. */
export function feelingLabel(feeling: number): 'adores' | 'likes' | 'neutral' | 'wary' | 'grudge' {
  if (feeling >= 0.6) return 'adores';
  if (feeling >= 0.25) return 'likes';
  if (feeling <= -0.6) return 'grudge';
  if (feeling <= -0.25) return 'wary';
  return 'neutral';
}

function clampFeeling(n: number): number {
  return Math.max(-1, Math.min(1, n));
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
