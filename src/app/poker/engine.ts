import { Card, Rng, cardLabel, createDeck, shuffle } from './cards';
import { HandResult, evaluateHand } from './evaluator';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

/** `raise.to` is the player's total bet for this street after raising (a "bet" is a raise from 0). */
export type PlayerAction =
  { type: 'fold' } | { type: 'check' } | { type: 'call' } | { type: 'raise'; to: number };

export interface SeatConfig {
  id: string;
  name: string;
  isHuman: boolean;
}

export interface PlayerState extends SeatConfig {
  stack: number;
  hole: Card[];
  /** Chips put in during the current betting street. */
  streetBet: number;
  /** Chips put in during the whole hand (used for side pots). */
  handBet: number;
  folded: boolean;
  allIn: boolean;
  /** Out of chips; sits out for the rest of the game. */
  busted: boolean;
  /** Has acted since the last full raise. */
  hasActed: boolean;
  /** Short label for the seat, e.g. "Raise 120". Cleared each street. */
  lastAction: string | null;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Chips needed to call (capped at the player's stack). */
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
}

export interface Pot {
  amount: number;
  eligible: string[];
}

export interface Award {
  playerId: string;
  amount: number;
}

export interface HandOutcome {
  showdown: boolean;
  /** Total chips each winner received (side pots merged). */
  awards: Award[];
  /** Hands of players who reached showdown, keyed by player id. */
  hands: Record<string, HandResult>;
  summary: string;
}

export type LogKind = 'round' | 'deal' | 'action' | 'result';

export interface LogEntry {
  id: number;
  round: number;
  street: Street;
  kind: LogKind;
  text: string;
  playerId?: string;
}

export interface TableState {
  round: number;
  street: Street;
  board: Card[];
  deck: Card[];
  players: PlayerState[];
  dealerIndex: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  /** Index of the player whose turn it is, or -1. */
  toActIndex: number;
  /** Highest street bet so far this street. */
  currentBet: number;
  /** Size of the last full raise; the next raise must be at least this much more. */
  minRaise: number;
  smallBlind: number;
  bigBlind: number;
  pot: number;
  handOver: boolean;
  outcome: HandOutcome | null;
  log: LogEntry[];
}

export interface EngineOptions {
  startingStack?: number;
  smallBlind?: number;
  bigBlind?: number;
  random?: Rng;
}

const MAX_LOG = 400;

/**
 * No-limit Texas Hold'em table. Holds mutable state; call `snapshot()` to get a copy for the UI.
 * Throws on illegal actions — callers (bots, UI) are expected to pick from `legalActions()`.
 */
export class PokerEngine {
  readonly state: TableState;
  private readonly random: Rng;
  private nextLogId = 1;

  constructor(seats: SeatConfig[], options: EngineOptions = {}) {
    if (seats.length < 2) throw new Error('Need at least two players');
    this.random = options.random ?? Math.random;
    const startingStack = options.startingStack ?? 1000;
    const smallBlind = options.smallBlind ?? 10;
    const bigBlind = options.bigBlind ?? 20;

    this.state = {
      round: 0,
      street: 'preflop',
      board: [],
      deck: [],
      players: seats.map((seat) => ({
        ...seat,
        stack: startingStack,
        hole: [],
        streetBet: 0,
        handBet: 0,
        folded: false,
        allIn: false,
        busted: false,
        hasActed: false,
        lastAction: null,
      })),
      // startHand() moves the button one seat, so this picks a random first dealer.
      dealerIndex: Math.floor(this.random() * seats.length),
      smallBlindIndex: -1,
      bigBlindIndex: -1,
      toActIndex: -1,
      currentBet: 0,
      minRaise: bigBlind,
      smallBlind,
      bigBlind,
      pot: 0,
      handOver: true,
      outcome: null,
      log: [],
    };
  }

  snapshot(): TableState {
    return structuredClone(this.state);
  }

  get toAct(): PlayerState | null {
    const s = this.state;
    return s.toActIndex >= 0 ? s.players[s.toActIndex] : null;
  }

  player(id: string): PlayerState {
    const p = this.state.players.find((x) => x.id === id);
    if (!p) throw new Error(`Unknown player ${id}`);
    return p;
  }

  /** Players with chips left (not busted). */
  playersInGame(): PlayerState[] {
    return this.state.players.filter((p) => !p.busted);
  }

