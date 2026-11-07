import { afterEach, describe, expect, it, vi } from 'vitest';
import { offlineDecision } from '../ai/offline-bot';
import { CHARACTERS } from '../shared/personas';
import { parseCards, seededRng } from '../poker/cards';
import { LegalActions, PokerEngine, TableState } from '../poker/engine';
import { buildBotView, toLegalAction } from './bot-view';
import { PlayerHistory, feelingLabel } from './player-history';

const legal = (maxRaiseTo = 1000): LegalActions => ({
  canFold: true,
  canCheck: false,
  canCall: true,
  callAmount: 20,
  canRaise: true,
  minRaiseTo: 40,
  maxRaiseTo,
});

/** A finished-round table with only what endRound reads. */
function table(round: number, humanHole: string, board = ''): TableState {
  return {
    round,
    board: parseCards(board),
    outcome: { showdown: false, awards: [], hands: {}, summary: '' },
    players: [
      { id: 'you', name: 'Sam', isHuman: true, hole: parseCards(humanHole), folded: false },
      { id: 'rosie', name: 'Rosie', isHuman: false, hole: parseCards('Kd Kh'), folded: true },
    ],
  } as unknown as TableState;
}

describe('PlayerHistory', () => {
  it("widens a player's range the more often they shove", () => {
    const h = new PlayerHistory();
    const first = h.bettingRange('you', true);
    for (let r = 1; r <= 10; r++) {
      h.startRound(['you', 'rosie']);
      h.recordAction('you', { type: 'raise', to: 1000 }, legal());
      h.endRound(table(r, '7c 2d'), ['you'], {});
    }
    expect(first).toBeLessThan(0.2);
    expect(h.bettingRange('you', true)).toBeGreaterThan(0.6);
  });

  it('uses revealed cards: a rare raiser who raises junk still gets a wide range', () => {
    const h = new PlayerHistory();
    for (let r = 1; r <= 20; r++) {
      h.startRound(['you']);
      if (r % 5 === 0) h.recordAction('you', { type: 'raise', to: 60 }, legal());
      h.endRound(table(r, r % 2 ? '7c 2d' : '8s 3h'), ['you'], {});
    }
    // Raises only 20% of rounds, but always with trash, so the range is near "any two cards".
    expect(h.bettingRange('you', false)).toBeGreaterThan(0.7);
  });

  it('keeps a tight range for a player who only raises premium hands', () => {
    const h = new PlayerHistory();
    for (let r = 1; r <= 20; r++) {
      h.startRound(['you']);
      if (r % 5 === 0) h.recordAction('you', { type: 'raise', to: 60 }, legal());
      h.endRound(table(r, 'As Ah'), ['you'], {});
    }
    expect(h.bettingRange('you', false)).toBeLessThan(0.35);
  });

  it('catches bluffs in messages using the revealed cards, and keeps only 3 notes', () => {
    const h = new PlayerHistory();
    for (let r = 1; r <= 5; r++) {
      h.startRound(['you', 'rosie']);
      h.recordMessage('rosie', 'you', 'I have pocket aces, please fold');
      h.endRound(table(r, r === 5 ? 'Ac Ad' : '7c 2d'), ['you'], { rosie: ['Folded'] });
    }
    const p = h.profileFor('rosie', 'you', 'Sam');
    expect(p.messages).toBe(5);
    expect(p.claims).toBe(5);
    expect(p.bluffsCaught).toBe(4);
    expect(p.claimsBackedUp).toBe(1);
    expect(p.notes).toHaveLength(3);
    expect(p.notes[2]).toContain('Round 5');
    expect(p.notes[1]).toContain('It was a bluff.');
    // Being lied to four times leaves a grudge.
    expect(feelingLabel(p.feeling)).toBe('grudge');
  });

  it('keeps separate memories per human', () => {
    const h = new PlayerHistory();
    h.startRound(['you', 'rosie']);
    h.recordMessage('rosie', 'you', 'I have the nuts');
    h.endRound(table(1, '7c 2d'), ['you', 'alex'], {});
    h.adjustFeeling('rosie', 'alex', 0.4);
    expect(h.profileFor('rosie', 'you', 'Sam').bluffsCaught).toBe(1);
    expect(h.profileFor('rosie', 'alex', 'Alex').messages).toBe(0);
    expect(feelingLabel(h.profileFor('rosie', 'alex', 'Alex').feeling)).toBe('likes');
  });

  it('saves and restores one human (for the next game)', () => {
    const h = new PlayerHistory();
    h.startRound(['you']);
    h.recordAction('you', { type: 'call' }, legal());
    h.recordMessage('rosie', 'you', 'hello');
    h.endRound(table(1, '9c 9d'), ['you'], {});
    const saved = JSON.parse(JSON.stringify(h.exportPlayer('you')));
    const next = new PlayerHistory();
    next.importPlayer('h-1-abc', saved);
    const p = next.profileFor('rosie', 'h-1-abc', 'Sam');
    expect(p.rounds).toBe(1);
    expect(p.playedPct).toBe(100);
    expect(p.messages).toBe(1);
  });
});

