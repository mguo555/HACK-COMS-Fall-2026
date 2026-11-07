import { BotDecision, BotView } from './ai.types';
import type { OfflineStyle } from '../shared/personas';

/**
 * Simple stand-in used when Gemini isn't used: compares the win chance to the pot odds,
 * nudged by the character's aggression and looseness. It ignores chat entirely.
 */
export function offlineDecision(
  view: BotView,
  style: OfflineStyle,
  random = Math.random,
): BotDecision {
  const { aggression, looseness } = style;
  const { legal, toCall, pot, blinds } = view;
  // Facing a bet, judge the hand against the bettor's likely range (wide if they bet all the
  // time). Loose players overrate their hands; tight ones underrate them.
  const base = view.facingBet?.winChance ?? view.winChance;
  const strength = base + (looseness - 0.5) * 0.12;
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;

  const wantsValueRaise = strength > 0.62 - aggression * 0.1;
  const wantsBluff = random() < aggression * 0.12;
  if (legal.canRaise && (wantsValueRaise || wantsBluff)) {
    const size = Math.max(
      blinds.big,
      Math.round((pot * (0.5 + aggression * 0.5)) / blinds.big) * blinds.big,
    );
    const raiseTo = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, view.currentBet + size));
    return decision(
      'raise',
      raiseTo,
      wantsValueRaise
        ? 'Strong hand. Time to build the pot.'
        : 'A little pressure might take this down.',
    );
  }

  if (legal.canCheck)
    return decision('check', 0, 'Nothing worth betting. I will take the free card.');

  const margin = 0.06 * (1 - looseness);
  if (strength >= potOdds + margin) return decision('call', 0, 'The price is right to keep going.');
  return decision('fold', 0, 'Not worth the chips.');
}

export function offlineReply(style: OfflineStyle, random = Math.random): string {
  const replies = style.replies;
  return replies[Math.floor(random() * replies.length)];
}

function decision(action: BotDecision['action'], raiseTo: number, thought: string): BotDecision {
  return { action, raiseTo, tableTalk: '', thought, influence: null, offline: true };
}