  isGameOver(): boolean {
    const human = this.state.players.find((p) => p.isHuman);
    return (human?.busted ?? false) || this.playersInGame().length < 2;
  }

  startHand(): void {
    const s = this.state;
    if (!s.handOver) throw new Error('Hand still in progress');
    if (this.playersInGame().length < 2) throw new Error('Not enough players with chips');

    s.round++;
    s.street = 'preflop';
    s.board = [];
    s.deck = shuffle(createDeck(), this.random);
    s.pot = 0;
    s.outcome = null;
    s.handOver = false;
    for (const p of s.players) {
      p.hole = [];
      p.streetBet = 0;
      p.handBet = 0;
      p.folded = p.busted;
      p.allIn = false;
      p.hasActed = false;
      p.lastAction = null;
    }

    const inGame = (p: PlayerState) => !p.busted;
    s.dealerIndex = this.nextSeat(s.dealerIndex, inGame);
    const headsUp = this.playersInGame().length === 2;
    // Heads-up, the dealer posts the small blind and acts first before the flop.
    s.smallBlindIndex = headsUp ? s.dealerIndex : this.nextSeat(s.dealerIndex, inGame);
    s.bigBlindIndex = this.nextSeat(s.smallBlindIndex, inGame);

    this.log('round', `Round ${s.round} — ${s.players[s.dealerIndex].name} has the dealer button`);
    this.postBlind(s.smallBlindIndex, s.smallBlind, 'small blind');
    this.postBlind(s.bigBlindIndex, s.bigBlind, 'big blind');
    s.currentBet = s.bigBlind;
    s.minRaise = s.bigBlind;

    for (let round = 0; round < 2; round++) {
      let i = s.dealerIndex;
      do {
        i = (i + 1) % s.players.length;
        if (!s.players[i].busted) s.players[i].hole.push(this.draw());
      } while (i !== s.dealerIndex);
    }

    s.toActIndex = this.nextToAct(s.bigBlindIndex);
    if (s.toActIndex === -1) this.finishStreet();
  }

  legalActions(playerIndex = this.state.toActIndex): LegalActions {
    const s = this.state;
    const p = s.players[playerIndex];
    const toCall = Math.max(0, s.currentBet - p.streetBet);
    const othersCanAct = s.players.some((o, i) => i !== playerIndex && this.canBet(o));
    // A player who already acted can't re-raise if they're only facing a short all-in.
    const canRaise = p.stack > toCall && !p.hasActed && othersCanAct;
    const maxRaiseTo = p.streetBet + p.stack;
    return {
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      callAmount: Math.min(toCall, p.stack),
      canRaise,
      minRaiseTo: Math.min(s.currentBet + s.minRaise, maxRaiseTo),
      maxRaiseTo,
    };
  }

  act(playerId: string, action: PlayerAction): void {
    const s = this.state;
    if (s.handOver) throw new Error('Hand is over');
    const index = s.toActIndex;
    const p = s.players[index];
    if (!p || p.id !== playerId) throw new Error(`It is not ${playerId}'s turn`);

    const legal = this.legalActions(index);
    if (action.type === 'call' && !legal.canCall) action = { type: 'check' };

    switch (action.type) {
      case 'fold':
        p.folded = true;
        p.lastAction = 'Fold';
        this.log('action', `${p.name} folds`, p.id);
        break;

      case 'check':
        if (!legal.canCheck) throw new Error(`${p.name} can't check`);
        p.lastAction = 'Check';
        this.log('action', `${p.name} checks`, p.id);
        break;

      case 'call': {
        const amount = legal.callAmount;
        this.commit(p, amount);
        p.lastAction = p.allIn ? 'All-in' : `Call ${amount}`;
        this.log(
          'action',
          p.allIn ? `${p.name} calls all-in for ${amount}` : `${p.name} calls ${amount}`,
          p.id,
        );
        break;
      }

      case 'raise': {
        const to = Math.floor(action.to);
        if (!legal.canRaise) throw new Error(`${p.name} can't raise`);
        if (to < legal.minRaiseTo || to > legal.maxRaiseTo) {
          throw new Error(`Raise to ${to} is outside ${legal.minRaiseTo}–${legal.maxRaiseTo}`);
        }
        const previousBet = s.currentBet;
        this.commit(p, to - p.streetBet);
        const raiseSize = to - previousBet;
        if (raiseSize >= s.minRaise) {
          // Full raise: reopens the action for everyone else.
          s.minRaise = raiseSize;
          for (const other of s.players) {
            if (other !== p && this.canBet(other)) other.hasActed = false;
          }
        }
        s.currentBet = Math.max(s.currentBet, to);
        const verb = previousBet === 0 ? 'bets' : 'raises to';
        p.lastAction = p.allIn ? 'All-in' : previousBet === 0 ? `Bet ${to}` : `Raise ${to}`;
        this.log(
          'action',
          p.allIn ? `${p.name} goes all-in (${to})` : `${p.name} ${verb} ${to}`,
          p.id,
        );
        break;
      }
    }

    p.hasActed = true;
    this.advance(index);
  }

