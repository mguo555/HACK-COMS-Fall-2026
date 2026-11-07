import { Injectable, computed, inject, signal } from '@angular/core';
import { AiService } from '../ai/ai.service';
import { ChatTurn } from '../ai/ai.types';
import { PERSONAS } from '../ai/personas';
import { cardLabel } from '../poker/cards';
import { LegalActions, PlayerAction, PokerEngine, Street, TableState } from '../poker/engine';
import { buildBotView, toLegalAction } from './bot-view';
import { GAME_CONFIG } from './game.config';

export const HUMAN_ID = 'you';

export interface ChatMessage {
  id: number;
  botId: string;
  from: 'human' | 'bot';
  text: string;
  round: number;
  street: Street;
  /** Bot reply still on its way. */
  pending?: boolean;
  /** Reply came from the built-in fallback, not Gemini. */
  offline?: boolean;
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
  /** Whether the human had messaged this bot this round before it decided. */
  heardMessage: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a game: owns the engine, drives bot turns, and enforces the chat rule. Components read
 * the signals; all changes go through the methods here.
 */
@Injectable({ providedIn: 'root' })
export class GameService {
  private readonly ai = inject(AiService);
  private engine: PokerEngine | null = null;
  /** Bumped on every new game so stale async work (bot turns, replies) is ignored. */
  private gameId = 0;
  private botLoopGameId = -1;
  private nextId = 1;
  private readonly pendingReplies = new Map<string, Promise<void>>();
  private readonly bubbleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  readonly phase = signal<'intro' | 'playing'>('intro');
  readonly humanName = signal('');
  readonly table = signal<TableState | null>(null);
  readonly chat = signal<ChatMessage[]>([]);
  readonly thoughts = signal<BotThought[]>([]);
  readonly thinkingBotId = signal<string | null>(null);
  /** Table talk currently shown above seats, by player id. */
  readonly bubbles = signal<Partial<Record<string, string>>>({});
  readonly recentRounds = signal<string[]>([]);
  /** Messages sent per allowance window (see GAME_CONFIG.messageLimit). */
  private readonly sent = signal<ReadonlyMap<string, number>>(new Map());

  readonly human = computed(() => this.table()?.players.find((p) => p.isHuman) ?? null);

  readonly isHumanTurn = computed(() => {
    const t = this.table();
    return !!t && !t.handOver && t.toActIndex >= 0 && t.players[t.toActIndex].isHuman;
  });

  readonly legal = computed<LegalActions | null>(() => {
    this.table(); // re-evaluate whenever the table changes
    return this.isHumanTurn() && this.engine ? this.engine.legalActions() : null;
  });

  readonly gameOver = computed(() => {
    const t = this.table();
    if (!t?.handOver) return false;
    const human = t.players.find((p) => p.isHuman);
    return !!human?.busted || t.players.filter((p) => !p.busted).length < 2;
  });

  readonly roundThoughts = computed(() => {
    const round = this.table()?.round;
    return this.thoughts().filter((t) => t.round === round);
  });

  // --- Game flow -------------------------------------------------------------

  async startGame(name: string): Promise<void> {
    const id = ++this.gameId;
    this.humanName.set(name.trim().slice(0, 24) || 'Player');
    this.engine = new PokerEngine(
      [
        { id: HUMAN_ID, name: this.humanName(), isHuman: true },
        ...PERSONAS.map((p) => ({ id: p.id, name: p.name, isHuman: false })),
      ],
      {
        startingStack: GAME_CONFIG.startingStack,
        smallBlind: GAME_CONFIG.smallBlind,
        bigBlind: GAME_CONFIG.bigBlind,
      },
    );
    this.chat.set([]);
    this.thoughts.set([]);
    this.recentRounds.set([]);
    this.sent.set(new Map());
    this.clearBubbles();
    this.thinkingBotId.set(null);
    this.sync();
    this.phase.set('playing');

    await this.ai.checkHealth();
    if (id === this.gameId) this.nextRound();
  }

  nextRound(): void {
    const engine = this.engine;
    if (!engine || !engine.state.handOver || engine.isGameOver()) return;
    engine.startHand();
    this.clearBubbles();
    this.sync();
    void this.runBots();
  }

  quitToMenu(): void {
    this.gameId++;
    this.engine = null;
    this.table.set(null);
    this.thinkingBotId.set(null);
    this.clearBubbles();
    this.phase.set('intro');
  }

  /** The human's move. Ignored if it isn't their turn. */
  act(action: PlayerAction): void {
    const engine = this.engine;
    if (!engine || !this.isHumanTurn()) return;
    engine.act(HUMAN_ID, action);
    this.sync();
    if (engine.state.handOver) this.recordRound();
    else void this.runBots();
  }

  // --- Chat ------------------------------------------------------------------

  /** Why the human can't message this bot right now, or null if they can. */
  messageBlocker(botId: string): string | null {
    const t = this.table();
    if (!t || t.round === 0) return 'Waiting for the deal';
    const bot = t.players.find((p) => p.id === botId);
    if (!bot) return 'Unknown player';
    if (bot.busted) return `${bot.name} is out of chips`;
    if (t.handOver) return 'Round over. Deal the next one to chat';
    if (bot.folded) return `${bot.name} folded this round`;
    if (this.messagesLeft(botId) <= 0) {
      return GAME_CONFIG.messageLimit.resetEach === 'street'
        ? 'Message used. You get another next street'
        : 'Message used. You get another next round';
    }
    if (this.thinkingBotId() === botId) return `${bot.name} is deciding a move…`;
    if (this.chat().some((m) => m.botId === botId && m.pending)) return `${bot.name} is replying…`;
    return null;
  }

