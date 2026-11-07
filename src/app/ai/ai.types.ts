import type { HumanProfile } from '../game/player-history';
import type { Street } from '../poker/engine';
import type { Leaning, MoodLabel } from '../shared/protocol';

/** What a bot is allowed to know about the table when it decides or talks. */
export interface BotView {
  round: number;
  street: Street;
  blinds: { small: number; big: number };
  /** e.g. ["A♠", "K♥"] */
  hole: string[];
  board: string[];
  /** e.g. "Pair of Queens", or null preflop without a pocket pair. */
  madeHand: string | null;
  pot: number;
  stack: number;
  streetBet: number;
  currentBet: number;
  toCall: number;
  /** Monte Carlo estimate vs everyone still in, as if they held random cards. 0 to 1. */
  winChance: number;
  /**
   * Set when there's a bet to call: who made it, how wide their betting range looks from past
   * play, and the win chance against that range (plus anyone who already called). This is the
   * number to compare with the pot odds.
   */
  facingBet: {
    bettor: string;
    isHuman: boolean;
    allIn: boolean;
    /** Share of hands they bet like this with, as a percentage. */
    rangePct: number;
    winChance: number;
  } | null;
  opponentsInHand: number;
  legal: {
    canCheck: boolean;
    callAmount: number;
    canRaise: boolean;
    minRaiseTo: number;
    maxRaiseTo: number;
  };
  players: {
    name: string;
    stack: number;
    streetBet: number;
    status: 'in the hand' | 'folded' | 'all-in' | 'out of chips';
    isHuman: boolean;
    isSelf: boolean;
    isDealer: boolean;
  }[];
  /** This round's public actions and table talk, oldest first. */
  actionLog: string[];
  /** One-line summaries of the last couple of rounds. */
  recentRounds: string[];
  /** What this bot remembers about each human at the table, already compacted. */
  profiles: HumanProfile[];
}

/** A bot's private chat with one human (this round and the last, word for word). */
export interface PrivateChat {
  humanName: string;
  turns: { from: 'human' | 'bot'; text: string; round: number }[];
}

/** A table announcement the bot heard this round or last. */
export interface HeardAnnouncement {
  fromName: string;
  text: string;
  round: number;
  /** What this bot said back, if it reacted. */
  reaction: string | null;
}

/** Everything a prompt is built from. */
export interface BotContext {
  view: BotView;
  chats: PrivateChat[];
  announcements: HeardAnnouncement[];
  /** The bot's mood from recent results, e.g. tilted after losing a big pot. */
  mood: { label: MoodLabel; reason: string } | null;
}

export type BotActionType = 'fold' | 'check' | 'call' | 'raise';

export interface BotDecision {
  action: BotActionType;
  raiseTo: number;
  /** Said out loud at the table ("" to stay quiet). */
  tableTalk: string;
  /** Private reasoning, revealed after the round. */
  thought: string;
  /** How much messages changed this decision, 0 to 100. Null for built-in decisions. */
  influence: number | null;
  /** True when the built-in logic made this decision instead of Gemini. */
  offline: boolean;
}

export interface ChatReply {
  text: string;
  sway: number | null;
  leaning: Leaning | null;
  /** How the message changed the bot's feelings about the sender. */
  feeling: 'warmer' | 'colder' | 'same' | null;
  offline: boolean;
}