  // ---------------------------------------------------------------------------

  private advance(fromIndex: number): void {
    const live = this.state.players.filter((p) => !p.folded);
    if (live.length === 1) {
      // The last player standing takes every chip, so no refund step is needed.
      this.awardUncontested(live[0]);
      return;
    }
    const next = this.nextToAct(fromIndex);
    if (next !== -1) {
      this.state.toActIndex = next;
      return;
    }
    this.finishStreet();
  }

  /** Closes the betting street and deals the next one (or goes to showdown). */
  private finishStreet(): void {
    const s = this.state;
    s.toActIndex = -1;
    this.returnUncalledBet();

    while (true) {
      for (const p of s.players) {
        p.streetBet = 0;
        p.hasActed = false;
        if (!p.folded && !p.allIn) p.lastAction = null;
      }
      s.currentBet = 0;
      s.minRaise = s.bigBlind;

      if (s.street === 'river') {
        this.showdown();
        return;
      }

      this.draw(); // burn
      if (s.street === 'preflop') {
        s.street = 'flop';
        s.board.push(this.draw(), this.draw(), this.draw());
      } else {
        s.street = s.street === 'flop' ? 'turn' : 'river';
        s.board.push(this.draw());
      }
      const label = s.street[0].toUpperCase() + s.street.slice(1);
      this.log('deal', `${label}: ${s.board.map(cardLabel).join(' ')}`);

      // If at most one player still has chips to bet, just run out the board.
      const bettors = s.players.filter((p) => this.canBet(p)).length;
      if (bettors >= 2) {
        s.toActIndex = this.nextToAct(s.dealerIndex);
        if (s.toActIndex !== -1) return;
      }
    }
  }

  private showdown(): void {
    const s = this.state;
    s.street = 'showdown';
    const live = s.players.filter((p) => !p.folded);
    const hands: Record<string, HandResult> = {};
    for (const p of live) hands[p.id] = evaluateHand([...p.hole, ...s.board]);

    const totals = new Map<string, number>();
    for (const pot of computePots(s.players)) {
      const contenders = pot.eligible.map((id) => this.player(id));
      const best = Math.max(...contenders.map((p) => hands[p.id].score));
      const winners = this.inSeatOrderFromDealer(
        contenders.filter((p) => hands[p.id].score === best),
      );
      const share = Math.floor(pot.amount / winners.length);
      let oddChips = pot.amount - share * winners.length;
      for (const w of winners) {
        const amount = share + (oddChips-- > 0 ? 1 : 0);
        w.stack += amount;
        totals.set(w.id, (totals.get(w.id) ?? 0) + amount);
      }
    }

    const awards = [...totals].map(([playerId, amount]) => ({ playerId, amount }));
    for (const p of live) {
      this.log(
        'result',
        `${p.name} shows ${p.hole.map(cardLabel).join(' ')} — ${hands[p.id].description}`,
        p.id,
      );
    }
    const summary = awards
      .map(
        (a) =>
          `${this.player(a.playerId).name} wins ${a.amount} with ${hands[a.playerId].description}`,
      )
      .join('; ');
    this.endHand({ showdown: true, awards, hands, summary });
  }

  private awardUncontested(winner: PlayerState): void {
    const amount = this.state.pot;
    winner.stack += amount;
    this.endHand({
      showdown: false,
      awards: [{ playerId: winner.id, amount }],
      hands: {},
      summary: `${winner.name} wins ${amount} — everyone else folded`,
    });
  }