  messagesLeft(botId: string): number {
    const t = this.table();
    if (!t) return 0;
    return GAME_CONFIG.messageLimit.perPlayer - (this.sent().get(this.allowanceKey(botId, t)) ?? 0);
  }

  async sendMessage(botId: string, raw: string): Promise<void> {
    const engine = this.engine;
    const t = this.table();
    const text = raw.trim().slice(0, GAME_CONFIG.maxMessageLength);
    if (!engine || !t || !text || this.messageBlocker(botId)) return;

    const id = this.gameId;
    const key = this.allowanceKey(botId, t);
    this.sent.update((m) => new Map(m).set(key, (m.get(key) ?? 0) + 1));

    const conversation = this.conversationFor(botId);
    const base = { botId, round: t.round, street: t.street };
    const sentMessage: ChatMessage = { ...base, id: this.nextId++, from: 'human', text };
    const placeholder: ChatMessage = {
      ...base,
      id: this.nextId++,
      from: 'bot',
      text: '',
      pending: true,
    };
    this.chat.update((c) => [...c, sentMessage, placeholder]);

    const task = this.ai
      .reply({
        personaId: botId,
        humanName: this.humanName(),
        view: buildBotView(engine, botId, this.recentRounds()),
        conversation,
        message: text,
      })
      .then((reply) => {
        if (id !== this.gameId) return;
        this.chat.update((c) =>
          c.map((m) =>
            m.id === placeholder.id
              ? { ...m, text: reply.text, pending: false, offline: reply.offline }
              : m,
          ),
        );
      });
    this.pendingReplies.set(botId, task);
    try {
      await task;
    } finally {
      if (this.pendingReplies.get(botId) === task) this.pendingReplies.delete(botId);
    }
  }

  // --- Bots ------------------------------------------------------------------

  private async runBots(): Promise<void> {
    const id = this.gameId;
    if (this.botLoopGameId === id) return; // already running for this game
    this.botLoopGameId = id;
    try {
      while (this.engine && id === this.gameId) {
        const p = this.engine.toAct;
        if (!p || p.isHuman || this.engine.state.handOver) break;
        await this.playBotTurn(p.id, id);
      }
    } finally {
      if (this.botLoopGameId === id) this.botLoopGameId = -1;
      if (id === this.gameId) this.thinkingBotId.set(null);
    }
  }

  private async playBotTurn(botId: string, id: number): Promise<void> {
    const engine = this.engine!;
    const round = engine.state.round;
    this.thinkingBotId.set(botId);

    // If the human just messaged this bot, let the reply land so the decision can use it.
    await this.pendingReplies.get(botId);
    if (id !== this.gameId) return;

    const started = performance.now();
    const conversation = this.conversationFor(botId);
    const heardMessage = conversation.some((m) => m.from === 'human' && m.round === round);
    const useAi = GAME_CONFIG.aiDecisions === 'always' || heardMessage;
    const decision = await this.ai.decide(
      {
        personaId: botId,
        humanName: this.humanName(),
        view: buildBotView(engine, botId, this.recentRounds()),
        conversation,
      },
      useAi,
    );
    const wait = GAME_CONFIG.minBotTurnMs - (performance.now() - started);
    if (wait > 0) await sleep(wait);
    if (id !== this.gameId || engine.toAct?.id !== botId || engine.state.round !== round) return;

    const street = engine.state.street;
    const legal = engine.legalActions();
    const action = toLegalAction(decision, legal);
    const talk = decision.tableTalk.trim();
    if (talk) {
      engine.addTableTalk(botId, talk);
      this.showBubble(botId, talk);
    }
    engine.act(botId, action);

    this.thoughts.update((list) => [
      ...list,
      {
        id: this.nextId++,
        botId,
        round,
        street,
        action: describeAction(action, legal),
        thought: decision.thought,
        offline: decision.offline,
        heardMessage,
      },
    ]);
    this.thinkingBotId.set(null);
    this.sync();
    if (engine.state.handOver) this.recordRound();
  }

  /** The private chat with one bot, oldest first, as sent to the server. */
  private conversationFor(botId: string): ChatTurn[] {
    return this.chat()
      .filter((m) => m.botId === botId && !m.pending)
      .slice(-12)
      .map((m) => ({ from: m.from, text: m.text, round: m.round }));
  }

  /** Saves a one-line summary of the finished round; bots see the last few. */
  private recordRound(): void {
    const t = this.engine!.state;
    const outcome = t.outcome;
    if (!outcome) return;
    let line = `Round ${t.round}: ${outcome.summary}`;
    if (outcome.showdown) {
      const shown = Object.entries(outcome.hands).map(([id, hand]) => {
        const p = t.players.find((x) => x.id === id)!;
        return `${p.name} showed ${p.hole.map(cardLabel).join(' ')} (${hand.description})`;
      });
      line += `. ${shown.join('; ')}`;
    }
    this.recentRounds.update((r) => [...r.slice(-5), line]);
  }

  private allowanceKey(botId: string, t: TableState): string {
    return GAME_CONFIG.messageLimit.resetEach === 'street'
      ? `${botId}:${t.round}:${t.street}`
      : `${botId}:${t.round}`;
  }

  private sync(): void {
    this.table.set(this.engine ? this.engine.snapshot() : null);
  }

  private showBubble(botId: string, text: string): void {
    this.bubbles.update((b) => ({ ...b, [botId]: text }));
    clearTimeout(this.bubbleTimers.get(botId));
    this.bubbleTimers.set(
      botId,
      setTimeout(() => {
        this.bubbles.update(({ [botId]: _removed, ...rest }) => rest);
      }, GAME_CONFIG.bubbleMs),
    );
  }

  private clearBubbles(): void {
    for (const timer of this.bubbleTimers.values()) clearTimeout(timer);
    this.bubbleTimers.clear();
    this.bubbles.set({});
  }
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
