import { describe, expect, it } from 'vitest';
import { parseCards, seededRng } from './cards';
import { estimateWinChance } from './equity';
import { evaluateHand } from './evaluator';

const hand = (codes: string) => evaluateHand(parseCards(codes));

describe('evaluateHand', () => {
  it.each([
    ['As Ks Qs Js Ts 2d 3c', 'Straight Flush', 'Royal Flush'],
    ['9h 8h 7h 6h 5h Ad Ac', 'Straight Flush', 'Straight Flush, Nine-high'],
    ['Kd Kh Kc Ks 2d 3c 4h', 'Four of a Kind', 'Four of a Kind, Kings'],
    ['Qd Qh Qc 7s 7d 2c 3h', 'Full House', 'Full House, Queens over Sevens'],
    ['Ah 9h 7h 4h 2h Kd Kc', 'Flush', 'Flush, Ace-high'],
    ['Ts 9d 8c 7h 6s 2d 2c', 'Straight', 'Straight, Ten-high'],
    ['Ad 2c 3h 4s 5d Kc Qh', 'Straight', 'Straight, Five-high'],
    ['8s 8d 8c Kh 2s 4d 6c', 'Three of a Kind', 'Three of a Kind, Eights'],
    ['Js Jd 4c 4h As 2d 7c', 'Two Pair', 'Two Pair, Jacks and Fours'],
    ['Ts Td 4c 8h As 2d 7c', 'Pair', 'Pair of Tens'],
    ['As Jd 9c 7h 4s 3d 2c', 'High Card', 'High Card, Ace'],
  ])('%s → %s', (codes, category, description) => {
    const result = hand(codes);
    expect(result.category).toBe(category);
    expect(result.description).toBe(description);
    expect(result.cards).toHaveLength(5);
  });

  it('ranks categories in the right order', () => {
    const ordered = [
      'As Jd 9c 7h 4s',
      'Ts Td 4c 8h As',
      'Js Jd 4c 4h As',
      '8s 8d 8c Kh 2s',
      'Ts 9d 8c 7h 6s',
      'Ah 9h 7h 4h 2h',
      'Qd Qh Qc 7s 7d',
      'Kd Kh Kc Ks 2d',
      '9h 8h 7h 6h 5h',
    ].map((c) => hand(c).score);
    expect([...ordered].sort((a, b) => a - b)).toEqual(ordered);
  });

  it('the wheel is the lowest straight', () => {
    expect(hand('Ad 2c 3h 4s 5d').score).toBeLessThan(hand('2c 3h 4s 5d 6c').score);
  });

  it('uses kickers to break ties', () => {
    expect(hand('As Ad Kc 7h 4s').score).toBeGreaterThan(hand('Ah Ac Qc 7d 4h').score);
    expect(hand('Js Jd 4c 4h As').score).toBeGreaterThan(hand('Jh Jc 4s 4d Ks').score);
  });

  it('picks the best two pair out of three pairs', () => {
    const result = hand('Ks Kd 9c 9h 5s 5d Ac');
    expect(result.description).toBe('Two Pair, Kings and Nines');
    expect(result.cards[4].rank).toBe(14);
  });

  it('two sets make a full house with the higher set on top', () => {
    expect(hand('7s 7d 7c 9h 9s 9d 2c').description).toBe('Full House, Nines over Sevens');
  });

  it('identical boards split', () => {
    expect(hand('As Ks Qs Js Ts 2d 3c').score).toBe(hand('As Ks Qs Js Ts 4h 5h').score);
  });
});

describe('estimateWinChance', () => {
  it('pocket aces win about 85% heads-up preflop', () => {
    const chance = estimateWinChance(parseCards('As Ah'), [], 1, 4000, seededRng(1));
    expect(chance).toBeGreaterThan(0.81);
    expect(chance).toBeLessThan(0.89);
  });

  it('a made royal flush always wins', () => {
    const chance = estimateWinChance(
      parseCards('As Ks'),
      parseCards('Qs Js Ts'),
      3,
      300,
      seededRng(2),
    );
    expect(chance).toBe(1);
  });

  it('more opponents means lower odds', () => {
    const hole = parseCards('Jh Td');
    const one = estimateWinChance(hole, [], 1, 2000, seededRng(3));
    const four = estimateWinChance(hole, [], 4, 2000, seededRng(3));
    expect(four).toBeLessThan(one);
  });
});
