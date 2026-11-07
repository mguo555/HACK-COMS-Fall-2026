import { BotActionType, BotDecision, BotView } from '../ai/ai.types';
import { cardLabel, rankName } from '../poker/cards';
import { LegalActions, PlayerAction, PokerEngine } from '../poker/engine';
import { estimateWinChance } from '../poker/equity';
import { evaluateHand } from '../poker/evaluator';
import { GAME_CONFIG } from './game.config';

/** Builds what `botId` can see: its own cards, the board, public actions — never other hands. */
export function buildBotView(engine: PokerEngine, botId: string, recentRounds: string[]): BotView {
  const s = engine.state;
  const index = s.players.findIndex((p) => p.id === botId);
  const me = s.players[index];
  const legal = engine.legalActions(index);
  const opponents = s.players.filter((p) => p.id !== botId && !p.folded).length;

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
    toCall: Math.max(0, s.currentBet - me.streetBet),
    winChance:
      Math.round(
        estimateWinChance(me.hole, s.board, opponents, GAME_CONFIG.equityIterations) * 100,
      ) / 100,
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
    recentRounds: recentRounds.slice(-3),
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