  private endHand(outcome: HandOutcome): void {
    const s = this.state;
    s.outcome = outcome;
    s.handOver = true;
    s.toActIndex = -1;
    s.pot = 0;
    for (const p of s.players) {
      p.streetBet = 0;
      if (p.stack === 0 && !p.busted) {
        p.busted = true;
        this.log('result', `${p.name} is out of chips`, p.id);
      }
    }
    this.log('result', outcome.summary);
  }

  /** If the top bet this street was never matched, give the unmatched part back. */
  private returnUncalledBet(): void {
    const s = this.state;
    const [top, second] = s.players.slice().sort((a, b) => b.streetBet - a.streetBet);
    const excess = top.streetBet - (second?.streetBet ?? 0);
    if (excess <= 0) return;
    top.stack += excess;
    top.streetBet -= excess;
    top.handBet -= excess;
    top.allIn = false;
    s.pot -= excess;
    this.log('action', `Uncalled ${excess} returned to ${top.name}`, top.id);
  }

  private postBlind(index: number, amount: number, label: string): void {
    const p = this.state.players[index];
    const posted = Math.min(amount, p.stack);
    this.commit(p, posted);
    p.lastAction = label === 'small blind' ? `SB ${posted}` : `BB ${posted}`;
    this.log('action', `${p.name} posts ${label} ${posted}`, p.id);
  }

  private commit(p: PlayerState, amount: number): void {
    const chips = Math.min(amount, p.stack);
    p.stack -= chips;
    p.streetBet += chips;
    p.handBet += chips;
    this.state.pot += chips;
    if (p.stack === 0) p.allIn = true;
  }

  private canBet(p: PlayerState): boolean {
    return !p.folded && !p.allIn && !p.busted;
  }

  private needsToAct(index: number): boolean {
    const s = this.state;
    const p = s.players[index];
    if (!this.canBet(p)) return false;
    if (p.streetBet < s.currentBet) return true;
    if (p.hasActed) return false;
    // Nothing to call and nobody left who could respond to a bet: no decision to make.
    return s.players.some((o, i) => i !== index && this.canBet(o));
  }

  /** First seat after `fromIndex` (wrapping, ending on `fromIndex` itself) that must act. */
  private nextToAct(fromIndex: number): number {
    const n = this.state.players.length;
    for (let step = 1; step <= n; step++) {
      const i = (fromIndex + step) % n;
      if (this.needsToAct(i)) return i;
    }
    return -1;
  }

  private nextSeat(fromIndex: number, predicate: (p: PlayerState) => boolean): number {
    const n = this.state.players.length;
    for (let step = 1; step <= n; step++) {
      const i = (((fromIndex + step) % n) + n) % n;
      if (predicate(this.state.players[i])) return i;
    }
    return -1;
  }

  private inSeatOrderFromDealer(players: PlayerState[]): PlayerState[] {
    const n = this.state.players.length;
    const seat = (p: PlayerState) =>
      (this.state.players.indexOf(p) - this.state.dealerIndex - 1 + n) % n;
    return players.slice().sort((a, b) => seat(a) - seat(b));
  }

  private draw(): Card {
    const card = this.state.deck.pop();
    if (!card) throw new Error('Deck is empty');
    return card;
  }

  private log(kind: LogKind, text: string, playerId?: string): void {
    const s = this.state;
    s.log.push({ id: this.nextLogId++, round: s.round, street: s.street, kind, text, playerId });
    if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
  }
}

/**
 * Splits the chips everyone put in this hand into a main pot and side pots. Folded players'
 * chips count toward the pots but they can't win them.
 */
export function computePots(
  players: ReadonlyArray<Pick<PlayerState, 'id' | 'handBet' | 'folded'>>,
): Pot[] {
  const levels = [
    ...new Set(players.filter((p) => !p.folded && p.handBet > 0).map((p) => p.handBet)),
  ].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previous = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) amount += Math.max(0, Math.min(p.handBet, level) - previous);
    const eligible = players.filter((p) => !p.folded && p.handBet >= level).map((p) => p.id);
    const last = pots[pots.length - 1];
    if (last && last.eligible.length === eligible.length) {
      last.amount += amount; // same contenders: merge
    } else if (amount > 0) {
      pots.push({ amount, eligible });
    }
    previous = level;
  }
  // Chips above the highest live bet (only possible from folded players) join the last pot.
  const leftover = players.reduce((sum, p) => sum + Math.max(0, p.handBet - previous), 0);
  if (leftover > 0 && pots.length > 0) pots[pots.length - 1].amount += leftover;
  return pots;
}
