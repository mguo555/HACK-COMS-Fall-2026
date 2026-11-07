import { describe, expect, it } from 'vitest';
import { parseCards, seededRng } from './cards';
import { PokerEngine, SeatConfig, computePots } from './engine';

const seats = (n: number): SeatConfig[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isHuman: i === 0 }));

function newEngine(n = 3, seed = 7, startingStack = 1000) {
  const engine = new PokerEngine(seats(n), { random: seededRng(seed), startingStack });
  engine.startHand();
  return engine;
}

/** Plays check/call for whoever is to act until the hand ends. */
function checkDown(engine: PokerEngine) {
  let guard = 0;
  while (!engine.state.handOver && guard++ < 100) {
    const p = engine.toAct!;
    const legal = engine.legalActions();
    engine.act(p.id, legal.canCheck ? { type: 'check' } : { type: 'call' });
  }
}

const totalChips = (engine: PokerEngine) =>
  engine.state.players.reduce((sum, p) => sum + p.stack, 0) + engine.state.pot;

describe('PokerEngine', () => {
  it('posts blinds and deals two cards to everyone', () => {
    const engine = newEngine(4);
    const s = engine.state;
    expect(s.players[s.smallBlindIndex].streetBet).toBe(10);
    expect(s.players[s.bigBlindIndex].streetBet).toBe(20);
    expect(s.pot).toBe(30);
    expect(s.players.every((p) => p.hole.length === 2)).toBe(true);
    // First to act preflop is left of the big blind.
    expect(s.toActIndex).toBe((s.bigBlindIndex + 1) % 4);
  });

  it('heads-up: the dealer posts the small blind and acts first preflop', () => {
    const engine = newEngine(2);
    const s = engine.state;
    expect(s.smallBlindIndex).toBe(s.dealerIndex);
    expect(s.toActIndex).toBe(s.dealerIndex);
  });

  it('awards the pot when everyone else folds', () => {
    const engine = newEngine(3);
    const s = engine.state;
    const bb = s.players[s.bigBlindIndex];
    while (!s.handOver) engine.act(engine.toAct!.id, { type: 'fold' });
    expect(s.outcome?.showdown).toBe(false);
    expect(s.outcome?.awards).toEqual([{ playerId: bb.id, amount: 30 }]);
    expect(bb.stack).toBe(1010);
    expect(totalChips(engine)).toBe(3000);
  });

  it('gives the big blind an option after limps', () => {
    const engine = newEngine(3);
    const s = engine.state;
    engine.act(engine.toAct!.id, { type: 'call' });
    engine.act(engine.toAct!.id, { type: 'call' }); // small blind completes
    expect(s.toActIndex).toBe(s.bigBlindIndex);
    expect(engine.legalActions().canCheck).toBe(true);
    engine.act(engine.toAct!.id, { type: 'check' });
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
  });

  it('checks down to a showdown and conserves chips', () => {
    const engine = newEngine(4, 11);
    checkDown(engine);
    const s = engine.state;
    expect(s.street).toBe('showdown');
    expect(s.board).toHaveLength(5);
    expect(s.outcome?.showdown).toBe(true);
    expect(Object.keys(s.outcome!.hands)).toHaveLength(4);
    expect(totalChips(engine)).toBe(4000);
  });

  it('enforces minimum raises and reopens action after a raise', () => {
    const engine = newEngine(3);
    const s = engine.state;
    const first = engine.toAct!;
    expect(engine.legalActions().minRaiseTo).toBe(40);
    expect(() => engine.act(first.id, { type: 'raise', to: 30 })).toThrow();
    engine.act(first.id, { type: 'raise', to: 60 });
    expect(s.currentBet).toBe(60);
    expect(engine.legalActions().minRaiseTo).toBe(100); // raised by 40, so next raise is 40 more
    engine.act(engine.toAct!.id, { type: 'raise', to: 200 });
    engine.act(engine.toAct!.id, { type: 'call' });
    // Action is back on the first raiser, who can re-raise.
    expect(engine.toAct!.id).toBe(first.id);
    expect(engine.legalActions().canRaise).toBe(true);
  });

  it('returns an uncalled bet', () => {
    const engine = newEngine(2);
    const s = engine.state;
    const sb = s.players[s.smallBlindIndex];
    engine.act(sb.id, { type: 'raise', to: 500 });
    engine.act(engine.toAct!.id, { type: 'fold' });
    expect(sb.stack).toBe(1020); // won the big blind, got the rest back
  });

  it('runs out the board when everyone is all-in', () => {
    const engine = newEngine(3, 5);
    const s = engine.state;
    const first = engine.toAct!;
    engine.act(first.id, { type: 'raise', to: engine.legalActions().maxRaiseTo });
    engine.act(engine.toAct!.id, { type: 'call' });
    engine.act(engine.toAct!.id, { type: 'call' });
    expect(s.handOver).toBe(true);
    expect(s.board).toHaveLength(5);
    expect(totalChips(engine)).toBe(3000);
  });

  it('a short all-in does not let players who already acted re-raise', () => {
    const engine = new PokerEngine(seats(3), { random: seededRng(9) });
    const s = engine.state;
    engine.startHand();
    // Seat to act raises to 100; give the next player only 130 chips so their all-in is short.
    const opener = engine.toAct!;
    engine.act(opener.id, { type: 'raise', to: 100 });
    const shorty = engine.toAct!;
    shorty.stack = 130 - shorty.streetBet;
    engine.act(shorty.id, { type: 'raise', to: 130 }); // only +30, less than a full raise
    engine.act(engine.toAct!.id, { type: 'call' });
    expect(engine.toAct!.id).toBe(opener.id);
    const legal = engine.legalActions();
    expect(legal.callAmount).toBe(30);
    expect(legal.canRaise).toBe(false);
    expect(s.currentBet).toBe(130);
  });

  it('marks players with no chips as busted and skips them next hand', () => {
    const engine = newEngine(3, 3, 100);
    const s = engine.state;
    while (!s.handOver) {
      const legal = engine.legalActions();
      engine.act(
        engine.toAct!.id,
        legal.canRaise ? { type: 'raise', to: legal.maxRaiseTo } : { type: 'call' },
      );
    }
    const busted = s.players.filter((p) => p.busted);
    expect(busted.length).toBeGreaterThan(0);
    if (!engine.isGameOver()) {
      engine.startHand();
      for (const p of busted) expect(p.hole).toHaveLength(0);
    }
  });

  it('keeps chip totals constant over many random hands', () => {
    const rng = seededRng(42);
    const engine = new PokerEngine(seats(5), { random: rng });
    for (let hand = 0; hand < 200 && engine.playersInGame().length >= 2; hand++) {
      engine.startHand();
      let guard = 0;
      while (!engine.state.handOver && guard++ < 200) {
        const p = engine.toAct!;
        const legal = engine.legalActions();
        const roll = rng();
        if (roll < 0.15 && legal.canCall) engine.act(p.id, { type: 'fold' });
        else if (roll < 0.35 && legal.canRaise) {
          const to =
            legal.minRaiseTo + Math.floor(rng() * (legal.maxRaiseTo - legal.minRaiseTo + 1));
          engine.act(p.id, { type: 'raise', to });
        } else engine.act(p.id, legal.canCheck ? { type: 'check' } : { type: 'call' });
      }
      expect(engine.state.handOver).toBe(true);
      expect(totalChips(engine)).toBe(5000);
      expect(engine.state.players.every((p) => p.stack >= 0)).toBe(true);
    }
  });
});