describe('bots against a player who goes all-in every hand', () => {
  afterEach(() => vi.restoreAllMocks());

  it('call the shoves more as they learn, so shoving stops winning the blinds for free', () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRng(2026));
    const engine = new PokerEngine(
      [
        { id: 'you', name: 'Sam', isHuman: true },
        ...CHARACTERS.slice(0, 4).map((p) => ({ id: p.id, name: p.name, isHuman: false })),
      ],
      { random: seededRng(7) },
    );
    const history = new PlayerHistory();
    const early = { calls: 0, faced: 0 };
    const late = { calls: 0, faced: 0 };
    let lateRounds = 0;
    let lateSteals = 0;

    for (let round = 1; round <= 40; round++) {
      // Fresh 1000 stacks every round, so we can watch the same matchup for many rounds.
      for (const p of engine.state.players) Object.assign(p, { stack: 1000, busted: false });
      engine.startHand();
      history.startRound(engine.state.players.map((p) => p.id));
      let guard = 0;
      while (!engine.state.handOver && guard++ < 50) {
        const p = engine.toAct!;
        const lg = engine.legalActions();
        if (p.isHuman) {
          const action = lg.canRaise
            ? { type: 'raise' as const, to: lg.maxRaiseTo }
            : { type: 'call' as const };
          engine.act(p.id, action);
          history.recordAction(p.id, action, lg);
          continue;
        }
        const view = buildBotView(engine, p.id, [], history);
        const persona = CHARACTERS.find((x) => x.id === p.id)!;
        const action = toLegalAction(offlineDecision(view, persona.offline), lg);
        if (view.facingBet?.isHuman && view.facingBet.allIn) {
          const bucket = round <= 2 ? early : late;
          bucket.faced++;
          if (action.type !== 'fold') bucket.calls++;
        }
        engine.act(p.id, action);
        history.recordAction(p.id, action, lg);
      }
      history.endRound(engine.state, ['you'], {});
      if (round > 2) {
        lateRounds++;
        const o = engine.state.outcome!;
        if (!o.showdown && o.awards[0]?.playerId === 'you') lateSteals++;
      }
    }

    const earlyRate = early.calls / Math.max(1, early.faced);
    const lateRate = late.calls / Math.max(1, late.faced);
    // Once they've seen the shover's junk, bots call far more often than at first.
    expect(late.faced).toBeGreaterThan(50);
    expect(lateRate).toBeGreaterThan(0.25);
    expect(lateRate).toBeGreaterThan(earlyRate);
    // Before, everyone folded to the shove almost every round. Now someone usually calls.
    // (Chip results over 40 rounds are mostly luck: a called shove is close to a coin flip.)
    expect(lateSteals / lateRounds).toBeLessThan(0.35);
  });
});
