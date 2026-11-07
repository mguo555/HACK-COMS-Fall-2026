/**
 * What the server and the browser send each other. The server runs every table; each browser
 * gets its own view (its own cards only) over Server-Sent Events and sends actions with POST.
 */
import type { LegalActions, PlayerAction, Street, TableState } from '../poker/engine';
import type { PublicPersona } from './personas';

export type AiStyle = 'characters' | 'gemini';
export type Leaning = 'fold' | 'call' | 'raise' | 'unchanged';
/** How a bot feels right now, from its recent wins and losses. */
export type MoodLabel = 'steady' | 'tilted' | 'shaken' | 'on a heater';
/** How a bot feels about one human, from how they've treated it. */
export type FeelingLabel = 'adores' | 'likes' | 'neutral' | 'wary' | 'grudge';

export interface RoomSettings {
  /** Characters with personalities, or plain Gemini players. */
  aiStyle: AiStyle;
  /** AI seats at the table (total seats are capped at 6). */
  aiSeats: number;
  /** AIs the humans must knock out to win. */
  knockoutGoal: number;
}

export interface RoomPlayer {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  /** Optional, shown next to the name and used by the AIs. */
  pronouns: string;
  /** Language code the AIs use with this player (see languages.ts). */
  language: string;
}

/** How a player wants to be addressed. Sent when creating or joining a table. */
export interface PlayerProfile {
  pronouns?: string;
  language?: string;
}

/** A private message in your thread with one other player (an AI or another human). */
export interface ChatMessage {
  id: number;
  /** The other player in this thread. */
  withId: string;
  /** You sent it (false: they sent it to you). */
  mine: boolean;
  text: string;
  round: number;
  street: Street;
  pending?: boolean;
  /** Canned reply (Gemini not used). */
  offline?: boolean;
  /** How much the message shifted the bot, 0 to 100 (bot replies only). */
  sway?: number | null;
  leaning?: Leaning | null;
}

/** An AI player's out-loud reaction to a table announcement. */
export interface Reaction {
  botId: string;
  say: string;
  sway: number | null;
  leaning: Leaning | null;
}

/** Something a human said to the whole table. */
export interface Announcement {
  id: number;
  round: number;
  street: Street;
  fromId: string;
  fromName: string;
  text: string;
  pending: boolean;
  reactions: Reaction[];
  offline: boolean;
}

/** A bot's private reasoning for one decision, revealed after the round. */
export interface BotThought {
  id: number;
  botId: string;
  round: number;
  street: Street;
  action: string;
  thought: string;
  offline: boolean;
  /** Whether a human had messaged this bot, or announced to the table, before it decided. */
  heardMessage: boolean;
  /** How much messages changed this decision, 0 to 100 (Gemini decisions only). */
  influence: number | null;
}

export interface Scoreboard {
  knockouts: number;
  goal: number;
  humansLeft: number;
  humansTotal: number;
  blindLevel: number;
  roundsToBlindsUp: number;
}

export interface ClientState {
  code: string;
  phase: 'lobby' | 'playing' | 'over';
  settings: RoomSettings;
  you: { id: string; name: string; isHost: boolean };
  players: RoomPlayer[];
  /** Every AI player that has sat at this table, by player id. */
  personas: Partial<Record<string, PublicPersona>>;
  /** Other players' hole cards are hidden (rank 0) unless shown at showdown. */
  table: TableState | null;
  /** Set when it's your turn. */
  legal: LegalActions | null;
  /** When your turn times out (epoch ms), if it's your turn. */
  turnDeadline: number | null;
  thinkingBotId: string | null;
  bubbles: Partial<Record<string, string>>;
  /** Each AI player's current mood (only when not steady). */
  moods: Partial<Record<string, MoodLabel>>;
  /** How each AI player feels about you. */
  feelings: Partial<Record<string, FeelingLabel>>;
  /** Your private threads only: with each AI, and with each other human. */
  chat: ChatMessage[];
  /** Recent table announcements (public). */
  announcements: Announcement[];
  /** Bots' thoughts for the round just finished. */
  thoughts: BotThought[];
  /** Why you can't message each other player right now (null = you can). */
  chatBlockers: Partial<Record<string, string | null>>;
  messagesLeft: Partial<Record<string, number>>;
  announceLeft: number;
  announceBlocker: string | null;
  ai: { enabled: boolean; model: string; reason: string | null; usedToday: number; perDay: number };
  notice: string | null;
  scoreboard: Scoreboard;
  /** Set when the game is over. */
  result: { winner: 'humans' | 'ais'; summary: string; stats: PlayerSummary[] } | null;
  /** Players ready for the next round, and when it starts anyway. */
  ready: string[];
  nextRoundAt: number | null;
}

export interface PlayerSummary {
  id: string;
  name: string;
  isHuman: boolean;
  chips: number;
  roundsPlayed: number;
  /** Times a bot reported your message swayed it at least 50%. */
  persuasions: number;
}

// --- Requests ---------------------------------------------------------------------------------

export interface CreateRoomRequest {
  name: string;
  settings: Partial<RoomSettings>;
  profile?: PlayerProfile;
}

export interface JoinRoomRequest {
  name: string;
  profile?: PlayerProfile;
}

export interface JoinRoomResponse {
  code: string;
  token: string;
}

export interface ActRequest {
  action: PlayerAction;
}

export interface MessageRequest {
  botId: string;
  text: string;
}

export interface AnnounceRequest {
  text: string;
}
