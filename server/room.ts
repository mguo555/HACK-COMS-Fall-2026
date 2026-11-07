// One table: up to 4 humans plus AI players. The server is the single source of truth; each
// human gets their own view (their own cards only) pushed over Server-Sent Events.
import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { BotContext, HeardAnnouncement, PrivateChat } from '../src/app/ai/ai.types';
import { buildBotView, toLegalAction } from '../src/app/game/bot-view';
import { GAME_CONFIG } from '../src/app/game/game.config';
import { PlayerHistory, describeHolding, feelingLabel } from '../src/app/game/player-history';
import { cardLabel } from '../src/app/poker/cards';
import {
  LegalActions,
  PlayerAction,
  PlayerState,
  PokerEngine,
  SeatConfig,
  TableState,
} from '../src/app/poker/engine';
import { CHARACTERS, Persona, geminiPlayer, toPublic } from '../src/app/shared/personas';
import type {
  Announcement,
  BotThought,
  ChatMessage,
  ClientState,
  Leaning,
  FeelingLabel,
  MoodLabel,
  PlayerSummary,
  RoomPlayer,
  RoomSettings,
} from '../src/app/shared/protocol';
import * as ai from './ai';
import { loadPlayer, savePlayer } from './history-store';

export class RoomError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Human {
  id: string;
  name: string;
  token: string;
  isHost: boolean;
  persuasions: number;
  roundsPlayed: number;
}

interface Subscriber {
  human: Human;
  res: ServerResponse;
}

/** A whisper between a human and an AI (both directions). */
interface BotChat {
  id: number;
  botId: string;
  humanId: string;
  from: 'human' | 'bot';
  text: string;
  round: number;
  street: TableState['street'];
  pending?: boolean;
  offline?: boolean;
  sway?: number | null;
  leaning?: Leaning | null;
}

