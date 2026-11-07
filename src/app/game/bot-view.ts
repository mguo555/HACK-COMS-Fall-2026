import { BotActionType, BotDecision, BotView } from '../ai/ai.types';
import { cardLabel, rankName } from '../poker/cards';
import { LegalActions, PlayerAction, PokerEngine } from '../poker/engine';
import { estimateWinChance, estimateWinChanceVsRanges } from '../poker/equity';
import { evaluateHand } from '../poker/evaluator';
import { GAME_CONFIG } from './game.config';
import { PlayerHistory } from './player-history';

/** Range assumed for a player who called the current bet (they have something, often). */
const CALLER_RANGE = 0.5;

/**
 * Builds what `botId` can see: its own cards, the board, public actions and what it remembers
 * about the human. Never other players' cards.
 */
export function buildBotView(
  engine: PokerEngine,
  botId: string,
  recentRounds: string[],
  history: PlayerHistory,
): BotView {
  const s = engine.state;
  const index = s.players.findIndex((p) => p.id === botId);
  const me = s.players[index];
  const legal = engine.legalActions(index);
  const others = s.players.filter((p) => p.id !== botId && !p.folded);
  const opponents = others.length;
  const toCall = Math.max(0, s.currentBet - me.streetBet);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Facing a bet: judge the hand against the bettor's likely range (from how often they bet like
  // this) and anyone who already called, not against random hands from everyone still in.
  // Players who haven't acted yet are left out; they often fold.
  let facingBet: BotView['facingBet'] = null;
  if (toCall > 0 && others.length > 0) {
    const bettor = others.reduce((a, b) => (b.streetBet > a.streetBet ? b : a));
    const blindsOnly = s.street === 'preflop' && s.currentBet <= s.bigBlind;
    const range = blindsOnly ? 1 : history.bettingRange(bettor.id, bettor.allIn);
    const ranges = others
      .filter((p) => p === bettor || p.allIn || p.streetBet >= s.currentBet)
      .map((p) => (p === bettor ? range : CALLER_RANGE));
    facingBet = {
      bettor: bettor.name,
      isHuman: bettor.isHuman,
      allIn: bettor.allIn,
      rangePct: Math.round(range * 100),
      winChance: round2(
        estimateWinChanceVsRanges(me.hole, s.board, ranges, GAME_CONFIG.equityIterations),
      ),
    };
  }

  let madeHand: string | null = null;
  if (s.board.length >= 3) {
    madeHand = evaluateHand([...me.hole, ...s.board]).description;
  } else if (me.hole.length === 2 && me.hole[0].rank === me.hole[1].rank) {
    madeHand = `Pocket ${rankName(me.hole[0].rank, true)}`;
  }

  return {
    round: s.round,
    street: s.street,
    blinds: { small: s.smallBlind, big: s.bigBlind },
    hole: me.hole.map(cardLabel),
    board: s.board.map(cardLabel),
    madeHand,
    pot: s.pot,
    stack: me.stack,
    streetBet: me.streetBet,
    currentBet: s.currentBet,
    toCall,
    winChance: round2(estimateWinChance(me.hole, s.board, opponents, GAME_CONFIG.equityIterations)),
    facingBet,
    opponentsInHand: opponents,
    legal: {
      canCheck: legal.canCheck,
      callAmount: legal.callAmount,
      canRaise: legal.canRaise,
      minRaiseTo: legal.minRaiseTo,
      maxRaiseTo: legal.maxRaiseTo,
    },
    players: s.players.map((p, i) => ({
      name: p.name,
      stack: p.stack,
      streetBet: p.streetBet,
      status: p.busted ? 'out of chips' : p.folded ? 'folded' : p.allIn ? 'all-in' : 'in the hand',
      isHuman: p.isHuman,
      isSelf: p.id === botId,
      isDealer: i === s.dealerIndex,
    })),
    actionLog: s.log.filter((e) => e.round === s.round && e.kind !== 'round').map((e) => e.text),
    recentRounds: recentRounds.slice(-2),
    profiles: s.players
      .filter((p) => p.isHuman)
      .map((p) => history.profileFor(botId, p.id, p.name)),
  };
}

/**
 * Turns whatever the model chose into a legal move. The model usually picks legal moves, but the
 * engine is strict, so this guarantees a bad reply can't stall the game.
 */
export function toLegalAction(
  decision: Pick<BotDecision, 'action' | 'raiseTo'>,
  legal: LegalActions,
): PlayerAction {
  const check: PlayerAction = { type: 'check' };
  const call: PlayerAction = { type: 'call' };
  const action: BotActionType = decision.action;
  switch (action) {
    case 'fold':
      return legal.canCheck ? check : { type: 'fold' };
    case 'check':
      return legal.canCheck ? check : call;
    case 'call':
      return legal.canCall ? call : check;
    case 'raise': {
      if (!legal.canRaise) return legal.canCall ? call : check;
      const to = Math.min(
        legal.maxRaiseTo,
        Math.max(legal.minRaiseTo, Math.round(decision.raiseTo || 0)),
      );
      return { type: 'raise', to };
    }
  }
}