describe('computePots', () => {
  it('builds side pots for short all-ins', () => {
    const pots = computePots([
      { id: 'a', handBet: 100, folded: false },
      { id: 'b', handBet: 300, folded: false },
      { id: 'c', handBet: 300, folded: false },
      { id: 'd', handBet: 50, folded: true },
    ]);
    expect(pots).toEqual([
      { amount: 350, eligible: ['a', 'b', 'c'] },
      { amount: 400, eligible: ['b', 'c'] },
    ]);
  });

  it('folded chips above the top live bet join the last pot', () => {
    const pots = computePots([
      { id: 'a', handBet: 100, folded: false },
      { id: 'b', handBet: 100, folded: false },
      { id: 'c', handBet: 150, folded: true },
    ]);
    expect(pots).toEqual([{ amount: 350, eligible: ['a', 'b'] }]);
  });
});

describe('showdown', () => {
  it('splits a pot between equal hands', () => {
    const engine = new PokerEngine(seats(2), { random: seededRng(1) });
    engine.startHand();
    const s = engine.state;
    // Rig the hand: both players play the board (a royal flush).
    s.players[0].hole = parseCards('2c 3d');
    s.players[1].hole = parseCards('2d 3c');
    s.deck = parseCards('As Ks Qs Js Ts 4h 5h 6h 7h').reverse();
    checkDown(engine);
    expect(s.outcome?.awards.map((a) => a.amount)).toEqual([20, 20]);
    expect(s.players.map((p) => p.stack)).toEqual([1000, 1000]);
  });
});