/** A whisper from one human to another. No AI sees these. */
interface DirectMessage {
  id: number;
  fromId: string;
  toId: string;
  text: string;
  round: number;
  street: TableState['street'];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shuffled = <T>(items: T[]): T[] => {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export function normalizeSettings(input: Partial<RoomSettings> | undefined): RoomSettings {
  const aiStyle = input?.aiStyle === 'gemini' ? 'gemini' : 'characters';
  const aiSeats = clampInt(input?.aiSeats, 1, GAME_CONFIG.maxSeats - 1, GAME_CONFIG.defaultAiSeats);
  const maxGoal = aiStyle === 'characters' ? CHARACTERS.length : 20;
  const knockoutGoal = clampInt(input?.knockoutGoal, 1, maxGoal, GAME_CONFIG.defaultKnockoutGoal);
  return { aiStyle, aiSeats, knockoutGoal };
}

export class Room {
  phase: 'lobby' | 'playing' | 'over' = 'lobby';
  lastActivity = Date.now();

  private readonly humans: Human[] = [];
  private readonly subscribers = new Set<Subscriber>();
  private engine: PokerEngine | null = null;
  private readonly history = new PlayerHistory();
  /** Every AI that has sat at the table, by player id. */
  private readonly personas = new Map<string, Persona>();
  /** Characters waiting for a seat (shuffled). */
  private roster: Persona[] = [];
  private geminiCount = 0;
  private knockouts = 0;
  /** AI player ids already counted as knocked out. */
  private readonly knockedOut = new Set<string>();

  private readonly chat: BotChat[] = [];
  private readonly directs: DirectMessage[] = [];
  private readonly announcements: Announcement[] = [];
  private thoughts: BotThought[] = [];
  private readonly bubbles = new Map<string, { text: string; until: number }>();
  private readonly recentRounds: string[] = [];
  /** Each AI's mood and how many more rounds it lasts unless something new happens. */
  private readonly moods = new Map<string, { label: MoodLabel; reason: string; rounds: number }>();
  private readonly startStacks = new Map<string, number>();
  /** Allowance counters: messages by human|bot|window, announcements by human|window. */
  private readonly used = new Map<string, number>();
  private thinkingBotId: string | null = null;
  private readonly pendingReplies = new Map<string, Promise<void>>();
  private pendingAnnouncement: Promise<void> | null = null;
  private notice: string | null = null;
  private result: ClientState['result'] = null;
  private aiState: ai.AiStatus = {
    enabled: false,
    model: '',
    reason: 'checking',
    usedToday: 0,
    perDay: 0,
  };

  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnDeadline: number | null = null;
  private nextTimer: ReturnType<typeof setTimeout> | null = null;
  private nextRoundAt: number | null = null;
  private readonly ready = new Set<string>();
  private botLoopRunning = false;
  private nextId = 1;
  private closed = false;
  private broadcastQueued = false;

  constructor(
    readonly code: string,
    readonly settings: RoomSettings,
  ) {
    void this.refreshAiStatus();
  }

  // --- Joining ---------------------------------------------------------------------------------

  join(rawName: string): Human {
    const name = cleanName(rawName);
    if (!name) throw new RoomError(400, 'Pick a name first');
    if (this.phase !== 'lobby') throw new RoomError(409, 'That game has already started');
    if (this.humans.length >= GAME_CONFIG.maxHumans) throw new RoomError(409, 'That table is full');
    if (this.humans.some((h) => h.name.toLowerCase() === name.toLowerCase())) {
      throw new RoomError(409, `Someone called ${name} is already at this table`);
    }
    const human: Human = {
      id: `h-${this.humans.length + 1}-${randomBytes(3).toString('hex')}`,
      name,
      token: randomBytes(18).toString('base64url'),
      isHost: this.humans.length === 0,
      persuasions: 0,
      roundsPlayed: 0,
    };
    this.humans.push(human);
    this.touch();
    return human;
  }

  byToken(token: string | undefined | null): Human {
    const human = token ? this.humans.find((h) => h.token === token) : undefined;
    if (!human) throw new RoomError(401, 'Not part of this table');
    return human;
  }

  leave(human: Human): void {
    if (this.phase === 'lobby') {
      this.humans.splice(this.humans.indexOf(human), 1);
      if (human.isHost && this.humans[0]) this.humans[0].isHost = true;
    }
    for (const sub of this.subscribers) if (sub.human === human) this.subscribers.delete(sub);
    this.touch();
  }

  get isEmpty(): boolean {
    return this.subscribers.size === 0;
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
    for (const sub of this.subscribers) sub.res.end();
    this.subscribers.clear();
  }

  // --- Starting and running rounds ---------------------------------------------------------------

  start(human: Human): void {
    if (!human.isHost) throw new RoomError(403, 'Only the host can start the game');
    if (this.phase !== 'lobby') throw new RoomError(409, 'The game has already started');

    const aiSeats = Math.min(this.settings.aiSeats, GAME_CONFIG.maxSeats - this.humans.length);
    if (this.settings.aiStyle === 'characters') this.roster = shuffled(CHARACTERS);
    const ais: SeatConfig[] = [];
    for (let i = 0; i < aiSeats; i++) {
      const persona = this.nextPersona();
      if (persona) ais.push({ id: persona.id, name: persona.name, isHuman: false });
    }

    // Spread the humans around the table instead of seating them side by side.
    const total = this.humans.length + ais.length;
    const seats: (SeatConfig | null)[] = Array(total).fill(null);
    this.humans.forEach((h, i) => {
      seats[Math.round((i * total) / this.humans.length)] = {
        id: h.id,
        name: h.name,
        isHuman: true,
      };
    });
    for (let i = 0; i < total; i++) seats[i] ??= ais.shift()!;

    const [small, big] = GAME_CONFIG.blindLevels[0];
    this.engine = new PokerEngine(seats as SeatConfig[], {
      startingStack: GAME_CONFIG.startingStack,
      smallBlind: small,
      bigBlind: big,
    });
    for (const h of this.humans) this.history.importPlayer(h.id, loadPlayer(h.name));
    this.phase = 'playing';
    this.nextRound();
  }

  /** A human clicked "Next round". Starts it once everyone still playing is ready. */
  markReady(human: Human): void {
    const t = this.engine?.state;
    if (this.phase !== 'playing' || !t?.handOver) return;
    this.ready.add(human.id);
    const waitingOn = this.activeHumans().filter(
      (h) => this.isConnected(h) && !this.ready.has(h.id),
    );
    if (waitingOn.length === 0) this.nextRound();
    else this.broadcast();
  }

  private nextRound(): void {
    const engine = this.engine;
    if (!engine || this.phase !== 'playing' || !engine.state.handOver) return;
    this.clearNextTimer();
    this.ready.clear();
    this.notice = null;

    const level = Math.min(
      GAME_CONFIG.blindLevels.length - 1,
      Math.floor(engine.state.round / GAME_CONFIG.roundsPerLevel),
    );
    const [small, big] = GAME_CONFIG.blindLevels[level];
    if (engine.state.bigBlind !== big) {
      engine.setBlinds(small, big);
      if (engine.state.round > 0) engine.addNote(`Blinds go up to ${small}/${big}`);
    }

    for (const p of engine.state.players) this.startStacks.set(p.id, p.stack);
    engine.startHand();
    this.history.startRound(engine.state.players.filter((p) => !p.busted).map((p) => p.id));
    this.bubbles.clear();
    this.thoughts = [];
    this.afterChange();
  }

  /** Called after anything moves the game forward. */
  private afterChange(): void {
    this.broadcast();
    const engine = this.engine;
    if (!engine || this.closed) return;
    if (engine.state.handOver) {
      this.endRound();
      return;
    }
    const p = engine.toAct;
    if (p?.isHuman) this.startTurnTimer(p.id);
    else void this.runBots();
  }

  act(human: Human, action: PlayerAction): void {
    const engine = this.requireEngine();
    if (engine.toAct?.id !== human.id) throw new RoomError(409, "It isn't your turn");
    this.applyHumanAction(human.id, action);
  }

  private applyHumanAction(playerId: string, action: PlayerAction): void {
    const engine = this.requireEngine();
    const legal = engine.legalActions();
    try {
      engine.act(playerId, action);
    } catch (error) {
      throw new RoomError(400, error instanceof Error ? error.message : 'Illegal move');
    }
    this.history.recordAction(playerId, action, legal);
    this.clearTurnTimer();
    this.touch();
    this.afterChange();
  }

  private startTurnTimer(playerId: string): void {
    this.clearTurnTimer();
    const human = this.humans.find((h) => h.id === playerId);
    // Someone who closed the tab shouldn't hold everyone up for the full timer.
    const ms = human && this.isConnected(human) ? GAME_CONFIG.turnTimeoutMs : 5000;
    this.turnDeadline = Date.now() + ms;
    this.turnTimer = setTimeout(() => {
      const engine = this.engine;
      if (!engine || engine.toAct?.id !== playerId) return;
      const legal = engine.legalActions();
      engine.addNote(`${engine.toAct.name} ran out of time`);
      this.applyHumanAction(playerId, legal.canCheck ? { type: 'check' } : { type: 'fold' });
    }, ms);
    this.broadcast();
  }

  // --- Bots ------------------------------------------------------------------------------------

  private async runBots(): Promise<void> {
    if (this.botLoopRunning) return;
    this.botLoopRunning = true;
    try {
      while (!this.closed && this.engine) {
        const p = this.engine.toAct;
        if (!p || p.isHuman || this.engine.state.handOver) break;
        try {
          await this.playBotTurn(p.id);
        } catch (error) {
          console.error(`[room ${this.code}] bot turn failed:`, error);
          this.forceSafeAction(p.id);
        }
      }
    } finally {
      this.botLoopRunning = false;
      this.thinkingBotId = null;
    }
    if (!this.closed) this.afterChange();
  }

  private async playBotTurn(botId: string): Promise<void> {
    const engine = this.engine!;
    const persona = this.personas.get(botId)!;
    const round = engine.state.round;
    this.thinkingBotId = botId;
    this.broadcast();

    // Let any reply or table reaction still on its way land first, so the decision can use it.
    await this.pendingReplies.get(botId);
    await this.pendingAnnouncement;
    if (this.closed || engine.toAct?.id !== botId) return;

    const started = Date.now();
    const ctx = this.contextFor(botId);
    const heardMessage =
      ctx.chats.some((c) => c.turns.some((t) => t.from === 'human' && t.round === round)) ||
      ctx.announcements.some((a) => a.round === round);
    const useAi = GAME_CONFIG.aiDecisions === 'always' || heardMessage;
    const { value: decision, notice } = await ai.decide(persona, this.humanNames(), ctx, useAi);
    if (notice) this.notice = notice;
    if (!decision.offline) void this.refreshAiStatus();

    const wait = GAME_CONFIG.minBotTurnMs - (Date.now() - started);
    if (wait > 0) await sleep(wait);
    if (this.closed || engine.toAct?.id !== botId || engine.state.round !== round) return;

    const street = engine.state.street;
    const legal = engine.legalActions();
    const action = toLegalAction(decision, legal);
    const talk = decision.tableTalk.trim();
    if (talk) this.say(botId, talk);
    engine.act(botId, action);
    this.history.recordAction(botId, action, legal);

    this.thoughts.push({
      id: this.nextId++,
      botId,
      round,
      street,
      action: describeAction(action, legal),
      thought: decision.thought,
      offline: decision.offline,
      heardMessage,
      influence: decision.offline ? null : decision.influence,
    });
    this.thinkingBotId = null;
    this.broadcast();
  }

  /** Last resort after an unexpected error: check if possible, else fold, so play goes on. */
  private forceSafeAction(playerId: string): void {
    const engine = this.engine;
    if (!engine || engine.toAct?.id !== playerId) return;
    try {
      engine.act(playerId, engine.legalActions().canCheck ? { type: 'check' } : { type: 'fold' });
    } catch (error) {
      console.error(`[room ${this.code}] could not recover:`, error);
      this.close();
    }
  }

  /** What one bot knows right now: the table, its chats, and what was announced. */
  private contextFor(botId: string): BotContext {
    const engine = this.engine!;
    const round = engine.state.round;
    const chats: PrivateChat[] = this.humans
      .map((h) => ({
        humanName: h.name,
        turns: this.chat
          .filter(
            (m) => m.botId === botId && m.humanId === h.id && !m.pending && m.round >= round - 1,
          )
          .slice(-6)
          .map((m) => ({ from: m.from, text: m.text, round: m.round })),
      }))
      .filter((c) => c.turns.length > 0);
    const announcements: HeardAnnouncement[] = this.announcements
      .filter((a) => a.round >= round - 1 && !a.pending)
      .map((a) => ({
        fromName: a.fromName,
        text: a.text,
        round: a.round,
        reaction: a.reactions.find((r) => r.botId === botId)?.say || null,
      }));
    return {
      view: buildBotView(engine, botId, this.recentRounds, this.history),
      chats,
      announcements,
      mood: this.moods.get(botId) ?? null,
    };
  }

  // --- Talking -----------------------------------------------------------------------------------

  private window(t: TableState): string {
    return GAME_CONFIG.messageLimit.resetEach === 'street'
      ? `${t.round}:${t.street}`
      : `${t.round}`;
  }

  messagesLeft(human: Human, botId: string): number {
    const t = this.engine?.state;
    if (!t) return 0;
    return (
      GAME_CONFIG.messageLimit.perPlayer -
      (this.used.get(`m|${human.id}|${botId}|${this.window(t)}`) ?? 0)
    );
  }

  announceLeft(human: Human): number {
    const t = this.engine?.state;
    if (!t) return 0;
    return GAME_CONFIG.announcementsPerRound - (this.used.get(`a|${human.id}|${t.round}`) ?? 0);
  }

  chatBlocker(human: Human, botId: string): string | null {
    const t = this.engine?.state;
    if (this.phase !== 'playing' || !t || t.round === 0) return 'Waiting for the deal';
    const bot = t.players.find((p) => p.id === botId);
    if (!bot) return 'Not at the table';
    if (bot.id === human.id) return "That's you";
    if (bot.isHuman) {
      // Whispers between humans: same one-per-round rule, but folding doesn't stop the chat.
      if (t.handOver) return 'Round over. You can chat again next round';
      if (this.messagesLeft(human, botId) <= 0) {
        return GAME_CONFIG.messageLimit.resetEach === 'street'
          ? 'Message used. You get another next street'
          : 'Message used. You get another next round';
      }
      return null;
    }
    if (bot.busted) return `${bot.name} is out of chips`;
    if (t.handOver) return 'Round over. You can chat again next round';
    if (this.seatOf(human)?.busted) return "You're out of chips";
    if (bot.folded) return `${bot.name} folded this round`;
    if (this.messagesLeft(human, botId) <= 0) {
      return GAME_CONFIG.messageLimit.resetEach === 'street'
        ? 'Message used. You get another next street'
        : 'Message used. You get another next round';
    }
    if (this.thinkingBotId === botId) return `${bot.name} is deciding a move…`;
    if (this.chat.some((m) => m.botId === botId && m.humanId === human.id && m.pending)) {
      return `${bot.name} is replying…`;
    }
    return null;
  }

  announceBlocker(human: Human): string | null {
    const t = this.engine?.state;
    if (this.phase !== 'playing' || !t || t.round === 0) return 'Waiting for the deal';
    if (t.handOver) return 'Round over. You can announce again next round';
    if (this.seatOf(human)?.busted) return "You're out of chips";
    if (this.announceLeft(human) <= 0) return 'Announcement used. You get another next round';
    if (this.pendingAnnouncement) return 'The table is still reacting…';
    return null;
  }

  async sendMessage(human: Human, botId: string, raw: string): Promise<void> {
    const text = cleanMessage(raw);
    if (!text) throw new RoomError(400, 'Message is empty');
    const blocker = this.chatBlocker(human, botId);
    if (blocker) throw new RoomError(409, blocker);
    const engine = this.requireEngine();
    const t = engine.state;
    const key = `m|${human.id}|${botId}|${this.window(t)}`;
    this.used.set(key, (this.used.get(key) ?? 0) + 1);

    if (t.players.find((p) => p.id === botId)?.isHuman) {
      // To another human: just deliver it. No AI call, and the AIs never see it.
      this.directs.push({
        id: this.nextId++,
        fromId: human.id,
        toId: botId,
        text,
        round: t.round,
        street: t.street,
      });
      if (this.directs.length > 400) this.directs.splice(0, this.directs.length - 400);
      this.touch();
      this.broadcast();
      return;
    }
    const persona = this.personas.get(botId)!;

    const ctx = this.contextFor(botId); // before the new message is added
    const base = { botId, humanId: human.id, round: t.round, street: t.street };
    this.chat.push({ ...base, id: this.nextId++, from: 'human', text });
    const reply: BotChat = {
      ...base,
      id: this.nextId++,
      from: 'bot',
      text: '',
      pending: true,
    };
    this.chat.push(reply);
    this.history.recordMessage(botId, human.id, text);
    this.touch();
    this.broadcast();

    const task = ai
      .chatReply(persona, human.name, this.humanNames(), ctx, text)
      .then(({ value, notice }) => {
        Object.assign(reply, {
          text: value.text,
          pending: false,
          offline: value.offline,
          sway: value.sway,
          leaning: value.leaning,
        });
        if ((value.sway ?? 0) >= 50) human.persuasions++;
        if (value.feeling === 'warmer') this.history.adjustFeeling(botId, human.id, 0.2);
        if (value.feeling === 'colder') this.history.adjustFeeling(botId, human.id, -0.25);
        if (notice) this.notice = notice;
        if (!value.offline) void this.refreshAiStatus();
      })
      .finally(() => {
        if (this.pendingReplies.get(botId) === task) this.pendingReplies.delete(botId);
        this.broadcast();
      });
    this.pendingReplies.set(botId, task);
    await task;
  }

  async announce(human: Human, raw: string): Promise<void> {
    const text = cleanMessage(raw);
    if (!text) throw new RoomError(400, 'Announcement is empty');
    const blocker = this.announceBlocker(human);
    if (blocker) throw new RoomError(409, blocker);
    const engine = this.requireEngine();
    const t = engine.state;
    const key = `a|${human.id}|${t.round}`;
    this.used.set(key, (this.used.get(key) ?? 0) + 1);

    const announcement: Announcement = {
      id: this.nextId++,
      round: t.round,
      street: t.street,
      fromId: human.id,
      fromName: human.name,
      text,
      pending: true,
      reactions: [],
      offline: false,
    };
    this.announcements.push(announcement);
    if (this.announcements.length > 30)
      this.announcements.splice(0, this.announcements.length - 30);
    this.say(human.id, text);
    this.touch();
    this.broadcast();

    // Everyone still in the hand hears it; one Gemini call voices all their reactions.
    const listeners = t.players
      .filter((p) => !p.isHuman && !p.folded && !p.busted)
      .map((p) => ({ persona: this.personas.get(p.id)!, ctx: this.contextFor(p.id) }));
    const task = ai
      .reactions(listeners, human.name, text)
      .then(({ value, notice }) => {
        announcement.reactions = value.reactions;
        announcement.offline = value.offline;
        if (value.reactions.some((r) => (r.sway ?? 0) >= 50)) human.persuasions++;
        if (notice) this.notice = notice;
        for (const r of value.reactions) if (r.say) this.say(r.botId, r.say);
        if (!value.offline) void this.refreshAiStatus();
      })
      .finally(() => {
        announcement.pending = false;
        this.pendingAnnouncement = null;
        this.broadcast();
      });
    this.pendingAnnouncement = task;
    await task;
  }

  /** Speech bubble + log line. */
  private say(playerId: string, text: string): void {
    this.engine?.addTableTalk(playerId, text);
    this.bubbles.set(playerId, { text, until: Date.now() + GAME_CONFIG.bubbleMs });
    setTimeout(() => this.broadcast(), GAME_CONFIG.bubbleMs + 50);
  }

  // --- End of round --------------------------------------------------------------------------

  private endRound(): void {
    const engine = this.engine!;
    const t = engine.state;
    const outcome = t.outcome;
    if (!outcome || this.phase !== 'playing') return;
    this.clearTurnTimer();

    let line = `Round ${t.round}: ${outcome.summary}`;
    if (outcome.showdown) {
      const shown = Object.entries(outcome.hands).map(([id, hand]) => {
        const p = t.players.find((x) => x.id === id)!;
        return `${p.name} showed ${p.hole.map(cardLabel).join(' ')} (${hand.description})`;
      });
      line += `. ${shown.join('; ')}`;
    }
    const revealed = t.players
      .filter((p) => p.isHuman && p.hole.length === 2 && !outcome.hands[p.id])
      .map((p) => `${p.name} had ${describeHolding(p.hole, t.board)}`);
    if (revealed.length) line += `. Revealed after the round: ${revealed.join('; ')}`;
    this.recentRounds.push(line);
    if (this.recentRounds.length > 6) this.recentRounds.shift();

    // Reveal every hand to the bots' memory, compact it, and save each human's part.
    const botMoves: Record<string, string[]> = {};
    for (const th of this.thoughts) (botMoves[th.botId] ??= []).push(th.action);
    const humanIds = this.humans.map((h) => h.id);
    this.history.endRound(t, humanIds, botMoves);
    for (const h of this.humans) {
      if (t.players.find((p) => p.id === h.id)?.hole.length) h.roundsPlayed++;
      savePlayer(h.name, this.history.exportPlayer(h.id));
    }

    this.updateMoods(t);

    // Busted AIs count as knockouts and are replaced by a new challenger.
    t.players.forEach((p, index) => {
      if (p.isHuman || !p.busted || this.knockedOut.has(p.id)) return;
      this.knockedOut.add(p.id);
      this.knockouts++;
      const next = this.knockouts < this.settings.knockoutGoal ? this.nextPersona() : null;
      if (next) {
        engine.replaceSeat(
          index,
          { id: next.id, name: next.name, isHuman: false },
          GAME_CONFIG.startingStack,
        );
        engine.addNote(`${p.name} is out. ${next.name} sits down.`);
      } else {
        engine.addNote(`${p.name} is out.`);
      }
    });

    const humansLeft = this.activeHumans().length;
    const aisLeft = t.players.filter((p) => !p.isHuman && !p.busted).length;
    if (humansLeft === 0) this.finish('ais');
    else if (this.knockouts >= this.settings.knockoutGoal || aisLeft === 0) this.finish('humans');
    else if (this.connectedActiveHumans() > 1) {
      this.nextRoundAt = Date.now() + GAME_CONFIG.nextRoundDelayMs;
      this.nextTimer = setTimeout(() => this.nextRound(), GAME_CONFIG.nextRoundDelayMs);
    }
    this.broadcast();
  }

  private finish(winner: 'humans' | 'ais'): void {
    const t = this.engine!.state;
    this.phase = 'over';
    this.clearTimers();
    const summary =
      winner === 'humans'
        ? `The humans win. ${this.knockouts} AI${this.knockouts === 1 ? '' : 's'} knocked out in ${t.round} rounds.`
        : `The AIs win. Every human is out of chips after ${t.round} rounds, with ${this.knockouts} AI${this.knockouts === 1 ? '' : 's'} knocked out.`;
    const stats: PlayerSummary[] = t.players.map((p) => {
      const h = this.humans.find((x) => x.id === p.id);
      return {
        id: p.id,
        name: p.name,
        isHuman: p.isHuman,
        chips: p.stack,
        roundsPlayed: h?.roundsPlayed ?? t.round,
        persuasions: h?.persuasions ?? 0,
      };
    });
    this.result = { winner, summary, stats };
  }

  /**
   * The bots' "soul": a big loss tilts them, a smaller one shakes them, a big win puts them on
   * a heater. Moods fade after a few rounds without another swing.
   */
  private updateMoods(t: TableState): void {
    for (const p of t.players) {
      if (p.isHuman) continue;
      const start = this.startStacks.get(p.id) ?? p.stack;
      const delta = p.stack - start;
      const ratio = start > 0 ? delta / start : 0;
      const current = this.moods.get(p.id);
      if (ratio <= -0.4) {
        this.moods.set(p.id, {
          label: 'tilted',
          reason: `lost ${-delta} chips last round`,
          rounds: 3,
        });
      } else if (ratio <= -0.15) {
        this.moods.set(p.id, {
          label: 'shaken',
          reason: `lost ${-delta} chips last round`,
          rounds: 2,
        });
      } else if (ratio >= 0.5) {
        this.moods.set(p.id, {
          label: 'on a heater',
          reason: `won ${delta} chips last round`,
          rounds: 3,
        });
      } else if (current && --current.rounds <= 0) {
        this.moods.delete(p.id);
      }
    }
  }

  private nextPersona(): Persona | null {
    let persona: Persona | null;
    if (this.settings.aiStyle === 'gemini') persona = geminiPlayer(++this.geminiCount);
    else persona = this.roster.shift() ?? null;
    if (persona) this.personas.set(persona.id, persona);
    return persona;
  }

  // --- Views -----------------------------------------------------------------------------------

  subscribe(human: Human, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const sub = { human, res };
    this.subscribers.add(sub);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
    res.on('close', () => {
      clearInterval(heartbeat);
      this.subscribers.delete(sub);
      this.broadcast();
    });
    this.touch();
    this.broadcast();
  }

  /** Sends everyone their view. Coalesced so a burst of changes is one update. */
  broadcast(): void {
    if (this.broadcastQueued || this.closed) return;
    this.broadcastQueued = true;
    queueMicrotask(() => {
      this.broadcastQueued = false;
      for (const sub of this.subscribers) {
        sub.res.write(`data: ${JSON.stringify(this.stateFor(sub.human))}\n\n`);
      }
    });
  }

  stateFor(human: Human): ClientState {
    const engine = this.engine;
    const t = engine ? sanitize(engine.state, human.id) : null;
    const now = Date.now();
    const bubbles: Record<string, string> = {};
    for (const [id, b] of this.bubbles) if (b.until > now) bubbles[id] = b.text;

    // Everyone else at the table is someone you can whisper to.
    const contactIds = t ? t.players.filter((p) => p.id !== human.id).map((p) => p.id) : [];
    const botIds = t ? t.players.filter((p) => !p.isHuman).map((p) => p.id) : [];
    const chatBlockers: Record<string, string | null> = {};
    const messagesLeft: Record<string, number> = {};
    for (const id of contactIds) {
      chatBlockers[id] = this.chatBlocker(human, id);
      messagesLeft[id] = this.messagesLeft(human, id);
    }
    const myTurn = engine?.toAct?.id === human.id;
    const round = engine?.state.round ?? 0;
    const levelRounds = GAME_CONFIG.roundsPerLevel;

    return {
      code: this.code,
      phase: this.phase,
      settings: this.settings,
      you: { id: human.id, name: human.name, isHost: human.isHost },
      players: this.humans.map((h): RoomPlayer => ({
        id: h.id,
        name: h.name,
        isHost: h.isHost,
        connected: this.isConnected(h),
      })),
      personas: Object.fromEntries([...this.personas].map(([id, p]) => [id, toPublic(p)])),
      table: t,
      legal: myTurn && engine ? engine.legalActions() : null,
      turnDeadline: myTurn ? this.turnDeadline : null,
      thinkingBotId: this.thinkingBotId,
      bubbles,
      moods: Object.fromEntries([...this.moods].map(([id, m]) => [id, m.label])),
      feelings: Object.fromEntries(
        botIds.map((id): [string, FeelingLabel] => [
          id,
          feelingLabel(this.history.memory(id, human.id).feeling),
        ]),
      ),
      chat: this.threadsFor(human),
      announcements: this.announcements.filter((a) => a.round >= round - 2),
      thoughts: t?.handOver ? this.thoughts : [],
      chatBlockers,
      messagesLeft,
      announceLeft: this.announceLeft(human),
      announceBlocker: this.announceBlocker(human),
      ai: this.aiState,
      notice: this.notice,
      scoreboard: {
        knockouts: this.knockouts,
        goal: this.settings.knockoutGoal,
        humansLeft: this.activeHumans().length,
        humansTotal: this.humans.length,
        blindLevel: Math.min(GAME_CONFIG.blindLevels.length, Math.floor(round / levelRounds) + 1),
        roundsToBlindsUp: levelRounds - (round % levelRounds),
      },
      result: this.result,
      ready: [...this.ready],
      nextRoundAt: this.nextRoundAt,
    };
  }

  /** Your whispers with the AIs and with other humans, as one list keyed by the other player. */
  private threadsFor(human: Human): ChatMessage[] {
    const withBots = this.chat
      .filter((m) => m.humanId === human.id)
      .map((m): ChatMessage => ({
        id: m.id,
        withId: m.botId,
        mine: m.from === 'human',
        text: m.text,
        round: m.round,
        street: m.street,
        pending: m.pending,
        offline: m.offline,
        sway: m.sway,
        leaning: m.leaning,
      }));
    const withHumans = this.directs
      .filter((d) => d.fromId === human.id || d.toId === human.id)
      .map((d): ChatMessage => ({
        id: d.id,
        withId: d.fromId === human.id ? d.toId : d.fromId,
        mine: d.fromId === human.id,
        text: d.text,
        round: d.round,
        street: d.street,
      }));
    return [...withBots, ...withHumans].sort((a, b) => a.id - b.id).slice(-120);
  }

  // --- Helpers ---------------------------------------------------------------------------------

  private async refreshAiStatus(): Promise<void> {
    this.aiState = await ai.aiStatus();
    this.broadcast();
  }

  private humanNames(): string[] {
    return this.humans.map((h) => h.name);
  }

  private seatOf(human: Human): PlayerState | undefined {
    return this.engine?.state.players.find((p) => p.id === human.id);
  }

  private activeHumans(): Human[] {
    return this.humans.filter((h) => !this.seatOf(h)?.busted);
  }

  private connectedActiveHumans(): number {
    return this.activeHumans().filter((h) => this.isConnected(h)).length;
  }

  private isConnected(human: Human): boolean {
    for (const sub of this.subscribers) if (sub.human === human) return true;
    return false;
  }

  private requireEngine(): PokerEngine {
    if (!this.engine || this.phase !== 'playing')
      throw new RoomError(409, 'The game is not running');
    return this.engine;
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnDeadline = null;
  }

  private clearNextTimer(): void {
    if (this.nextTimer) clearTimeout(this.nextTimer);
    this.nextTimer = null;
    this.nextRoundAt = null;
  }

  private clearTimers(): void {
    this.clearTurnTimer();
    this.clearNextTimer();
  }
}

/** A copy of the table with the deck removed and other players' cards hidden (rank 0). */
function sanitize(state: TableState, viewerId: string): TableState {
  const t = structuredClone(state);
  t.deck = [];
  const shown = new Set(Object.keys(t.outcome?.hands ?? {}));
  for (const p of t.players) {
    if (p.id !== viewerId && !shown.has(p.id)) p.hole = p.hole.map(() => ({ rank: 0, suit: 's' }));
  }
  return t;
}

function describeAction(action: PlayerAction, legal: LegalActions): string {
  switch (action.type) {
    case 'fold':
      return 'Folded';
    case 'check':
      return 'Checked';
    case 'call':
      return `Called ${legal.callAmount}`;
    case 'raise':
      return action.to === legal.maxRaiseTo ? `All-in for ${action.to}` : `Raised to ${action.to}`;
  }
}

export function cleanName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[^\p{L}\p{N} _.'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

function cleanMessage(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, GAME_CONFIG.maxMessageLength);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
