import { HumanProfile } from '../game/player-history';
import { Street } from '../poker/engine';

/** What a bot is allowed to know about the table. Sent to the server to build prompts. */
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
  /** What this bot remembers about the human, already compacted (see player-history.ts). */
  profile: HumanProfile;
}

export interface ChatTurn {
  from: 'human' | 'bot';
  text: string;
  round: number;
}

export interface DecideRequest {
  personaId: string;
  humanName: string;
  view: BotView;
  conversation: ChatTurn[];
}

export interface ChatRequest extends DecideRequest {
  message: string;
}

export type BotActionType = 'fold' | 'check' | 'call' | 'raise';

export interface BotDecision {
  action: BotActionType;
  raiseTo: number;
  /** Said out loud at the table ("" to stay quiet). */
  tableTalk: string;
  /** Private reasoning, revealed after the round. */
  thought: string;
  /** True when the built-in logic made this decision instead of Gemini. */
  offline: boolean;
}

export type AiState = 'checking' | 'online' | 'offline';

export interface AiStatus {
  state: AiState;
  model?: string;
  /** Why we're offline, in plain words. */
  reason?: string;
}
